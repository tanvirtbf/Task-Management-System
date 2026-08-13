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

import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import type { LoggedInClient } from "../test-utils/app";
import { makeStatus, makeTask, makeTaskType } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * THE "MY WORK" TOOLS (AI_ASSISTANT_DEEP_PLAN.md P3) — `get_my_tasks` and
 * `get_task_details`.
 *
 * These answer the question the office actually asks the bot ("ami ki ki task
 * e assign asi?"), which until now could only be answered with a NUMBER. The
 * risk they carry is the mirror image: a list tool that forgets whose list it
 * is hands one person another person's work.
 *
 * Same harness as `scoping.test.ts`: the mocked model is forced to call the
 * tool through the REAL route, so the AsyncLocalStorage RBAC context is the
 * production one, and the assertions read the TOOL RESULT — the boundary the
 * model is shown — plus the database.
 */

const CHAT = "/api/v1/assistant/chat";

const db = () => getDb();

beforeAll(() => {
    resetPolicy();
});

/** Make the model call `name` with `args`, then answer "ok". */
const modelCalling = (name: string, args: Record<string, unknown> = {}) => {
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

const ask = async (
    client: LoggedInClient,
    seen: string[],
): Promise<Record<string, unknown>> => {
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "amar kaj?" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    return JSON.parse(seen[0]) as Record<string, unknown>;
};

type Row = { name: string; dueDate: string | null; checklist: string | null };
const names = (result: Record<string, unknown>): string[] =>
    (result.tasks as Row[]).map((t) => t.name);

/** The seeded status name — asserted verbatim, so it is written once. */
const STATUS_NAME = "In Progress";

/** A workspace with one team, one list, and a member who works in it. */
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
    const status = await makeStatus({ scopeId: listId, name: STATUS_NAME });
    const type = await makeTaskType({ workspaceId: ws.id });
    const member = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "space"],
            "assistant.use",
            "member.view",
        ],
        { spaceId: marketing },
    );
    return { ws, owner, marketing, listId, status, type, member };
};

/**
 * Create a task in the seeded list and assign it to `userId`.
 * `fields` (due date, priority, …) are applied after insert — the shared
 * factory deliberately keeps a minimal input shape.
 */
const taskFor = async (
    s: Awaited<ReturnType<typeof seed>>,
    userId: string,
    name: string,
    fields: Partial<{ dueDate: string; priority: number }> = {},
) => {
    // A DATE column is materialised at UTC midnight (the F3 clock rule), so
    // the test writes it the way TaskWriteService.toDateOnly does.
    const asStoredDate = (ymd: string): Date => {
        const [y, m, d] = ymd.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    };
    const t = await makeTask({
        workspaceId: s.ws.id,
        listId: s.listId,
        statusId: s.status.id,
        taskTypeId: s.type.id,
        createdBy: s.owner.id,
        name,
    });
    if (Object.keys(fields).length > 0) {
        await db()
            .update(schema.tasks)
            .set({
                ...(fields.dueDate
                    ? { dueDate: asStoredDate(fields.dueDate) }
                    : {}),
                ...(fields.priority !== undefined
                    ? { priority: fields.priority }
                    : {}),
            })
            .where(eq(schema.tasks.id, t.id));
    }
    await db()
        .insert(schema.taskAssignees)
        .values({ taskId: t.id, userId, assignedBy: s.owner.id });
    return t;
};

describe("get_my_tasks — WHICH tasks, not how many", () => {
    it("returns the caller's own assigned work, with the names it must say out loud", async () => {
        const s = await seed();
        await taskFor(s, s.member.id, "Banner review", {
            dueDate: "2026-08-20",
            priority: 1,
        });
        await taskFor(s, s.owner.id, "Someone else's task");

        const seen = modelCalling("get_my_tasks", { bucket: "open" });
        const result = await ask(s.member.client, seen);

        expect(result.bucket).toBe("open");
        expect(names(result)).toEqual(["Banner review"]);
        const [row] = result.tasks as Array<Record<string, unknown>>;
        expect(row.list).toBe("Eid Campaign 2026");
        expect(row.team).toBe("Marketing");
        expect(row.dueDate).toBe("2026-08-20");
        expect(row.priority).toBe("urgent"); // 1 → a word, never a bare number
        expect(String(row.url)).toMatch(/^\/t\//);
        expect(result.more).toBe(false);
    });

    it("never leaks a colleague's list — two callers in sequence stay separate", async () => {
        const s = await seed();
        const other = await userWithPermissions(
            s.ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: s.marketing },
        );
        await taskFor(s, s.member.id, "Mine only");
        await taskFor(s, other.id, "Theirs only");

        const seenA = modelCalling("get_my_tasks", {});
        const a = await ask(s.member.client, seenA);
        const seenB = modelCalling("get_my_tasks", {});
        const b = await ask(other.client, seenB);

        expect(names(a)).toEqual(["Mine only"]);
        expect(names(b)).toEqual(["Theirs only"]);
    });

    it("overdue means overdue — a future due date is not in it", async () => {
        const s = await seed();
        await taskFor(s, s.member.id, "Late report", { dueDate: "2020-01-01" });
        await taskFor(s, s.member.id, "Future work", { dueDate: "2099-01-01" });

        const seen = modelCalling("get_my_tasks", { bucket: "overdue" });
        const result = await ask(s.member.client, seen);

        expect(names(result)).toEqual(["Late report"]);
    });

    it("carries checklist progress, so 'koto% hoyeche' needs no second call", async () => {
        const s = await seed();
        const t = await taskFor(s, s.member.id, "With checklist");
        await db()
            .update(schema.tasks)
            .set({ checklistItemsTotal: 4, checklistItemsDone: 3 })
            .where(eq(schema.tasks.id, t.id));

        const seen = modelCalling("get_my_tasks", {});
        const result = await ask(s.member.client, seen);

        expect((result.tasks as Row[])[0].checklist).toBe("3/4");
    });

    it("an empty bucket is an empty list, not an error", async () => {
        const s = await seed();
        const seen = modelCalling("get_my_tasks", { bucket: "overdue" });
        const result = await ask(s.member.client, seen);

        expect(result.count).toBe(0);
        expect(result.tasks).toEqual([]);
        expect(result.error).toBeUndefined();
    });

    it("caps the list and SAYS it capped — no silent truncation", async () => {
        const s = await seed();
        for (let i = 0; i < 22; i++) {
            await taskFor(s, s.member.id, `Bulk task ${i}`);
        }

        const seen = modelCalling("get_my_tasks", {});
        const result = await ask(s.member.client, seen);

        expect(result.count).toBe(20);
        expect(result.more).toBe(true);
    });
});

describe("get_task_details — one task, only if they may see it", () => {
    it("answers with status, list, team, assignees and checklist percent", async () => {
        const s = await seed();
        const t = await taskFor(s, s.member.id, "Eid banner design", {
            dueDate: "2026-08-25",
            priority: 2,
        });
        await db()
            .update(schema.tasks)
            .set({ checklistItemsTotal: 4, checklistItemsDone: 1 })
            .where(eq(schema.tasks.id, t.id));

        const seen = modelCalling("get_task_details", {
            task: "Eid banner design",
        });
        const result = await ask(s.member.client, seen);

        expect(result.name).toBe("Eid banner design");
        expect(result.list).toBe("Eid Campaign 2026");
        expect(result.team).toBe("Marketing");
        expect(result.status).toBe(STATUS_NAME);
        expect(result.dueDate).toBe("2026-08-25");
        expect(result.priority).toBe("high");
        expect(result.checklist).toEqual({ done: 1, total: 4, percent: 25 });
        expect(result.unassigned).toBe(false);
        expect((result.assignees as string[]).length).toBe(1);
    });

    it("a task in a team they cannot see is 'not found' — and its NAME is never echoed", async () => {
        const s = await seed();
        const support = await makeRbacSpace(s.ws.id, s.owner.id, "Support");
        const otherList = await makeRbacList(
            s.ws.id,
            support,
            s.owner.id,
            "Refunds",
        );
        const otherStatus = await makeStatus({ scopeId: otherList });
        await makeTask({
            workspaceId: s.ws.id,
            listId: otherList,
            statusId: otherStatus.id,
            taskTypeId: s.type.id,
            createdBy: s.owner.id,
            name: "Secret refund escalation",
        });

        const seen = modelCalling("get_task_details", {
            task: "Secret refund escalation",
        });
        const result = await ask(s.member.client, seen);

        // The anti-enumeration rule: refuse identically whether it is missing
        // or merely invisible, and give the model nothing to leak.
        expect(result.error).toBe("not_found");
        expect(JSON.stringify(result)).not.toContain("Secret refund");
        expect(JSON.stringify(result)).not.toContain("Refunds");
        expect(JSON.stringify(result)).not.toContain("Support");
    });

    it("resolves by id as well as by name", async () => {
        const s = await seed();
        const t = await taskFor(s, s.member.id, "Find me by id");

        const seen = modelCalling("get_task_details", { task: t.id });
        const result = await ask(s.member.client, seen);

        expect(result.name).toBe("Find me by id");
    });

    it("finds a task whose real name uses a typographic dash the user did not type", async () => {
        // A live probe had a Customer Service member ask about his OWN task
        // with a plain hyphen and get "not found, or you do not have
        // permission" — wrong, and frightening in the wrong direction.
        const s = await seed();
        await taskFor(s, s.member.id, "Repeated late delivery — VIP customer");

        const seen = modelCalling("get_task_details", {
            task: "Repeated late delivery - VIP customer",
        });
        const result = await ask(s.member.client, seen);

        expect(result.name).toBe("Repeated late delivery — VIP customer");
    });

    it("asks instead of guessing when the name is ambiguous", async () => {
        const s = await seed();
        await taskFor(s, s.member.id, "Campaign photo one");
        await taskFor(s, s.member.id, "Campaign photo two");

        const seen = modelCalling("get_task_details", {
            task: "Campaign photo",
        });
        const result = await ask(s.member.client, seen);

        expect(result.name).toBeUndefined();
        expect(String(result.error)).toContain("More than one task");
        expect((result.candidates as string[]).length).toBe(2);
    });

    it("a task assigned to them but owned by ANOTHER team is still readable (the own-escape)", async () => {
        const s = await seed();
        // This one needs a caller whose `task.view` reaches `own`, because the
        // escape hatch is itself a permission (`rbac/ownEscape.ts`): a purely
        // space-scoped reader gets no extra rows, by design. The live Member
        // role holds exactly this — `task.view = own` at the workspace, plus a
        // space-scoped assignment — which is two `user_roles` rows in
        // production and cannot be expressed as one ad-hoc test role (the same
        // permission twice would collide on `role_permissions.PRIMARY`).
        const assignee = await userWithPermissions(s.ws, [
            ["task.view", "own"],
            "assistant.use",
            "member.view",
        ]);
        const support = await makeRbacSpace(s.ws.id, s.owner.id, "Support");
        const otherList = await makeRbacList(
            s.ws.id,
            support,
            s.owner.id,
            "Refunds",
        );
        const otherStatus = await makeStatus({ scopeId: otherList });
        const t = await makeTask({
            workspaceId: s.ws.id,
            listId: otherList,
            statusId: otherStatus.id,
            taskTypeId: s.type.id,
            createdBy: s.owner.id,
            name: "Cross-team job",
        });
        await db()
            .insert(schema.taskAssignees)
            .values({ taskId: t.id, userId: assignee.id, assignedBy: s.owner.id });

        const seen = modelCalling("get_task_details", { task: t.id });
        const result = await ask(assignee.client, seen);

        // Being assigned is exactly what makes it visible — same rule the task
        // drawer follows when someone opens a link from their Inbox.
        expect(result.name).toBe("Cross-team job");
        expect(result.team).toBe("Support");
    });
});
