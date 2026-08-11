import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import {
    assignmentGate,
    resetAssignmentGate,
} from "../../src/services/AssignmentRequestsService";
import { makeTask } from "../test-utils/factories";
import {
    assignRole,
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithSystemRole,
    type RbacWorkspace,
} from "./helpers";

/**
 * Team-access P8 — the cross-team assignment APPROVAL matrix, in the
 * production shape (the 019 + 020 flips applied byte-faithfully):
 *
 *   same-team assignment            → instant (Q5)
 *   cross-team (target not a member
 *     of the owning space, Q11)     → a PENDING request, not an assignee row
 *   target / their Head / an admin  → may accept (atomic claim) / decline /
 *                                     query — the requester NEVER decides
 *   query → answer → accept          → the B2 round-trip: the requester moves
 *                                     the real due date through its OWN
 *                                     endpoint (post-020 they cannot edit)
 *   7-day expiry (Q6)               → dead to every mutation + janitor sweep
 *   bulk (Q8)                       → honest "N assigned, M pending" counts
 *   open seeds                      → the whole gate is DORMANT
 */

beforeAll(() => {
    resetPolicy();
    resetAssignmentGate();
});

jest.setTimeout(120_000);

const db = () => getDb();

/** 019 + 020, byte-faithful (the p7 matrix's helper). */
const applyFlips = async (ws: RbacWorkspace) => {
    const mg = [ws.systemRoleIds.member, ws.systemRoleIds.guest];
    await db()
        .update(schema.rolePermissions)
        .set({ scope: "space" })
        .where(
            and(
                inArray(schema.rolePermissions.roleId, mg),
                eq(schema.rolePermissions.permissionKey, "space.view"),
            ),
        );
    await db()
        .update(schema.rolePermissions)
        .set({ scope: "own" })
        .where(
            and(
                inArray(schema.rolePermissions.roleId, mg),
                eq(schema.rolePermissions.permissionKey, "task.view"),
            ),
        );
    await db()
        .update(schema.rolePermissions)
        .set({ scope: "own" })
        .where(
            and(
                eq(schema.rolePermissions.roleId, ws.systemRoleIds.member),
                inArray(schema.rolePermissions.permissionKey, [
                    "task.edit",
                    "task.archive",
                    "task.delete",
                ]),
            ),
        );
    await db()
        .update(schema.workspaces)
        .set({
            permissionsVersion: sql`${schema.workspaces.permissionsVersion} + 1`,
        })
        .where(eq(schema.workspaces.id, ws.id));
};

/**
 * Two teams: Alpha (the task's home) and Beta (the receiving side).
 * `requester` is an Alpha member who CREATED the task (holds edit as its
 * creator); `manager` is an Alpha member who did NOT (post-020 they hold
 * `task.assign` but NO edit on it — the exact B2 persona).
 */
const seed = async () => {
    const ws = await rbacWorkspace();
    const admin = await userWithSystemRole(ws, "admin");
    const teamA = await makeRbacSpace(ws.id, admin.id, "Alpha");
    const teamB = await makeRbacSpace(ws.id, admin.id, "Beta");
    const listA = await makeRbacList(ws.id, teamA, admin.id);

    const member = async (spaceId: string) => {
        const u = await userWithSystemRole(ws, "member");
        await assignRole({
            workspaceId: ws.id,
            userId: u.id,
            roleId: ws.systemRoleIds.member,
            spaceId,
        });
        return u;
    };
    const requester = await member(teamA);
    const manager = await member(teamA);
    const target = await member(teamB);
    const headB = await member(teamB);
    const mateB = await member(teamB);
    await db()
        .update(schema.spaces)
        .set({ headUserId: headB.id })
        .where(eq(schema.spaces.id, teamB));

    const task = await makeTask({
        workspaceId: ws.id,
        listId: listA,
        createdBy: requester.id,
    });

    await applyFlips(ws);
    return {
        ws,
        admin,
        teamA,
        teamB,
        listA,
        requester,
        manager,
        target,
        headB,
        mateB,
        task,
    };
};

const pendingRows = (taskId: string, targetId?: string) =>
    db()
        .select()
        .from(schema.taskAssignmentRequests)
        .where(
            and(
                eq(schema.taskAssignmentRequests.taskId, taskId),
                targetId
                    ? eq(
                          schema.taskAssignmentRequests.targetUserId,
                          targetId,
                      )
                    : undefined,
            ),
        );

const assigneeIds = async (taskId: string): Promise<string[]> =>
    (
        await db()
            .select({ userId: schema.taskAssignees.userId })
            .from(schema.taskAssignees)
            .where(eq(schema.taskAssignees.taskId, taskId))
    ).map((r) => r.userId);

const bellRows = (userId: string, type: string) =>
    db()
        .select()
        .from(schema.notifications)
        .where(
            and(
                eq(schema.notifications.userId, userId),
                eq(
                    schema.notifications.type,
                    type as (typeof schema.notificationTypes)[number],
                ),
            ),
        );

describe("P8 — cross-team assignment approval", () => {
    it("gates a cross-team add into a pending request; same-team stays instant (Q5/Q11)", async () => {
        const s = await seed();
        const mate2 = await userWithSystemRole(s.ws, "member");
        await assignRole({
            workspaceId: s.ws.id,
            userId: mate2.id,
            roleId: s.ws.systemRoleIds.member,
            spaceId: s.teamA,
        });

        const res = await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [mate2.id, s.target.id] });
        expect(res.status).toBe(204);

        // Same-team: assigned. Cross-team: NOT assigned — a pending request.
        const assigned = await assigneeIds(s.task.id);
        expect(assigned).toContain(mate2.id);
        expect(assigned).not.toContain(s.target.id);
        const reqs = await pendingRows(s.task.id, s.target.id);
        expect(reqs).toHaveLength(1);
        expect(reqs[0].status).toBe("pending");
        expect(reqs[0].requestedBy).toBe(s.requester.id);
        expect(reqs[0].spaceId).toBe(s.teamA);

        // Q2: the target AND their Head hear about it; no `assigned` bell.
        expect(
            await bellRows(s.target.id, "assignment_request"),
        ).toHaveLength(1);
        expect(
            await bellRows(s.headB.id, "assignment_request"),
        ).toHaveLength(1);
        expect(await bellRows(s.target.id, "assigned")).toHaveLength(0);

        // The 'created' ledger row exists.
        const events = await db()
            .select()
            .from(schema.taskAssignmentRequestEvents)
            .where(
                eq(
                    schema.taskAssignmentRequestEvents.requestId,
                    reqs[0].id,
                ),
            );
        expect(events.map((e) => e.action)).toEqual(["created"]);

        // Idempotent: asking again creates NOTHING new (unique pending).
        const again = await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        expect(again.status).toBe(204);
        expect(await pendingRows(s.task.id, s.target.id)).toHaveLength(1);
        expect(
            await bellRows(s.target.id, "assignment_request"),
        ).toHaveLength(1);
    });

    it("gates initial assignees on create, and bulk reports honest counts (Q8)", async () => {
        const s = await seed();

        // Create-with-assignees: the task lands, the cross-team person waits.
        const created = await s.requester.client
            .post("/api/v1/tasks")
            .send({
                primary_list_id: s.listA,
                name: "campaign shoot",
                assignees: [s.target.id],
            });
        expect(created.status).toBe(201);
        const newTaskId = created.body.id as string;
        expect(await assigneeIds(newTaskId)).toHaveLength(0);
        expect(await pendingRows(newTaskId, s.target.id)).toHaveLength(1);

        // Bulk: two tasks × one cross-team target → 0 assigns, 2 pendings.
        const t2 = await makeTask({
            workspaceId: s.ws.id,
            listId: s.listA,
            createdBy: s.requester.id,
        });
        const bulk = await s.requester.client
            .post("/api/v1/tasks/bulk")
            .send({
                ids: [s.task.id, t2.id],
                patch: { assignee_add: [s.target.id] },
            });
        expect(bulk.status).toBe(200);
        expect(bulk.body.updated).toBe(2);
        expect(bulk.body.pending_approval).toBe(2);
        expect(await assigneeIds(s.task.id)).not.toContain(s.target.id);
        expect(await assigneeIds(t2.id)).not.toContain(s.target.id);
    });

    it("routes the boxes correctly, and the receiver sees a task snapshot they cannot otherwise open", async () => {
        const s = await seed();
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });

        // The receiver cannot open the task itself (team boundary)…
        expect(
            (await s.target.client.get(`/api/v1/tasks/${s.task.id}`)).status,
        ).toBe(404);

        // …but their received box shows WHAT they are consenting to.
        const received = await s.target.client.get(
            "/api/v1/assignment-requests",
        );
        expect(received.status).toBe(200);
        expect(received.body.data).toHaveLength(1);
        const wire = received.body.data[0];
        expect(wire.status).toBe("pending");
        expect(wire.task.name).toBeTruthy();
        expect(wire.task.space_name).toBe("Alpha");
        expect(wire.requested_by.id).toBe(s.requester.id);
        expect(wire.events.map((e: { action: string }) => e.action)).toEqual([
            "created",
        ]);

        // The Head's team box sees it; a plain teammate sees nothing.
        const teamBox = await s.headB.client.get(
            "/api/v1/assignment-requests?box=team",
        );
        expect(teamBox.body.data).toHaveLength(1);
        expect(
            (await s.mateB.client.get("/api/v1/assignment-requests")).body
                .data,
        ).toHaveLength(0);
        const sent = await s.requester.client.get(
            "/api/v1/assignment-requests?box=sent",
        );
        expect(sent.body.data).toHaveLength(1);

        // Drawer feed: readable exactly where the task is.
        expect(
            (
                await s.requester.client.get(
                    `/api/v1/tasks/${s.task.id}/assignment-requests`,
                )
            ).body.data,
        ).toHaveLength(1);
        expect(
            (
                await s.mateB.client.get(
                    `/api/v1/tasks/${s.task.id}/assignment-requests`,
                )
            ).status,
        ).toBe(404);
    });

    it("accept = the atomic claim + the REAL assignment, and the task opens for the new assignee (B1)", async () => {
        const s = await seed();
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r] = await pendingRows(s.task.id, s.target.id);

        const res = await s.target.client
            .post(`/api/v1/assignment-requests/${r.id}/accept`)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("accepted");
        expect(res.body.data.decided_by.id).toBe(s.target.id);

        // The real side effects: assignee row + audit row + requester's bell.
        expect(await assigneeIds(s.task.id)).toContain(s.target.id);
        const audit = await db()
            .select()
            .from(schema.taskActivity)
            .where(
                and(
                    eq(schema.taskActivity.taskId, s.task.id),
                    eq(schema.taskActivity.action, "assignee_added"),
                ),
            );
        expect(audit).toHaveLength(1);
        expect(
            await bellRows(s.requester.id, "assignment_request_decided"),
        ).toHaveLength(1);
        // The target accepted THEMSELVES — no self "assigned" bell.
        expect(await bellRows(s.target.id, "assigned")).toHaveLength(0);

        // B1: the own-escape now opens the cross-team task for them.
        expect(
            (await s.target.client.get(`/api/v1/tasks/${s.task.id}`)).status,
        ).toBe(200);

        // The claim is final.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r.id}/accept`)
                    .send({})
            ).status,
        ).toBe(409);
    });

    it("deciders are the target, their Head, an admin — never the requester, never a bystander", async () => {
        const s = await seed();
        const t2 = await makeTask({
            workspaceId: s.ws.id,
            listId: s.listA,
            createdBy: s.requester.id,
        });
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        await s.requester.client
            .post(`/api/v1/tasks/${t2.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r1] = await pendingRows(s.task.id, s.target.id);
        const [r2] = await pendingRows(t2.id, s.target.id);

        // A bystander (same team as the target, not their head): 404 — the
        // request's existence is not theirs to know.
        expect(
            (
                await s.mateB.client
                    .post(`/api/v1/assignment-requests/${r1.id}/accept`)
                    .send({})
            ).status,
        ).toBe(404);
        // The requester: 403 — asking is not consenting.
        expect(
            (
                await s.requester.client
                    .post(`/api/v1/assignment-requests/${r1.id}/accept`)
                    .send({})
            ).status,
        ).toBe(403);
        // The target's Head accepts on the team's behalf (Q2) — and the
        // target, who did NOT act, gets the normal `assigned` bell.
        expect(
            (
                await s.headB.client
                    .post(`/api/v1/assignment-requests/${r1.id}/accept`)
                    .send({})
            ).status,
        ).toBe(200);
        expect(await assigneeIds(s.task.id)).toContain(s.target.id);
        expect(await bellRows(s.target.id, "assigned")).toHaveLength(1);
        // An admin can always step in.
        expect(
            (
                await s.admin.client
                    .post(`/api/v1/assignment-requests/${r2.id}/accept`)
                    .send({})
            ).status,
        ).toBe(200);
    });

    it("decline leaves the task untouched; cancel withdraws and tells the target", async () => {
        const s = await seed();
        const t2 = await makeTask({
            workspaceId: s.ws.id,
            listId: s.listA,
            createdBy: s.requester.id,
        });
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        await s.requester.client
            .post(`/api/v1/tasks/${t2.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r1] = await pendingRows(s.task.id, s.target.id);
        const [r2] = await pendingRows(t2.id, s.target.id);

        const declined = await s.target.client
            .post(`/api/v1/assignment-requests/${r1.id}/decline`)
            .send({ note: "fully booked this sprint" });
        expect(declined.status).toBe(200);
        expect(declined.body.data.status).toBe("declined");
        expect(await assigneeIds(s.task.id)).toHaveLength(0);
        expect(
            await bellRows(s.requester.id, "assignment_request_decided"),
        ).toHaveLength(1);

        // Cancel: only the requester (or an admin) — the target hears.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r2.id}/cancel`)
                    .send({})
            ).status,
        ).toBe(403);
        const cancelled = await s.requester.client
            .post(`/api/v1/assignment-requests/${r2.id}/cancel`)
            .send({});
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.status).toBe("cancelled");
        expect(
            await bellRows(s.target.id, "assignment_request_decided"),
        ).toHaveLength(1);
        // Nothing further can happen to a decided request.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r2.id}/decline`)
                    .send({})
            ).status,
        ).toBe(409);
    });

    it("query → answer → accept: the B2 round-trip moves the real deadline and re-arms the overdue alert", async () => {
        const s = await seed();
        // The B2 persona: MANAGER assigns (task.assign is `all`) but cannot
        // edit — they are neither creator, assignee nor Alpha's head.
        await s.manager.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r] = await pendingRows(s.task.id, s.target.id);

        // The receiver asks for two more days.
        const q = await s.target.client
            .post(`/api/v1/assignment-requests/${r.id}/query`)
            .send({ note: "need 2 more days", proposed_due_date: "2026-08-20" });
        expect(q.status).toBe(200);
        expect(q.body.data.status).toBe("pending");
        expect(q.body.data.query_note).toBe("need 2 more days");
        expect(q.body.data.proposed_due_date).toBe("2026-08-20");
        expect(
            await bellRows(s.manager.id, "assignment_query"),
        ).toHaveLength(1);

        // THE DEADLOCK THIS EXISTS TO PREVENT: a generic edit refuses the
        // requester (post-020 they hold no task.edit on this task)…
        expect(
            (
                await s.manager.client
                    .patch(`/api/v1/tasks/${s.task.id}`)
                    .send({ due_date: "2026-08-20" })
            ).status,
        ).toBe(403);
        // …and the target may not answer their own query.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r.id}/answer`)
                    .send({ note: "granting myself time" })
            ).status,
        ).toBe(403);

        // Arm the overdue claim so the re-arm is observable.
        await db()
            .update(schema.tasks)
            .set({ overdueNotifiedAt: new Date() })
            .where(eq(schema.tasks.id, s.task.id));

        // The requester answers THROUGH THEIR OWN DOOR, granting the date.
        const a = await s.manager.client
            .post(`/api/v1/assignment-requests/${r.id}/answer`)
            .send({ note: "ok — moved it", due_date: "2026-08-20" });
        expect(a.status).toBe(200);
        expect(a.body.data.status).toBe("pending"); // receiver still decides
        expect(
            a.body.data.events.map((e: { action: string }) => e.action),
        ).toEqual(["created", "queried", "answered"]);

        // The REAL update path ran: date moved, audit diff, re-arm cleared.
        const [taskRow] = await db()
            .select()
            .from(schema.tasks)
            .where(eq(schema.tasks.id, s.task.id));
        expect(
            taskRow.dueDate && taskRow.dueDate.toISOString().slice(0, 10),
        ).toBe("2026-08-20");
        expect(taskRow.overdueNotifiedAt).toBeNull();
        const updates = await db()
            .select()
            .from(schema.taskActivity)
            .where(
                and(
                    eq(schema.taskActivity.taskId, s.task.id),
                    eq(schema.taskActivity.action, "task_updated"),
                ),
            );
        expect(updates).toHaveLength(1);
        expect(await bellRows(s.target.id, "assignment_query")).toHaveLength(
            1,
        );

        // The receiver accepts the improved deal.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r.id}/accept`)
                    .send({})
            ).status,
        ).toBe(200);
        expect(await assigneeIds(s.task.id)).toContain(s.target.id);
    });

    it("a double-accept race admits exactly one decider", async () => {
        const s = await seed();
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r] = await pendingRows(s.task.id, s.target.id);

        const [a, b] = await Promise.all([
            s.target.client
                .post(`/api/v1/assignment-requests/${r.id}/accept`)
                .send({}),
            s.headB.client
                .post(`/api/v1/assignment-requests/${r.id}/accept`)
                .send({}),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        // Exactly one assignee row, exactly one accepted event.
        expect(
            (await assigneeIds(s.task.id)).filter(
                (id) => id === s.target.id,
            ),
        ).toHaveLength(1);
        const events = await db()
            .select()
            .from(schema.taskAssignmentRequestEvents)
            .where(
                and(
                    eq(schema.taskAssignmentRequestEvents.requestId, r.id),
                    eq(schema.taskAssignmentRequestEvents.action, "accepted"),
                ),
            );
        expect(events).toHaveLength(1);
    });

    it("a lapsed request is dead to every mutation, and the janitor formalises + notifies (Q6)", async () => {
        const s = await seed();
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r] = await pendingRows(s.task.id, s.target.id);
        await db()
            .update(schema.taskAssignmentRequests)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(schema.taskAssignmentRequests.id, r.id));

        // Nobody may act on it any more.
        expect(
            (
                await s.target.client
                    .post(`/api/v1/assignment-requests/${r.id}/accept`)
                    .send({})
            ).status,
        ).toBe(409);
        expect(
            (
                await s.requester.client
                    .post(`/api/v1/assignment-requests/${r.id}/cancel`)
                    .send({})
            ).status,
        ).toBe(409);

        // The sweep claims it once, writes the ledger, tells the requester.
        const first = await assignmentGate().expireDue({
            now: new Date(),
            limit: 100,
            dryRun: false,
        });
        expect(first.expired).toBeGreaterThanOrEqual(1);
        const [after] = await pendingRows(s.task.id, s.target.id);
        expect(after.status).toBe("expired");
        expect(after.decidedBy).toBeNull();
        expect(
            await bellRows(s.requester.id, "assignment_request_decided"),
        ).toHaveLength(1);
        // Idempotent: nothing left to claim.
        const again = await assignmentGate().expireDue({
            now: new Date(),
            limit: 100,
            dryRun: false,
        });
        expect(again.expired).toBe(0);
        // The task was left unassigned — asking again is a NEW request.
        expect(await assigneeIds(s.task.id)).toHaveLength(0);
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        expect(await pendingRows(s.task.id, s.target.id)).toHaveLength(2);
    });

    it("accept refuses an archived task and a deactivated target, precisely", async () => {
        const s = await seed();
        const t2 = await makeTask({
            workspaceId: s.ws.id,
            listId: s.listA,
            createdBy: s.requester.id,
        });
        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        await s.requester.client
            .post(`/api/v1/tasks/${t2.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        const [r1] = await pendingRows(s.task.id, s.target.id);
        const [r2] = await pendingRows(t2.id, s.target.id);

        await db()
            .update(schema.tasks)
            .set({ archivedAt: new Date() })
            .where(eq(schema.tasks.id, s.task.id));
        const archived = await s.target.client
            .post(`/api/v1/assignment-requests/${r1.id}/accept`)
            .send({});
        expect(archived.status).toBe(409);
        expect(archived.body.error.code).toBe("request.task_archived");

        await db()
            .update(schema.users)
            .set({ status: "deactivated" })
            .where(eq(schema.users.id, s.target.id));
        const inactive = await s.headB.client
            .post(`/api/v1/assignment-requests/${r2.id}/accept`)
            .send({});
        expect(inactive.status).toBe(409);
        expect(inactive.body.error.code).toBe("request.user_inactive");
    });

    it("stays fully DORMANT under the open seeds — cross-team assignment is instant", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const teamA = await makeRbacSpace(ws.id, admin.id, "Alpha");
        const teamB = await makeRbacSpace(ws.id, admin.id, "Beta");
        const listA = await makeRbacList(ws.id, teamA, admin.id);
        const alpha = await userWithSystemRole(ws, "member");
        await assignRole({
            workspaceId: ws.id,
            userId: alpha.id,
            roleId: ws.systemRoleIds.member,
            spaceId: teamA,
        });
        const beta = await userWithSystemRole(ws, "member");
        await assignRole({
            workspaceId: ws.id,
            userId: beta.id,
            roleId: ws.systemRoleIds.member,
            spaceId: teamB,
        });
        const task = await makeTask({
            workspaceId: ws.id,
            listId: listA,
            createdBy: alpha.id,
        });
        // NO flips — the open-seed world every existing test lives in.
        const res = await alpha.client
            .post(`/api/v1/tasks/${task.id}/assignees`)
            .send({ user_ids: [beta.id] });
        expect(res.status).toBe(204);
        expect(await assigneeIds(task.id)).toContain(beta.id);
        expect(await pendingRows(task.id)).toHaveLength(0);
    });

    it("the exemption switch bypasses the gate wholesale (Q7 — the on-call page)", async () => {
        const s = await seed();
        const split = await assignmentGate().splitByApproval({
            workspaceId: s.ws.id,
            requesterId: s.requester.id,
            exempt: true,
            pairs: [
                {
                    taskId: s.task.id,
                    spaceId: s.teamA,
                    targetUserId: s.target.id,
                    taskName: "S0 incident",
                },
            ],
        });
        expect(split.gated).toHaveLength(0);
        expect(split.directByTask.get(s.task.id)).toEqual([s.target.id]);
        // And without the exemption the same pair IS gated.
        const gated = await assignmentGate().splitByApproval({
            workspaceId: s.ws.id,
            requesterId: s.requester.id,
            pairs: [
                {
                    taskId: s.task.id,
                    spaceId: s.teamA,
                    targetUserId: s.target.id,
                    taskName: "S0 incident",
                },
            ],
        });
        expect(gated.gated).toHaveLength(1);
    });
});
