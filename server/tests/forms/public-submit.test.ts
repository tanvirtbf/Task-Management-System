import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
    forms,
    taskCustomFieldValues,
    tasks,
} from "../../src/db/schema";
import {
    makeUser,
    makeList,
    makeStatus,
    makeTaskType,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import {
    makeForm,
    makeFormField,
    makeCustomField,
    setListDefaultTaskType,
} from "./helpers";

/**
 * §18 public submit — POST /api/v1/public/forms/:slug/submit (🔓).
 *
 * Seeds a "submission-ready" list: a default task type + at least one status,
 * so the reused TaskWriteService can resolve a type/status for the created task.
 */

const seedSubmittableForm = async (opts: {
    isPublic?: boolean;
    settings?: Record<string, unknown>;
    slug?: string;
} = {}) => {
    const u = await makeUser({ role: "admin" });
    const list = await makeList({
        workspaceId: u.workspaceId,
        createdBy: u.id,
    });
    const tt = await makeTaskType({ workspaceId: u.workspaceId });
    await setListDefaultTaskType(list.id, tt.id);
    await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    const form = await makeForm({
        listId: list.id,
        createdBy: u.id,
        title: "Complaint intake",
        isPublic: opts.isPublic ?? true,
        publicSlug: opts.slug,
        settings: opts.settings ?? {},
    });
    return { u, list, tt, form };
};

describe("§18 Forms — public submit", () => {
    it("missing ENCRYPTION_KEY → clean 503 BEFORE the intake task exists (gap-scan C4 orphan-task lock)", async () => {
        const { form } = await seedSubmittableForm();
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "name",
            label: "Subject",
            isRequired: true,
        });
        const { Config } = await import("../../src/config");
        const realKey = Config.ENCRYPTION_KEY;
        try {
            (Config as { ENCRYPTION_KEY: string }).ENCRYPTION_KEY = "";
            const agent = await oneOff();
            const res = await agent
                .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
                .send({ data: { name: "should not create a task" } });
            expect(res.status).toBe(503);
            expect(res.body.error.code).toBe("form.encryption_unavailable");

            // The old bug created the task FIRST, then crashed on encrypt.
            const orphan = await getDb()
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.name, "should not create a task"));
            expect(orphan.length).toBe(0);
        } finally {
            (Config as { ENCRYPTION_KEY: string }).ENCRYPTION_KEY = realKey;
        }
    });

    it("creates a task + records the submission + bumps submission_count (201)", async () => {
        const { form } = await seedSubmittableForm({
            settings: { success_message: "Thanks for reaching out!" },
        });
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "name",
            label: "Subject",
            isRequired: true,
            position: 0,
        });
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "description",
            label: "Details",
            position: 1,
        });

        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({
                data: {
                    name: "Order arrived damaged",
                    description: "The box was crushed",
                    email: "buyer@example.test",
                },
            });

        expect(res.status).toBe(201);
        expect(typeof res.body.submission_id).toBe("string");
        expect(typeof res.body.task_id).toBe("string");
        expect(res.body.message).toBe("Thanks for reaching out!");

        const db = getDb();
        const [task] = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, res.body.task_id));
        expect(task).toBeDefined();
        expect(task.name).toBe("Order arrived damaged");
        expect(task.description).toBe("The box was crushed");

        const [formRow] = await db
            .select()
            .from(forms)
            .where(eq(forms.id, form.id));
        expect(formRow.submissionCount).toBe(1);
    });

    it("defaults the task name to the form title when no name field is mapped", async () => {
        const { form } = await seedSubmittableForm();
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "description",
            label: "Details",
        });

        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({ data: { description: "no subject given" } });
        expect(res.status).toBe(201);

        const db = getDb();
        const [task] = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, res.body.task_id));
        expect(task.name).toContain("Complaint intake");
    });

    it("writes a custom_field value to the created task", async () => {
        const { u, form } = await seedSubmittableForm();
        const cf = await makeCustomField({
            workspaceId: u.workspaceId,
            createdBy: u.id,
            type: "text",
            name: "Phone model",
        });
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "name",
            label: "Subject",
            position: 0,
        });
        await makeFormField({
            formId: form.id,
            fieldKind: "custom_field",
            fieldKey: cf.id,
            label: "Model",
            position: 1,
        });

        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({
                data: {
                    name: "Has a custom field",
                    [cf.id]: { text: "Galaxy S24" },
                },
            });
        expect(res.status).toBe(201);

        const db = getDb();
        const [val] = await db
            .select()
            .from(taskCustomFieldValues)
            .where(
                and(
                    eq(taskCustomFieldValues.taskId, res.body.task_id),
                    eq(taskCustomFieldValues.customFieldId, cf.id),
                ),
            );
        expect(val).toBeDefined();
        expect(val.value).toMatchObject({ text: "Galaxy S24" });
    });

    it("422s when a required field is missing", async () => {
        const { form } = await seedSubmittableForm();
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: "name",
            label: "Subject",
            isRequired: true,
        });

        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({ data: {} });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("validates a dropdown custom-field value against its options", async () => {
        const { u, form } = await seedSubmittableForm();
        const cf = await makeCustomField({
            workspaceId: u.workspaceId,
            createdBy: u.id,
            type: "dropdown",
            name: "Priority",
        });
        await makeFormField({
            formId: form.id,
            fieldKind: "custom_field",
            fieldKey: cf.id,
            label: "Pick one",
        });

        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({ data: { [cf.id]: { option_id: "cfo-not-real" } } });
        expect(res.status).toBe(422);
    });

    it("404s for an unknown slug", async () => {
        const agent = await oneOff();
        const res = await agent
            .post("/api/v1/public/forms/no-such-slug/submit")
            .send({ data: { name: "x" } });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("form.not_found");
    });

    it("403s for a non-public form", async () => {
        const { form } = await seedSubmittableForm({ isPublic: false });
        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({ data: { name: "x" } });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("form.submission_closed");
    });

    it("403s when settings.submission_open is false", async () => {
        const { form } = await seedSubmittableForm({
            settings: { submission_open: false },
        });
        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({ data: { name: "x" } });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("form.submission_closed");
    });

    it("422s when the body has no data object", async () => {
        const { form } = await seedSubmittableForm();
        const agent = await oneOff();
        const res = await agent
            .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
            .send({});
        expect(res.status).toBe(422);
    });
});
