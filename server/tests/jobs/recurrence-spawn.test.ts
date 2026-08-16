import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks, taskAssignees } from "../../src/db/schema";
import { runJob } from "../../src/jobs";
import {
    occurrenceName,
    occurrenceSuffix,
} from "../../src/jobs/recurrenceSpawn";
import {
    makeList,
    makeStatus,
    makeTask,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { clockInZone, todayInZone } from "../../src/utils/dhakaTime";
import { TaskWriteService } from "../../src/services/TaskWriteService";

/**
 * §28 recurrence-spawn (upgrades/024) — the job that finally makes a repeating
 * task repeat.
 *
 * Recurrence was stored and never read for the whole life of the product: the
 * picker saved a pattern and no task was ever created from it. These tests pin
 * the behaviour the office asked for, and in particular the three things that
 * would quietly ruin it:
 *   1. it must fire ONCE a day, not once per 15-minute tick;
 *   2. the new task must be CLEAN — an assignee or a due date carried over
 *      from yesterday is worse than no task at all;
 *   3. the copy must not itself recur, or one template becomes an avalanche.
 */

jest.setTimeout(60_000);

const db = () => getDb();

const TZ = "Asia/Dhaka";
const today = () => todayInZone(TZ);

/** A workspace whose clock is Dhaka, with one list ready for tasks. */
const seed = async () => {
    const ws = await makeWorkspace({ timezone: TZ });
    const user = await makeUser({ workspaceId: ws.id, role: "member" });
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    return { ws, user, list, status, taskType };
};

/** A recurring TEMPLATE — pattern + a time already past on the wall clock. */
const template = async (
    s: Awaited<ReturnType<typeof seed>>,
    name: string,
    fields: Record<string, unknown> = {},
) => {
    const t = await makeTask({
        workspaceId: s.ws.id,
        listId: s.list.id,
        statusId: s.status.id,
        taskTypeId: s.taskType.id,
        createdBy: s.user.id,
        name,
    });
    await db()
        .update(tasks)
        .set({
            recurrencePattern: "daily",
            // 00:00 has always passed, whatever time the suite runs.
            recurrenceTime: "00:00:00",
            ...fields,
        })
        .where(eq(tasks.id, t.id));
    return t;
};

const spawnedFrom = async (templateId: string) =>
    db().select().from(tasks).where(eq(tasks.recurringSourceId, templateId));

const run = () => runJob("recurrence-spawn", { dryRun: false });

describe("recurrence-spawn", () => {
    it("creates today's occurrence, named for the day", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");

        const out = await run();
        expect(out.ok).toBe(true);

        const [copy] = await spawnedFrom(tpl.id);
        expect(copy).toBeDefined();
        expect(copy.name).toBe(`Daily stock check — ${occurrenceSuffix(today())}`);
        expect(copy.primaryListId).toBe(s.list.id);
        expect(copy.taskTypeId).toBe(s.taskType.id);
        // Attribution is the person who set the recurrence up — not a robot
        // account that does not exist.
        expect(copy.createdBy).toBe(s.user.id);
    });

    it("the occurrence is CLEAN — nothing carried over from the template", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");
        // Load the template up with exactly the state that must NOT travel.
        await db()
            .update(tasks)
            .set({
                dueDate: new Date(Date.UTC(2026, 0, 2)),
                startDate: new Date(Date.UTC(2026, 0, 1)),
                priority: 1,
                description: "yesterday's notes",
            })
            .where(eq(tasks.id, tpl.id));
        await db().insert(taskAssignees).values({
            taskId: tpl.id,
            userId: s.user.id,
            assignedBy: s.user.id,
        });

        await run();

        const [copy] = await spawnedFrom(tpl.id);
        expect(copy.dueDate).toBeNull();
        expect(copy.startDate).toBeNull();
        expect(copy.priority).toBe(0);
        expect(copy.description).toBeNull();
        const assignees = await db()
            .select()
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, copy.id));
        expect(assignees).toHaveLength(0);
    });

    it("the occurrence does NOT recur — one template can never avalanche", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");

        await run();

        const [copy] = await spawnedFrom(tpl.id);
        expect(copy.recurrencePattern).toBe("none");
        expect(copy.recurrenceTime).toBeNull();
    });

    it("fires ONCE a day however often the job runs", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");

        await run();
        await run();
        await run();

        expect(await spawnedFrom(tpl.id)).toHaveLength(1);
        const [row] = await db()
            .select()
            .from(tasks)
            .where(eq(tasks.id, tpl.id));
        expect(row.recurrenceLastSpawnedOn).toBe(today());
    });

    it("waits for the picked time — nothing before it", async () => {
        const s = await seed();
        // A time later than "now" on the workspace clock. If the suite happens
        // to run at 23:5x, 23:59 is still >= now, so this stays deterministic.
        const [h, m] = clockInZone(TZ).split(":").map(Number);
        const later =
            h === 23 && m >= 58
                ? "23:59:59"
                : `${String(h).padStart(2, "0")}:${String(Math.min(m + 2, 59)).padStart(2, "0")}:00`;
        const tpl = await template(s, "Evening close-out", {
            recurrenceTime: later,
        });

        await run();

        expect(await spawnedFrom(tpl.id)).toHaveLength(0);
    });

    it("weekly fires only on the listed days", async () => {
        const s = await seed();
        const dow = new Date(`${today()}T00:00:00Z`).getUTCDay();
        const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        const notToday = KEYS[(dow + 3) % 7];

        const wrongDay = await template(s, "Weekly wrong day", {
            recurrencePattern: "weekly",
            recurrenceDays: [notToday],
        });
        const rightDay = await template(s, "Weekly right day", {
            recurrencePattern: "weekly",
            recurrenceDays: [KEYS[dow]],
        });

        await run();

        expect(await spawnedFrom(wrongDay.id)).toHaveLength(0);
        expect(await spawnedFrom(rightDay.id)).toHaveLength(1);
    });

    it("stops after the end date, and skips archived templates", async () => {
        const s = await seed();
        const ended = await template(s, "Finished campaign check", {
            recurrenceEndsAt: new Date(Date.UTC(2020, 0, 1)),
        });
        const archived = await template(s, "Retired routine", {
            archivedAt: new Date(),
        });

        await run();

        expect(await spawnedFrom(ended.id)).toHaveLength(0);
        expect(await spawnedFrom(archived.id)).toHaveLength(0);
    });

    it("a COMPLETED template keeps its schedule — archiving is the off switch", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check", {
            completedAt: new Date(),
        });

        await run();

        expect(await spawnedFrom(tpl.id)).toHaveLength(1);
    });

    it("a dry run reports what it would do and writes nothing", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");

        const out = await runJob("recurrence-spawn", { dryRun: true });

        expect(out.ok).toBe(true);
        expect(out.processed).toBeGreaterThanOrEqual(1);
        expect(out.spawned).toBe(0);
        expect(await spawnedFrom(tpl.id)).toHaveLength(0);
    });

    it("a failed create hands the day BACK — the office is not skipped", async () => {
        const s = await seed();
        const tpl = await template(s, "Daily stock check");

        // The claim is committed on its own connection (TaskWriteService opens
        // its own transaction, so the two cannot share one). Without an
        // explicit release, one bad create would burn today's occurrence and
        // the task would simply never appear — silently, once, unrepeatably.
        const boom = jest
            .spyOn(TaskWriteService.prototype, "create")
            .mockRejectedValueOnce(new Error("list vanished mid-tick"));

        const bad = await run();
        expect(bad.ok).toBe(true); // the job survives one bad template
        expect(bad.failed).toBe(1);
        expect(bad.spawned).toBe(0);
        expect(await spawnedFrom(tpl.id)).toHaveLength(0);

        const [afterFailure] = await db()
            .select()
            .from(tasks)
            .where(eq(tasks.id, tpl.id));
        expect(afterFailure.recurrenceLastSpawnedOn).toBeNull();

        boom.mockRestore();

        // …and the very next tick makes good on it.
        const good = await run();
        expect(good.spawned).toBeGreaterThanOrEqual(1);
        expect(await spawnedFrom(tpl.id)).toHaveLength(1);
    });

    it("leaves non-recurring tasks alone", async () => {
        const s = await seed();
        const plain = await makeTask({
            workspaceId: s.ws.id,
            listId: s.list.id,
            statusId: s.status.id,
            taskTypeId: s.taskType.id,
            createdBy: s.user.id,
            name: "An ordinary task",
        });

        await run();

        const rows = await db()
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, s.ws.id),
                    eq(tasks.name, "An ordinary task"),
                ),
            );
        expect(rows).toHaveLength(1);
        expect(rows[0].recurrenceLastSpawnedOn).toBeNull();
        expect(await spawnedFrom(plain.id)).toHaveLength(0);
    });
});

describe("occurrenceName", () => {
    it("reads the way the office writes a date", () => {
        expect(occurrenceName("Stock check", "2026-08-17")).toBe(
            "Stock check — 17 Aug 2026",
        );
    });

    it("keeps the date when the template name is enormous", () => {
        const long = "x".repeat(600);
        const out = occurrenceName(long, "2026-08-17");
        expect(out.length).toBeLessThanOrEqual(500);
        expect(out.endsWith("17 Aug 2026")).toBe(true);
    });
});
