import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { formFields, formSubmissions, forms } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeList,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormField, makeFormSubmission } from "./helpers";

/**
 * §18 #5 PATCH /api/v1/forms/:id (👑) and #6 DELETE /api/v1/forms/:id (👑).
 */

describe("§18 Forms — update + delete (#5/#6)", () => {
    // ─── #5 PATCH /api/v1/forms/:id ────────────────────────────────────────────
    describe("PATCH /api/v1/forms/:id", () => {
        it("401s without authentication", async () => {
            const res = await (await oneOff())
                .patch("/api/v1/forms/frm-x")
                .send({ title: "X" });
            expect(res.status).toBe(401);
        });

        it("403s for a non-admin member (👑)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({ listId: list.id, createdBy: u.id });
            const res = await client
                .patch(`/api/v1/forms/${form.id}`)
                .send({ title: "Nope" });
            expect(res.status).toBe(403);
        });

        it("updates metadata / settings / branding / is_public (200)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({
                listId: list.id,
                createdBy: u.id,
                title: "Old",
            });

            const res = await client.patch(`/api/v1/forms/${form.id}`).send({
                title: "New title",
                description: "New desc",
                is_public: false,
                settings: { success_message: "Updated!" },
                branding: { primary_color: "#FF0000" },
            });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                id: form.id,
                title: "New title",
                description: "New desc",
                is_public: false,
            });
            expect(res.body.settings).toMatchObject({
                success_message: "Updated!",
            });
            expect(res.body.branding).toMatchObject({
                primary_color: "#FF0000",
            });
        });

        it("422s on an empty body (at least one field required)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({ listId: list.id, createdBy: u.id });
            const res = await client.patch(`/api/v1/forms/${form.id}`).send({});
            expect(res.status).toBe(422);
        });

        it("allows re-setting the form's own current slug", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({
                listId: list.id,
                createdBy: u.id,
                publicSlug: "keep-me",
            });
            const res = await client
                .patch(`/api/v1/forms/${form.id}`)
                .send({ public_slug: "keep-me" });
            expect(res.status).toBe(200);
            expect(res.body.public_slug).toBe("keep-me");
        });

        it("409s when changing to a slug another form owns", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await makeForm({
                listId: list.id,
                createdBy: u.id,
                publicSlug: "owned-by-a",
            });
            const formB = await makeForm({
                listId: list.id,
                createdBy: u.id,
                publicSlug: "owned-by-b",
            });
            const res = await client
                .patch(`/api/v1/forms/${formB.id}`)
                .send({ public_slug: "owned-by-a" });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("form.slug_taken");
        });

        it("404s for an unknown form", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client
                .patch("/api/v1/forms/frm-missing")
                .send({ title: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });

        it("404s for a form in another workspace", async () => {
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
                .patch(`/api/v1/forms/${otherForm.id}`)
                .send({ title: "X" });
            expect(res.status).toBe(404);
        });
    });

    // ─── #6 DELETE /api/v1/forms/:id ───────────────────────────────────────────
    describe("DELETE /api/v1/forms/:id", () => {
        it("401s without authentication", async () => {
            const res = await (await oneOff()).delete("/api/v1/forms/frm-x");
            expect(res.status).toBe(401);
        });

        it("403s for a non-admin member (👑)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({ listId: list.id, createdBy: u.id });
            const res = await client.delete(`/api/v1/forms/${form.id}`);
            expect(res.status).toBe(403);
        });

        it("deletes the form and cascades to fields + submissions (204)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({ listId: list.id, createdBy: u.id });
            await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
            });
            await makeFormSubmission({ formId: form.id, data: { name: "x" } });

            const res = await client.delete(`/api/v1/forms/${form.id}`);
            expect(res.status).toBe(204);

            const db = getDb();
            const remainingForms = await db
                .select()
                .from(forms)
                .where(eq(forms.id, form.id));
            expect(remainingForms).toHaveLength(0);
            const remainingFields = await db
                .select()
                .from(formFields)
                .where(eq(formFields.formId, form.id));
            expect(remainingFields).toHaveLength(0);
            const remainingSubs = await db
                .select()
                .from(formSubmissions)
                .where(eq(formSubmissions.formId, form.id));
            expect(remainingSubs).toHaveLength(0);

            const after = await client.get(`/api/v1/forms/${form.id}`);
            expect(after.status).toBe(404);
        });

        it("404s for an unknown form", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const res = await client.delete("/api/v1/forms/frm-missing");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });

        it("404s for a form in another workspace", async () => {
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
            const res = await client.delete(`/api/v1/forms/${otherForm.id}`);
            expect(res.status).toBe(404);
        });
    });
});
