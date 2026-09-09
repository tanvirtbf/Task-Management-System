import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import {
    deadlinePassed,
    dueTodayNotYetLate,
    sqlDeadlinePassed,
    sqlDueTodayNotYetLate,
    workspaceNow,
    type WorkspaceNow,
} from "../../src/utils/deadline";
import {
    makeList,
    makeStatus,
    makeTask,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { utcDate } from "../test-utils/dates";

/**
 * P2 of DEADLINE_TIME_PLAN_2026-09-08 — the one deadline rule, proved twice.
 *
 * `src/utils/deadline.ts` states the rule in two forms because it has to: the
 * repositories decide "is it overdue" inside a WHERE clause, and the services
 * decide it for one task in memory. Two implementations is how they drift, so
 * this file runs BOTH against the same matrix and fails the moment they
 * disagree — the proof that makes writing it twice acceptable.
 *
 * ── the property that matters most ──────────────────────────────────────────
 * For a task with NO due_time — which is every task that exists today — the new
 * rule must return exactly what `due_date < today` returned. If that ever
 * stopped being true, shipping upgrades/027 would silently re-judge the whole
 * production dataset. The matrix asserts it against the old expression rather
 * than against my opinion of it.
 */

jest.setTimeout(60_000);

const NOW: WorkspaceNow = { today: "2026-03-20", clock: "14:30" };

/** The rule as it was BEFORE upgrades/027 — the thing we must not change. */
const legacyOverdue = (dueDate: string | null): boolean =>
    dueDate !== null && dueDate < NOW.today;

describe("the deadline rule — JS form", () => {
    it("a task with no due date is never late", () => {
        expect(deadlinePassed(null, null, NOW)).toBe(false);
        expect(deadlinePassed(null, "09:00", NOW)).toBe(false);
    });

    it("with NO time, matches the pre-027 rule exactly", () => {
        for (const d of [
            "2026-03-18",
            "2026-03-19",
            "2026-03-20",
            "2026-03-21",
            "2026-04-01",
        ]) {
            expect({ d, now: deadlinePassed(d, null, NOW) }).toEqual({
                d,
                now: legacyOverdue(d),
            });
        }
    });

    it("a time-less task due TODAY is not late at any hour of today", () => {
        // The invariant the whole plan rests on. If a null time were ever read
        // as midnight, the 00:01 case below would flip and every task due today
        // would go overdue across the company at once.
        for (const clock of ["00:01", "09:00", "14:30", "23:58", "23:59"]) {
            expect({
                clock,
                late: deadlinePassed("2026-03-20", null, { today: "2026-03-20", clock }),
            }).toEqual({ clock, late: false });
        }
    });

    it("a TIMED task is late from its minute onward, and not before", () => {
        const at = (clock: string) =>
            deadlinePassed("2026-03-20", "17:00", { today: "2026-03-20", clock });
        expect({
            before: at("16:59"),
            exactly: at("17:00"),
            after: at("17:01"),
        }).toEqual({ before: false, exactly: true, after: true });
    });

    it("a time on a PAST day is late whatever the clock says", () => {
        expect(
            deadlinePassed("2026-03-19", "23:59", { today: "2026-03-20", clock: "00:01" }),
        ).toBe(true);
    });

    it("tolerates a stored HH:MM:SS as well as a wire HH:MM", () => {
        // mysql2 hands a TIME back as `17:00:00`; the wire carries `17:00`. A
        // plain string compare of the two is wrong, so the helper trims both.
        const at = (t: string) =>
            deadlinePassed("2026-03-20", t, { today: "2026-03-20", clock: "17:00" });
        expect({ wire: at("17:00"), stored: at("17:00:00") }).toEqual({
            wire: true,
            stored: true,
        });
    });

    it("dueToday and overdue are DISJOINT", () => {
        // They are disjoint today (`= today` vs `< today`) and must stay so, or
        // the Home tiles double-count a task due at 9am once 9am has passed.
        const cases: [string, string | null][] = [
            ["2026-03-20", null],
            ["2026-03-20", "09:00"],
            ["2026-03-20", "17:00"],
            ["2026-03-19", null],
            ["2026-03-21", "09:00"],
        ];
        for (const [d, t] of cases) {
            const late = deadlinePassed(d, t, NOW);
            const today = dueTodayNotYetLate(d, t, NOW);
            expect({ d, t, both: late && today }).toEqual({ d, t, both: false });
        }
    });
});

describe("the deadline rule — SQL form agrees with the JS form", () => {
    /**
     * The whole point of this suite. Every combination is inserted as a real
     * row, the SQL predicate selects, and the answer is compared to what the JS
     * predicate said about the same values.
     */
    const DATES = ["2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21"];
    const TIMES: (string | null)[] = [null, "00:00", "09:00", "14:30", "17:00", "23:59"];

    it("agrees on every date × time combination", async () => {
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const list = await makeList({ workspaceId: ws.id, createdBy: owner.id });
        const status = await makeStatus({ scopeId: list.id });
        const type = await makeTaskType({ workspaceId: ws.id });

        const made: { id: string; date: string; time: string | null }[] = [];
        for (const date of DATES) {
            for (const time of TIMES) {
                const t = await makeTask({
                    workspaceId: ws.id,
                    listId: list.id,
                    statusId: status.id,
                    taskTypeId: type.id,
                    createdBy: owner.id,
                });
                await getDb()
                    .update(tasks)
                    .set({ dueDate: utcDate(date), dueTime: time })
                    .where(eq(tasks.id, t.id));
                made.push({ id: t.id, date, time });
            }
        }
        expect(made).toHaveLength(DATES.length * TIMES.length);

        const lateIds = new Set(
            (
                await getDb()
                    .select({ id: tasks.id })
                    .from(tasks)
                    .where(and(eq(tasks.workspaceId, ws.id), sqlDeadlinePassed(NOW)))
            ).map((r) => r.id),
        );
        const todayIds = new Set(
            (
                await getDb()
                    .select({ id: tasks.id })
                    .from(tasks)
                    .where(and(eq(tasks.workspaceId, ws.id), sqlDueTodayNotYetLate(NOW)))
            ).map((r) => r.id),
        );

        const disagreements: string[] = [];
        for (const m of made) {
            const jsLate = deadlinePassed(m.date, m.time, NOW);
            const jsToday = dueTodayNotYetLate(m.date, m.time, NOW);
            if (lateIds.has(m.id) !== jsLate) {
                disagreements.push(
                    `overdue ${m.date} ${m.time ?? "(none)"}: sql=${lateIds.has(m.id)} js=${jsLate}`,
                );
            }
            if (todayIds.has(m.id) !== jsToday) {
                disagreements.push(
                    `dueToday ${m.date} ${m.time ?? "(none)"}: sql=${todayIds.has(m.id)} js=${jsToday}`,
                );
            }
        }
        expect({ disagreements }).toEqual({ disagreements: [] });

        // Vacuity guard: a predicate that selected nothing would "agree" with a
        // JS predicate that also returned false for everything.
        expect(lateIds.size).toBeGreaterThan(0);
        expect(todayIds.size).toBeGreaterThan(0);
    });

    it("SQL reproduces the pre-027 answer for every time-less task", async () => {
        // Stated separately from the matrix because it is the migration's
        // safety argument, not a detail of it.
        const ws = await makeWorkspace();
        const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
        const list = await makeList({ workspaceId: ws.id, createdBy: owner.id });
        const status = await makeStatus({ scopeId: list.id });
        const type = await makeTaskType({ workspaceId: ws.id });

        const byDate = new Map<string, string>();
        for (const date of DATES) {
            const t = await makeTask({
                workspaceId: ws.id,
                listId: list.id,
                statusId: status.id,
                taskTypeId: type.id,
                createdBy: owner.id,
            });
            await getDb()
                .update(tasks)
                .set({ dueDate: utcDate(date), dueTime: null })
                .where(eq(tasks.id, t.id));
            byDate.set(date, t.id);
        }

        const lateIds = new Set(
            (
                await getDb()
                    .select({ id: tasks.id })
                    .from(tasks)
                    .where(and(eq(tasks.workspaceId, ws.id), sqlDeadlinePassed(NOW)))
            ).map((r) => r.id),
        );

        for (const date of DATES) {
            expect({ date, sql: lateIds.has(byDate.get(date)!) }).toEqual({
                date,
                sql: legacyOverdue(date),
            });
        }
    });
});

describe("workspaceNow reads the workspace's clock, not the server's", () => {
    it("two zones 25 hours apart disagree about the date", () => {
        // Same discipline as P12's clock tests: Kiritimati (+14) and Midway
        // (−11) never share a calendar day, so this holds every hour.
        const east = workspaceNow("Pacific/Kiritimati");
        const west = workspaceNow("Pacific/Midway");
        expect(east.today).not.toBe(west.today);
        expect(east.today > west.today).toBe(true);
    });

    it("returns a well-formed date and clock", () => {
        const now = workspaceNow("Asia/Dhaka");
        expect(now.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(now.clock).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    });

    it("the SAME task is late in one workspace and not in another", () => {
        // The consequence of the rule being per-workspace. A deadline of
        // "today 12:00" has already passed in the far east and has not in the
        // far west, at the same instant.
        const east = workspaceNow("Pacific/Kiritimati");
        const west = workspaceNow("Pacific/Midway");
        // East's today is strictly later, so a task due on WEST's today with no
        // time is already past for east and still current for west.
        expect(deadlinePassed(west.today, null, east)).toBe(true);
        expect(deadlinePassed(west.today, null, west)).toBe(false);
    });
});
