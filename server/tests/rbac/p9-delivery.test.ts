import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { MailService } from "../../src/services/MailService";
import { resetAssignmentGate } from "../../src/services/AssignmentRequestsService";
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
 * Team-access P9 — the DELIVERY layer behind the approval flow (R1.6):
 * the five email moments fire post-commit to exactly the bell's recipients
 * (via the established MailService prototype spy seam; Web Push is
 * VAPID-withheld under NODE_ENV=test by design), and G15 — bulk assignment
 * used to be completely silent — now produces the same `assigned`
 * bell + email set the single-target path always had.
 */

beforeAll(() => {
    resetPolicy();
    resetAssignmentGate();
});

jest.setTimeout(120_000);

const db = () => getDb();

/** 019 + 020, byte-faithful (the p7/p8 helper). */
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
    const target = await member(teamB);
    const headB = await member(teamB);
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
    return { ws, admin, teamA, listA, requester, target, headB, task };
};

type MailCall = {
    to: string;
    kind: string;
    note: string | null | undefined;
    proposedYmd: string | null | undefined;
};

const spyOnRequestMail = () => {
    const calls: MailCall[] = [];
    const spy = jest
        .spyOn(MailService.prototype, "sendAssignmentRequestEmail")
        .mockImplementation(async (to, p) => {
            calls.push({
                to,
                kind: p.kind,
                note: p.note,
                proposedYmd: p.proposedYmd,
            });
        });
    return { calls, spy };
};

const spyOnAssignedMail = () => {
    const calls: { to: string; taskName: string }[] = [];
    const spy = jest
        .spyOn(MailService.prototype, "sendTaskAssignedEmail")
        .mockImplementation(async (to, p) => {
            calls.push({ to, taskName: p.taskName });
        });
    return { calls, spy };
};

/** Post-commit fanouts are fire-and-forget — give the microtasks a beat. */
const settle = () => new Promise((r) => setTimeout(r, 250));

afterEach(() => jest.restoreAllMocks());

const emailOf = async (userId: string): Promise<string> => {
    const [row] = await db()
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
    return row.email;
};

describe("P9 — the delivery layer", () => {
    it("request created → 'received' mail to the target AND their Head, never the requester", async () => {
        const s = await seed();
        const { calls } = spyOnRequestMail();

        await s.requester.client
            .post(`/api/v1/tasks/${s.task.id}/assignees`)
            .send({ user_ids: [s.target.id] });
        await settle();

        const received = calls.filter((c) => c.kind === "received");
        expect(received).toHaveLength(2);
        const tos = received.map((c) => c.to).sort();
        expect(tos).toEqual(
            [await emailOf(s.target.id), await emailOf(s.headB.id)].sort(),
        );
        const requesterEmail = await emailOf(s.requester.id);
        expect(calls.some((c) => c.to === requesterEmail)).toBe(false);
    });

    it("decline / query / answer / accept each mail their counterpart with the right kind", async () => {
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
        const [r1] = await db()
            .select()
            .from(schema.taskAssignmentRequests)
            .where(eq(schema.taskAssignmentRequests.taskId, s.task.id));
        const [r2] = await db()
            .select()
            .from(schema.taskAssignmentRequests)
            .where(eq(schema.taskAssignmentRequests.taskId, t2.id));

        const { calls } = spyOnRequestMail();
        const assigned = spyOnAssignedMail();
        const requesterEmail = await emailOf(s.requester.id);
        const targetEmail = await emailOf(s.target.id);

        // QUERY → the requester, with the note + proposed date.
        await s.target.client
            .post(`/api/v1/assignment-requests/${r1.id}/query`)
            .send({ note: "need 2 more days", proposed_due_date: "2026-08-20" });
        await settle();
        expect(
            calls.filter(
                (c) => c.kind === "query" && c.to === requesterEmail,
            ),
        ).toHaveLength(1);
        expect(calls.find((c) => c.kind === "query")?.proposedYmd).toBe(
            "2026-08-20",
        );

        // ANSWER → the receiver side.
        await s.requester.client
            .post(`/api/v1/assignment-requests/${r1.id}/answer`)
            .send({ note: "ok, take them" });
        await settle();
        expect(
            calls.filter(
                (c) => c.kind === "answer" && c.to === targetEmail,
            ),
        ).toHaveLength(1);

        // The HEAD accepts → 'accepted' to the requester + the normal
        // assigned mail to the target (they did not act themselves).
        await s.headB.client
            .post(`/api/v1/assignment-requests/${r1.id}/accept`)
            .send({});
        await settle();
        expect(
            calls.filter(
                (c) => c.kind === "accepted" && c.to === requesterEmail,
            ),
        ).toHaveLength(1);
        expect(
            assigned.calls.filter((c) => c.to === targetEmail),
        ).toHaveLength(1);

        // DECLINE (the second request) → 'declined' to the requester.
        await s.target.client
            .post(`/api/v1/assignment-requests/${r2.id}/decline`)
            .send({ note: "fully booked" });
        await settle();
        const declined = calls.filter((c) => c.kind === "declined");
        expect(declined).toHaveLength(1);
        expect(declined[0].to).toBe(requesterEmail);
        expect(declined[0].note).toBe("fully booked");
    });

    it("G15: BULK assignment now produces the assigned bell + email (it used to be silent)", async () => {
        // Open-seed workspace — the dormant world every real bulk lives in.
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const teamA = await makeRbacSpace(ws.id, admin.id, "Alpha");
        const listA = await makeRbacList(ws.id, teamA, admin.id);
        const mate = await userWithSystemRole(ws, "member");
        await assignRole({
            workspaceId: ws.id,
            userId: mate.id,
            roleId: ws.systemRoleIds.member,
            spaceId: teamA,
        });
        const t1 = await makeTask({
            workspaceId: ws.id,
            listId: listA,
            createdBy: admin.id,
        });
        const t2 = await makeTask({
            workspaceId: ws.id,
            listId: listA,
            createdBy: admin.id,
        });

        const assigned = spyOnAssignedMail();
        const res = await admin.client.post("/api/v1/tasks/bulk").send({
            ids: [t1.id, t2.id],
            patch: { assignee_add: [mate.id] },
        });
        expect(res.status).toBe(200);
        expect(res.body.pending_approval).toBe(0);
        await settle();

        // One `assigned` bell per task…
        const bells = await db()
            .select()
            .from(schema.notifications)
            .where(
                and(
                    eq(schema.notifications.userId, mate.id),
                    eq(schema.notifications.type, "assigned"),
                ),
            );
        expect(bells).toHaveLength(2);
        // …and one email per task, to the assignee only.
        const mateEmail = await emailOf(mate.id);
        expect(assigned.calls).toHaveLength(2);
        expect(assigned.calls.every((c) => c.to === mateEmail)).toBe(true);

        // Re-running the same bulk is a no-op: no duplicate bells/mails.
        assigned.calls.length = 0;
        await admin.client.post("/api/v1/tasks/bulk").send({
            ids: [t1.id, t2.id],
            patch: { assignee_add: [mate.id] },
        });
        await settle();
        expect(assigned.calls).toHaveLength(0);
        expect(
            await db()
                .select()
                .from(schema.notifications)
                .where(
                    and(
                        eq(schema.notifications.userId, mate.id),
                        eq(schema.notifications.type, "assigned"),
                    ),
                ),
        ).toHaveLength(2);
    });
});
