import {
    makeUser,
    makeLoggedInClient,
    makeList,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormSubmission } from "./helpers";

/**
 * §18 #11 GET /api/v1/forms/:id/submissions (🔐) — newest-first, cursor-paginated.
 */

describe("§18 Forms — submissions (#11)", () => {
    it("401s without authentication", async () => {
        const res = await (
            await oneOff()
        ).get("/api/v1/forms/frm-x/submissions");
        expect(res.status).toBe(401);
    });

    it("returns an empty page for a form with no submissions", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const form = await makeForm({ listId: list.id, createdBy: u.id });

        const res = await client.get(`/api/v1/forms/${form.id}/submissions`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.pagination).toMatchObject({
            next_cursor: null,
            has_more: false,
            total_estimate: 0,
        });
    });

    it("lists submissions newest-first with the wire shape", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const form = await makeForm({ listId: list.id, createdBy: u.id });

        await makeFormSubmission({ formId: form.id, data: { q: "first" } });
        const second = await makeFormSubmission({
            formId: form.id,
            submitterEmail: "buyer@example.test",
            data: { q: "second" },
        });

        const res = await client.get(`/api/v1/forms/${form.id}/submissions`);
        expect(res.status).toBe(200);
        expect(res.body.pagination.total_estimate).toBe(2);
        expect(res.body.data).toHaveLength(2);
        // Newest (highest internal_id) first.
        expect(res.body.data[0].id).toBe(second.id);
        expect(res.body.data[0]).toMatchObject({
            form_id: form.id,
            submitter_email: "buyer@example.test",
            task_id: null,
        });
        expect(res.body.data[0].data).toMatchObject({ q: "second" });
        expect(typeof res.body.data[0].submitted_at).toBe("string");
    });

    it("paginates with limit + cursor", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const form = await makeForm({ listId: list.id, createdBy: u.id });

        const s1 = await makeFormSubmission({ formId: form.id, data: { n: 1 } });
        const s2 = await makeFormSubmission({ formId: form.id, data: { n: 2 } });
        const s3 = await makeFormSubmission({ formId: form.id, data: { n: 3 } });

        const page1 = await client
            .get(`/api/v1/forms/${form.id}/submissions`)
            .query({ limit: 2 });
        expect(page1.status).toBe(200);
        expect(page1.body.data.map((s: { id: string }) => s.id)).toEqual([
            s3.id,
            s2.id,
        ]);
        expect(page1.body.pagination.has_more).toBe(true);
        expect(page1.body.pagination.total_estimate).toBe(3);
        expect(typeof page1.body.pagination.next_cursor).toBe("string");

        const page2 = await client
            .get(`/api/v1/forms/${form.id}/submissions`)
            .query({ limit: 2, cursor: page1.body.pagination.next_cursor });
        expect(page2.status).toBe(200);
        expect(page2.body.data.map((s: { id: string }) => s.id)).toEqual([
            s1.id,
        ]);
        expect(page2.body.pagination.has_more).toBe(false);
        expect(page2.body.pagination.next_cursor).toBeNull();
    });

    it("404s for an unknown form", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const res = await client.get(
            "/api/v1/forms/frm-missing/submissions",
        );
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
        await makeFormSubmission({ formId: otherForm.id, data: { x: 1 } });

        const res = await client.get(
            `/api/v1/forms/${otherForm.id}/submissions`,
        );
        expect(res.status).toBe(404);
    });

    it("422s on an out-of-range limit", async () => {
        const u = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(u);
        const list = await makeList({
            workspaceId: u.workspaceId,
            createdBy: u.id,
        });
        const form = await makeForm({ listId: list.id, createdBy: u.id });
        const res = await client
            .get(`/api/v1/forms/${form.id}/submissions`)
            .query({ limit: 9999 });
        expect(res.status).toBe(422);
    });
});
