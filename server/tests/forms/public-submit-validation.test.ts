import { makeUser, makeList, makeStatus, makeTaskType } from "../test-utils/factories";
import { oneOff } from "../test-utils/app";
import { makeForm, makeFormField, setListDefaultTaskType } from "./helpers";

/**
 * §18 public submit — task_attr VALUE validation. The anonymous submit path maps
 * `task_attr` fields (priority / due_date / start_date) straight into
 * TaskWriteService.create, BYPASSING the HTTP task validator that the normal
 * POST /tasks path runs. Without its own checks, an out-of-range priority or a
 * malformed date reaches the DB and trips a CHECK / Invalid-Date → an unhandled
 * 500 on a PUBLIC endpoint. These tests assert a clean 422 instead.
 */

const seed = async () => {
    const u = await makeUser({ role: "admin" });
    const list = await makeList({ workspaceId: u.workspaceId, createdBy: u.id });
    const tt = await makeTaskType({ workspaceId: u.workspaceId });
    await setListDefaultTaskType(list.id, tt.id);
    await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    const form = await makeForm({
        listId: list.id,
        createdBy: u.id,
        title: "Intake",
        isPublic: true,
    });
    for (const [i, key] of ["name", "priority", "due_date", "start_date"].entries()) {
        await makeFormField({
            formId: form.id,
            fieldKind: "task_attr",
            fieldKey: key,
            label: key,
            position: i,
        });
    }
    return { form };
};

const submit = async (
    form: { publicSlug: string },
    data: Record<string, unknown>,
) =>
    (await oneOff())
        .post(`/api/v1/public/forms/${form.publicSlug}/submit`)
        .send({ data });

describe("§18 public submit — task_attr value validation (anonymous injection guard)", () => {
    it("422 for an out-of-range priority (not a 500 CHECK violation)", async () => {
        const { form } = await seed();
        const res = await submit(form, { name: "x", priority: 99 });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("422 for a negative priority", async () => {
        const { form } = await seed();
        const res = await submit(form, { name: "x", priority: -3 });
        expect(res.status).toBe(422);
    });

    it("422 for a malformed due_date (not a 500 Invalid Date)", async () => {
        const { form } = await seed();
        const res = await submit(form, { name: "x", due_date: "garbage" });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("validation.failed");
    });

    it("422 for a calendar-overflow due_date like 2026-13-45", async () => {
        const { form } = await seed();
        const res = await submit(form, { name: "x", due_date: "2026-13-45" });
        expect(res.status).toBe(422);
    });

    it("422 when start_date is after due_date (not a 500 CHECK violation)", async () => {
        const { form } = await seed();
        const res = await submit(form, {
            name: "x",
            start_date: "2026-12-31",
            due_date: "2026-01-01",
        });
        expect(res.status).toBe(422);
    });

    it("422 for a name longer than the 500-char column (not a 500 data-too-long)", async () => {
        const { form } = await seed();
        const res = await submit(form, { name: "z".repeat(501) });
        expect(res.status).toBe(422);
    });

    it("201 for valid priority + ordered dates (baseline)", async () => {
        const { form } = await seed();
        const res = await submit(form, {
            name: "x",
            priority: 3,
            start_date: "2026-01-01",
            due_date: "2026-02-01",
        });
        expect(res.status).toBe(201);
    });
});
