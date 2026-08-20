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
 * `get_team_stats` (INSIGHTS_PLAN P4) — team-window analytics through the
 * asker's permissions, end to end through the real route. The SQL is proven in
 * insights-repo.test.ts; this file proves the TOOL boundary: the member.view
 * gate, scoped team resolution (invisible == nonexistent, zero names leaked),
 * name hydration, the empty-window honesty note, and argument guidance.
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
 * Space "P4 Marketing": 3 tasks created now (2 → mim, 1 → rana, one of the
 * mim tasks also overdue), 1 completed 2 days ago, 1 archived (never
 * counted). Space "P4 Hidden": the foreign team the scoped asker must not
 * even learn exists. Space "P4 Empty": zero tasks, for the honesty note.
 */
const seed = async () => {
    const ws = await rbacWorkspace();
    const creator = await makeUser({
        workspaceId: ws.id,
        firstName: "Creator",
        lastName: "Person",
    });
    const mim = await makeUser({
        workspaceId: ws.id,
        firstName: "Mim",
        lastName: "Akter",
    });
    const rana = await makeUser({
        workspaceId: ws.id,
        firstName: "Rana",
        lastName: "Sheikh",
    });

    const marketing = await makeRbacSpace(ws.id, creator.id, "P4 Marketing");
    const hidden = await makeRbacSpace(ws.id, creator.id, "P4 Hidden");
    await makeRbacSpace(ws.id, creator.id, "P4 Empty");
    const listM = await makeRbacList(ws.id, marketing, creator.id);
    const listH = await makeRbacList(ws.id, hidden, creator.id);
    const openM = await makeStatus({ scopeId: listM });
    const doneM = await makeStatus({ scopeId: listM, statusGroup: "done" });
    const openH = await makeStatus({ scopeId: listH });

    const viewerAll = await userWithPermissions(ws, [
        "assistant.use",
        ["space.view", "all"],
        ["task.view", "all"],
        ["member.view", "all"],
    ]);
    const viewerMarketing = await userWithPermissions(
        ws,
        [
            "assistant.use",
            ["space.view", "space"],
            ["task.view", "space"],
            ["member.view", "all"],
        ],
        { spaceId: marketing },
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
        opts: {
            assignee?: string;
            dueDate?: Date;
            completedAt?: Date;
            archivedAt?: Date;
        } = {},
    ) => {
        const t = await makeTask({
            workspaceId: ws.id,
            createdBy: creator.id,
            listId,
            statusId,
            name,
            archivedAt: opts.archivedAt ?? null,
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
        if (opts.assignee) {
            await db().insert(taskAssignees).values({
                taskId: t.id,
                userId: opts.assignee,
                assignedBy: creator.id,
            });
        }
        return t.id;
    };

    await mk("M mim one", listM, openM.id, { assignee: mim.id });
    await mk("M mim overdue", listM, openM.id, {
        assignee: mim.id,
        dueDate: new Date(now.getTime() - 3 * DAY),
    });
    await mk("M rana one", listM, openM.id, { assignee: rana.id });
    await mk("M done recent", listM, doneM.id, {
        assignee: rana.id,
        completedAt: new Date(now.getTime() - 2 * DAY),
    });
    await mk("M archived", listM, openM.id, {
        assignee: mim.id,
        archivedAt: new Date(),
    });
    await mk("H secret", listH, openH.id, { assignee: rana.id });

    resetPolicy();
    return { ws, viewerAll, viewerMarketing, blind };
};

describe("get_team_stats — the tool boundary", () => {
    it("refuses without member.view — counts would bypass the roster gate", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "P4 Marketing",
        });
        const result = await ask(s.blind.client, seen);
        expect(result.permission).toBe("member.view");
        expect(result.reason).toBe("no_grant");
    });

    it("an unrestricted asker gets the seeded truth, names hydrated", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "P4 Marketing",
            window_days: 7,
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.team).toBe("P4 Marketing");
        expect(result.windowDays).toBe(7);

        const created = result.created as Record<string, unknown>;
        // 5 created in-window minus the archived one = 4.
        expect(created.count).toBe(4);
        const createdTasks = created.tasks as Array<Record<string, unknown>>;
        expect(createdTasks.map((t) => t.name)).not.toContain("M archived");
        for (const t of createdTasks) {
            expect(String(t.url)).toMatch(/^\/t\//);
            expect(t.createdBy).toBe("Creator Person");
        }
        const byAssignee = new Map(
            (created.byAssignee as Array<{ name: string; tasks: number }>).map(
                (a) => [a.name, a.tasks],
            ),
        );
        expect(byAssignee.get("Mim Akter")).toBe(2);
        expect(byAssignee.get("Rana Sheikh")).toBe(2);

        const overdue = result.overdueNow as Record<string, unknown>;
        expect(overdue.count).toBe(1);
        expect(
            (overdue.tasks as Array<{ name: string }>)[0].name,
        ).toBe("M mim overdue");

        expect(
            (result.completedInWindow as Record<string, unknown>).count,
        ).toBe(1);
        expect(String(result.note)).toMatch(/never a permission problem/);
    });

    it("a team-scoped member asking their OWN team gets the same truth", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "P4 Marketing",
        });
        const result = await ask(s.viewerMarketing.client, seen);
        expect((result.created as Record<string, unknown>).count).toBe(4);
        expect((result.overdueNow as Record<string, unknown>).count).toBe(1);
    });

    it("a foreign team answers not_found with ZERO names in the payload", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "P4 Hidden",
        });
        const result = await ask(s.viewerMarketing.client, seen);
        expect(result.code).toBe("space.not_found");
        const raw = JSON.stringify(result);
        expect(raw).not.toContain("H secret");
        expect(raw).not.toContain("Rana");
        expect(raw).not.toContain("Mim");
    });

    it("a nonexistent team answers EXACTLY the same shape as an invisible one", async () => {
        const s = await seed();
        const hiddenSeen = modelCalling("get_team_stats", {
            team_name: "P4 Hidden",
        });
        const hidden = await ask(s.viewerMarketing.client, hiddenSeen);
        const ghostSeen = modelCalling("get_team_stats", {
            team_name: "No Such Team",
        });
        const ghost = await ask(s.viewerMarketing.client, ghostSeen);
        expect(ghost).toEqual(hidden);
    });

    it("an empty team reads as honest zeros, not a refusal", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "P4 Empty",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect((result.created as Record<string, unknown>).count).toBe(0);
        expect((result.overdueNow as Record<string, unknown>).count).toBe(0);
        expect(String(result.note)).toMatch(/never a permission problem/);
    });

    it("a single substring hit forgives casual naming", async () => {
        const s = await seed();
        const seen = modelCalling("get_team_stats", {
            team_name: "marketing",
        });
        const result = await ask(s.viewerAll.client, seen);
        expect(result.team).toBe("P4 Marketing");
    });

    it("garbage window_days and a missing team come back as guidance", async () => {
        const s = await seed();

        let seen = modelCalling("get_team_stats", {
            team_name: "P4 Marketing",
            window_days: "soptaho",
        });
        let result = await ask(s.viewerAll.client, seen);
        expect(String(result.error)).toMatch(/whole number of days/);

        seen = modelCalling("get_team_stats", {});
        result = await ask(s.viewerAll.client, seen);
        expect(String(result.error)).toMatch(/Which team/);
    });
});
