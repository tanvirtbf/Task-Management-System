import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { fakeId } from "../../src/utils";
import { makeStatus, makeTask } from "../test-utils/factories";
import {
    assignRole,
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithSystemRole,
    type RbacWorkspace,
} from "./helpers";

/**
 * Team-access P7 — the edit-rights MATRIX, in the production shape (the
 * 019 + 020 flips applied byte-faithfully to a test workspace):
 *
 *   same-team NON-assignee → refused on EVERY edit path (403 not_own)
 *   assignee               → full edit incl. completing
 *   HEAD of the owning space (not assigned) → full edit (the G4 allow-path)
 *   creator                → keeps edit (Q3, pre-acceptance)
 *   other team             → 404 (invisible, no oracle)
 *   admin                  → unaffected
 *
 * Every adjacent surface participates: tags, checklists (+items),
 * attachments (sign), custom-field values, dependencies, archive, bulk.
 */

beforeAll(() => resetPolicy());

jest.setTimeout(90_000);

const db = () => getDb();

/** 019 + 020, byte-faithful. */
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
                eq(
                    schema.rolePermissions.roleId,
                    ws.systemRoleIds.member,
                ),
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
    const creator = await member(teamA);
    const assignee = await member(teamA);
    const teammate = await member(teamA);
    const head = await member(teamA);
    const outsider = await member(teamB);
    await db()
        .update(schema.spaces)
        .set({ headUserId: head.id })
        .where(eq(schema.spaces.id, teamA));

    const task = await makeTask({
        workspaceId: ws.id,
        listId: listA,
        createdBy: creator.id,
    });
    await db()
        .insert(schema.taskAssignees)
        .values({ taskId: task.id, userId: assignee.id, assignedBy: admin.id });

    // A tag, a custom field and a second task for the adjacent probes.
    const tagId = fakeId("tag");
    await db().insert(schema.tags).values({
        id: tagId,
        workspaceId: ws.id,
        name: `probe-${tagId.slice(4, 10)}`,
    });
    const fieldId = fakeId("cf");
    await db().insert(schema.customFields).values({
        id: fieldId,
        workspaceId: ws.id,
        scopeType: "workspace",
        scopeId: null,
        name: "probe text",
        type: "text",
        config: {},
        createdBy: admin.id,
    });
    const otherTask = await makeTask({
        workspaceId: ws.id,
        listId: listA,
        createdBy: admin.id,
    });

    await applyFlips(ws);
    return {
        ws,
        admin,
        teamA,
        listA,
        creator,
        assignee,
        teammate,
        head,
        outsider,
        task,
        otherTask,
        tagId,
        fieldId,
    };
};

const sign = (client: { post: (u: string) => { send: (b: object) => Promise<{ status: number }> } }, taskId: string) =>
    client.post("/api/v1/uploads/sign").send({
        scope_type: "task",
        scope_id: taskId,
        filename: "probe.pdf",
        mime_type: "application/pdf",
        size_bytes: 1000,
    });

describe("P7 — the edit-rights matrix", () => {
    it("a same-team NON-assignee is refused on every edit path", async () => {
        const s = await seed();
        const c = s.teammate.client;
        const T = s.task.id;

        expect(
            (await c.patch(`/api/v1/tasks/${T}`).send({ priority: 1 }))
                .status,
        ).toBe(403);
        expect(
            (await c.post(`/api/v1/tasks/${T}/tags`).send({ tag_id: s.tagId }))
                .status,
        ).toBe(403);
        expect(
            (
                await c
                    .post(`/api/v1/tasks/${T}/checklists`)
                    .send({ name: "sneak" })
            ).status,
        ).toBe(403);
        expect((await sign(c, T)).status).toBe(403);
        expect(
            (
                await c
                    .put(`/api/v1/tasks/${T}/custom-fields/${s.fieldId}`)
                    .send({ text: "x" })
            ).status,
        ).toBe(403);
        expect(
            (
                await c.post("/api/v1/task-dependencies").send({
                    task_id: T,
                    related_task_id: s.otherTask.id,
                })
            ).status,
        ).toBe(403);
        expect((await c.post(`/api/v1/tasks/${T}/archive`)).status).toBe(403);
        expect(
            (
                await c
                    .post("/api/v1/tasks/bulk")
                    .send({ ids: [T], patch: { priority: 2 } })
            ).status,
        ).toBe(403);
    });

    it("the ASSIGNEE edits, tags, checklists, attaches, sets fields, links and completes", async () => {
        const s = await seed();
        const c = s.assignee.client;
        const T = s.task.id;

        expect(
            (await c.patch(`/api/v1/tasks/${T}`).send({ priority: 1 }))
                .status,
        ).toBe(200);
        expect(
            (await c.post(`/api/v1/tasks/${T}/tags`).send({ tag_id: s.tagId }))
                .status,
        ).toBe(204);
        const checklist = await c
            .post(`/api/v1/tasks/${T}/checklists`)
            .send({ name: "assignee list" });
        expect(checklist.status).toBe(201);
        const item = await c
            .post(`/api/v1/checklists/${checklist.body.id}/items`)
            .send({ text: "step one" });
        expect(item.status).toBe(201);
        expect(
            (
                await c.post(
                    `/api/v1/checklist-items/${item.body.id}/toggle`,
                )
            ).status,
        ).toBe(200);
        expect((await sign(c, T)).status).toBe(201);
        expect(
            (
                await c
                    .put(`/api/v1/tasks/${T}/custom-fields/${s.fieldId}`)
                    .send({ text: "done by assignee" })
            ).status,
        ).toBe(200);
        expect(
            (
                await c.post("/api/v1/task-dependencies").send({
                    task_id: T,
                    related_task_id: s.otherTask.id,
                })
            ).status,
        ).toBe(201);
        const done = await makeStatus({
            scopeId: s.listA,
            statusGroup: "done",
            name: "Finished",
        });
        const complete = await c
            .patch(`/api/v1/tasks/${T}`)
            .send({ status_id: done.id });
        expect(complete.status).toBe(200);
        expect(complete.body.completed_at).not.toBeNull();
    });

    it("the HEAD of the owning space (not assigned) has the same reach — G4", async () => {
        const s = await seed();
        const c = s.head.client;
        const T = s.task.id;

        expect(
            (await c.patch(`/api/v1/tasks/${T}`).send({ priority: 1 }))
                .status,
        ).toBe(200);
        expect(
            (await c.post(`/api/v1/tasks/${T}/tags`).send({ tag_id: s.tagId }))
                .status,
        ).toBe(204);
        expect(
            (
                await c
                    .post(`/api/v1/tasks/${T}/checklists`)
                    .send({ name: "head's checklist" })
            ).status,
        ).toBe(201);
        expect((await sign(c, T)).status).toBe(201);
        expect(
            (
                await c
                    .put(`/api/v1/tasks/${T}/custom-fields/${s.fieldId}`)
                    .send({ text: "set by head" })
            ).status,
        ).toBe(200);
        expect(
            (
                await c
                    .post("/api/v1/tasks/bulk")
                    .send({ ids: [T], patch: { priority: 3 } })
            ).status,
        ).toBe(200);
    });

    it("the CREATOR keeps edit (Q3, pre-acceptance), including archive", async () => {
        const s = await seed();
        const c = s.creator.client;
        expect(
            (
                await c
                    .patch(`/api/v1/tasks/${s.task.id}`)
                    .send({ name: "renamed by creator" })
            ).status,
        ).toBe(200);
        expect(
            (await c.post(`/api/v1/tasks/${s.task.id}/archive`)).status,
        ).toBe(204);
    });

    it("the other team gets 404s — the task does not exist for them", async () => {
        const s = await seed();
        const c = s.outsider.client;
        expect(
            (await c.patch(`/api/v1/tasks/${s.task.id}`).send({ priority: 1 }))
                .status,
        ).toBe(404);
        expect(
            (
                await c
                    .post(`/api/v1/tasks/${s.task.id}/checklists`)
                    .send({ name: "x" })
            ).status,
        ).toBe(404);
    });

    it("an ADMIN is unaffected, including the SLA override", async () => {
        const s = await seed();
        const c = s.admin.client;
        expect(
            (await c.patch(`/api/v1/tasks/${s.task.id}`).send({ priority: 4 }))
                .status,
        ).toBe(200);
        const future = new Date(Date.now() + 86_400_000).toISOString();
        expect(
            (
                await c
                    .patch(`/api/v1/tasks/${s.task.id}/sla`)
                    .send({ sla_due_at: future })
            ).status,
        ).toBe(200);
    });
});
