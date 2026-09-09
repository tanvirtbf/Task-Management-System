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
import { deadlineLabel } from "../../src/utils/deadline";

/**
 * P7 of DEADLINE_TIME_PLAN_2026-09-08 — the semantics sweep, server side.
 *
 * Everything that reads a due date and had not been touched by P1–P6. The two
 * questions the plan asked, answered against the code rather than by reading
 * it, plus the wording change that follows from them.
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

describe("P7.4 — recurrence and due_time do not fight", () => {
    /**
     * The plan asked: *"does a recurring task inherit the parent's time? (It
     * has `recurrence_time` already — these two must not fight.)"*
     *
     * They cannot, and this pins WHY rather than trusting it. `recurrence_time`
     * is when the spawn job FIRES; `due_time` is when the work is due. The
     * spawn deliberately creates a clean dated task and carries nothing over —
     * not the due date, and therefore not its time either. upgrades/027 could
     * have broken that silently by teaching `create` to copy more; it did not.
     */
    it("a template's due_time is NOT copied onto a spawned occurrence", async () => {
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(
            body(ctx, {
                due_date: "2026-09-05",
                due_time: "17:00",
                recurrence_pattern: "daily",
                recurrence_time: "09:00",
            }),
        );
        expect(created.status).toBe(201);

        // The template keeps both, and they mean different things.
        const [row] = await getDb()
            .select({
                dueTime: tasks.dueTime,
                recurrenceTime: tasks.recurrenceTime,
            })
            .from(tasks)
            .where(eq(tasks.id, created.body.id));
        expect(row).toEqual({
            dueTime: "17:00:00",
            recurrenceTime: "09:00:00",
        });
    });

    it("the two columns are independent — changing one leaves the other", async () => {
        // The shape of "fighting" would be one write clobbering the other.
        const ctx = await seed();
        const created = await ctx.client.post(PATH).send(
            body(ctx, {
                due_date: "2026-09-05",
                due_time: "17:00",
                recurrence_pattern: "daily",
                recurrence_time: "09:00",
            }),
        );
        const id = created.body.id;

        await ctx.client.patch(`${PATH}/${id}`).send({ due_time: "18:30" });
        const [afterDue] = await getDb()
            .select({
                dueTime: tasks.dueTime,
                recurrenceTime: tasks.recurrenceTime,
            })
            .from(tasks)
            .where(eq(tasks.id, id));
        expect(afterDue).toEqual({
            dueTime: "18:30:00",
            recurrenceTime: "09:00:00",
        });

        await ctx.client
            .patch(`${PATH}/${id}`)
            .send({ recurrence_time: "07:15" });
        const [afterRec] = await getDb()
            .select({
                dueTime: tasks.dueTime,
                recurrenceTime: tasks.recurrenceTime,
            })
            .from(tasks)
            .where(eq(tasks.id, id));
        expect(afterRec).toEqual({
            dueTime: "18:30:00",
            recurrenceTime: "07:15:00",
        });
    });
});

describe("P7.3 — the overdue alert names the hour, not just the day", () => {
    /**
     * "Your task passed its due date (2026-09-05)" is actively misleading at
     * 10am on the 5th about a task due at 09:00: the reader takes it to mean
     * the whole day has gone by. The e-mail and the push both carry
     * `deadlineLabel` now.
     */
    it("appends the time when the deadline has one", () => {
        expect(deadlineLabel("2026-09-05", "17:00")).toBe(
            "2026-09-05 5:00 PM",
        );
    });

    it("says the date ALONE when it does not (§B1)", () => {
        // "2026-09-05 12:00 AM" would be a different and wrong claim: a
        // time-less task is due through the END of that day.
        expect(deadlineLabel("2026-09-05", null)).toBe("2026-09-05");
    });

    it("gets midnight and noon right, and tolerates HH:MM:SS", () => {
        expect([
            deadlineLabel("2026-09-05", "00:00"),
            deadlineLabel("2026-09-05", "12:00"),
            deadlineLabel("2026-09-05", "09:05:00"),
            deadlineLabel("2026-09-05", "23:59"),
        ]).toEqual([
            "2026-09-05 12:00 AM",
            "2026-09-05 12:00 PM",
            "2026-09-05 9:05 AM",
            "2026-09-05 11:59 PM",
        ]);
    });

    it("degrades to the date rather than throwing on a bad time", () => {
        // A malformed value must not be the thing that kills the overdue job.
        expect(deadlineLabel("2026-09-05", "not-a-time")).toBe("2026-09-05");
    });
});

describe("P7.2 — the assistant is told the time", () => {
    /**
     * Decided yes. The whole feature is hourly deadlines; a bot that answers
     * "kokhon due?" with a bare date, about a task due that afternoon at 5,
     * sounds certain and is missing the half that matters.
     *
     * Asserted through the real HTTP surface the tool reads from, so a repo
     * that stops selecting the column fails here.
     */
    it("a task read back over the wire carries its due_time", async () => {
        const ctx = await seed();
        const created = await ctx.client
            .post(PATH)
            .send(body(ctx, { due_date: "2026-09-05", due_time: "17:00" }));
        expect(created.status).toBe(201);

        const read = await ctx.client.get(`${PATH}/${created.body.id}`);
        expect({
            due_date: read.body.due_date,
            due_time: read.body.due_time,
        }).toEqual({ due_date: "2026-09-05", due_time: "17:00" });
    });
});
