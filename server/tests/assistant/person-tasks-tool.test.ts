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
import { taskAssignees, tasks } from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import type { LoggedInClient } from "../test-utils/app";
import { makeStatus, makeTask, makeUser } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
} from "../rbac/helpers";

/**
 * `get_person_tasks` (INSIGHTS_PLAN P3) — another person's task list through
 * the asker's permissions, end to end through the REAL route (mocked model,
 * production AsyncLocalStorage). The repo WHERE is already proven against SQL
 * truth in insights-repo.test.ts; this file proves the TOOL layer: the
 * member.view gate, @handle resolution, buckets, the completed window and its
 * clamp, caps, and the visible-zero note the model must relay.
 */

const CHAT = "/api/v1/assistant/chat";
const db = () => getDb();
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => resetPolicy());

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
        .send({ message: "?" });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    return JSON.parse(seen[0]) as Record<string, unknown>;
};

/**
 * Two spaces; the target works in both. The unrestricted asker sees
 * everything, the A-scoped asker only space A, the blind asker holds no
 * member.view at all.
 */
const seed = async () => {
    const ws = await rbacWorkspace();
    const creator = await makeUser({ workspaceId: ws.id });
    const target = await makeUser({
        workspaceId: ws.id,
        firstName: "Harun",
        lastName: "Mia",
        email: "harun@insights.test",
    });
    const spaceA = await makeRbacSpace(ws.id, creator.id, "P3 Space A");
    const spaceB = await makeRbacSpace(ws.id, creator.id, "P3 Space B");
    const listA = await makeRbacList(ws.id, spaceA, creator.id);
    const listB = await makeRbacList(ws.id, spaceB, creator.id);
    const openA = await makeStatus({ scopeId: listA });
    const doneA = await makeStatus({ scopeId: listA, statusGroup: "done" });
    const openB = await makeStatus({ scopeId: listB });

    const viewerAll = await userWithPermissions(ws, [
        "assistant.use",
        ["space.view", "all"],
        ["task.view", "all"],
        ["member.view", "all"],
    ]);
    const viewerA = await userWithPermissions(
        ws,
        [
            "assistant.use",
            ["space.view", "space"],
            ["task.view", "space"],
            ["member.view", "all"],
        ],
        { spaceId: spaceA },
    );
    const blind = await userWithPermissions(ws, [
        "assistant.use",
        ["space.view", "all"],
        ["task.view", "all"],
    ]);

    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const mk = async (
        name: string,
        listId: string,
        statusId: string,
        opts: { dueDate?: Date; completedAt?: Date } = {},
    ) => {
        const t = await makeTask({
            workspaceId: ws.id,
            createdBy: creator.id,
            listId,
            statusId,
            name,
        });
        if (opts.dueDate || opts.completedAt) {
            await db()
                .update(tasks)
                .set({
                    ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
                    ...(opts.completedAt
                        ? { completedAt: opts.completedAt }
                        : {}),
                })
                .where(eq(tasks.id, t.id));
        }
        await db().insert(taskAssignees).values({
            taskId: t.id,
            userId: target.id,
            assignedBy: creator.id,
        });
        return t.id;
    };

    await mk("A open plain", listA, openA.id);
    await mk("A overdue", listA, openA.id, {
        dueDate: new Date(now.getTime() - 3 * DAY),
    });
    await mk("A done recent", listA, doneA.id, {
        completedAt: new Date(now.getTime() - 2 * DAY),
    });
    await mk("A done old", listA, doneA.id, {
        completedAt: new Date(now.getTime() - 60 * DAY),
    });
    await mk("B open", listB, openB.id);

    resetPolicy();
    return { ws, target, viewerAll, viewerA, blind, listA, openA, creator };
};

describe("get_person_tasks — the tool boundary", () => {
    it("refuses without member.view — the honest-denial shape", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
        });
        const result = await ask(s.blind.client, seen);
        expect(result.permission).toBe("member.view");
        expect(result.reason).toBe("no_grant");
    });

    it("an unrestricted asker gets the full open list, links included", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "@harun",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.person).toBe("Harun Mia");
        expect(result.bucket).toBe("open");
        expect(result.count).toBe(3);
        expect(result.more).toBe(false);
        const tasksArr = result.tasks as Array<Record<string, unknown>>;
        expect(tasksArr.map((t) => t.name).sort()).toEqual([
            "A open plain",
            "A overdue",
            "B open",
        ]);
        for (const t of tasksArr) {
            expect(String(t.url)).toMatch(/^\/t\//);
        }
        expect(String(result.note)).toMatch(/YOU can see/);
    });

    it("a space-scoped asker sees only the shared space's rows", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
        });
        const result = await ask(s.viewerA.client, seen);
        expect(result.count).toBe(2);
        const names = (result.tasks as Array<{ name: string }>).map(
            (t) => t.name,
        );
        expect(names).not.toContain("B open");
    });

    it("overdue bucket narrows to past-due open tasks", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "overdue",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.count).toBe(1);
        expect((result.tasks as Array<{ name: string }>)[0].name).toBe(
            "A overdue",
        );
    });

    it("completed respects window_days and reports the window it used", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "completed",
            window_days: 7,
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.windowDays).toBe(7);
        expect(result.count).toBe(1);
        const [t] = result.tasks as Array<Record<string, unknown>>;
        expect(t.name).toBe("A done recent");
        expect(String(t.completedOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("window_days clamps to 92 and a 90-day window reaches the older completion", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "completed",
            window_days: 999,
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.windowDays).toBe(92);
        expect(result.count).toBe(2); // both completions inside 92 days
    });

    it("the visible-zero note never lets the model claim 'they have none'", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "due_soon",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.count).toBe(0);
        expect(String(result.note)).toMatch(/Do NOT say they have none/);
        expect(String(result.note)).toMatch(/outside your view/);
    });

    it("caps at 15 rows and says more:true", async () => {
        const s = await seed();
        for (let i = 1; i <= 14; i++) {
            const t = await makeTask({
                workspaceId: s.ws.id,
                createdBy: s.creator.id,
                listId: s.listA,
                statusId: s.openA.id,
                name: `bulk ${i}`,
            });
            await db().insert(taskAssignees).values({
                taskId: t.id,
                userId: s.target.id,
                assignedBy: s.creator.id,
            });
        }
        const seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.count).toBe(15); // 3 seeded open + 14 bulk = 17 → capped
        expect(result.more).toBe(true);
    });

    it("an unknown person fails honestly, echoing what was typed", async () => {
        const s = await seed();
        const seen = modelCalling("get_person_tasks", {
            person_name: "@ghost",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(String(result.error)).toContain('"@ghost"');
    });

    it("garbage bucket and garbage window_days come back as guidance, never a throw", async () => {
        const s = await seed();

        let seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "kal",
        });
        let result = await ask(s.viewerAll.client, seen);
        expect(String(result.error)).toMatch(
            /open, overdue, due_soon or completed/,
        );

        seen = modelCalling("get_person_tasks", {
            person_name: "Harun Mia",
            bucket: "completed",
            window_days: "7din",
        });
        result = await ask(s.viewerAll.client, seen);
        expect(String(result.error)).toMatch(/whole number of days/);
        expect(String(result.error)).toContain("7din");
    });
});
