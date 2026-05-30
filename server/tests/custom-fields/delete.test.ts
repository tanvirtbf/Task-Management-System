import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeTask,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    customFields,
    customFieldOptions,
    taskCustomFieldValues,
    workspaceActivity,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `DELETE /api/v1/custom-fields/:id` (§17 #5, 👑 admin/owner).
 * Cascades to options + all stored task values (DB ON DELETE CASCADE). Isolated
 * `tms_customfields_test`. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const path = (id: string) => `/api/v1/custom-fields/${id}`;

const seedDropdownField = async (workspaceId: string, createdBy: string) => {
    const id = fakeId("cf");
    await getDb().insert(customFields).values({
        id,
        workspaceId,
        scopeType: "workspace",
        scopeId: null,
        name: "Source",
        type: "dropdown",
        createdBy,
    });
    return id;
};
const seedOption = async (customFieldId: string, label: string) => {
    const id = fakeId("cfo");
    await getDb()
        .insert(customFieldOptions)
        .values({ id, customFieldId, label });
    return id;
};
const seedValue = async (
    taskId: string,
    customFieldId: string,
    value: unknown,
    updatedBy: string,
) => {
    await getDb()
        .insert(taskCustomFieldValues)
        .values({ taskId, customFieldId, value, updatedBy });
};
const fieldExists = async (id: string) =>
    (
        await getDb()
            .select({ id: customFields.id })
            .from(customFields)
            .where(eq(customFields.id, id))
    ).length > 0;
const optionCount = async (customFieldId: string) =>
    (
        await getDb()
            .select({ id: customFieldOptions.id })
            .from(customFieldOptions)
            .where(eq(customFieldOptions.customFieldId, customFieldId))
    ).length;
const valueCount = async (customFieldId: string) =>
    (
        await getDb()
            .select({ taskId: taskCustomFieldValues.taskId })
            .from(taskCustomFieldValues)
            .where(eq(taskCustomFieldValues.customFieldId, customFieldId))
    ).length;
const fetchActivityFor = async (entityId: string) =>
    getDb()
        .select({ action: workspaceActivity.action })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
const signAccess = (
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

describe("DELETE /api/v1/custom-fields/:id", () => {
    describe("Happy path + cascade", () => {
        it("deletes the field (204) and cascades to its options and stored values", async () => {
            const u = await makeUser({ role: "admin" });
            const fieldId = await seedDropdownField(u.workspaceId, u.id);
            const optId = await seedOption(fieldId, "Facebook");
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedValue(task.id, fieldId, { option_id: optId }, u.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(path(fieldId));

            expect(res.status).toBe(204);
            expect(await fieldExists(fieldId)).toBe(false);
            expect(await optionCount(fieldId)).toBe(0); // cascade
            expect(await valueCount(fieldId)).toBe(0); // cascade
        });

        it("writes a workspace_activity row (action=deleted) that survives the cascade", async () => {
            const u = await makeUser({ role: "admin" });
            const fieldId = await seedDropdownField(u.workspaceId, u.id);
            const client = await makeLoggedInClient(u);
            await client.delete(path(fieldId));
            const rows = await fetchActivityFor(fieldId);
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe("deleted");
        });

        it("allows an owner to delete", async () => {
            const u = await makeUser({ role: "owner" });
            const fieldId = await seedDropdownField(u.workspaceId, u.id);
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(fieldId));
            expect(res.status).toBe(204);
        });
    });

    describe("Not found / idempotency / tenant", () => {
        it("returns 404 for an absent id", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client.delete(path(fakeId("cf")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("custom_field.not_found");
        });
        it("a second delete returns 404 (already gone)", async () => {
            const u = await makeUser({ role: "admin" });
            const fieldId = await seedDropdownField(u.workspaceId, u.id);
            const client = await makeLoggedInClient(u);
            const first = await client.delete(path(fieldId));
            const second = await client.delete(path(fieldId));
            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
        });
        it("returns 404 for another workspace's field and leaves it intact", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aId = await seedDropdownField(ua.workspaceId, ua.id);
            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.delete(path(aId));
            expect(res.status).toBe(404);
            expect(await fieldExists(aId)).toBe(true);
        });
    });

    describe("Authentication & authorization (👑 admin/owner)", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(path("cf-x"));
            expect(res.status).toBe(401);
        });
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 for a ${role} and leaves the field`, async () => {
                const u = await makeUser({ role });
                const fieldId = await seedDropdownField(u.workspaceId, u.id);
                const client = await makeLoggedInClient(u);
                const res = await client.delete(path(fieldId));
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await fieldExists(fieldId)).toBe(true);
            });
        }
    });
});
