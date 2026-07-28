// The OpenAI client is mocked so the suite never makes a real API call. The
// factory references `mockCreate` (the `mock` prefix is allowed by jest's
// out-of-scope guard); it resolves lazily when the app first imports the module.
const mockCreate = jest.fn();
jest.mock("../../src/services/openaiClient", () => ({
    openai: {
        chat: {
            completions: {
                create: (...args: unknown[]) => mockCreate(...args),
            },
        },
    },
    ASSISTANT_MODEL: "test-model",
    ASSISTANT_MAX_OUTPUT_TOKENS: 100,
}));

import { oneOff } from "../test-utils/app";
import { makeUser, makeLoggedInClient } from "../test-utils/factories";

const ROUTE = "/api/v1/assistant/chat";

/** Fresh user + authenticated client (user-scoped isolation, no DB reset). */
const setup = async () => {
    const user = await makeUser();
    const client = await makeLoggedInClient(user);
    return { user, client };
};

beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation((params: { stream?: boolean }) => {
        if (params?.stream) {
            const gen = (async function* () {
                yield { choices: [{ delta: { content: "Hello " } }] };
                yield { choices: [{ delta: { content: "world" } }] };
            })();
            return Promise.resolve(gen);
        }
        return Promise.resolve({
            choices: [{ message: { content: "MOCK REPLY" } }],
            usage: { total_tokens: 42 },
        });
    });
});

describe("AI Help Assistant — auth & validation", () => {
    it("401 without authentication", async () => {
        const req = await oneOff();
        const res = await req.post(ROUTE).send({ message: "hi" });
        expect(res.status).toBe(401);
    });

    it("422 on an empty message", async () => {
        const { client } = await setup();
        const res = await client.post(ROUTE).send({ message: "" });
        expect(res.status).toBe(422);
    });

    it("422 when message is missing", async () => {
        const { client } = await setup();
        const res = await client.post(ROUTE).send({});
        expect(res.status).toBe(422);
    });
});

describe("AI Help Assistant — non-streaming chat + persistence", () => {
    it("returns the reply + conversationId and persists both turns", async () => {
        const { client } = await setup();
        const res = await client.post(ROUTE).send({ message: "Inbox kothay?" });

        expect(res.status).toBe(200);
        expect(res.body.reply).toBe("MOCK REPLY");
        expect(typeof res.body.conversationId).toBe("string");
        expect(mockCreate).toHaveBeenCalledTimes(1);

        const convId = res.body.conversationId as string;

        const list = await client.get("/api/v1/assistant/conversations");
        expect(list.status).toBe(200);
        expect(list.body.conversations).toHaveLength(1);
        expect(list.body.conversations[0].id).toBe(convId);
        expect(list.body.conversations[0].title).toBe("Inbox kothay?");

        const conv = await client.get(
            `/api/v1/assistant/conversations/${convId}`,
        );
        expect(conv.status).toBe(200);
        expect(conv.body.messages).toHaveLength(2);
        expect(conv.body.messages[0]).toMatchObject({
            role: "user",
            content: "Inbox kothay?",
        });
        expect(conv.body.messages[1]).toMatchObject({
            role: "assistant",
            content: "MOCK REPLY",
        });
    });

    it("threads onto the same conversation when conversationId is supplied", async () => {
        const { client } = await setup();
        const first = await client.post(ROUTE).send({ message: "q1" });
        const convId = first.body.conversationId as string;

        const second = await client
            .post(ROUTE)
            .send({ message: "q2", conversationId: convId });
        expect(second.body.conversationId).toBe(convId);

        const conv = await client.get(
            `/api/v1/assistant/conversations/${convId}`,
        );
        expect(conv.body.messages).toHaveLength(4);
    });
});

describe("AI Help Assistant — ownership", () => {
    it("404 on an unknown conversation id", async () => {
        const { client } = await setup();
        const res = await client.get(
            "/api/v1/assistant/conversations/conv-nope",
        );
        expect(res.status).toBe(404);
    });

    it("a user cannot read another user's conversation", async () => {
        const a = await setup();
        const first = await a.client.post(ROUTE).send({ message: "secret" });
        const convId = first.body.conversationId as string;

        const b = await setup();
        const res = await b.client.get(
            `/api/v1/assistant/conversations/${convId}`,
        );
        expect(res.status).toBe(404);
    });
});

describe("AI Help Assistant — streaming (SSE)", () => {
    it("streams delta events + [DONE] with an X-Conversation-Id header", async () => {
        const { client } = await setup();
        const res = await client
            .post(ROUTE)
            .set("Accept", "text/event-stream")
            .send({ message: "stream please" });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.headers["x-conversation-id"]).toBeTruthy();
        expect(res.text).toContain('data: {"delta":"Hello "}');
        expect(res.text).toContain("data: [DONE]");

        // The joined deltas are persisted as the assistant turn.
        const convId = res.headers["x-conversation-id"];
        const conv = await client.get(
            `/api/v1/assistant/conversations/${convId}`,
        );
        expect(conv.body.messages).toHaveLength(2);
        expect(conv.body.messages[1]).toMatchObject({
            role: "assistant",
            content: "Hello world",
        });
    });
});

describe("AI Help Assistant — OpenAI error mapping (no raw leak)", () => {
    it("maps a 429 to 503 assistant.rate_limited", async () => {
        const { client } = await setup();
        mockCreate.mockReset();
        mockCreate.mockRejectedValueOnce(
            Object.assign(new Error("rate"), { status: 429 }),
        );
        const res = await client.post(ROUTE).send({ message: "hi" });
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("assistant.rate_limited");
    });

    it("maps an unknown error to 502 assistant.upstream_error", async () => {
        const { client } = await setup();
        mockCreate.mockReset();
        mockCreate.mockRejectedValueOnce(new Error("boom"));
        const res = await client.post(ROUTE).send({ message: "hi" });
        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe("assistant.upstream_error");
    });
});

describe("AI Help Assistant — data-aware tools (Phase 8)", () => {
    it("calls a tool, feeds the result back, and answers (agentic loop)", async () => {
        const { client } = await setup();
        // First streamed call → request the get_my_task_counts tool; the second
        // call (after the tool result is appended) → answer echoing it.
        mockCreate.mockReset();
        mockCreate.mockImplementation(
            (params: { messages?: { role: string; content?: string }[] }) => {
                const msgs = params.messages ?? [];
                const hasToolResult = msgs.some((m) => m.role === "tool");
                if (!hasToolResult) {
                    return Promise.resolve(
                        (async function* () {
                            yield {
                                choices: [
                                    {
                                        delta: {
                                            tool_calls: [
                                                {
                                                    index: 0,
                                                    id: "call_1",
                                                    type: "function",
                                                    function: {
                                                        name: "get_my_task_counts",
                                                        arguments: "{}",
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            };
                        })(),
                    );
                }
                const toolMsg = msgs.find((m) => m.role === "tool");
                return Promise.resolve(
                    (async function* () {
                        yield {
                            choices: [
                                { delta: { content: "Here is your summary: " } },
                            ],
                        };
                        yield {
                            choices: [
                                {
                                    delta: {
                                        content: String(toolMsg?.content ?? ""),
                                    },
                                },
                            ],
                        };
                    })(),
                );
            },
        );

        const res = await client
            .post(ROUTE)
            .set("Accept", "text/event-stream")
            .send({ message: "how many overdue tasks do I have?" });

        expect(res.status).toBe(200);
        // Two model calls: one to request the tool, one to answer with its result.
        expect(mockCreate).toHaveBeenCalledTimes(2);
        // The executor ran get_my_task_counts and its result was fed back + echoed.
        expect(res.text).toContain("openTasksAssignedToMe");
        expect(res.text).toContain("myTasksOverdue");
    });
});
