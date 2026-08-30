import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeTask,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    customFields,
    taskCustomFieldValues,
    taskActivity,
    tasks,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/**
 * Tests for `DELETE /api/v1/tasks/:id/custom-fields/:fieldId` (§17 #7, 🔐).
 * Clears a task's value; idempotent. Isolated `tms_customfields_test`.
 * ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const path = (taskId: string, fieldId: string) =>
    `/api/v1/tasks/${taskId}/custom-fields/${fieldId}`;

const seedTextField = async (workspaceId: string, createdBy: string) => {
    const id = fakeId("cf");
    await getDb().insert(customFields).values({
        id,
        workspaceId,
        scopeType: "workspace",
        scopeId: null,
        name: "Text",
        type: "text",
        createdBy,
    });
    return id;
};
const seedValue = async (
    taskId: string,
    customFieldId: string,
    updatedBy: string,
) => {
    await getDb()
        .insert(taskCustomFieldValues)
        .values({ taskId, customFieldId, value: { text: "set" }, updatedBy });
};
const valueExists = async (taskId: string, customFieldId: string) =>
    (
        await getDb()
            .select({ taskId: taskCustomFieldValues.taskId })
            .from(taskCustomFieldValues)
            .where(
                and(
                    eq(taskCustomFieldValues.taskId, taskId),
                    eq(taskCustomFieldValues.customFieldId, customFieldId),
                ),
            )
    ).length > 0;
const activityActions = async (taskId: string) =>
    (
        await getDb()
            .select({ action: taskActivity.action })
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).map((r) => r.action);
const setUpdatedAtPast = async (taskId: string) => {
    await getDb()
        .update(tasks)
        .set({ updatedAt: PAST })
        .where(eq(tasks.id, taskId));
};
const getUpdatedAt = async (taskId: string) => {
    const [row] = await getDb()
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row?.updatedAt ?? null;
};
const _signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

describe("DELETE /api/v1/tasks/:id/custom-fields/:fieldId", () => {
    describe("Happy path", () => {
        it("clears a set value (204), removes the row, writes activity, bumps ETag", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedTextField(u.workspaceId, u.id);
            await seedValue(t.id, f, u.id);
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(path(t.id, f));

            expect(res.status).toBe(204);
            expect(await valueExists(t.id, f)).toBe(false);
            expect(await activityActions(t.id)).toContain(
                "custom_field_value_cleared",
            );
            expect((await getUpdatedAt(t.id))!.getTime()).toBeGreaterThan(
                PAST.getTime(),
            );
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedTextField(u.workspaceId, u.id);
            await seedValue(t.id, f, u.id);
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(t.id, f));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Idempotency", () => {
        it("clearing a field with no value is a 204 no-op (no activity, no bump)", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedTextField(u.workspaceId, u.id);
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(path(t.id, f));

            expect(res.status).toBe(204);
            expect(await activityActions(t.id)).not.toContain(
                "custom_field_value_cleared",
            );
            expect((await getUpdatedAt(t.id))!.getTime()).toBe(PAST.getTime());
        });
    });

    describe("Resource lifecycle / tenant", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser();
            const f = await seedTextField(u.workspaceId, u.id);
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(fakeId("t"), f));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
        it("returns 404 custom_field.not_found for an absent field", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(t.id, fakeId("cf")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("custom_field.not_found");
        });
        it("returns 409 task.archived for an archived task", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const f = await seedTextField(u.workspaceId, u.id);
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(t.id, f));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
        it("returns 404 when the task is in another workspace", async () => {
            const ua = await makeUser();
            const ub = await makeUser();
            const aTask = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            const bField = await seedTextField(ub.workspaceId, ub.id);
            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.delete(path(aTask.id, bField));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    describe("Authentication & authorization (🔐 any member)", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(path("t-x", "cf-x"));
            expect(res.status).toBe(401);
        });
        for (const role of ["owner", "admin", "member"] as const) {
            it(`allows a ${role} to clear (204)`, async () => {
                const u = await makeUser({ role });
                const t = await makeTask({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const f = await seedTextField(u.workspaceId, u.id);
                await seedValue(t.id, f, u.id);
                const client = await makeLoggedInClient(u);
                const res = await client.delete(path(t.id, f));
                expect(res.status).toBe(204);
            });
        }

        // F28 (ISS-094, D12.1): clearing rides the same `customfield.set_value`
        // gate that setting does, and the Guest role no longer holds it.
        it("REFUSES a guest (403) — customfield.set_value revoked", async () => {
            const u = await makeUser({ role: "guest" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedTextField(u.workspaceId, u.id);
            await seedValue(t.id, f, u.id);
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(t.id, f));
            expect(res.status).toBe(403);
        });
    });
});
