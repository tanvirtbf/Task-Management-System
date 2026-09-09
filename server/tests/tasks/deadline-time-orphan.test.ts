import { eq } from "drizzle-orm";
import {
    makeList,
    makeLoggedInClient,
    makeStatus,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";

/**
 * P3 of DEADLINE_TIME_PLAN_2026-09-08 — a time cannot outlive its date.
 *
 * The plan's P3 step 3 reads "clearing the date clears the time; setting a time
 * without a date is refused in the UI, *not only by the validator*" — which
 * assumed a validator was already holding that line. It was not. P1 added the
 * two columns and validated each one's FORMAT; nothing tied a time to its date,
 * on any of the three write paths.
 *
 * ── why it matters, given `deadlinePassed` already ignores an orphan ─────────
 * The resolver returns "not late" for a task with no due date whatever its
 * time, so this is not a wrong-answer bug. It is a data bug with a a user-facing
 * shape: set a deadline of "5 Sep, 5:00 PM", clear the date, set a new date next
 * week — and the task silently carries 5:00 PM onto a deadline nobody gave a
 * time to. The person who set the new date never saw the old time and cannot
 * see it now, because a badge with no date renders nothing at all.
 *
 * Enforced on the SERVER rather than only in the pickers, because the pickers
 * are not the only writer: the public form submit path skips the HTTP task
 * validator entirely, the bulk patch is its own schema, and the assistant
 * creates tasks through this same service.
 */

jest.setTimeout(60_000);

const PATH = "/api/v1/tasks";

const seed = async () => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    return { ws, user, client, list, taskType };
};

const body = (
    ctx: { list: { id: string }; taskType: { id: string } },
    extra: Record<string, unknown> = {},
) => ({
    primary_list_id: ctx.list.id,
    name: "Ship the thing",
    task_type_id: ctx.taskType.id,
    ...extra,
});

const stored = async (id: string) => {
    const [row] = await getDb()
        .select({
            startDate: tasks.startDate,
            dueDate: tasks.dueDate,
            startTime: tasks.startTime,
            dueTime: tasks.dueTime,
        })
        .from(tasks)
        .where(eq(tasks.id, id));
    return row;
};

describe("clearing a date clears its time", () => {
    it("PATCH due_date: null also clears due_time", async () => {
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_date: null });
        expect(res.status).toBe(200);

        // The API's own answer and the database must agree — a serializer that
        // hides the orphan would be worse than the orphan.
        expect({
            wire: res.body.due_time,
            db: (await stored(id)).dueTime,
        }).toEqual({ wire: null, db: null });
    });

    it("PATCH start_date: null also clears start_time", async () => {
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(
            body(ctx, {
                start_date: "2026-09-05",
                start_time: "09:30",
                due_date: "2026-09-30",
            }),
        );
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ start_date: null });
        expect(res.status).toBe(200);
        expect({
            wire: res.body.start_time,
            db: (await stored(id)).startTime,
        }).toEqual({ wire: null, db: null });
    });

    it("clearing ONE date leaves the other date's time alone", async () => {
        // The obvious way to get this wrong is to null both times whenever
        // either date is cleared.
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(
            body(ctx, {
                start_date: "2026-09-05",
                start_time: "09:30",
                due_date: "2026-09-30",
                due_time: "17:00",
            }),
        );
        expect(created.status).toBe(201);
        const id = created.body.id;

        await ctx.client.patch(`${PATH}/${id}`).send({ start_date: null });
        expect(await stored(id)).toEqual({
            startDate: null,
            startTime: null,
            dueDate: expect.anything(),
            dueTime: "17:00:00",
        });
    });

    it("the BULK patch clears it too", async () => {
        // A second write path with its own schema. P1's format validation had
        // to be added to all three, and the first attempt patched only two.
        //
        // ⚠️ POST, not PATCH. `PATCH /tasks/bulk` matches `PATCH /tasks/:id`
        // with id="bulk" and answers a validation 422 that looks exactly like
        // a real refusal -- which is how the first draft of this test blamed
        // the product for its own mistake.
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await ctx.client
            .post(`${PATH}/bulk`)
            .send({ ids: [id], patch: { due_date: null } });
        expect(res.status).toBe(200);
        expect((await stored(id)).dueTime).toBeNull();
    });

    it("the BULK patch refuses a time that would orphan on ANY target", async () => {
        // Fail-atomic, like every other bulk validation: one uniform patch
        // lands on rows with different dates, so a batch is refused whole
        // rather than applied to the half it happens to suit.
        const ctx = await seed();
        const withDate = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05" }));
        const withoutDate = await ctx.client.post(PATH).send(body(ctx));

        const res = await ctx.client.post(`${PATH}/bulk`).send({
            ids: [withDate.body.id, withoutDate.body.id],
            patch: { due_time: "17:00" },
        });
        expect({ status: res.status, code: res.body.error?.code }).toEqual({
            status: 422,
            code: "task.time_without_date",
        });
        // Whole batch, so the target that WOULD have been fine is untouched.
        expect((await stored(withDate.body.id)).dueTime).toBeNull();
    });

    it("the BULK patch ALLOWS a time when every target has a date", async () => {
        const ctx = await seed();
        const a = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05" }));
        const b = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-30" }));

        const res = await ctx.client.post(`${PATH}/bulk`).send({
            ids: [a.body.id, b.body.id],
            patch: { due_time: "17:00" },
        });
        expect(res.status).toBe(200);
        expect([
            (await stored(a.body.id)).dueTime,
            (await stored(b.body.id)).dueTime,
        ]).toEqual(["17:00:00", "17:00:00"]);
    });

    it("a time SURVIVES a date change that is not a clear", async () => {
        // Vacuity guard in the other direction: "clear the time whenever the
        // date is touched" would pass every test above and be wrong. Moving a
        // deadline from the 5th to the 6th keeps 5:00 PM.
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_date: "2026-09-06" });
        expect(res.status).toBe(200);
        expect(res.body.due_time).toBe("17:00");
    });
});

describe("a time without a date is refused, not stored", () => {
    it("POST with due_time and no due_date is a 422", async () => {
        const ctx = await seed();
        const res = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_time: "17:00" }));
        expect({ status: res.status, code: res.body.error?.code }).toEqual({
            status: 422,
            code: "task.time_without_date",
        });
    });

    it("POST with start_time and no start_date is a 422", async () => {
        const ctx = await seed();
        const res = await ctx.client
            .post(PATH)
            .send(body(ctx, { start_time: "09:30", due_date: "2026-09-05" }));
        expect(res.status).toBe(422);
    });

    it("PATCH adding a time to a task with no date is a 422", async () => {
        // The check must read the RESULTING state, not the payload: this
        // request carries no date at all, and is still wrong.
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(body(ctx));
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_time: "17:00" });
        expect({ status: res.status, code: res.body.error?.code }).toEqual({
            status: 422,
            code: "task.time_without_date",
        });
        expect((await stored(id)).dueTime).toBeNull();
    });

    it("PATCH adding a time to a task that HAS a date is fine", async () => {
        // The same request, one fixture apart. Without this the rule could be
        // "reject every time-only patch", which would make the picker useless.
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05" }));
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_time: "17:00" });
        expect(res.status).toBe(200);
        expect(res.body.due_time).toBe("17:00");
    });

    it("PATCH setting a date and a time together is fine", async () => {
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(body(ctx));
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_date: "2026-09-05", due_time: "17:00" });
        expect(res.status).toBe(200);
        expect(res.body.due_time).toBe("17:00");
    });

    it("PATCH clearing the date while setting a time is a 422", async () => {
        // Contradictory in one request. Silently dropping the time would be
        // defensible; silently keeping it would not, and a 422 says which the
        // caller got.
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05" }));
        const id = created.body.id;

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_date: null, due_time: "17:00" });
        expect(res.status).toBe(422);
    });
});
