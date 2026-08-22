import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
    notifications,
    taskDeleteRequests,
    tasks,
    workspaceActivity,
} from "../../src/db/schema";
import {
    makeList,
    makeLoggedInClient,
    makeStatus,
    makeTask,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { Role } from "../../src/constants";

/**
 * PERMANENT-DELETE APPROVAL (upgrades/023).
 *
 * Deleting a task for good used to be admin-only and instant. Now anyone whose
 * `task.delete` reach covers the task may ASK, and an Owner/Admin decides.
 *
 * The three properties worth breaking a build over:
 *   1. a pending request changes NOTHING about the task — it must never become
 *      a way to make a colleague's work disappear from their board;
 *   2. only an Owner/Admin can approve, and approval really destroys the task;
 *   3. the decision is atomic, so two admins clicking Approve at the same
 *      moment cannot both proceed (the second would delete a ghost).
 */

jest.setTimeout(60_000);

const REQUEST = (id: string) => `/api/v1/tasks/${id}/delete-request`;
const QUEUE = "/api/v1/delete-requests";
const APPROVE = (id: string) => `/api/v1/delete-requests/${id}/approve`;
const REJECT = (id: string) => `/api/v1/delete-requests/${id}/reject`;
const CANCEL = (id: string) => `/api/v1/delete-requests/${id}/cancel`;

const db = () => getDb();

const taskRow = async (id: string) => {
    const [row] = await db().select().from(tasks).where(eq(tasks.id, id));
    return row;
};
const requestsFor = async (taskId: string) =>
    db()
        .select()
        .from(taskDeleteRequests)
        .where(eq(taskDeleteRequests.taskId, taskId));

/** A workspace with a member, an admin, and one task the member owns. */
const seed = async () => {
    const ws = await makeWorkspace();
    const member = await makeUser({ workspaceId: ws.id, role: "member" });
    const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
    const memberClient = await makeLoggedInClient(member);
    const adminClient = await makeLoggedInClient(admin);
    const list = await makeList({ workspaceId: ws.id, createdBy: member.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const status = await makeStatus({ scopeId: list.id });
    const task = await makeTask({
        workspaceId: ws.id,
        listId: list.id,
        statusId: status.id,
        taskTypeId: taskType.id,
        createdBy: member.id,
        name: "Wrongly created campaign task",
    });
    return { ws, member, admin, memberClient, adminClient, list, task, status, taskType };
};

describe("POST /tasks/:id/delete-request", () => {
    it("a member's ask becomes a PENDING request and leaves the task untouched", async () => {
        const s = await seed();

        const res = await s.memberClient
            .post(REQUEST(s.task.id))
            .send({ reason: "duplicate of the other campaign task" });

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("pending");
        expect(res.body.data.task_name).toBe("Wrongly created campaign task");
        expect(res.body.data.reason).toBe(
            "duplicate of the other campaign task",
        );

        // Property 1: the task is still there, and still not archived.
        const row = await taskRow(s.task.id);
        expect(row).toBeDefined();
        expect(row.archivedAt).toBeNull();
    });

    it("an ADMIN asking deletes immediately — they are the approver", async () => {
        const s = await seed();

        const res = await s.adminClient.post(REQUEST(s.task.id)).send({});

        expect(res.status).toBe(204);
        expect(await taskRow(s.task.id)).toBeUndefined();
        // No queue entry: there was nothing to decide.
        expect(await requestsFor(s.task.id)).toHaveLength(0);
    });

    it("refuses a second request for the same task", async () => {
        const s = await seed();
        await s.memberClient.post(REQUEST(s.task.id)).send({});

        const again = await s.memberClient.post(REQUEST(s.task.id)).send({});

        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe("delete_request.already_pending");
        expect(await requestsFor(s.task.id)).toHaveLength(1);
    });

    it("notifies the admins, and not the person who asked", async () => {
        const s = await seed();

        await s.memberClient.post(REQUEST(s.task.id)).send({});

        const rows = await db()
            .select()
            .from(notifications)
            .where(eq(notifications.type, "delete_request"));
        expect(rows.map((r) => r.userId)).toEqual([s.admin.id]);
        expect(rows[0].entityId).toBe(s.task.id);
    });

    it("404s for a task that does not exist", async () => {
        const s = await seed();
        const res = await s.memberClient.post(REQUEST("t-nope")).send({});
        expect(res.status).toBe(404);
    });
});

describe("approve / reject", () => {
    const pendingId = async (client: Awaited<ReturnType<typeof makeLoggedInClient>>, taskId: string) => {
        const res = await client.post(REQUEST(taskId)).send({});
        return res.body.data.id as string;
    };

    it("approval destroys the task and leaves an audit trail that outlives it", async () => {
        const s = await seed();
        const id = await pendingId(s.memberClient, s.task.id);

        const res = await s.adminClient
            .post(APPROVE(id))
            .send({ note: "agreed, it is a duplicate" });

        expect(res.status).toBe(204);
        expect(await taskRow(s.task.id)).toBeUndefined();

        // The request row cascades away with the task — which is exactly why
        // the evidence has to live somewhere without an FK to it.
        const audit = await db()
            .select()
            .from(workspaceActivity)
            .where(
                and(
                    eq(workspaceActivity.entityType, "task"),
                    eq(workspaceActivity.entityId, s.task.id),
                ),
            );
        // ONE row, carrying both halves. The hard-delete path has written
        // `task_hard_deleted` since upgrades/017 (WHAT was destroyed: name,
        // list, subtree size); the approval flow merges WHO ASKED and WHY into
        // that same row. Its presence also proves approval went through the
        // REAL delete rather than a second implementation.
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe("task_hard_deleted");
        expect(audit[0].actorId).toBe(s.admin.id);
        expect(audit[0].context).toMatchObject({
            name: "Wrongly created campaign task",
            subtree_count: 1,
            via: "delete_request",
            requested_by: s.member.id,
            decision_note: "agreed, it is a duplicate",
        });

        // …and the requester is told, pointing at the REQUEST, not the task
        // that no longer exists (a task link would navigate to a 404).
        const [notice] = await db()
            .select()
            .from(notifications)
            .where(eq(notifications.type, "delete_request_decided"));
        expect(notice.userId).toBe(s.member.id);
        expect(notice.entityType).toBe("delete_request");
        expect(notice.title).toContain("Wrongly created campaign task");
    });

    it("rejection keeps the task and records the decision", async () => {
        const s = await seed();
        const id = await pendingId(s.memberClient, s.task.id);

        const res = await s.adminClient
            .post(REJECT(id))
            .send({ note: "we still need this one" });

        expect(res.status).toBe(204);
        expect(await taskRow(s.task.id)).toBeDefined();
        const [req] = await requestsFor(s.task.id);
        expect(req.status).toBe("rejected");
        expect(req.decidedBy).toBe(s.admin.id);
        expect(req.decisionNote).toBe("we still need this one");
    });

    it("a MEMBER cannot approve — not even their own request", async () => {
        const s = await seed();
        const id = await pendingId(s.memberClient, s.task.id);

        const res = await s.memberClient.post(APPROVE(id)).send({});

        expect(res.status).toBe(403);
        expect(await taskRow(s.task.id)).toBeDefined();
        const [req] = await requestsFor(s.task.id);
        expect(req.status).toBe("pending");
    });

    it("the claim is atomic — a second decision is refused, not re-run", async () => {
        const s = await seed();
        const id = await pendingId(s.memberClient, s.task.id);

        const first = await s.adminClient.post(REJECT(id)).send({});
        const second = await s.adminClient.post(APPROVE(id)).send({});

        expect(first.status).toBe(204);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe("delete_request.already_decided");
        // The task survived: the losing APPROVE must not have deleted it.
        expect(await taskRow(s.task.id)).toBeDefined();
    });

    it("the requester can withdraw; nobody else can", async () => {
        const s = await seed();
        const id = await pendingId(s.memberClient, s.task.id);

        const stranger = await makeUser({
            workspaceId: s.ws.id,
            role: "member",
        });
        const strangerClient = await makeLoggedInClient(stranger);
        const theirs = await strangerClient.post(CANCEL(id)).send({});
        expect(theirs.status).toBe(403);

        const mine = await s.memberClient.post(CANCEL(id)).send({});
        expect(mine.status).toBe(204);
        const [req] = await requestsFor(s.task.id);
        expect(req.status).toBe("cancelled");

        // …and cancelling frees the task for a fresh request later.
        const again = await s.memberClient.post(REQUEST(s.task.id)).send({});
        expect(again.status).toBe(201);
    });
});

describe("reading requests", () => {
    it("the drawer read returns the live request, or null", async () => {
        const s = await seed();

        const before = await s.memberClient.get(REQUEST(s.task.id));
        expect(before.status).toBe(200);
        expect(before.body.data).toBeNull();

        await s.memberClient.post(REQUEST(s.task.id)).send({});
        const after = await s.memberClient.get(REQUEST(s.task.id));
        expect(after.body.data.status).toBe("pending");
    });

    it("the approver queue is admin-only; everyone can read their own asks", async () => {
        const s = await seed();
        await s.memberClient.post(REQUEST(s.task.id)).send({});

        const denied = await s.memberClient.get(`${QUEUE}?box=pending`);
        expect(denied.status).toBe(403);

        const queue = await s.adminClient.get(`${QUEUE}?box=pending`);
        expect(queue.status).toBe(200);
        expect(queue.body.data).toHaveLength(1);
        expect(queue.body.data[0].task_id).toBe(s.task.id);

        const mine = await s.memberClient.get(`${QUEUE}?box=mine`);
        expect(mine.status).toBe(200);
        expect(mine.body.data).toHaveLength(1);
    });

    it("does not leak another workspace's request", async () => {
        const s = await seed();
        await s.memberClient.post(REQUEST(s.task.id)).send({});

        const other = await makeWorkspace();
        const otherAdmin = await makeUser({
            workspaceId: other.id,
            role: "admin" as Role,
        });
        const otherClient = await makeLoggedInClient(otherAdmin);

        const queue = await otherClient.get(`${QUEUE}?box=pending`);
        expect(queue.status).toBe(200);
        expect(queue.body.data).toHaveLength(0);
    });
});
