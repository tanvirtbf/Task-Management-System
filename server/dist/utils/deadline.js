"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deadlineLabel = exports.companyNow = exports.sqlDueTodayNotYetLate = exports.sqlDeadlinePassed = exports.dueTodayNotYetLate = exports.deadlinePassed = exports.workspaceNow = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const dhakaTime_1 = require("./dhakaTime");
/** Resolve a workspace's timezone to the pair the rule compares against. */
const workspaceNow = (timeZone) => ({
    today: (0, dhakaTime_1.todayInZone)(timeZone),
    clock: (0, dhakaTime_1.clockInZone)(timeZone),
});
exports.workspaceNow = workspaceNow;
/** `HH:MM` from either `HH:MM` or a stored `HH:MM:SS`. */
const hhmm = (value) => value.slice(0, 5);
/**
 * Has this task's deadline passed?
 *
 * A task with no due date has no deadline and is never overdue — which is the
 * same answer `due_date IS NULL` gives in SQL.
 */
const deadlinePassed = (dueDate, dueTime, now) => {
    if (!dueDate)
        return false;
    const day = dueDate.slice(0, 10);
    if (day < now.today)
        return true;
    if (day > now.today)
        return false;
    // Due TODAY: only a task that named a time can be late during its own day,
    // and only once that time has arrived. `<=` so a task due at 17:00 is late
    // AT 17:00 rather than a minute after it.
    return dueTime != null && hhmm(dueTime) <= hhmm(now.clock);
};
exports.deadlinePassed = deadlinePassed;
/** Is this task due today AND not yet late? The two are kept disjoint. */
const dueTodayNotYetLate = (dueDate, dueTime, now) => {
    if (!dueDate)
        return false;
    return dueDate.slice(0, 10) === now.today && !(0, exports.deadlinePassed)(dueDate, dueTime, now);
};
exports.dueTodayNotYetLate = dueTodayNotYetLate;
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
const sqlDeadlinePassed = (now) => (0, drizzle_orm_1.sql) `(${schema_1.tasks.dueDate} < ${now.today}
         OR (${schema_1.tasks.dueDate} = ${now.today}
             AND ${schema_1.tasks.dueTime} IS NOT NULL
             AND ${schema_1.tasks.dueTime} <= CAST(${now.clock} AS TIME)))`;
exports.sqlDeadlinePassed = sqlDeadlinePassed;
/** Due on the workspace's today, and its time (if any) has not arrived. */
const sqlDueTodayNotYetLate = (now) => (0, drizzle_orm_1.sql) `(${schema_1.tasks.dueDate} = ${now.today}
         AND (${schema_1.tasks.dueTime} IS NULL
              OR ${schema_1.tasks.dueTime} > CAST(${now.clock} AS TIME)))`;
exports.sqlDueTodayNotYetLate = sqlDueTodayNotYetLate;
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
const companyNow = () => (0, exports.workspaceNow)("Asia/Dhaka");
exports.companyNow = companyNow;
/**
 * How a deadline reads to a person: `"2026-09-05"` or
 * `"2026-09-05 5:00 PM"`.
 *
 * For the overdue e-mail and push (P7.3). Before this they said "passed
 * its due date (2026-09-05)", which at 10am on the 5th, about a task due
 * at 09:00, reads as though the whole day had gone by.
 *
 * No time is appended when there is none — a task due Friday is due
 * through the END of Friday (§B1), and "Friday 12:00 AM" would be a
 * different and wrong claim.
 */
const deadlineLabel = (dueDate, dueTime) => {
    if (!dueTime)
        return dueDate;
    const [h, m] = dueTime.slice(0, 5).split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m))
        return dueDate;
    const hour = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? "AM" : "PM";
    return `${dueDate} ${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};
exports.deadlineLabel = deadlineLabel;
