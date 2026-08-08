import { eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { workspaces } from "../db/schema";
import { weekDays } from "../db/schema/_shared";
import type { DbExecutor } from "./types";

/**
 * Data access for the `workspaces` table. Owns the Drizzle queries; services
 * compose business logic over the rows this repo returns.
 *
 * V1 is single-tenant: there is exactly one workspace row per `workspace_id`,
 * and reads/writes are keyed by the JWT's `workspaceId` claim — never by a
 * client-supplied id.
 */

/** A day-of-week member of the `working_days` SET column. */
export type WeekDay = (typeof weekDays)[number];

/**
 * Shape returned by `findById`. Carries exactly the fields the wire `Workspace`
 * type needs (API_DESIGN.md Appendix A) — deliberately excludes `created_at`
 * and `updated_at`, which the contract does not expose.
 */
export interface WorkspaceRecord {
    id: string;
    name: string;
    logoUrl: string | null;
    timezone: string;
    defaultLocale: string;
    weekStartsOn: number;
    workingDays: string[];
    businessHoursStart: string;
    businessHoursEnd: string;
}

/**
 * Columns updatable through `PATCH /api/v1/workspace` (API_DESIGN.md §3),
 * camelCase to match the Drizzle column props. `default_locale`, `id` and the
 * timestamps are intentionally absent — they are not updatable via that
 * endpoint, so untrusted body fields can never reach the row.
 */
export interface WorkspaceUpdateColumns {
    name?: string;
    logoUrl?: string | null;
    timezone?: string;
    weekStartsOn?: number;
    workingDays?: WeekDay[];
    businessHoursStart?: string;
    businessHoursEnd?: string;
}

/** Projection shared by every read so the wire shape can't drift between them. */
const workspaceColumns = {
    id: workspaces.id,
    name: workspaces.name,
    logoUrl: workspaces.logoUrl,
    timezone: workspaces.timezone,
    defaultLocale: workspaces.defaultLocale,
    weekStartsOn: workspaces.weekStartsOn,
    workingDays: workspaces.workingDays,
    businessHoursStart: workspaces.businessHoursStart,
    businessHoursEnd: workspaces.businessHoursEnd,
};

export class WorkspaceRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Look up the single workspace row by primary key. Returns the tight
     * `WorkspaceRecord` projection (never the raw row, so `created_at` /
     * `updated_at` don't leak into a response shape). `null` when no row
     * matches — the service maps that to a 404.
     *
     * `working_days` is a MySQL SET; the Drizzle `mysqlSet` custom type returns
     * it already split into an array of day-name literals (`["sun","mon",…]`),
     * matching the wire shape directly.
     */
    async findById(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<WorkspaceRecord | null> {
        const [row] = await exec
            .select(workspaceColumns)
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);
        return row ?? null;
    }

    /**
     * Every workspace's id + timezone — the overdue-alert job's outer loop
     * ("today" is per-workspace, F5 rule). V1 is single-tenant so this is one
     * row in practice; test databases hold many.
     */
    async listAll(): Promise<Array<{ id: string; timezone: string }>> {
        return this.db
            .select({ id: workspaces.id, timezone: workspaces.timezone })
            .from(workspaces);
    }

    /**
     * Same projection as `findById`, but takes a `FOR UPDATE` row lock so a
     * service can read-merge-write inside one transaction without a lost-update
     * race (used by the PATCH business-hours merge check). Must run inside a
     * transaction — pass the `tx` executor.
     */
    async findByIdForUpdate(
        workspaceId: string,
        exec: DbExecutor,
    ): Promise<WorkspaceRecord | null> {
        const [row] = await exec
            .select(workspaceColumns)
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1)
            .for("update");
        return row ?? null;
    }

    /**
     * Apply a partial update and return the refreshed projection. Only the
     * whitelisted `WorkspaceUpdateColumns` are written. The caller guarantees
     * `patch` is non-empty and the row exists (the service runs the 404 guard
     * under the same lock first).
     */
    async update(
        workspaceId: string,
        patch: WorkspaceUpdateColumns,
        exec: DbExecutor = this.db,
    ): Promise<WorkspaceRecord> {
        await exec
            .update(workspaces)
            .set(patch)
            .where(eq(workspaces.id, workspaceId));

        const updated = await this.findById(workspaceId, exec);
        if (!updated) {
            // The service proved the row exists under the same lock just above,
            // so a miss here is an unreachable invariant violation, not a 404.
            throw new Error(`Workspace ${workspaceId} disappeared mid-update`);
        }
        return updated;
    }
}
