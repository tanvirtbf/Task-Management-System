import { sql, type SQL } from "drizzle-orm";
import { tasks } from "../db/schema";
import { clockInZone, todayInZone } from "./dhakaTime";

/**
 * THE deadline rule. There is exactly one, and it lives here.
 *
 * `tasks.due_date` is a calendar day and `tasks.due_time` (upgrades/027) is an
 * optional wall-clock time on it. Neither carries a timezone — together they
 * only become a moment once read against a workspace's clock, which is what
 * this module does and what nothing else may do for itself.
 *
 * ── ⛔ the rule (DEADLINE_TIME_PLAN §B1) ────────────────────────────────────
 *
 *   due_time IS NULL  →  the task is due through the END of that day, and
 *                        becomes overdue at the first instant of the next one.
 *   due_time set      →  the task becomes overdue when that time arrives.
 *
 * The null case is not a default anyone picked — it is what "due Friday" has
 * always meant here, and it is why the whole existing dataset keeps behaving
 * exactly as it did. Reading a missing time as midnight would turn every task
 * due today overdue the moment upgrades/027 shipped.
 *
 * ── why a JS predicate AND SQL fragments ────────────────────────────────────
 * The overdue judgement is made in two places and cannot be made in one: the
 * repositories decide it inside a `WHERE` clause over thousands of rows, and
 * the services and jobs decide it for a single task already in memory. So the
 * rule is written twice, deliberately, in the same file — and
 * `tests/tasks/deadline-resolver.test.ts` runs both against the same matrix and
 * fails if they ever disagree. Two implementations in one file with a proof
 * they match is honest; two implementations in two files is the bug this
 * module exists to prevent.
 *
 * ── why not compute an instant ──────────────────────────────────────────────
 * A `Date` would be the obvious shape, and it is the wrong one. MySQL cannot
 * compare a JS Date against `due_date`+`due_time` without building one per row,
 * which throws away the index on `due_date`. Comparing calendar-day to
 * calendar-day and clock to clock keeps `due_date` sargable and needs no
 * timezone arithmetic in the database at all — the zone is resolved once, in
 * Node, into the two plain strings below.
 */

/** The workspace's "now", as the two plain strings every comparison uses. */
export interface WorkspaceNow {
    /** `YYYY-MM-DD` on the workspace's calendar. */
    today: string;
    /** `HH:MM` (24h) on the workspace's clock. */
    clock: string;
}

/** Resolve a workspace's timezone to the pair the rule compares against. */
export const workspaceNow = (timeZone: string): WorkspaceNow => ({
    today: todayInZone(timeZone),
    clock: clockInZone(timeZone),
});

/** `HH:MM` from either `HH:MM` or a stored `HH:MM:SS`. */
const hhmm = (value: string): string => value.slice(0, 5);

/**
 * Has this task's deadline passed?
 *
 * A task with no due date has no deadline and is never overdue — which is the
 * same answer `due_date IS NULL` gives in SQL.
 */
export const deadlinePassed = (
    dueDate: string | null | undefined,
    dueTime: string | null | undefined,
    now: WorkspaceNow,
): boolean => {
    if (!dueDate) return false;
    const day = dueDate.slice(0, 10);
    if (day < now.today) return true;
    if (day > now.today) return false;
    // Due TODAY: only a task that named a time can be late during its own day,
    // and only once that time has arrived. `<=` so a task due at 17:00 is late
    // AT 17:00 rather than a minute after it.
    return dueTime != null && hhmm(dueTime) <= hhmm(now.clock);
};

/** Is this task due today AND not yet late? The two are kept disjoint. */
export const dueTodayNotYetLate = (
    dueDate: string | null | undefined,
    dueTime: string | null | undefined,
    now: WorkspaceNow,
): boolean => {
    if (!dueDate) return false;
    return dueDate.slice(0, 10) === now.today && !deadlinePassed(dueDate, dueTime, now);
};

// ─── the same rule, for a WHERE clause ──────────────────────────────────────
// Written as `due_date` comparisons first so the column stays usable by
// `idx_tasks_list_active` / `idx_tasks_overdue_scan`; the time only decides the
// single-day boundary case.
//
// The `CAST(? AS TIME)` is deliberate but NOT load-bearing, and the difference
// is worth stating so nobody "simplifies" it on a wrong premise. Removing it
// was tried: the tests stayed green, because `due_time` is a TIME COLUMN and
// MySQL therefore coerces the string operand to TIME rather than degrading the
// column to text. The cast survives as an explicit statement of intent — the
// comparison is between two times, not two strings — and to keep that true if
// the left side ever stops being a bare column (a `COALESCE(due_time, '…')`
// would make it a string compare, where `'17:00:00' <= '17:00'` is FALSE
// because the longer string wins on the shared prefix).

/** `due_date`/`due_time` is at or past the workspace's now. */
export const sqlDeadlinePassed = (now: WorkspaceNow): SQL =>
    sql`(${tasks.dueDate} < ${now.today}
         OR (${tasks.dueDate} = ${now.today}
             AND ${tasks.dueTime} IS NOT NULL
             AND ${tasks.dueTime} <= CAST(${now.clock} AS TIME)))`;

/** Due on the workspace's today, and its time (if any) has not arrived. */
export const sqlDueTodayNotYetLate = (now: WorkspaceNow): SQL =>
    sql`(${tasks.dueDate} = ${now.today}
         AND (${tasks.dueTime} IS NULL
              OR ${tasks.dueTime} > CAST(${now.clock} AS TIME)))`;

/**
 * The COMPANY's now — Asia/Dhaka, deliberately, and not any workspace's.
 *
 * P12 classified the nine hardcoded `dhakaToday()` call sites and found the
 * split IS the answer: the on-call roster and the Monday 09:00 HR report are
 * company events and must not move when a workspace re-zones itself, while the
 * review queues and the assistant's date line belong to a workspace. Reviews
 * therefore resolve `workspaces.timezone`; the weekly report resolves this.
 *
 * Named rather than inlined as `workspaceNow("Asia/Dhaka")` so the decision
 * stays legible at the call site — an unexplained literal zone is exactly what
 * a later "consistency" refactor deletes.
 */
export const companyNow = (): WorkspaceNow => workspaceNow("Asia/Dhaka");
