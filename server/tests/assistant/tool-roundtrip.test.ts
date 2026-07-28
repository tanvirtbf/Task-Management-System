// The OpenAI client is mocked so this suite never makes a real API call.
const mockCreate = jest.fn();
jest.mock("../../src/services/openaiClient", () => ({
    openai: {
        chat: {
            completions: {
                create: (...args: unknown[]) => mockCreate(...args),
            },
        },
    },
    ASSISTANT_MODEL: "gpt-4o-mini",
    ASSISTANT_MAX_OUTPUT_TOKENS: 800,
    createOpenAIClient: () => null,
}));

import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import type { LoggedInClient } from "../test-utils/app";

/**
 * P1 — a round that produced tool calls must ALWAYS execute them.
 *
 * The bug this pins: `streamReply` used to return as soon as any content had
 * been streamed, so a model that opened with a lead-in sentence *and then*
 * called a tool had its tool call silently thrown away. Under the Bangla-always
 * system prompt gpt-4o-mini does that constantly — only 2 of 10 live data
 * questions came back with a real number (the P0 baseline).
 *
 * These tests drive the real HTTP route with a fake stream, so they cover the
 * controller → service → tool-executor path exactly as production runs it.
 */

const ROUTE = "/api/v1/assistant/chat";

type Msg = { role: string; content?: string | null };

/** A stream that yields the given text deltas, then the given tool call. */
const streamOf = (opts: { text?: string[]; tool?: { name: string; args?: string } }) =>
    Promise.resolve(
        (async function* () {
            for (const t of opts.text ?? []) {
                yield { choices: [{ delta: { content: t } }] };
            }
            if (opts.tool) {
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
                                            name: opts.tool.name,
                                            arguments: opts.tool.args ?? "{}",
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                };
            }
        })(),
    );

const setup = async (): Promise<{ client: LoggedInClient }> => {
    const user = await makeUser({ role: "member" });
    return { client: await makeLoggedInClient(user) };
};

const sse = (client: LoggedInClient, message: string) =>
    client.post(ROUTE).set("Accept", "text/event-stream").send({ message });

beforeEach(() => {
    mockCreate.mockReset();
});

describe("tool round-trip — a lead-in sentence must not cancel the tool call", () => {
    it("THE REGRESSION: content + tool_call in one round still runs the tool", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const answered = (params.messages ?? []).some((m) => m.role === "tool");
            return answered
                ? streamOf({ text: ["Apnar hisab: ", "DONE"] })
                : // A lead-in, THEN the tool call — the exact shape that used
                  // to make the tool disappear.
                  streamOf({
                      text: ["Ekhu dekhchi... "],
                      tool: { name: "get_my_task_counts" },
                  });
        });

        const res = await sse(client, "amar koyta task overdue?");

        expect(res.status).toBe(200);
        // Two model calls = the tool round-trip actually happened.
        expect(mockCreate).toHaveBeenCalledTimes(2);
        // The user saw the lead-in AND the real answer.
        expect(res.text).toContain("Ekhu dekhchi");
        expect(res.text).toContain("DONE");
    });

    it("feeds the tool's REAL result back to the model", async () => {
        const { client } = await setup();
        let toolResultSeen: string | null = null;
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const toolMsg = (params.messages ?? []).find((m) => m.role === "tool");
            if (!toolMsg) {
                return streamOf({
                    text: ["ek second... "],
                    tool: { name: "get_my_task_counts" },
                });
            }
            toolResultSeen = String(toolMsg.content ?? "");
            return streamOf({ text: [toolResultSeen] });
        });

        const res = await sse(client, "how many open tasks do I have?");

        expect(res.status).toBe(200);
        // The executor ran the real tool against the real DB, not a stub.
        expect(toolResultSeen).toContain("openTasksAssignedToMe");
        expect(res.text).toContain("openTasksAssignedToMe");
    });

    it("carries the already-streamed lead-in into the follow-up turn", async () => {
        // Without this the model repeats itself, because round 2 has no record
        // of what the reader has already been shown.
        const { client } = await setup();
        const assistantTurns: (string | null | undefined)[] = [];
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const withTools = (params.messages ?? []).filter(
                (m) => m.role === "assistant",
            );
            for (const m of withTools) assistantTurns.push(m.content);
            const answered = (params.messages ?? []).some((m) => m.role === "tool");
            return answered
                ? streamOf({ text: ["ok"] })
                : streamOf({
                      text: ["Ekhu dekhchi... "],
                      tool: { name: "get_my_task_counts" },
                  });
        });

        await sse(client, "amar kaj koyta?");

        expect(assistantTurns).toContain("Ekhu dekhchi... ");
    });

    it("still executes a bare tool call (no lead-in) — the old happy path", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const answered = (params.messages ?? []).some((m) => m.role === "tool");
            return answered
                ? streamOf({ text: ["answer"] })
                : streamOf({ tool: { name: "get_my_task_counts" } });
        });

        const res = await sse(client, "counts please");

        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(res.text).toContain("answer");
    });

    it("a plain answer with NO tool call still ends in one round", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation(() => streamOf({ text: ["shudhu uttor"] }));

        const res = await sse(client, "Board view ki?");

        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(res.text).toContain("shudhu uttor");
    });

    it("survives a tool that throws — the model still gets a round to answer", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const toolMsg = (params.messages ?? []).find((m) => m.role === "tool");
            if (!toolMsg) {
                return streamOf({
                    text: ["dekhchi "],
                    // Unknown tool name → the executor returns an error object.
                    tool: { name: "no_such_tool" },
                });
            }
            return streamOf({ text: [String(toolMsg.content ?? "")] });
        });

        const res = await sse(client, "break it");

        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(res.text).toContain("Unknown tool");
    });

    it("caps the rounds so a tool-calling loop cannot run away", async () => {
        const { client } = await setup();
        // A model that ALWAYS asks for a tool, never answers.
        mockCreate.mockImplementation(() =>
            streamOf({ text: ["again "], tool: { name: "get_my_task_counts" } }),
        );

        const res = await sse(client, "loop forever");

        expect(res.status).toBe(200);
        // maxRounds is 4; the last round runs without tools, so the model is
        // called at most 4 times no matter how insistent it is.
        expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(4);
    });
});

/**
 * P9 / decision D-9 — the JSON transport gets the same tools as SSE.
 *
 * Until P9 `POST /assistant/chat` (no `Accept: text/event-stream`) ran without
 * tools, so it silently could not answer a data question its own SSE twin
 * answered fine. The browser always streams, so nobody noticed — which is
 * precisely why it was worth removing rather than documenting.
 */
describe("the JSON path has the same tools as the streaming path", () => {
    const jsonAsk = (client: LoggedInClient, message: string) =>
        client.post(ROUTE).send({ message }); // no Accept: text/event-stream

    it("calls a tool and answers from its result", async () => {
        const { client } = await setup();
        let toolResultSeen: string | null = null;
        mockCreate.mockImplementation((params: { messages?: Msg[] }) => {
            const toolMsg = (params.messages ?? []).find((m) => m.role === "tool");
            if (!toolMsg) {
                return Promise.resolve({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: null,
                                tool_calls: [
                                    {
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
                });
            }
            toolResultSeen = String(toolMsg.content ?? "");
            return Promise.resolve({
                choices: [
                    { message: { role: "assistant", content: toolResultSeen } },
                ],
            });
        });

        const res = await jsonAsk(client, "how many open tasks do I have?");

        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(toolResultSeen).toContain("openTasksAssignedToMe");
        expect(res.body.reply).toContain("openTasksAssignedToMe");
    });

    it("still answers plainly when no tool is needed (one round)", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation(() =>
            Promise.resolve({
                choices: [{ message: { role: "assistant", content: "shudhu uttor" } }],
            }),
        );

        const res = await jsonAsk(client, "Board view ki?");

        expect(res.status).toBe(200);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(res.body.reply).toBe("shudhu uttor");
    });

    it("caps the rounds here too — a tool-hungry model cannot loop", async () => {
        const { client } = await setup();
        mockCreate.mockImplementation(() =>
            Promise.resolve({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
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
            }),
        );

        const res = await jsonAsk(client, "loop forever");

        // Never answered → a clean 502, not a hang and not a silent empty body.
        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe("assistant.empty_reply");
        expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(4);
    });
});
