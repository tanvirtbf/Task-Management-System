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

import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { resetAssignmentGate } from "../../src/services/AssignmentRequestsService";
import type { LoggedInClient } from "../test-utils/app";
import { makeStatus, makeTaskType } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * The assistant's ONE write tool — `create_task` (2026-08-12).
 *
 * The safety story these tests pin: the tool runs through the REAL
 * `TaskWriteService.create` inside the authenticated request, so the chatting
 * user's own RBAC reach decides everything — an invisible list cannot be
 * found, a role without `task.create` cannot create, a cross-team assignee
 * still becomes a pending approval request (team-access P8), and every
 * refusal comes back as a readable `error` the model must relay, never a 500
 * and never a silent partial write.
 *
 * Same harness as `scoping.test.ts`: the mocked model is forced to call the
 * tool through the real route (so the AsyncLocalStorage RBAC context is the
 * one production uses), and the assertions read the TOOL RESULT — the
 * boundary — plus the database itself.
 */

const CHAT = "/api/v1/assistant/chat";

const db = () => getDb();

beforeAll(() => {
    resetPolicy();
    resetAssignmentGate();
});

/**
 * Make the model ask for `create_task` with `args` (`times` parallel calls in
 * ONE round — the duplicated-tool-call shape gpt-4o-mini sometimes emits),
 * then answer "ok". Captures EVERY tool result the model is shown.
 */
const modelCalling = (args: Record<string, unknown>, times = 1) => {
    const seen: string[] = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(
        (params: { messages?: { role: string; content?: string }[] }) => {
            const toolMsgs = (params.messages ?? []).filter(
                (m) => m.role === "tool",
            );
            if (toolMsgs.length === 0) {
                return Promise.resolve(
                    (async function* () {
                        yield {
                            choices: [
                                {
                                    delta: {
                                        tool_calls: Array.from(
                                            { length: times },
                                            (_, i) => ({
                                                index: i,
                                                id: `call_${i + 1}`,
                                                type: "function",
                                                function: {
                                                    name: "create_task",
                                                    arguments:
                                                        JSON.stringify(args),
                                                },
                                            }),
                                        ),
                                    },
                                },
                            ],
                        };
                    })(),
                );
            }
            toolMsgs.forEach((m) => seen.push(String(m.content ?? "")));
            return Promise.resolve(
                (async function* () {
                    yield { choices: [{ delta: { content: "ok" } }] };
                })(),
            );
        },
    );
    return seen;
};

const ask = async (
    client: LoggedInClient,
    seen: string[],
    expectedResults = 1,
): Promise<Record<string, unknown>> => {
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "ekta task banao" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(expectedResults);
    return JSON.parse(seen[0]) as Record<string, unknown>;
};

const taskRowsByName = (name: string) =>
    db().select().from(schema.tasks).where(eq(schema.tasks.name, name));

/** A workspace + a member who can create tasks in their own space. */
const seed = async () => {
    const ws = await rbacWorkspace();
    const owner = await userWithSystemRole(ws, "owner");
    const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
    const listId = await makeRbacList(
        ws.id,
        marketing,
        owner.id,
        "Eid Campaign 2026",
    );
    // create() places the task on the list's first status and needs at least
    // one task type in the workspace — give it both.
    await makeStatus({ scopeId: listId });
    await makeTaskType({ workspaceId: ws.id });
    const member = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "space"],
            ["task.create", "space"],
            "assistant.use",
            "member.view",
        ],
        { spaceId: marketing },
    );
    return { ws, owner, marketing, listId, member };
};

describe("create_task — the assistant's one write, under the caller's own rules", () => {
    it("creates a REAL task as the chatting user: row, audit trail, wire link", async () => {
        const s = await seed();
        const seen = modelCalling({
            name: "Banner reviewer khoja",
            list_name: "Eid Campaign 2026",
            due_date: "2026-08-20",
            priority: 2,
        });

        const result = await ask(s.member.client, seen);

        expect(result.created).toBe(true);
        expect(result.list).toBe("Eid Campaign 2026");
        expect(String(result.url)).toMatch(/^\/t\//);

        const [row] = await taskRowsByName("Banner reviewer khoja");
        expect(row).toBeDefined();
        expect(row.createdBy).toBe(s.member.id);
        // ASSIGNED_BY_PLAN P2 — a task the bot creates is handed out by the
        // PERSON who asked for it. The assistant is a tool, never the assigner.
        expect(row.assignedBy).toBe(s.member.id);
        expect(row.priority).toBe(2);
        expect(row.dueDate?.toISOString().slice(0, 10)).toBe("2026-08-20");
        const audit = await db()
            .select()
            .from(schema.taskActivity)
            .where(
                and(
                    eq(schema.taskActivity.taskId, row.id),
                    eq(schema.taskActivity.action, "task_created"),
                ),
            );
        expect(audit).toHaveLength(1);
        expect(audit[0].actorId).toBe(s.member.id);
    });

    it("cannot land a task in a list the caller cannot SEE (the visibility boundary)", async () => {
        const s = await seed();
        const support = await makeRbacSpace(s.ws.id, s.owner.id, "Support");
        await makeRbacList(s.ws.id, support, s.owner.id, "Refunds Queue");

        const seen = modelCalling({
            name: "sneaky cross-team task",
            list_name: "Refunds Queue",
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBeUndefined();
        expect(String(result.error)).toContain("No list matching");
        expect(await taskRowsByName("sneaky cross-team task")).toHaveLength(0);
    });

    it("a role without task.create is refused by the real service — no row, readable error", async () => {
        const s = await seed();
        // Can SEE the list (space.view) but cannot create.
        const viewer = await userWithPermissions(
            s.ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: s.marketing },
        );

        const seen = modelCalling({
            name: "not allowed task",
            list_name: "Eid Campaign 2026",
        });
        const result = await ask(viewer.client, seen);

        expect(result.created).toBeUndefined();
        expect(typeof result.error).toBe("string");
        expect(await taskRowsByName("not allowed task")).toHaveLength(0);
    });

    it("an ambiguous list name asks instead of guessing", async () => {
        const s = await seed();
        await makeRbacList(s.ws.id, s.marketing, s.owner.id, "Eid Campaign X");

        const seen = modelCalling({
            name: "ambiguous list task",
            list_name: "Eid Campaign",
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBeUndefined();
        expect(String(result.error)).toContain("More than one list");
        expect(Array.isArray(result.candidates)).toBe(true);
        expect(await taskRowsByName("ambiguous list task")).toHaveLength(0);
    });

    it("an unknown assignee name aborts the create — never the wrong Rahim", async () => {
        const s = await seed();
        const seen = modelCalling({
            name: "task for nobody",
            list_name: "Eid Campaign 2026",
            assignee_names: ["Nonexistent Person"],
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBeUndefined();
        expect(String(result.error)).toContain("No active member matching");
        expect(await taskRowsByName("task for nobody")).toHaveLength(0);
    });

    it("a cross-team assignee becomes a PENDING APPROVAL request, and the tool says so (P8)", async () => {
        const s = await seed();
        // Scoped reach (own ≠ all) and NOT a member of Marketing → the gate
        // fires exactly as it would from the New-task button.
        const outsider = await userWithPermissions(s.ws, [
            ["task.view", "own"],
        ]);
        const [named] = await db()
            .select({
                first: schema.users.firstName,
                last: schema.users.lastName,
            })
            .from(schema.users)
            .where(eq(schema.users.id, outsider.id));
        const outsiderName = `${named.first} ${named.last}`.trim();

        const seen = modelCalling({
            name: "cross team ask",
            list_name: "Eid Campaign 2026",
            assignee_names: [outsiderName],
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBe(true);
        expect(result.assigned).toEqual([]);
        expect(result.pendingApproval).toEqual([outsiderName]);

        const [row] = await taskRowsByName("cross team ask");
        const requests = await db()
            .select()
            .from(schema.taskAssignmentRequests)
            .where(eq(schema.taskAssignmentRequests.taskId, row.id));
        expect(requests).toHaveLength(1);
        expect(requests[0].status).toBe("pending");
        expect(requests[0].targetUserId).toBe(outsider.id);
        expect(requests[0].requestedBy).toBe(s.member.id);
    });

    it("rejects a non-calendar due date before anything is written", async () => {
        const s = await seed();
        const seen = modelCalling({
            name: "bad date task",
            list_name: "Eid Campaign 2026",
            due_date: "2026-02-30",
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBeUndefined();
        expect(String(result.error)).toContain("real calendar day");
        expect(await taskRowsByName("bad date task")).toHaveLength(0);
    });

    it("a DUPLICATED create call in one message writes ONE row and reuses the result", async () => {
        const s = await seed();
        const seen = modelCalling(
            { name: "double-fired task", list_name: "Eid Campaign 2026" },
            2, // the model emits the same call twice, in parallel
        );
        const result = await ask(s.member.client, seen, 2);

        const second = JSON.parse(seen[1]) as Record<string, unknown>;
        expect(result.created).toBe(true);
        expect(second.created).toBe(true);
        expect(second.id).toBe(result.id); // memoised, not re-created
        expect(await taskRowsByName("double-fired task")).toHaveLength(1);
    });

    it('"@me" assigns the chatting user themselves — no directory guess', async () => {
        const s = await seed();
        const seen = modelCalling({
            name: "self assigned task",
            list_name: "Eid Campaign 2026",
            assignee_names: ["@me"],
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBe(true);
        expect(result.pendingApproval).toEqual([]); // self-assign is instant (Q11)
        expect(Array.isArray(result.assigned)).toBe(true);
        expect((result.assigned as string[]).length).toBe(1);

        const [row] = await taskRowsByName("self assigned task");
        const assignees = await db()
            .select()
            .from(schema.taskAssignees)
            .where(eq(schema.taskAssignees.taskId, row.id));
        expect(assignees).toHaveLength(1);
        expect(assignees[0].userId).toBe(s.member.id);
    });

    it("an out-of-range priority refuses instead of silently defaulting", async () => {
        const s = await seed();
        const seen = modelCalling({
            name: "priority nine task",
            list_name: "Eid Campaign 2026",
            priority: 9,
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBeUndefined();
        expect(String(result.error)).toContain("0-4");
        expect(await taskRowsByName("priority nine task")).toHaveLength(0);
    });

    it("the same person named twice is assigned once and reported once", async () => {
        const s = await seed();
        const [named] = await db()
            .select({
                first: schema.users.firstName,
                last: schema.users.lastName,
            })
            .from(schema.users)
            .where(eq(schema.users.id, s.member.id));
        const fullName = `${named.first} ${named.last}`.trim();

        const seen = modelCalling({
            name: "twice named task",
            list_name: "Eid Campaign 2026",
            assignee_names: [fullName, "@me"], // both resolve to the member
        });
        const result = await ask(s.member.client, seen);

        expect(result.created).toBe(true);
        expect(result.assigned).toEqual([fullName]); // once, not twice

        const [row] = await taskRowsByName("twice named task");
        const assignees = await db()
            .select()
            .from(schema.taskAssignees)
            .where(eq(schema.taskAssignees.taskId, row.id));
        expect(assignees).toHaveLength(1);
    });
});
