import { weekBoundsUtc, dhakaWeekOf, previousWeekStart } from "../../src/utils/dhakaTime";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";

/**
 * Dept Review V1 — P22: the two new notification types through the REAL
 * feed + preferences endpoints (the serializer/prefs path — P8/P20 assert
 * the DB rows; this locks the wire).
 *
 * Also the end-to-end proof of the P1 double-ENUM migration: saving a
 * preference for `task_reviewed` exercises the `user_notification_prefs.type`
 * column — the second ENUM copy the v1.1 verification caught.
 */

const LAST_WEEK = previousWeekStart(dhakaWeekOf(new Date()).weekStart);

const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const head = await makeUser({ workspaceId: ws, role: "member" });
    const assignee = await makeUser({ workspaceId: ws, role: "member" });
    const sp = await makeSpaceWithHead({
        workspaceId: ws,
        headUserId: head.id,
        createdBy: owner.id,
        name: "Dept N",
    });
    const dl = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const task = await makeDoneTask({
        workspaceId: ws,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        createdBy: owner.id,
        assigneeIds: [assignee.id],
        completedAt: new Date(
            weekBoundsUtc(LAST_WEEK).fromUtc.getTime() + 3600_000,
        ),
    });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    const assigneeClient = await makeLoggedInClient({
        ...assignee,
        role: "member",
    });
    const ownerClient = await makeLoggedInClient({ ...owner, role: "owner" });
    return { owner, ws, head, assignee, sp, dl, task, headClient, assigneeClient, ownerClient };
};

describe("Dept Review notifications on the wire (P22)", () => {
    it("a flag lands in the assignee's FEED as task_reviewed with the note as body, and bumps unread-count", async () => {
        const s = await seed();
        await s.headClient
            .post(`/api/v1/tasks/${s.task.id}/review`)
            .send({ status: "flagged", note: "screenshots missing" });

        const feed = await s.assigneeClient.get("/api/v1/notifications");
        expect(feed.status).toBe(200);
        const row = feed.body.data.find(
            (n: { type: string }) => n.type === "task_reviewed",
        );
        expect(row).toBeTruthy();
        expect(row).toMatchObject({
            type: "task_reviewed",
            entity_type: "task",
            entity_id: s.task.id,
            actor_id: s.head.id,
            body: "screenshots missing",
            is_read: false,
        });
        expect(row.title).toContain("Task flagged");

        const count = await s.assigneeClient.get(
            "/api/v1/notifications/unread-count",
        );
        expect(count.status).toBe(200);
    });

    it("a generated report lands in the admin feed as report_ready (entity report, digest body)", async () => {
        const s = await seed();
        const gen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(gen.status).toBe(200);

        const feed = await s.ownerClient.get("/api/v1/notifications");
        const row = feed.body.data.find(
            (n: { type: string }) => n.type === "report_ready",
        );
        expect(row).toBeTruthy();
        expect(row).toMatchObject({
            type: "report_ready",
            entity_type: "report",
            entity_id: gen.body.id,
        });
        expect(row.title).toContain("Dept N");
        expect(row.body).toContain("Completed 1");

        // Standard inbox verbs work on the new type.
        const read = await s.ownerClient.post(
            `/api/v1/notifications/${row.id}/read`,
        );
        expect(read.status).toBeLessThan(300);
    });

    /**
     * ⚠️ Rewritten at F28's sweep — stale since Block E, in a module no gate
     * had re-run since. D6 cut the type catalog 12 → 7 (five had no producer)
     * and D8 removed `email_enabled` everywhere (no mail sender exists for
     * notifications). The spec's real job is unchanged: the PUT writes a
     * `user_notification_prefs.type` row, which 500s with MySQL 1265 if the
     * second ENUM copy was ever missed — `task_reviewed` still proves that.
     */
    it("preferences enumerate the live types (11 since upgrades/021) and a PUT for task_reviewed round-trips (the second-ENUM-copy migration, end-to-end)", async () => {
        const s = await seed();

        const prefs = await s.assigneeClient.get(
            "/api/v1/notifications/preferences",
        );
        expect(prefs.status).toBe(200);
        const keys = Object.keys(prefs.body).sort();
        expect(keys).toEqual(
            [
                "assigned",
                "mentioned",
                "comment",
                "status_change",
                "form_submitted",
                "overdue", // upgrades/014 (2026-08-08): produced by the overdue-alert job
                "task_reviewed",
                "report_ready",
                // upgrades/021 (team-access P8, 2026-08-11): the
                // assignment-approval flow's three types.
                "assignment_request",
                "assignment_request_decided",
                "assignment_query",
            ].sort(),
        );
        expect(prefs.body.task_reviewed).toEqual({ in_app_enabled: true });

        const put = await s.assigneeClient
            .put("/api/v1/notifications/preferences")
            .send({ task_reviewed: { in_app_enabled: false } });
        expect(put.status).toBeLessThan(300);

        const after = await s.assigneeClient.get(
            "/api/v1/notifications/preferences",
        );
        expect(after.body.task_reviewed).toEqual({ in_app_enabled: false });
        expect(after.body.report_ready).toEqual({ in_app_enabled: true });
    });
});
