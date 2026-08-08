import { and, asc, desc, eq, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { onCallShifts, users } from "../db/schema";
import { fakeId } from "../utils";
import { dhakaToday } from "../utils/dhakaTime";
import type { DbExecutor } from "./types";
import type { WireUserSource } from "../serializers/userSerializer";

/**
 * Data access for §21 `on_call_shifts`. Owns the Drizzle queries; the service
 * composes business logic over the rows this repo returns.
 *
 * Every shift the API returns carries its `engineer` as a full `User`, so the
 * read methods INNER JOIN `users` and project the engineer's non-sensitive
 * columns (the `WireUserSource` shape `toWireUser` consumes) — never
 * `password_hash` / `workspace_id` / timestamps for the shift itself. The join
 * is safe because `engineer_id` is a NOT-NULL FK with `ON DELETE RESTRICT`, so
 * the referenced user always exists.
 */

/** One shift row + its hydrated engineer, projected to the §21 wire shape. */
export interface OnCallShiftRecord {
    id: string;
    /** MySQL DATE — mysql2 returns a Date; serializer renders `YYYY-MM-DD`. */
    weekStart: Date | string;
    weekEnd: Date | string;
    engineer: WireUserSource;
}

/**
 * Engineer columns hydrated onto every shift. Matches `WireUserSource` exactly
 * so the serializer can feed it straight to `toWireUser`.
 */
const engineerColumns = {
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
    email: users.email,
    role: users.role,
    avatarUrl: users.avatarUrl,
    status: users.status,
    timezone: users.timezone,
    createdAt: users.createdAt,
    lastLoginAt: users.lastLoginAt,
};

export class OnCallRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

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
    async findCurrent(workspaceId: string): Promise<OnCallShiftRecord | null> {
        const [row] = await this.db
            .select({
                id: onCallShifts.id,
                weekStart: onCallShifts.weekStart,
                weekEnd: onCallShifts.weekEnd,
                engineer: engineerColumns,
            })
            .from(onCallShifts)
            .innerJoin(users, eq(users.id, onCallShifts.engineerId))
            .where(
                and(
                    eq(onCallShifts.workspaceId, workspaceId),
                    sql`${onCallShifts.weekStart} <= ${dhakaToday()}`,
                    sql`${onCallShifts.weekEnd} >= ${dhakaToday()}`,
                ),
            )
            .orderBy(desc(onCallShifts.weekStart))
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
    async listSchedule(
        workspaceId: string,
        from?: string,
        to?: string,
    ): Promise<OnCallShiftRecord[]> {
        return this.db
            .select({
                id: onCallShifts.id,
                weekStart: onCallShifts.weekStart,
                weekEnd: onCallShifts.weekEnd,
                engineer: engineerColumns,
            })
            .from(onCallShifts)
            .innerJoin(users, eq(users.id, onCallShifts.engineerId))
            .where(
                and(
                    eq(onCallShifts.workspaceId, workspaceId),
                    from
                        ? sql`${onCallShifts.weekStart} >= ${from}`
                        : undefined,
                    to ? sql`${onCallShifts.weekStart} <= ${to}` : undefined,
                ),
            )
            .orderBy(asc(onCallShifts.weekStart), asc(onCallShifts.id));
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
    async upsert(
        input: {
            workspaceId: string;
            weekStart: Date;
            weekEnd: Date;
            engineerId: string;
            createdBy: string;
        },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        const id = fakeId("ocs");
        await exec
            .insert(onCallShifts)
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
    async findByWeek(
        workspaceId: string,
        weekStart: string,
        exec: DbExecutor = this.db,
    ): Promise<OnCallShiftRecord | null> {
        const [row] = await exec
            .select({
                id: onCallShifts.id,
                weekStart: onCallShifts.weekStart,
                weekEnd: onCallShifts.weekEnd,
                engineer: engineerColumns,
            })
            .from(onCallShifts)
            .innerJoin(users, eq(users.id, onCallShifts.engineerId))
            .where(
                and(
                    eq(onCallShifts.workspaceId, workspaceId),
                    sql`${onCallShifts.weekStart} = ${weekStart}`,
                ),
            )
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
    async deleteByWeek(
        workspaceId: string,
        weekStart: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [result] = await exec
            .delete(onCallShifts)
            .where(
                and(
                    eq(onCallShifts.workspaceId, workspaceId),
                    sql`${onCallShifts.weekStart} = ${weekStart}`,
                ),
            );
        return result.affectedRows;
    }
}
