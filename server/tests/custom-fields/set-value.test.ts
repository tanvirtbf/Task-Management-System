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
    customFieldOptions,
    taskCustomFieldValues,
    taskActivity,
    attachments,
    tasks,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `PUT /api/v1/tasks/:id/custom-fields/:fieldId` (§17 #6, 🔐). Per-type
 * value-shape validation is the marquee rule. Isolated `tms_customfields_test`.
 * ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const path = (taskId: string, fieldId: string) =>
    `/api/v1/tasks/${taskId}/custom-fields/${fieldId}`;

type FieldType = "text" | "phone" | "money" | "date" | "dropdown" | "files";

const seedField = async (input: {
    workspaceId: string;
    createdBy: string;
    type: FieldType;
    config?: Record<string, unknown>;
}) => {
    const id = fakeId("cf");
    await getDb()
        .insert(customFields)
        .values({
            id,
            workspaceId: input.workspaceId,
            scopeType: "workspace",
            scopeId: null,
            name: `${input.type} field`,
            type: input.type,
            config: input.config ?? {},
            createdBy: input.createdBy,
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
const seedAttachment = async (taskId: string, uploadedBy: string) => {
    const id = fakeId("att");
    await getDb()
        .insert(attachments)
        .values({
            id,
            taskId,
            name: "file.png",
            storageKey: `k/${id}`,
            sizeBytes: BigInt(1234),
            uploadedBy,
        });
    return id;
};
const getValue = async (taskId: string, customFieldId: string) => {
    const [row] = await getDb()
        .select({ value: taskCustomFieldValues.value })
        .from(taskCustomFieldValues)
        .where(
            and(
                eq(taskCustomFieldValues.taskId, taskId),
                eq(taskCustomFieldValues.customFieldId, customFieldId),
            ),
        )
        .limit(1);
    return row?.value ?? null;
};
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

describe("PUT /api/v1/tasks/:id/custom-fields/:fieldId", () => {
    describe("Happy path per type", () => {
        it("sets a text value (200) and returns the full Task with the value inline", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.put(path(t.id, f)).send({ text: "TRK-1" });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(t.id);
            expect(res.body.custom_field_values[f]).toMatchObject({
                text: "TRK-1",
            });
            expect(await getValue(t.id, f)).toMatchObject({ text: "TRK-1" });
            // ETag bumped.
            expect((await getUpdatedAt(t.id))!.getTime()).toBeGreaterThan(
                PAST.getTime(),
            );
        });

        it("sets money / date / dropdown / files values", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const money = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "money",
            });
            const date = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "date",
            });
            const dd = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "dropdown",
            });
            const opt = await seedOption(dd, "Facebook");
            const files = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "files",
            });
            const att = await seedAttachment(t.id, u.id);

            expect(
                (
                    await client
                        .put(path(t.id, money))
                        .send({ amount: 117000, currency: "BDT" })
                ).status,
            ).toBe(200);
            expect(
                (
                    await client
                        .put(path(t.id, date))
                        .send({ date: "2026-05-28", include_time: false })
                ).status,
            ).toBe(200);
            expect(
                (await client.put(path(t.id, dd)).send({ option_id: opt }))
                    .status,
            ).toBe(200);
            const filesRes = await client
                .put(path(t.id, files))
                .send({ file_ids: [att] });
            expect(filesRes.status).toBe(200);
            expect(await getValue(t.id, money)).toMatchObject({
                amount: 117000,
                currency: "BDT",
            });
        });

        it("upserts — a second PUT replaces the value", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            const client = await makeLoggedInClient(u);

            await client.put(path(t.id, f)).send({ text: "first" });
            await client.put(path(t.id, f)).send({ text: "second" });

            expect(await getValue(t.id, f)).toMatchObject({ text: "second" });
        });

        it("writes a task_activity row (custom_field_value_set)", async () => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            const client = await makeLoggedInClient(u);
            await client.put(path(t.id, f)).send({ text: "x" });
            expect(await activityActions(t.id)).toContain(
                "custom_field_value_set",
            );
        });
    });

    describe("Per-type value validation (marquee)", () => {
        const setup = async (
            type: FieldType,
            config?: Record<string, unknown>,
        ) => {
            const u = await makeUser();
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type,
                config,
            });
            const client = await makeLoggedInClient(u);
            return { u, t, f, client };
        };
        const expect422 = (res: {
            status: number;
            body: { error: { code: string } };
        }) => expect(res.status).toBe(422);

        it("text: rejects a value exceeding config.max_length", async () => {
            const { t, f, client } = await setup("text", { max_length: 3 });
            expect422(
                await client.put(path(t.id, f)).send({ text: "toolong" }),
            );
            expect(
                (await client.put(path(t.id, f)).send({ text: "ok" })).status,
            ).toBe(200);
        });
        it("phone: rejects a non-BD number when default_country=BD", async () => {
            const { t, f, client } = await setup("phone", {
                default_country: "BD",
            });
            expect422(await client.put(path(t.id, f)).send({ text: "12345" }));
            expect(
                (await client.put(path(t.id, f)).send({ text: "01712345678" }))
                    .status,
            ).toBe(200);
        });
        it("money: rejects non-integer amount / missing currency", async () => {
            const { t, f, client } = await setup("money");
            expect422(
                await client
                    .put(path(t.id, f))
                    .send({ amount: 1.5, currency: "BDT" }),
            );
            expect422(await client.put(path(t.id, f)).send({ amount: 100 }));
        });
        it("date: rejects a malformed date", async () => {
            const { t, f, client } = await setup("date");
            expect422(
                await client.put(path(t.id, f)).send({ date: "not-a-date" }),
            );
        });
        it("dropdown: rejects an option_id not in the field's options", async () => {
            const { t, f, client } = await setup("dropdown");
            expect422(
                await client.put(path(t.id, f)).send({ option_id: "bogus" }),
            );
        });
        it("files: rejects a file_id not in the workspace", async () => {
            const { t, f, client } = await setup("files");
            expect422(
                await client
                    .put(path(t.id, f))
                    .send({ file_ids: [fakeId("att")] }),
            );
        });
        it("rejects a value envelope of the wrong shape for the type", async () => {
            const { t, f, client } = await setup("text");
            expect422(await client.put(path(t.id, f)).send({ amount: 1 }));
        });
    });

    describe("Resource lifecycle / tenant", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser();
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            const client = await makeLoggedInClient(u);
            const res = await client
                .put(path(fakeId("t"), f))
                .send({ text: "x" });
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
            const res = await client
                .put(path(t.id, fakeId("cf")))
                .send({ text: "x" });
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
            const f = await seedField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            const client = await makeLoggedInClient(u);
            const res = await client.put(path(t.id, f)).send({ text: "x" });
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
            const bField = await seedField({
                workspaceId: ub.workspaceId,
                createdBy: ub.id,
                type: "text",
            });
            const clientB = await makeLoggedInClient(ub);
            const res = await clientB
                .put(path(aTask.id, bField))
                .send({ text: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    describe("Authentication & authorization (🔐 any member)", () => {
        it("returns 401 without a token", async () => {
            const http = await oneOff();
            const res = await http.put(path("t-x", "cf-x")).send({ text: "x" });
            expect(res.status).toBe(401);
        });
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} to set a value (200)`, async () => {
                const u = await makeUser({ role });
                const t = await makeTask({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const f = await seedField({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                    type: "text",
                });
                const client = await makeLoggedInClient(u);
                const res = await client.put(path(t.id, f)).send({ text: "x" });
                expect(res.status).toBe(200);
            });
        }
    });
});
