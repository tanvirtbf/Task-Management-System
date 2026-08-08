"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnCallRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const dhakaTime_1 = require("../utils/dhakaTime");
/**
 * Engineer columns hydrated onto every shift. Matches `WireUserSource` exactly
 * so the serializer can feed it straight to `toWireUser`.
 */
const engineerColumns = {
    id: schema_1.users.id,
    firstName: schema_1.users.firstName,
    lastName: schema_1.users.lastName,
    email: schema_1.users.email,
    role: schema_1.users.role,
    avatarUrl: schema_1.users.avatarUrl,
    status: schema_1.users.status,
    timezone: schema_1.users.timezone,
    createdAt: schema_1.users.createdAt,
    lastLoginAt: schema_1.users.lastLoginAt,
};
class OnCallRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * The shift covering today in a workspace — `week_start <= CURDATE() <=
     * week_end` — or `null`. If several weeks straddle today (a transition
     * week), the one with the most recent `week_start` wins (spec §21 note).
     * Workspace-scoped: `v_current_on_call` does NOT filter by workspace, so the
     * scoping is done here, against the base table, which also gives us the
     * engineer join in one round-trip.
     *
     * "Today" is `dhakaToday()`, bound as a parameter — NOT SQL `CURDATE()`.
     * `CURDATE()` renders in the MySQL *session* zone, which F3 pinned to UTC so
     * that TIMESTAMP columns round-trip. But `week_start`/`week_end` are DATE
     * columns holding Dhaka business days, so a UTC `CURDATE()` would roll the
     * roster over 6h late — every Monday 00:00–06:00 Dhaka would still report
     * last week's engineer. Deriving the day app-side keeps the rollover at
     * Dhaka midnight regardless of the session zone or the box's TZ.
     */
    async findCurrent(workspaceId) {
        const [row] = await this.db
            .select({
            id: schema_1.onCallShifts.id,
            weekStart: schema_1.onCallShifts.weekStart,
            weekEnd: schema_1.onCallShifts.weekEnd,
            engineer: engineerColumns,
        })
            .from(schema_1.onCallShifts)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.onCallShifts.engineerId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.onCallShifts.workspaceId, workspaceId), (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekStart} <= ${(0, dhakaTime_1.dhakaToday)()}`, (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekEnd} >= ${(0, dhakaTime_1.dhakaToday)()}`))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.onCallShifts.weekStart))
            .limit(1);
        return row ?? null;
    }
    /**
     * Every shift in a workspace, ordered chronologically by `week_start` (with
     * a stable `id` tie-break). Optional inclusive `from` / `to` bounds filter on
     * `week_start` (passed as `YYYY-MM-DD`; compared via raw `sql` so MySQL casts
     * the DATE column directly — no JS date math). Filtering is on `week_start`,
     * NOT interval overlap: a week whose `week_start` precedes `from` but whose
     * `week_end` straddles it is excluded (the §21 "upcoming shifts" reading).
     * The `(workspace_id, week_start)` unique index backs both the scope filter
     * and the sort. The engineer is hydrated via the same INNER JOIN as
     * `findCurrent`.
     */
    async listSchedule(workspaceId, from, to) {
        return this.db
            .select({
            id: schema_1.onCallShifts.id,
            weekStart: schema_1.onCallShifts.weekStart,
            weekEnd: schema_1.onCallShifts.weekEnd,
            engineer: engineerColumns,
        })
            .from(schema_1.onCallShifts)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.onCallShifts.engineerId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.onCallShifts.workspaceId, workspaceId), from
            ? (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekStart} >= ${from}`
            : undefined, to ? (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekStart} <= ${to}` : undefined))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.onCallShifts.weekStart), (0, drizzle_orm_1.asc)(schema_1.onCallShifts.id));
    }
    /**
     * Insert the shift for a week, or overwrite the existing one's engineer when
     * `(workspace_id, week_start)` already exists (`uq_on_call_shifts_week`) —
     * the §21 idempotent PUT. On the INSERT path `id` / `created_by` /
     * `created_at` are set; on the UPDATE path only `engineer_id` + `week_end`
     * change (`updated_at` auto-bumps via `ON UPDATE CURRENT_TIMESTAMP`), so the
     * original creator + creation time are preserved. `week_start` / `week_end`
     * are LOCAL-midnight Dates (Drizzle `date()` mode). Pass `exec` to enlist in
     * the caller's transaction so the paired re-read sees this write atomically.
     */
    async upsert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("ocs");
        await exec
            .insert(schema_1.onCallShifts)
            .values({
            id,
            workspaceId: input.workspaceId,
            weekStart: input.weekStart,
            weekEnd: input.weekEnd,
            engineerId: input.engineerId,
            createdBy: input.createdBy,
        })
            .onDuplicateKeyUpdate({
            set: {
                engineerId: input.engineerId,
                weekEnd: input.weekEnd,
            },
        });
    }
    /**
     * The shift for a specific `(workspace_id, week_start)`, engineer hydrated,
     * or `null`. `weekStart` is the validated `YYYY-MM-DD` string, compared via
     * raw `sql` (MySQL casts the DATE column). Pass `exec` to read inside the
     * upsert transaction so the just-written row is visible.
     */
    async findByWeek(workspaceId, weekStart, exec = this.db) {
        const [row] = await exec
            .select({
            id: schema_1.onCallShifts.id,
            weekStart: schema_1.onCallShifts.weekStart,
            weekEnd: schema_1.onCallShifts.weekEnd,
            engineer: engineerColumns,
        })
            .from(schema_1.onCallShifts)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.onCallShifts.engineerId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.onCallShifts.workspaceId, workspaceId), (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekStart} = ${weekStart}`))
            .limit(1);
        return row ?? null;
    }
    /**
     * Hard-delete the shift for a week, scoped to the caller's workspace; returns
     * the affected-row count (0 ⇒ no such shift, which the service maps to 404).
     * `weekStart` is the validated `YYYY-MM-DD` string, compared via raw `sql`
     * (MySQL casts the DATE column). The workspace-scoped `WHERE` is the
     * tenant-isolation control — a cross-tenant week deletes nothing.
     */
    async deleteByWeek(workspaceId, weekStart, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.onCallShifts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.onCallShifts.workspaceId, workspaceId), (0, drizzle_orm_1.sql) `${schema_1.onCallShifts.weekStart} = ${weekStart}`));
        return result.affectedRows;
    }
}
exports.OnCallRepo = OnCallRepo;
