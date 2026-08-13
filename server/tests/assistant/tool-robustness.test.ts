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

import { resetPolicy } from "../../src/rbac/policy";
import { ASSISTANT_TOOL_DEFS } from "../../src/assistant/tools";
import type { LoggedInClient } from "../test-utils/app";
import { rbacWorkspace, userWithSystemRole } from "../rbac/helpers";

/**
 * NEGATIVE-PATH SWEEP (AI_ASSISTANT_DEEP_PLAN.md P8).
 *
 * The model writes the tool arguments, and it writes them wrong sometimes: a
 * number where a string belongs, a missing required field, an enum value that
 * does not exist, a whole argument object that is empty. None of that may
 * become a 500 or an unhandled throw — the chat has to keep working and the
 * bot has to get something it can READ and relay.
 *
 * `AssistantService.appendToolRound` has a last-resort catch that turns a
 * throw into `{"error":"tool_execution_failed"}`. That backstop existing is
 * good; RELYING on it is not — it tells the user nothing. So these tests fail
 * on it too: every tool must answer garbage with its own readable error.
 */

const CHAT = "/api/v1/assistant/chat";

beforeAll(() => {
    resetPolicy();
});

const modelCalling = (name: string, args: unknown) => {
    const seen: string[] = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(
        (params: { messages?: { role: string; content?: string }[] }) => {
            const toolMsg = (params.messages ?? []).find(
                (m) => m.role === "tool",
            );
            if (!toolMsg) {
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
                                                    name,
                                                    arguments:
                                                        JSON.stringify(args),
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
            seen.push(String(toolMsg.content ?? ""));
            return Promise.resolve(
                (async function* () {
                    yield { choices: [{ delta: { content: "ok" } }] };
                })(),
            );
        },
    );
    return seen;
};

const call = async (
    client: LoggedInClient,
    name: string,
    args: unknown,
): Promise<Record<string, unknown>> => {
    const seen = modelCalling(name, args);
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "?" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    return JSON.parse(seen[0]) as Record<string, unknown>;
};

/** Every tool, paired with arguments a confused model might actually emit. */
const GARBAGE: Array<[string, unknown]> = [
    ["get_my_task_counts", { unexpected: true }],
    ["get_my_agenda", { date: 20260813 }],
    ["get_my_agenda", { date: "not-a-date" }],
    ["search", {}],
    ["search", { query: null }],
    ["get_my_tasks", { bucket: "yesterday" }],
    ["get_my_tasks", { bucket: 7 }],
    ["get_task_details", {}],
    ["get_task_details", { task: "" }],
    ["get_task_details", { task: { name: "nested" } }],
    ["get_people", {}],
    ["get_people", { action: "nonsense" }],
    ["get_people", { action: "team_roster" }],
    ["get_people", { action: "find_person", person_name: 42 }],
    ["get_my_approvals", { box: "everything" }],
    ["get_report_status", { team_name: 99 }],
    ["get_sla_breaches", { limit: "all" }],
    ["create_task", {}],
    ["create_task", { name: "no list named" }],
    ["create_task", { name: "bad priority", list_name: "x", priority: "high" }],
    ["create_task", { name: "bad date", list_name: "x", due_date: 20260101 }],
];

describe("tools survive whatever the model sends", () => {
    it("covers every tool the assistant offers", () => {
        // If a new tool ships without a garbage case, this fails — the sweep
        // is only a sweep while it is complete.
        const covered = new Set(GARBAGE.map(([name]) => name));
        const offered = ASSISTANT_TOOL_DEFS.map(
            (t) => (t as { function: { name: string } }).function.name,
        );
        expect(offered.filter((n) => !covered.has(n))).toEqual([]);
    });

    it.each(GARBAGE)(
        "%s with bad arguments answers readably, never a crash",
        async (name, args) => {
            const ws = await rbacWorkspace();
            const owner = await userWithSystemRole(ws, "owner");

            const result = await call(owner.client, name, args);

            // Never the service's last-resort catch: that string tells the
            // user nothing, so a tool leaning on it is a tool with a hole.
            expect(result.error).not.toBe("tool_execution_failed");
            // Either it answered, or it explained itself in words.
            if (result.error !== undefined) {
                expect(typeof result.error).toBe("string");
                expect(String(result.error).length).toBeGreaterThan(4);
            } else {
                expect(Object.keys(result).length).toBeGreaterThan(0);
            }
        },
        60_000,
    );

    it("an unknown tool name is reported, not thrown", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const result = await call(owner.client, "delete_everything", {});

        expect(String(result.error)).toContain("Unknown tool");
    });
});
