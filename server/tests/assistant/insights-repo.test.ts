import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { taskAssignees, tasks } from "../../src/db/schema";
import { TasksRepo } from "../../src/repositories/TasksRepo";
import { runWithPrincipal } from "../../src/rbac/context";
import { getPolicy, resetPolicy } from "../../src/rbac/policy";
import { makeStatus, makeTask, makeUser } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
} from "../rbac/helpers";

/**
 * INSIGHTS PLAN P1 — the scoped repo layer, proven against SQL truth.
 *
 * `personTasksVisible` and `teamWindowStats` are the correctness core of the
 * people/team analytics tools (P3/P4). Everything here runs the repo DIRECTLY
 * under a real resolved principal (`runWithPrincipal`), because the whole
 * point is the WHERE clause: an asker must get exactly the intersection of
 * the target's tasks with their own visibility — never a row more.
 *
 * ⚠️ The trap this file guards forever: `HomeRepo.myTasksByBucket` carries NO
 * visibility filter (safe only for self). These methods must never regress to
 * that shape.
 */

// ─── date helpers (UTC-stable: the test DB session runs at +00:00) ──────────
const DAY = 24 * 60 * 60 * 1000;
// Second-aligned: MySQL TIMESTAMP rounds sub-second values, so a record
// placed EXACTLY on a window boundary would flake with the wall clock's
// milliseconds. Whole seconds make every boundary comparison deterministic.
const now = new Date(Math.floor(Date.now() / 1000) * 1000);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const daysFromNow = (n: number): Date => new Date(now.getTime() + n * DAY);
const todayYmd = ymd(now);

// ─── one seeded world, shared by every test ─────────────────────────────────
let repo: TasksRepo;
let wsId: string;
let target: { id: string };
let other: { id: string };
let viewerAll: { id: string };
let viewerSpaceA: { id: string };
let viewerOwn: { id: string };
let spaceA: string;
let spaceB: string;
let ids: Record<string, string>; // task name → id

const asUser = async <T>(
    userId: string,
    fn: () => Promise<T>,
): Promise<T> => {
    const principal = await getPolicy().principalFor(userId, wsId);
    if (!principal) throw new Error("principal did not resolve");
    return runWithPrincipal(principal, fn);
};

beforeAll(async () => {
    resetPolicy();
    const db = getDb();
    repo = new TasksRepo(db);

    const ws = await rbacWorkspace();
    wsId = ws.id;
    const creator = await makeUser({ workspaceId: wsId });
    target = await makeUser({ workspaceId: wsId });
    other = await makeUser({ workspaceId: wsId });

    spaceA = await makeRbacSpace(wsId, creator.id, "Insights A");
    spaceB = await makeRbacSpace(wsId, creator.id, "Insights B");
    const spaceC = await makeRbacSpace(wsId, creator.id, "Insights C");
    const listA = await makeRbacList(wsId, spaceA, creator.id);
    const listB = await makeRbacList(wsId, spaceB, creator.id);

    // The three asker shapes of the plan's test matrix.
    viewerAll = await userWithPermissions(ws, [
        ["space.view", "all"],
        ["task.view", "all"],
        ["member.view", "all"],
    ]);
    viewerSpaceA = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "space"],
            ["member.view", "all"],
        ],
        { spaceId: spaceA },
    );
    viewerOwn = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "own"],
            ["member.view", "all"],
        ],
        { spaceId: spaceC },
    );

    const openA = await makeStatus({ scopeId: listA });
    const closedA = await makeStatus({
        scopeId: listA,
        statusGroup: "done",
    });
    const openB = await makeStatus({ scopeId: listB });

    const mk = async (
        name: string,
        listId: string,
        statusId: string,
        opts: {
            assignees?: string[];
            dueDate?: Date | null;
            completedAt?: Date | null;
            archivedAt?: Date | null;
        } = {},
    ) => {
        const t = await makeTask({
            workspaceId: wsId,
            createdBy: creator.id,
            listId,
            statusId,
            name,
            archivedAt: opts.archivedAt ?? null,
        });
        if (opts.dueDate !== undefined || opts.completedAt !== undefined) {
            await db
                .update(tasks)
                .set({
                    ...(opts.dueDate !== undefined
                        ? { dueDate: opts.dueDate }
                        : {}),
                    ...(opts.completedAt !== undefined
                        ? { completedAt: opts.completedAt }
                        : {}),
                })
                .where(eq(tasks.id, t.id));
        }
        for (const uid of opts.assignees ?? []) {
            await db.insert(taskAssignees).values({
                taskId: t.id,
                userId: uid,
                assignedBy: creator.id,
            });
        }
        return t.id;
    };

    ids = {
        // space A — the target's world
        A_dueSoon: await mk("A dueSoon", listA, openA.id, {
            assignees: [target.id],
            dueDate: daysFromNow(2),
        }),
        A_overdue: await mk("A overdue", listA, openA.id, {
            assignees: [target.id],
            dueDate: daysFromNow(-3),
        }),
        A_doneRecent: await mk("A doneRecent", listA, closedA.id, {
            assignees: [target.id],
            completedAt: daysFromNow(-2),
        }),
        A_doneOld: await mk("A doneOld", listA, closedA.id, {
            assignees: [target.id],
            completedAt: daysFromNow(-40),
        }),
        A_archived: await mk("A archived", listA, openA.id, {
            assignees: [target.id],
            dueDate: daysFromNow(-3),
            archivedAt: new Date(),
        }),
        A_otherPerson: await mk("A otherPerson", listA, openA.id, {
            assignees: [other.id],
        }),
        // space B — outside viewerSpaceA's reach
        B_noDue: await mk("B noDue", listB, openB.id, {
            assignees: [target.id],
        }),
        B_coAssigned: await mk("B coAssigned", listB, openB.id, {
            assignees: [target.id], // viewerOwn joins below, after they exist
        }),
    };
    // ownEscape case: the own-scoped asker is co-assigned on ONE space-B task.
    await db.insert(taskAssignees).values({
        taskId: ids.B_coAssigned,
        userId: viewerOwn.id,
        assignedBy: creator.id,
    });

    // Grants changed after policy singletons may have cached — start clean.
    resetPolicy();
});

const names = (
    rows: { name: string }[],
): string[] => rows.map((r) => r.name).sort();

describe("personTasksVisible — the asker's eyes, never more", () => {
    it("an unrestricted asker sees the target's open tasks across every space", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "open",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(rows)).toEqual([
            "A dueSoon",
            "A overdue",
            "B coAssigned",
            "B noDue",
        ]);
    });

    it("orders by due date ascending with undated last", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "open",
                todayYmd,
                limit: 50,
            }),
        );
        expect(rows[0].name).toBe("A overdue"); // -3d
        expect(rows[1].name).toBe("A dueSoon"); // +2d
        expect(rows[2].dueDate).toBeNull();
        expect(rows[3].dueDate).toBeNull();
    });

    it("overdue = open AND due before the workspace's today", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "overdue",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(rows)).toEqual(["A overdue"]);
    });

    it("due_soon = open AND due within the next 7 days", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "due_soon",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(rows)).toEqual(["A dueSoon"]);
    });

    it("completed honours the window on completed_at", async () => {
        const inWindow = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "completed",
                todayYmd,
                since: daysFromNow(-7),
                untilExclusive: daysFromNow(1),
                limit: 50,
            }),
        );
        expect(names(inWindow)).toEqual(["A doneRecent"]);

        const wide = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "completed",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(wide)).toEqual(["A doneOld", "A doneRecent"]);
        // newest completion first
        expect(wide[0].name).toBe("A doneRecent");
    });

    it("a space-scoped asker sees only the shared space's rows", async () => {
        const rows = await asUser(viewerSpaceA.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "open",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(rows)).toEqual(["A dueSoon", "A overdue"]);
    });

    it("an own-scoped asker sees ONLY the task they are personally attached to (own-escape)", async () => {
        const rows = await asUser(viewerOwn.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "open",
                todayYmd,
                limit: 50,
            }),
        );
        expect(names(rows)).toEqual(["B coAssigned"]);
    });

    it("archived tasks never appear, even for the unrestricted asker", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "overdue",
                todayYmd,
                limit: 50,
            }),
        );
        expect(rows.map((r) => r.name)).not.toContain("A archived");
    });

    it("respects the limit", async () => {
        const rows = await asUser(viewerAll.id, () =>
            repo.personTasksVisible({
                targetUserId: target.id,
                workspaceId: wsId,
                bucket: "open",
                todayYmd,
                limit: 2,
            }),
        );
        expect(rows).toHaveLength(2);
    });
});

describe("teamWindowStats — counted only across what the asker can see", () => {
    const window = { since: daysFromNow(-1), untilExclusive: daysFromNow(1) };

    it("unrestricted asker: created / breakdown / overdue / completed all match SQL truth", async () => {
        const s = await asUser(viewerAll.id, () =>
            repo.teamWindowStats({
                spaceId: spaceA,
                workspaceId: wsId,
                ...window,
                todayYmd,
            }),
        );
        // Created in-window & not archived: dueSoon, overdue, doneRecent,
        // doneOld, otherPerson (A_archived is excluded).
        expect(s.createdCount).toBe(5);
        expect(s.createdSample.map((t) => t.name).sort()).toEqual([
            "A doneOld",
            "A doneRecent",
            "A dueSoon",
            "A otherPerson",
            "A overdue",
        ]);
        const byUser = new Map(
            s.assigneeCounts.map((a) => [a.userId, a.count]),
        );
        expect(byUser.get(target.id)).toBe(4);
        expect(byUser.get(other.id)).toBe(1);
        expect(s.overdueNowCount).toBe(1);
        expect(s.overdueSample.map((t) => t.name)).toEqual(["A overdue"]);
        // doneRecent completed at -2d sits OUTSIDE the ±1d window — that edge
        // is itself an assertion:
        expect(s.completedCount).toBe(0);
        // …and a 7-day window contains it (doneOld at -40d stays out).
        const s7 = await asUser(viewerAll.id, () =>
            repo.teamWindowStats({
                spaceId: spaceA,
                workspaceId: wsId,
                since: daysFromNow(-7),
                untilExclusive: daysFromNow(1),
                todayYmd,
            }),
        );
        expect(s7.completedCount).toBe(1);
    });

    it("a space-scoped asker on their own space gets the same truth", async () => {
        const s = await asUser(viewerSpaceA.id, () =>
            repo.teamWindowStats({
                spaceId: spaceA,
                workspaceId: wsId,
                ...window,
                todayYmd,
            }),
        );
        expect(s.createdCount).toBe(5);
        expect(s.overdueNowCount).toBe(1);
    });

    it("an own-scoped outsider gets zeros — SQL-level defense even if the team name leaked", async () => {
        const s = await asUser(viewerOwn.id, () =>
            repo.teamWindowStats({
                spaceId: spaceA,
                workspaceId: wsId,
                ...window,
                todayYmd,
            }),
        );
        expect(s.createdCount).toBe(0);
        expect(s.createdSample).toHaveLength(0);
        expect(s.assigneeCounts).toHaveLength(0);
        expect(s.overdueNowCount).toBe(0);
        expect(s.completedCount).toBe(0);
    });

    it("a window that excludes now counts nothing", async () => {
        const s = await asUser(viewerAll.id, () =>
            repo.teamWindowStats({
                spaceId: spaceA,
                workspaceId: wsId,
                since: daysFromNow(-3),
                untilExclusive: daysFromNow(-2),
                todayYmd,
            }),
        );
        expect(s.createdCount).toBe(0);
        expect(s.completedCount).toBe(0);
    });
});
