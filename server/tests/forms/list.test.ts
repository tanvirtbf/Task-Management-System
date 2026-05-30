import { makeUser, makeLoggedInClient, makeList } from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormField } from "./helpers";

/**
 * §18 #1 GET /api/v1/forms, #2 GET /api/v1/lists/:listId/forms,
 * #3 GET /api/v1/forms/:id — the three 🔐 read endpoints.
 */

describe("§18 Forms — reads (#1/#2/#3)", () => {
    // ─── #1 GET /api/v1/forms ──────────────────────────────────────────────────
    describe("GET /api/v1/forms", () => {
        it("401s without authentication", async () => {
            const res = await (await oneOff()).get("/api/v1/forms");
            expect(res.status).toBe(401);
        });

        it("returns all forms in the workspace, each with fields inline", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const formA = await makeForm({
                listId: list.id,
                createdBy: u.id,
                title: "Intake A",
            });
            await makeFormField({
                formId: formA.id,
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "Your name",
                isRequired: true,
                position: 0,
            });
            await makeForm({
                listId: list.id,
                createdBy: u.id,
                title: "Intake B",
            });

            const res = await client.get("/api/v1/forms");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).toHaveLength(2);

            const a = res.body.find(
                (f: { title: string }) => f.title === "Intake A",
            );
            expect(a).toMatchObject({
                id: formA.id,
                list_id: list.id,
                title: "Intake A",
                is_public: true,
                submission_count: 0,
            });
            expect(typeof a.created_at).toBe("string");
            expect(a.fields).toHaveLength(1);
            expect(a.fields[0]).toMatchObject({
                field_kind: "task_attr",
                field_key: "name",
                label: "Your name",
                is_required: true,
                is_hidden: false,
                position: 0,
            });
        });

        it("returns [] when the workspace has no forms", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const res = await client.get("/api/v1/forms");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("does not leak forms from other workspaces", async () => {
            const mine = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(mine);

            const other = await makeUser({ role: "member" });
            const otherList = await makeList({
                workspaceId: other.workspaceId,
                createdBy: other.id,
            });
            await makeForm({ listId: otherList.id, createdBy: other.id });

            const res = await client.get("/api/v1/forms");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });
    });

    // ─── #2 GET /api/v1/lists/:listId/forms ────────────────────────────────────
    describe("GET /api/v1/lists/:listId/forms", () => {
        it("401s without authentication", async () => {
            const res = await (
                await oneOff()
            ).get("/api/v1/lists/l-whatever/forms");
            expect(res.status).toBe(401);
        });

        it("returns only the forms attached to that list", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const listA = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const listB = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const onA = await makeForm({ listId: listA.id, createdBy: u.id });
            await makeForm({ listId: listB.id, createdBy: u.id });

            const res = await client.get(`/api/v1/lists/${listA.id}/forms`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].id).toBe(onA.id);
            expect(res.body[0].list_id).toBe(listA.id);
        });

        it("404s for a list in another workspace (no existence oracle)", async () => {
            const mine = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(mine);
            const other = await makeUser({ role: "member" });
            const otherList = await makeList({
                workspaceId: other.workspaceId,
                createdBy: other.id,
            });

            const res = await client.get(
                `/api/v1/lists/${otherList.id}/forms`,
            );
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    // ─── #3 GET /api/v1/forms/:id ──────────────────────────────────────────────
    describe("GET /api/v1/forms/:id", () => {
        it("401s without authentication", async () => {
            const res = await (await oneOff()).get("/api/v1/forms/frm-x");
            expect(res.status).toBe(401);
        });

        it("returns the form with its fields ordered by position", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const list = await makeList({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const form = await makeForm({
                listId: list.id,
                createdBy: u.id,
                title: "Bug intake",
                description: "Report a bug",
                settings: { success_message: "Thanks!" },
            });
            await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "description",
                label: "Second",
                position: 1,
            });
            await makeFormField({
                formId: form.id,
                fieldKind: "task_attr",
                fieldKey: "name",
                label: "First",
                position: 0,
            });

            const res = await client.get(`/api/v1/forms/${form.id}`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                id: form.id,
                list_id: list.id,
                title: "Bug intake",
                description: "Report a bug",
                public_slug: form.publicSlug,
                is_public: true,
                submission_count: 0,
            });
            expect(res.body.fields.map((f: { label: string }) => f.label)).toEqual(
                ["First", "Second"],
            );
        });

        it("404s for an unknown form id", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const res = await client.get("/api/v1/forms/frm-does-not-exist");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });

        it("404s for a form in another workspace", async () => {
            const mine = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(mine);
            const other = await makeUser({ role: "member" });
            const otherList = await makeList({
                workspaceId: other.workspaceId,
                createdBy: other.id,
            });
            const otherForm = await makeForm({
                listId: otherList.id,
                createdBy: other.id,
            });

            const res = await client.get(`/api/v1/forms/${otherForm.id}`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("form.not_found");
        });
    });
});
