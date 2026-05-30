import {
    makeUser,
    makeLoggedInClient,
    makeList,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormField, makeCustomField } from "./helpers";

/**
 * §18 form-field endpoints: #7 POST /forms/:id/fields, #8 PATCH /form-fields/:id,
 * #9 DELETE /form-fields/:id, #10 PATCH /forms/:id/fields/reorder. All 👑.
 */

const seedForm = async (role: "admin" | "owner" | "member" = "admin") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    const list = await makeList({
        workspaceId: u.workspaceId,
        createdBy: u.id,
    });
    const form = await makeForm({ listId: list.id, createdBy: u.id });
    return { u, client, list, form };
};

describe("§18 Forms — fields (#7/#8/#9/#10)", () => {
    // ─── #7 POST /api/v1/forms/:id/fields ──────────────────────────────────────
    describe("POST /api/v1/forms/:id/fields", () => {
        it("401s without auth", async () => {
            const res = await (await oneOff())
                .post("/api/v1/forms/frm-x/fields")
                .send({ field_kind: "task_attr", field_key: "name", label: "N" });
            expect(res.status).toBe(401);
        });

        it("403s for a non-admin member", async () => {
            const { client, form } = await seedForm("member");
            const res = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({ field_kind: "task_attr", field_key: "name", label: "N" });
            expect(res.status).toBe(403);
        });

        it("adds a task_attr field, auto-appending position (201)", async () => {
            const { client, form } = await seedForm();
            const first = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({
                    field_kind: "task_attr",
                    field_key: "name",
                    label: "Your name",
                    is_required: true,
                });
            expect(first.status).toBe(201);
            expect(first.body).toMatchObject({
                field_kind: "task_attr",
                field_key: "name",
                label: "Your name",
                is_required: true,
                is_hidden: false,
                position: 0,
            });
            expect(typeof first.body.id).toBe("string");

            const second = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({
                    field_kind: "task_attr",
                    field_key: "description",
                    label: "Details",
                });
            expect(second.status).toBe(201);
            expect(second.body.position).toBe(1);
        });

        it("adds a custom_field field referencing a real custom field", async () => {
            const { u, client, form } = await seedForm();
            const cf = await makeCustomField({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                type: "text",
            });
            const res = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({
                    field_kind: "custom_field",
                    field_key: cf.id,
                    label: "Custom",
                });
            expect(res.status).toBe(201);
            expect(res.body.field_kind).toBe("custom_field");
            expect(res.body.field_key).toBe(cf.id);
        });

        it("422s for a task_attr key not in the whitelist", async () => {
            const { client, form } = await seedForm();
            const res = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({
                    field_kind: "task_attr",
                    field_key: "not_a_task_field",
                    label: "X",
                });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("form.invalid_field_key");
        });

        it("422s for a custom_field key that is not a custom field", async () => {
            const { client, form } = await seedForm();
            const res = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({
                    field_kind: "custom_field",
                    field_key: "cf-does-not-exist",
                    label: "X",
                });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("form.invalid_field_key");
        });

        it("409s on a duplicate (kind, key) for the same form", async () => {
            const { client, form } = await seedForm();
            const body = {
                field_kind: "task_attr",
                field_key: "name",
                label: "Name",
            };
            const a = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send(body);
            expect(a.status).toBe(201);
            const b = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send(body);
            expect(b.status).toBe(409);
            expect(b.body.error.code).toBe("form_field.duplicate");
        });

        it("404s when the form is in another workspace", async () => {
            const admin = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(admin);
            const other = await makeUser({ role: "admin" });
            const otherList = await makeList({
                workspaceId: other.workspaceId,
                createdBy: other.id,
            });
            const otherForm = await makeForm({
                listId: otherList.id,
                createdBy: other.id,
            });
            const res = await client
                .post(`/api/v1/forms/${otherForm.id}/fields`)
                .send({ field_kind: "task_attr", field_key: "name", label: "N" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });

        it("422s on missing required body fields", async () => {
            const { client, form } = await seedForm();
            const res = await client
                .post(`/api/v1/forms/${form.id}/fields`)
                .send({ field_kind: "task_attr" });
            expect(res.status).toBe(422);
        });
    });

    // ─── #8 PATCH /api/v1/form-fields/:id ──────────────────────────────────────
    describe("PATCH /api/v1/form-fields/:id", () => {
        it("401s without auth", async () => {
            const res = await (await oneOff())
                .patch("/api/v1/form-fields/ffld-x")
                .send({ label: "X" });
            expect(res.status).toBe(401);
        });

        it("403s for a non-admin member", async () => {
            const { form } = await seedForm("member");
            const field = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            const member = await makeUser({ role: "member" });
            const memberClient = await makeLoggedInClient(member);
            const res = await memberClient
                .patch(`/api/v1/form-fields/${field.id}`)
                .send({ label: "X" });
            expect(res.status).toBe(403);
        });

        it("updates a field (200)", async () => {
            const { client, form } = await seedForm();
            const field = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "Old",
            });
            const res = await client
                .patch(`/api/v1/form-fields/${field.id}`)
                .send({
                    label: "New label",
                    is_required: true,
                    is_hidden: true,
                    help_text: "Some help",
                    placeholder: "type here",
                });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                id: field.id,
                label: "New label",
                is_required: true,
                is_hidden: true,
                help_text: "Some help",
                placeholder: "type here",
            });
        });

        it("422s on an empty body", async () => {
            const { client, form } = await seedForm();
            const field = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            const res = await client
                .patch(`/api/v1/form-fields/${field.id}`)
                .send({});
            expect(res.status).toBe(422);
        });

        it("404s for an unknown field", async () => {
            const { client } = await seedForm();
            const res = await client
                .patch("/api/v1/form-fields/ffld-missing")
                .send({ label: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form_field.not_found");
        });

        it("404s for a field on another workspace's form", async () => {
            const admin = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(admin);
            const other = await makeUser({ role: "admin" });
            const otherList = await makeList({
                workspaceId: other.workspaceId,
                createdBy: other.id,
            });
            const otherForm = await makeForm({
                listId: otherList.id,
                createdBy: other.id,
            });
            const field = await makeFormField({
                formId: otherForm.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            const res = await client
                .patch(`/api/v1/form-fields/${field.id}`)
                .send({ label: "X" });
            expect(res.status).toBe(404);
        });
    });

    // ─── #9 DELETE /api/v1/form-fields/:id ─────────────────────────────────────
    describe("DELETE /api/v1/form-fields/:id", () => {
        it("403s for a non-admin member", async () => {
            const { form } = await seedForm();
            const field = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            const member = await makeUser({ role: "member" });
            const memberClient = await makeLoggedInClient(member);
            const res = await memberClient.delete(
                `/api/v1/form-fields/${field.id}`,
            );
            expect(res.status).toBe(403);
        });

        it("deletes a field (204) and it disappears from the form", async () => {
            const { client, form } = await seedForm();
            const field = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            const res = await client.delete(
                `/api/v1/form-fields/${field.id}`,
            );
            expect(res.status).toBe(204);

            const after = await client.get(`/api/v1/forms/${form.id}`);
            expect(after.body.fields).toHaveLength(0);
        });

        it("404s for an unknown field", async () => {
            const { client } = await seedForm();
            const res = await client.delete("/api/v1/form-fields/ffld-missing");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form_field.not_found");
        });
    });

    // ─── #10 PATCH /api/v1/forms/:id/fields/reorder ────────────────────────────
    describe("PATCH /api/v1/forms/:id/fields/reorder", () => {
        it("403s for a non-admin member", async () => {
            const { form } = await seedForm();
            const member = await makeUser({ role: "member" });
            const memberClient = await makeLoggedInClient(member);
            const res = await memberClient
                .patch(`/api/v1/forms/${form.id}/fields/reorder`)
                .send({ items: [] });
            expect(res.status).toBe(403);
        });

        it("reorders fields and returns the form in new order (200)", async () => {
            const { client, form } = await seedForm();
            const f1 = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "One",
                position: 0,
            });
            const f2 = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "description",
                label: "Two",
                position: 1,
            });
            const f3 = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "priority",
                label: "Three",
                position: 2,
            });

            const res = await client
                .patch(`/api/v1/forms/${form.id}/fields/reorder`)
                .send({
                    items: [
                        { id: f3.id, position: 0 },
                        { id: f2.id, position: 1 },
                        { id: f1.id, position: 2 },
                    ],
                });
            expect(res.status).toBe(200);
            expect(
                res.body.fields.map((f: { label: string }) => f.label),
            ).toEqual(["Three", "Two", "One"]);
        });

        it("422s when an item is not a field of the form", async () => {
            const { client, form } = await seedForm();
            const mine = await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
                position: 0,
            });
            const res = await client
                .patch(`/api/v1/forms/${form.id}/fields/reorder`)
                .send({
                    items: [
                        { id: mine.id, position: 0 },
                        { id: "ffld-foreign", position: 1 },
                    ],
                });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("form_field.not_in_form");
        });

        it("422s on an empty items array", async () => {
            const { client, form } = await seedForm();
            const res = await client
                .patch(`/api/v1/forms/${form.id}/fields/reorder`)
                .send({ items: [] });
            expect(res.status).toBe(422);
        });

        it("404s when the form is unknown", async () => {
            const { client } = await seedForm();
            const res = await client
                .patch("/api/v1/forms/frm-missing/fields/reorder")
                .send({ items: [{ id: "ffld-x", position: 0 }] });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });
    });
});
