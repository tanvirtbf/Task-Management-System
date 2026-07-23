import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import logger from "../../src/config/logger";
import { departmentReports, notifications } from "../../src/db/schema";
import { DepartmentReportsRepo } from "../../src/repositories/DepartmentReportsRepo";
import { NotificationsRepo } from "../../src/repositories/NotificationsRepo";
import { ReviewsRepo } from "../../src/repositories/ReviewsRepo";
import { SpacesRepo } from "../../src/repositories/SpacesRepo";
import { TasksRepo } from "../../src/repositories/TasksRepo";
import { UsersRepo } from "../../src/repositories/UsersRepo";
import { ReportStatsService } from "../../src/services/ReportStatsService";
import { ReportsService } from "../../src/services/ReportsService";
import { runJob } from "../../src/jobs";
import {
    dhakaWeekOf,
    previousWeekStart,
    weekBoundsUtc,
} from "../../src/utils/dhakaTime";
import { makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";

/**
 * Dept Review V1 — P20: the generation path + weekly job.
 *
 * Locks: the shared `generateFor` (row + DEDUPED fanout via the `notified_at`
 * atomic claim — regenerate and concurrent generates never re-notify),
 * headless-department inclusion, and the job's full behaviour (dry-run,
 * activity gate, self-heal, exactly-once notifications across re-runs).
 * Weeks are computed relative to NOW so the suite is date-independent.
 */

const LAST_WEEK = previousWeekStart(dhakaWeekOf(new Date()).weekStart);
const HEAL_WEEK = previousWeekStart(LAST_WEEK);

const inWeek = (weekStart: string, hoursIn = 5): Date =>
    new Date(
        weekBoundsUtc(weekStart).fromUtc.getTime() + hoursIn * 3600_000,
    );

const db = () => getDb();

const buildService = () => {
    const d = db();
    const usersRepo = new UsersRepo(d);
    return new ReportsService(
        d,
        new DepartmentReportsRepo(d),
        new SpacesRepo(d),
        usersRepo,
        new ReportStatsService(
            new ReviewsRepo(d),
            new TasksRepo(d),
            usersRepo,
            logger,
        ),
        new NotificationsRepo(d),
        logger,
    );
};

const fetchNotifications = async () =>
    db()
        .select({
            userId: notifications.userId,
            type: notifications.type,
            entityType: notifications.entityType,
            entityId: notifications.entityId,
            title: notifications.title,
            body: notifications.body,
        })
        .from(notifications);

const reportRows = async () =>
    db().select().from(departmentReports);

/** Owner + admin + head(member) + a dept with one in-window completion. */
const seed = async (opts: { headless?: boolean } = {}) => {
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const admin = await makeUser({ workspaceId: ws, role: "admin" });
    const head = opts.headless
        ? null
        : await makeUser({ workspaceId: ws, role: "member" });
    const sp = await makeSpaceWithHead({
        workspaceId: ws,
        // makeSpaceWithHead creates a head when omitted — for headless we
        // clear it below.
        headUserId: head?.id,
        createdBy: owner.id,
        name: "Dept X",
    });
    if (opts.headless) {
        const { spaces } = await import("../../src/db/schema");
        await db()
            .update(spaces)
            .set({ headUserId: null })
            .where(eq(spaces.id, sp.id));
    }
    const dl = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    await makeDoneTask({
        workspaceId: ws,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        createdBy: owner.id,
        completedAt: inWeek(LAST_WEEK),
    });
    const space = {
        id: sp.id,
        workspaceId: ws,
        name: "Dept X",
        headUserId: opts.headless ? null : (head?.id ?? null),
    };
    return { owner, ws, admin, head, sp, dl, space };
};

describe("ReportsService.generateFor (shared path)", () => {
    it("creates the row and fans out ONCE to the deduped owner/admin+head set", async () => {
        const { owner, admin, head, space } = await seed();
        // A plain member must NOT be notified.
        await makeUser({ workspaceId: space.workspaceId, role: "member" });

        const { report, notified } = await buildService().generateFor({
            space,
            weekStart: LAST_WEEK,
            actorId: null,
        });

        expect(notified).toBe(true);
        expect(report.weekStart).toBe(LAST_WEEK);
        expect(report.headUserId).toBe(head!.id);
        expect(
            (report.payload as { totals: { completed: number } }).totals
                .completed,
        ).toBe(1);

        const ntfs = await fetchNotifications();
        expect(ntfs).toHaveLength(3); // owner + admin + head, deduped set
        const recipients = ntfs.map((n) => n.userId).sort();
        expect(recipients).toEqual(
            [owner.id, admin.id, head!.id].sort(),
        );
        for (const n of ntfs) {
            expect(n.type).toBe("report_ready");
            expect(n.entityType).toBe("report");
            expect(n.entityId).toBe(report.id);
            expect(n.title).toContain("Dept X");
            expect(n.body).toContain("Completed 1");
        }
    });

    it("a head who is also an admin gets exactly ONE notification", async () => {
        const { owner, admin, ws } = await seed({ headless: true });
        const sp2 = await makeSpaceWithHead({
            workspaceId: ws,
            headUserId: admin.id, // admin doubles as head
            createdBy: owner.id,
            name: "Dept Y",
        });
        const dl2 = await makeDeptList({
            workspaceId: ws,
            spaceId: sp2.id,
            createdBy: owner.id,
        });
        await makeDoneTask({
            workspaceId: ws,
            listId: dl2.listId,
            doneStatusId: dl2.doneStatusId,
            createdBy: owner.id,
            completedAt: inWeek(LAST_WEEK),
        });

        await buildService().generateFor({
            space: {
                id: sp2.id,
                workspaceId: ws,
                name: "Dept Y",
                headUserId: admin.id,
            },
            weekStart: LAST_WEEK,
            actorId: null,
        });

        const ntfs = await fetchNotifications();
        const toAdmin = ntfs.filter((n) => n.userId === admin.id);
        expect(toAdmin).toHaveLength(1); // deduped
    });

    it("regenerate refreshes the payload but NEVER re-notifies (the claim)", async () => {
        const { head, space, ws, dl, owner } = await seed();
        const service = buildService();
        await service.generateFor({
            space,
            weekStart: LAST_WEEK,
            actorId: null,
        });
        const before = (await fetchNotifications()).length;

        // More work lands, then a manual regenerate.
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: inWeek(LAST_WEEK, 8),
        });
        const second = await service.generateFor({
            space,
            weekStart: LAST_WEEK,
            actorId: head!.id,
        });

        expect(second.notified).toBe(false);
        expect(
            (second.report.payload as { totals: { completed: number } })
                .totals.completed,
        ).toBe(2); // refreshed
        expect(second.report.generatedBy).toBe(head!.id);
        expect((await fetchNotifications()).length).toBe(before); // no re-fanout
    });

    it("CONCURRENT generates elect exactly one notifier (H-8 race containment)", async () => {
        const { space } = await seed();
        const service = buildService();

        const [a, b] = await Promise.all([
            service.generateFor({
                space,
                weekStart: LAST_WEEK,
                actorId: null,
            }),
            service.generateFor({
                space,
                weekStart: LAST_WEEK,
                actorId: null,
            }),
        ]);

        expect([a.notified, b.notified].filter(Boolean)).toHaveLength(1);
        const ntfs = await fetchNotifications();
        expect(ntfs).toHaveLength(3); // one fanout, not two
        expect(await reportRows()).toHaveLength(1); // one row
    });

    it("headless departments still report — HR is not blind (H-2); admins-only fanout", async () => {
        const { owner, admin, space } = await seed({ headless: true });

        const { report } = await buildService().generateFor({
            space,
            weekStart: LAST_WEEK,
            actorId: null,
        });

        expect(report.headUserId).toBeNull();
        const recipients = (await fetchNotifications())
            .map((n) => n.userId)
            .sort();
        expect(recipients).toEqual([owner.id, admin.id].sort());
    });
});

describe("runJob('department-report')", () => {
    it("dry-run counts without writing; the real run generates + notifies; re-runs never re-notify; dormant spaces skip; self-heal fills the missed week", async () => {
        const { ws, owner, space, dl } = await seed();
        // Self-heal material: activity in the week BEFORE last, no stored row.
        await makeDoneTask({
            workspaceId: ws,
            listId: dl.listId,
            doneStatusId: dl.doneStatusId,
            createdBy: owner.id,
            completedAt: inWeek(HEAL_WEEK),
        });
        // A dormant space: no tasks at all.
        await makeSpaceWithHead({
            workspaceId: ws,
            createdBy: owner.id,
            name: "Dormant",
        });

        // 1. Dry run: would generate last week + self-heal, writes nothing.
        const dry = await runJob("department-report", { dryRun: true });
        expect(dry.ok).toBe(true);
        expect(dry.generated).toBe(1);
        expect(dry.selfHealed).toBe(1);
        expect(dry.notified).toBe(0);
        expect(await reportRows()).toHaveLength(0);
        expect(await fetchNotifications()).toHaveLength(0);

        // 2. Real run.
        const run = await runJob("department-report", { dryRun: false });
        expect(run.ok).toBe(true);
        expect(run.generated).toBe(1);
        expect(run.selfHealed).toBe(1);
        expect(run.notified).toBe(2); // one fanout per generated week
        expect(run.skippedNoActivity).toBeGreaterThanOrEqual(1); // Dormant

        const rows = await reportRows();
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.weekStart).sort()).toEqual(
            [HEAL_WEEK, LAST_WEEK].sort(),
        );
        expect(rows.every((r) => r.spaceId === space.id)).toBe(true);
        const afterFirst = (await fetchNotifications()).length;
        expect(afterFirst).toBeGreaterThan(0);

        // 3. Re-run: rows refresh, self-heal no longer fires (row exists),
        //    and NOBODY is re-notified.
        const rerun = await runJob("department-report", { dryRun: false });
        expect(rerun.ok).toBe(true);
        expect(rerun.generated).toBe(1);
        expect(rerun.selfHealed).toBe(0);
        expect(rerun.notified).toBe(0);
        expect((await fetchNotifications()).length).toBe(afterFirst);
        expect(await reportRows()).toHaveLength(2);
    });
});
