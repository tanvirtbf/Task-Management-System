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
import { makeTask } from "../test-utils/factories";
import type { LoggedInClient } from "../test-utils/app";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * P8 — landmine L12: the assistant must not become a way around RBAC.
 *
 * Its tools read through `SearchRepo` and `HomeRepo`, which the RBAC work
 * taught to filter by the caller's visibility. That filter comes from an
 * AsyncLocalStorage context established per request — and the assistant is the
 * one place in the app that reads the database from **inside a streaming loop**,
 * several awaits deep in an OpenAI response iterator. If the context did not
 * survive that, every tool would quietly run unrestricted and the bot would be
 * the widest hole in the system.
 *
 * The scan reasoned it through and probed the async shape in isolation. These
 * tests prove it end to end, against a real database, through the real route.
 */

const CHAT = "/api/v1/assistant/chat";

/** Make the model ask for `tool`, then echo whatever the tool returned. */
const modelCalling = (tool: string, args: Record<string, unknown> = {}) => {
    const seen: string[] = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation((params: { messages?: { role: string; content?: string }[] }) => {
        const toolMsg = (params.messages ?? []).find((m) => m.role === "tool");
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
                                                name: tool,
                                                arguments: JSON.stringify(args),
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
    });
    return seen;
};

const askAndCaptureToolResult = async (
    client: LoggedInClient,
    message: string,
    seen: string[],
): Promise<string> => {
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message });
    expect(res.status).toBe(200);
    // The tool result is what the MODEL was shown — i.e. exactly what could
    // leak. Asserting on the rendered answer would test the model's discretion;
    // asserting here tests the boundary.
    expect(seen).toHaveLength(1);
    return seen[0];
};

beforeAll(() => resetPolicy());

describe("L12 — the assistant's search tool obeys the caller's visibility", () => {
    /** Two departments, one task each, plus a user who belongs to only one. */
    const twoDepartments = async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktList = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);
        await makeTask({
            workspaceId: ws.id,
            listId: mktList,
            name: "ZQMARKETING campaign brief",
        });
        await makeTask({
            workspaceId: ws.id,
            listId: supList,
            name: "ZQSUPPORT refund escalation",
        });
        return { ws, owner, marketing, support };
    };

    it("a person scoped to one department cannot see the other's tasks", async () => {
        const { ws, marketing } = await twoDepartments();
        // Belongs to Marketing only.
        const arif = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: marketing },
        );

        const seen = modelCalling("search", { query: "ZQ" });
        const toolResult = await askAndCaptureToolResult(
            arif.client,
            "ZQ diye kono task ache?",
            seen,
        );

        expect(toolResult).toContain("ZQMARKETING");
        // THE ASSERTION THIS PHASE EXISTS FOR.
        expect(toolResult).not.toContain("ZQSUPPORT");
    });

    it("an unrestricted person still sees both — the filter is the caller's, not a blanket", async () => {
        const { ws } = await twoDepartments();
        const admin = await userWithSystemRole(ws, "admin");

        const seen = modelCalling("search", { query: "ZQ" });
        const toolResult = await askAndCaptureToolResult(
            admin.client,
            "ZQ diye kono task ache?",
            seen,
        );

        expect(toolResult).toContain("ZQMARKETING");
        expect(toolResult).toContain("ZQSUPPORT");
    });

    it("the space and list names of a foreign department do not leak either", async () => {
        const { ws, marketing } = await twoDepartments();
        const arif = await userWithPermissions(
            ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: marketing },
        );

        // `search` returns tasks, lists AND spaces — a name alone is enough to
        // tell an outsider that a "Support" department exists.
        const seen = modelCalling("search", { query: "a" });
        const toolResult = await askAndCaptureToolResult(
            arif.client,
            "kichu khujen",
            seen,
        );

        // Guard against a vacuous pass: the search must actually have returned
        // this person's own department, or "Support is absent" proves nothing.
        expect(toolResult).toContain("Marketing");
        expect(toolResult).not.toContain("Support");
    });
});

describe("L12 — the counts tool obeys it too", () => {
    it("workspace-wide open-task counts are scoped to what the caller can see", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktList = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);
        // 1 task in Marketing, 3 in Support.
        await makeTask({ workspaceId: ws.id, listId: mktList });
        for (let i = 0; i < 3; i++) {
            await makeTask({ workspaceId: ws.id, listId: supList });
        }

        const arif = await userWithPermissions(
            ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: marketing },
        );
        const restricted = modelCalling("get_my_task_counts");
        const forArif = await askAndCaptureToolResult(
            arif.client,
            "koyta task ache?",
            restricted,
        );

        const admin = await userWithSystemRole(ws, "admin");
        const unrestricted = modelCalling("get_my_task_counts");
        const forAdmin = await askAndCaptureToolResult(
            admin.client,
            "koyta task ache?",
            unrestricted,
        );

        // "openTasksAcrossTheWholeWorkspace" counted the whole company for everyone before RBAC.
        const teamCount = (json: string) =>
            (JSON.parse(json) as { openTasksAcrossTheWholeWorkspace: number }).openTasksAcrossTheWholeWorkspace;
        expect(teamCount(forAdmin)).toBe(4);
        expect(teamCount(forArif)).toBe(1);
    });
});

describe("L12 — the async context survives the streaming loop", () => {
    it("a tool called mid-stream still sees the caller, not the last request", async () => {
        // The mechanism under test: `rbacContext` runs at the top of the v1
        // router, the tool executes several awaits deep inside the OpenAI
        // response iterator, and the repository reads the scope from
        // AsyncLocalStorage. Two DIFFERENT callers in sequence must each get
        // their own answer — if the context were lost or shared, the second
        // would inherit the first.
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const mktList = await makeRbacList(ws.id, marketing, owner.id);
        const supList = await makeRbacList(ws.id, support, owner.id);
        await makeTask({
            workspaceId: ws.id,
            listId: mktList,
            name: "ZQMARKETING one",
        });
        await makeTask({
            workspaceId: ws.id,
            listId: supList,
            name: "ZQSUPPORT two",
        });

        const inMarketing = await userWithPermissions(
            ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: marketing },
        );
        const inSupport = await userWithPermissions(
            ws,
            [["space.view", "space"], "assistant.use"],
            { spaceId: support },
        );

        const a = modelCalling("search", { query: "ZQ" });
        const forMarketing = await askAndCaptureToolResult(
            inMarketing.client,
            "ZQ?",
            a,
        );
        const b = modelCalling("search", { query: "ZQ" });
        const forSupport = await askAndCaptureToolResult(
            inSupport.client,
            "ZQ?",
            b,
        );

        expect(forMarketing).toContain("ZQMARKETING");
        expect(forMarketing).not.toContain("ZQSUPPORT");
        expect(forSupport).toContain("ZQSUPPORT");
        expect(forSupport).not.toContain("ZQMARKETING");
    });
});
