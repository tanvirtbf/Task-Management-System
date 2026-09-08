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
 * P1 of DEADLINE_TIME_PLAN_2026-09-08 — `start_time` / `due_time` on the wire.
 *
 * upgrades/027 gives each date an optional time of day so work can be handed out
 * with an hourly deadline. This phase only stores and serves it: nothing yet
 * *compares* the two, which is P2's job and where the timezone rules live.
 *
 * ── what these tests are really protecting ──────────────────────────────────
 * The migration adds two nullable columns and backfills nothing, which is the
 * whole safety argument for shipping it: every task that exists today must come
 * back over the wire byte-for-byte as it did before. `null` here is not an
 * absent value to be tidied into a default — it is the load-bearing statement
 * "this task is due some time that day", and the plan's §B1 rests on it.
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

/** What the DB actually holds, as opposed to what the API echoed back. */
const stored = async (id: string) => {
    const [row] = await getDb()
        .select({
            startDate: tasks.startDate,
            dueDate: tasks.dueDate,
            startTime: tasks.startTime,
            dueTime: tasks.dueTime,
            overdueNotifiedAt: tasks.overdueNotifiedAt,
        })
        .from(tasks)
        .where(eq(tasks.id, id));
    return row;
};

describe("POST /tasks — a deadline can carry a time", () => {
    it("round-trips HH:MM through create, read and the database", async () => {
        const ctx = await seed();
        const res = await ctx.client.post(PATH).send(
            body(ctx, {
                start_date: "2026-09-05",
                start_time: "09:30",
                due_date: "2026-09-05",
                due_time: "17:00",
            }),
        );
        expect(res.status).toBe(201);
        expect({
            start_date: res.body.start_date,
            start_time: res.body.start_time,
            due_date: res.body.due_date,
            due_time: res.body.due_time,
        }).toEqual({
            start_date: "2026-09-05",
            start_time: "09:30",
            due_date: "2026-09-05",
            due_time: "17:00",
        });

        // MySQL stores TIME as HH:MM:SS; the wire trims to HH:MM. Both are
        // asserted so a change to either end cannot pass unnoticed.
        const row = await stored(res.body.id);
        expect({ start: row.startTime, due: row.dueTime }).toEqual({
            start: "09:30:00",
            due: "17:00:00",
        });

        // …and reading the task back gives the same answer as the create did.
        const read = await ctx.client.get(`${PATH}/${res.body.id}`);
        expect(read.body.due_time).toBe("17:00");
    });

    it("a task created WITHOUT times is unchanged — null, not midnight", async () => {
        // The migration's safety argument. Every existing task looks like this.
        const ctx = await seed();
        const res = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05" }));

        expect(res.status).toBe(201);
        expect({
            due_date: res.body.due_date,
            due_time: res.body.due_time,
            start_time: res.body.start_time,
        }).toEqual({
            due_date: "2026-09-05",
            due_time: null,
            start_time: null,
        });

        const row = await stored(res.body.id);
        expect({ start: row.startTime, due: row.dueTime }).toEqual({
            start: null,
            due: null,
        });
    });

    it("keeps midnight and one-minute-to-midnight distinct from null", async () => {
        // `00:00` is a real choice a person can make and must not collapse into
        // "no time set" — the two mean different things once P2 resolves them.
        const ctx = await seed();
        for (const t of ["00:00", "23:59"]) {
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { due_date: "2026-09-05", due_time: t }));
            expect({ t, wire: res.body.due_time }).toEqual({ t, wire: t });
        }
    });

    it("refuses a malformed time before it reaches the database", async () => {
        const ctx = await seed();
        for (const bad of ["5:00 PM", "25:00", "17:60", "17", "17:00:00"]) {
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { due_date: "2026-09-05", due_time: bad }));
            expect({ bad, status: res.status }).toEqual({ bad, status: 422 });
        }
    });
});

describe("start must not be after due — now including the time", () => {
    it("refuses a start AFTER the due time on the same day", async () => {
        // The hole the time column opens: the dates are equal, so the old
        // date-only guard and the ck_tasks_dates CHECK both wave it through.
        const ctx = await seed();
        const res = await ctx.client.post(PATH).send(
            body(ctx, {
                start_date: "2026-09-05",
                start_time: "17:00",
                due_date: "2026-09-05",
                due_time: "09:00",
            }),
        );
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("task.invalid_date_range");
    });

    it("ALLOWS a same-day start with no times — the ordinary case", async () => {
        // The regression the asymmetric default exists to prevent. If a missing
        // due time defaulted to 00:00 like the start does, this would be read as
        // "starts 00:00, due 00:00" — fine — but a 5 PM start on a same-day due
        // date would be refused, which is an entirely normal thing to want.
        const ctx = await seed();
        const plain = await ctx.client.post(PATH).send(
            body(ctx, { start_date: "2026-09-05", due_date: "2026-09-05" }),
        );
        expect(plain.status).toBe(201);

        const lateStart = await ctx.client.post(PATH).send(
            body(ctx, {
                start_date: "2026-09-05",
                start_time: "17:00",
                due_date: "2026-09-05",
            }),
        );
        expect(lateStart.status).toBe(201);
    });

    it("still refuses a start on a LATER day, times or not", async () => {
        const ctx = await seed();
        const res = await ctx.client.post(PATH).send(
            body(ctx, { start_date: "2026-09-06", due_date: "2026-09-05" }),
        );
        expect(res.status).toBe(422);
    });
});

describe("PATCH — moving the time re-arms the overdue alert", () => {
    /**
     * `overdue_notified_at` is the once-per-deadline claim the overdue-alert job
     * writes (upgrades/014). Changing the DATE has always cleared it. Changing
     * only the TIME moves the deadline just as truly, and without this a
     * deadline pulled from 5 PM to 10 AM would never alert, because the claim
     * for that date was already spent.
     */
    it("clears the claim when only due_time changes", async () => {
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));
        const id = created.body.id as string;

        // Simulate the job having already alerted for this deadline.
        await getDb()
            .update(tasks)
            .set({ overdueNotifiedAt: new Date() })
            .where(eq(tasks.id, id));
        expect((await stored(id)).overdueNotifiedAt).not.toBeNull();

        const res = await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ due_time: "10:00" });
        expect(res.status).toBe(200);
        expect(res.body.due_time).toBe("10:00");
        expect((await stored(id)).overdueNotifiedAt).toBeNull();
    });

    it("clears a time back to null without touching the date", async () => {
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));

        const res = await ctx.client
            .patch(`${PATH}/${created.body.id}`)
            .send({ due_time: null });
        expect(res.status).toBe(200);
        expect({ date: res.body.due_date, time: res.body.due_time }).toEqual({
            date: "2026-09-05",
            time: null,
        });
    });
});

describe("the wire format does not move with the process timezone", () => {
    /**
     * A TIME column is a wall-clock reading, not an instant — it has no zone of
     * its own, and P2 will resolve it against the workspace's. So `17:00` must
     * come back as `17:00` wherever the API happens to be running. P13 found a
     * date reading a day early west of UTC; this is the same trap one column
     * over, checked before anything starts comparing these values.
     */
    const ORIGINAL_TZ = process.env.TZ;
    afterAll(() => {
        if (ORIGINAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = ORIGINAL_TZ;
    });

    it("serves the same HH:MM in four timezones", async () => {
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(
            body(ctx, { due_date: "2026-09-05", due_time: "17:00" }),
        );
        const id = created.body.id as string;

        for (const tz of [
            "Asia/Dhaka",
            "UTC",
            "America/New_York",
            "Pacific/Midway",
        ]) {
            process.env.TZ = tz;
            const read = await ctx.client.get(`${PATH}/${id}`);
            expect({ tz, date: read.body.due_date, time: read.body.due_time }).toEqual({
                tz,
                date: "2026-09-05",
                time: "17:00",
            });
        }
    });
});
