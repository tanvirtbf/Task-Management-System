import {
    makeUser,
    makeList,
    makeTaskType,
} from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormField, setListDefaultTaskType } from "./helpers";

/**
 * §18 public VIEW — GET /api/v1/public/forms/:slug (🔓).
 *
 * Gap-scan H2 regression lock: the anonymous view must honour `is_public`.
 * An unpublished form used to render its full field structure at a
 * half-guessable slug; now it is indistinguishable from an unknown slug
 * (404 — no existence oracle). `settings.submission_open` stays a
 * submit-only concern: a soft-closed form still RENDERS.
 */

const seedForm = async (isPublic: boolean, settings?: Record<string, unknown>) => {
    const u = await makeUser({ role: "admin" });
    const list = await makeList({
        workspaceId: u.workspaceId,
        createdBy: u.id,
    });
    const tt = await makeTaskType({ workspaceId: u.workspaceId });
    await setListDefaultTaskType(list.id, tt.id);
    const form = await makeForm({
        listId: list.id,
        createdBy: u.id,
        title: "Supplier intake",
        isPublic,
        settings: settings ?? {},
    });
    await makeFormField({
        formId: form.id,
        fieldKind: "task_attr",
        fieldKey: "name",
        label: "Your request",
        isRequired: true,
    });
    return form;
};

describe("§18 Forms — GET /api/v1/public/forms/:slug", () => {
    it("published form renders anonymously (200 + fields)", async () => {
        const form = await seedForm(true);
        const http = await oneOff();

        const res = await http.get(`/api/v1/public/forms/${form.publicSlug}`);
        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Supplier intake");
        expect(res.body.fields.length).toBeGreaterThan(0);
    });

    it("UNPUBLISHED form is a 404 — same shape as an unknown slug (H2: no oracle)", async () => {
        const form = await seedForm(false);
        const http = await oneOff();

        const res = await http.get(`/api/v1/public/forms/${form.publicSlug}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("form.not_found");

        const unknown = await http.get(`/api/v1/public/forms/nope-abc123`);
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe("form.not_found");
    });

    it("soft-closed form (submission_open=false) still renders — closing is submit's concern", async () => {
        const form = await seedForm(true, { submission_open: false });
        const http = await oneOff();

        const res = await http.get(`/api/v1/public/forms/${form.publicSlug}`);
        expect(res.status).toBe(200);
    });
});
