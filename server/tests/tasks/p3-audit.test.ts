import { eq } from "drizzle-orm";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTaskType,
    makeTask,
    makeTag,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    taskActivity,
    tasks,
    workspaceActivity,
} from "../../src/db/schema";

/**
 * Team-access P3 (plan G13) — the audit-log completion, TaskWrite side:
 *
 *   - bulk assignee / tag changes write the SAME per-pair rows the
 *     single-target endpoints write (only for pairs that actually changed),
 *   - bulk (un)archive writes semantic task_archived/task_unarchived rows and
 *     the `archived_at` timestamp no longer leaks into `task_updated` diffs,
 *   - `status_changed` rows denormalise from_name/to_name,
 *   - description diffs are clipped,
 *   - a parent's archive cascade writes a `via_parent` row per descendant,
 *   - a HARD delete leaves a `workspace_activity` trail (entity 'task') —
 *     the task's own rows die in the FK cascade.
 */

jest.setTimeout(60_000);

const BULK = "/api/v1/tasks/bulk";
const db = () => getDb();

const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async (role: "owner" | "admin" | "member" = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const mk = () =>
        makeTask({
            workspaceId: ws.id,
            createdBy: user.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: taskType.id,
        });
    return { ws, user, client, list, taskType, status, mk };
};

describe("P3 — bulk membership changes are audited", () => {
    it("bulk assignee_add writes one assignee_added row per (task,user) that actually changed", async () => {
        const ctx = await seed();
        const helper = await makeUser({ workspaceId: ctx.ws.id });
        const t1 = await ctx.mk();
        const t2 = await ctx.mk();
        // Pre-assign the helper on t1 through the single endpoint, so the bulk
        // is a no-op THERE and a real change on t2.
        await ctx.client
            .post(`/api/v1/tasks/${t1.id}/assignees`)
            .send({ user_ids: [helper.id] });

        const res = await ctx.client
            .post(BULK)
            .send({ ids: [t1.id, t2.id], patch: { assignee_add: [helper.id] } });
        expect(res.status).toBe(200);

        const rows1 = (await activityFor(t1.id)).filter(
            (a) => a.action === "assignee_added",
        );
        const rows2 = (await activityFor(t2.id)).filter(
            (a) => a.action === "assignee_added",
        );
        // t1: only the single-endpoint row (no bulk duplicate for a no-op).
        expect(rows1).toHaveLength(1);
        expect(
            (rows1[0].context as { bulk?: boolean }).bulk,
        ).toBeUndefined();
        // t2: exactly one bulk row with the standard shape.
        expect(rows2).toHaveLength(1);
        expect(rows2[0].context).toMatchObject({
            user_id: helper.id,
            bulk: true,
        });
        expect(rows2[0].actorId).toBe(ctx.user.id);
    });

    it("bulk assignee_remove + tag add/remove write rows only where state changed, tags with names", async () => {
        const ctx = await seed();
        const helper = await makeUser({ workspaceId: ctx.ws.id });
        const tag = await makeTag({ workspaceId: ctx.ws.id });
        const t1 = await ctx.mk();
        const t2 = await ctx.mk();
        await ctx.client
            .post(`/api/v1/tasks/${t1.id}/assignees`)
            .send({ user_ids: [helper.id] });
        await ctx.client
            .post(`/api/v1/tasks/${t1.id}/tags`)
            .send({ tag_id: tag.id });

        const res = await ctx.client.post(BULK).send({
            ids: [t1.id, t2.id],
            patch: {
                assignee_remove: [helper.id],
                tag_add: [tag.id],
                tag_remove: [],
            },
        });
        expect(res.status).toBe(200);

        // Removal happened only on t1 (t2 never had the helper).
        const removed1 = (await activityFor(t1.id)).filter(
            (a) => a.action === "assignee_removed",
        );
        const removed2 = (await activityFor(t2.id)).filter(
            (a) => a.action === "assignee_removed",
        );
        expect(removed1).toHaveLength(1);
        expect(removed1[0].context).toMatchObject({
            user_id: helper.id,
            bulk: true,
        });
        expect(removed2).toHaveLength(0);

        // The tag landed only on t2 (t1 already had it) — with its NAME.
        const tagAdd1 = (await activityFor(t1.id)).filter(
            (a) => a.action === "tag_added",
        );
        const tagAdd2 = (await activityFor(t2.id)).filter(
            (a) => a.action === "tag_added",
        );
        expect(tagAdd1).toHaveLength(1); // the single-endpoint row only
        expect(tagAdd2).toHaveLength(1);
        expect(tagAdd2[0].context).toMatchObject({
            tag_id: tag.id,
            name: tag.name,
            bulk: true,
        });
    });
});

describe("P3 — bulk archive is audited semantically", () => {
    it("writes task_archived/task_unarchived rows and keeps archived_at OUT of task_updated diffs", async () => {
        const ctx = await seed();
        const t1 = await ctx.mk();
        const t2 = await ctx.mk();
        // t2 starts archived, so the bulk archive is a no-op for it.
        await db()
            .update(tasks)
            .set({ archivedAt: new Date() })
            .where(eq(tasks.id, t2.id));

        const res = await ctx.client.post(BULK).send({
            ids: [t1.id, t2.id],
            patch: { archived_at: new Date().toISOString() },
        });
        expect(res.status).toBe(200);

        const arch1 = (await activityFor(t1.id)).filter(
            (a) => a.action === "task_archived",
        );
        const arch2 = (await activityFor(t2.id)).filter(
            (a) => a.action === "task_archived",
        );
        expect(arch1).toHaveLength(1);
        expect(arch1[0].context).toMatchObject({ bulk: true });
        expect(arch2).toHaveLength(0); // already archived — no lie

        // No task_updated row smuggling an `archived_at` timestamp diff.
        const updated = (await activityFor(t1.id)).filter(
            (a) => a.action === "task_updated",
        );
        for (const row of updated) {
            const changes =
                (row.context as { changes?: Record<string, unknown> })
                    ?.changes ?? {};
            expect(Object.keys(changes)).not.toContain("archived_at");
        }

        // Unarchive round-trip mirrors it.
        const back = await ctx.client.post(BULK).send({
            ids: [t1.id, t2.id],
            patch: { archived_at: null },
        });
        expect(back.status).toBe(200);
        const un1 = (await activityFor(t1.id)).filter(
            (a) => a.action === "task_unarchived",
        );
        const un2 = (await activityFor(t2.id)).filter(
            (a) => a.action === "task_unarchived",
        );
        expect(un1).toHaveLength(1);
        expect(un2).toHaveLength(1); // t2 WAS archived → real transition
    });
});

describe("P3 — status names + description clipping", () => {
    it("status_changed rows carry from_name/to_name (single PATCH and bulk)", async () => {
        const ctx = await seed();
        const done = await makeStatus({
            scopeId: ctx.list.id,
            name: "Shipped",
            statusGroup: "done",
        });
        const t1 = await ctx.mk();
        const t2 = await ctx.mk();

        await ctx.client
            .patch(`/api/v1/tasks/${t1.id}`)
            .send({ status_id: done.id });
        const single = (await activityFor(t1.id)).find(
            (a) => a.action === "status_changed",
        );
        expect(single?.context).toMatchObject({
            from: ctx.status.id,
            to: done.id,
            to_name: "Shipped",
        });
        expect(
            (single?.context as { from_name?: string }).from_name,
        ).toBeTruthy();

        await ctx.client
            .post(BULK)
            .send({ ids: [t2.id], patch: { status_id: done.id } });
        const bulk = (await activityFor(t2.id)).find(
            (a) => a.action === "status_changed",
        );
        expect(bulk?.context).toMatchObject({
            to: done.id,
            to_name: "Shipped",
        });
        expect(
            (bulk?.context as { from_name?: string }).from_name,
        ).toBeTruthy();
    });

    it("clips a huge description diff instead of storing two essays", async () => {
        const ctx = await seed();
        const t = await ctx.mk();
        const essay = "x".repeat(5000);
        const res = await ctx.client
            .patch(`/api/v1/tasks/${t.id}`)
            .send({ description: essay });
        expect(res.status).toBe(200);

        const row = (await activityFor(t.id)).find(
            (a) => a.action === "task_updated",
        );
        const change = (
            row?.context as {
                changes?: { description?: { from: unknown; to: unknown } };
            }
        )?.changes?.description;
        expect(change).toBeDefined();
        expect(String(change?.to).length).toBeLessThanOrEqual(281);
        expect(String(change?.to).endsWith("…")).toBe(true);
    });
});

describe("P3 — cascades and hard delete leave a trail", () => {
    it("archiving a parent writes a via_parent row on each live descendant", async () => {
        const ctx = await seed();
        const parent = await ctx.mk();
        const child = await makeTask({
            workspaceId: ctx.ws.id,
            createdBy: ctx.user.id,
            listId: ctx.list.id,
            statusId: ctx.status.id,
            taskTypeId: ctx.taskType.id,
        });
        await db()
            .update(tasks)
            .set({ parentTaskId: parent.id })
            .where(eq(tasks.id, child.id));

        const res = await ctx.client.post(
            `/api/v1/tasks/${parent.id}/archive`,
        );
        expect(res.status).toBe(204);

        const childRows = (await activityFor(child.id)).filter(
            (a) => a.action === "task_archived",
        );
        expect(childRows).toHaveLength(1);
        expect(childRows[0].context).toMatchObject({
            via_parent: parent.id,
        });

        // Restore mirrors it.
        await ctx.client.post(`/api/v1/tasks/${parent.id}/unarchive`);
        const childBack = (await activityFor(child.id)).filter(
            (a) => a.action === "task_unarchived",
        );
        expect(childBack).toHaveLength(1);
        expect(childBack[0].context).toMatchObject({
            via_parent: parent.id,
        });
    });

    it("a hard delete writes the surviving workspace_activity row BEFORE the cascade", async () => {
        const ctx = await seed("owner");
        const t = await ctx.mk();
        const res = await ctx.client.delete(
            `/api/v1/tasks/${t.id}?hard=true`,
        );
        expect(res.status).toBe(204);

        // The task and its own activity are gone…
        expect(await activityFor(t.id)).toHaveLength(0);
        // …but the workspace-level trail survives, with the essentials.
        const trail = await db()
            .select()
            .from(workspaceActivity)
            .where(eq(workspaceActivity.entityId, t.id));
        expect(trail).toHaveLength(1);
        expect(trail[0].entityType).toBe("task");
        expect(trail[0].action).toBe("task_hard_deleted");
        expect(trail[0].actorId).toBe(ctx.user.id);
        expect(trail[0].context).toMatchObject({
            list_id: ctx.list.id,
            subtree_count: 1,
        });
    });
});
