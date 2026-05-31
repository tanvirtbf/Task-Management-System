import { and, count, desc, eq, gte, lt, lte, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { workspaceActivity } from "../db/schema";
import { workspaceActivityEntityTypes } from "../db/schema/_shared";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Workspace-level audit feed (`workspace_activity`, §26).
 *
 * Two roles:
 *   - WRITE-side (`record`) used by every mutating 👑 endpoint — tag/space/list
 *     create, role change, sprint start, … — in the same transaction as the
 *     change it describes (per-task changes live in `task_activity`).
 *   - READ side for §26: a "last N" recent slice (`listRecent`) and a filtered,
 *     cursor-paginated full feed (`listFeed` / `countFeed`). Every read is
 *     scoped by `workspace_id` (tenant isolation) and ordered by `internal_id`
 *     DESC (the monotonic keyset; `created_at` is only second-granular).
 */

export type WorkspaceActivityEntityType =
    (typeof workspaceActivityEntityTypes)[number];

export interface NewWorkspaceActivity {
    workspaceId: string;
    /** `null` for system events (cron, webhook). */
    actorId: string | null;
    /** Which kind of entity the event is about. */
    entityType: WorkspaceActivityEntityType;
    entityId: string;
    /** Stable code the UI switches on, e.g. `created`. */
    action: string;
    /** Optional structured payload (name, from/to, …). */
    context?: Record<string, unknown> | null;
}

/**
 * One `workspace_activity` row in the §26 read projection. `internalId` is the
 * monotonic keyset / cursor value; `actorId` is `null` for system events or
 * when the actor's user row was deleted (`fk_workspace_activity_actor` is
 * `ON DELETE SET NULL`). `ip_address` is internal and never read here.
 */
export interface ActivityRow {
    id: string;
    internalId: bigint;
    actorId: string | null;
    entityType: WorkspaceActivityEntityType;
    entityId: string;
    action: string;
    context: Record<string, unknown> | null;
    createdAt: Date;
}

const READ_COLUMNS = {
    id: workspaceActivity.id,
    internalId: workspaceActivity.internalId,
    actorId: workspaceActivity.actorId,
    entityType: workspaceActivity.entityType,
    entityId: workspaceActivity.entityId,
    action: workspaceActivity.action,
    context: workspaceActivity.context,
    createdAt: workspaceActivity.createdAt,
} as const;

/** Optional filters for the §26 full feed (`GET /api/v1/activity`). */
export interface ActivityFilters {
    entityType?: WorkspaceActivityEntityType;
    actorId?: string;
    /** Inclusive lower bound on `created_at`. */
    from?: Date;
    /** Inclusive upper bound on `created_at`. */
    to?: Date;
}

export class WorkspaceActivityRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Append a single workspace-level activity row (write-side fanout). */
    async record(
        row: NewWorkspaceActivity,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(workspaceActivity).values({
            id: fakeId("wsa"),
            workspaceId: row.workspaceId,
            actorId: row.actorId,
            entityType: row.entityType,
            entityId: row.entityId,
            action: row.action,
            context: row.context ?? null,
        });
    }

    /**
     * The most recent `limit` events for a workspace (newest-first), for the
     * §26 #1 home activity card. No filters, no cursor — a small fixed slice.
     */
    async listRecent(
        workspaceId: string,
        limit: number,
    ): Promise<ActivityRow[]> {
        return this.db
            .select(READ_COLUMNS)
            .from(workspaceActivity)
            .where(eq(workspaceActivity.workspaceId, workspaceId))
            .orderBy(desc(workspaceActivity.internalId))
            .limit(limit);
    }

    /**
     * One filtered, newest-first page of a workspace's feed (§26 #2), ordered by
     * `internal_id` DESC. The caller passes `limit + 1` and uses the extra row to
     * derive `has_more`.
     */
    async listFeed(
        params: ActivityFilters & {
            workspaceId: string;
            afterInternalId?: string;
            limit: number;
        },
    ): Promise<ActivityRow[]> {
        return this.db
            .select(READ_COLUMNS)
            .from(workspaceActivity)
            .where(this.feedWhere(params))
            .orderBy(desc(workspaceActivity.internalId))
            .limit(params.limit);
    }

    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countFeed(
        params: ActivityFilters & { workspaceId: string },
    ): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(workspaceActivity)
            .where(this.feedWhere(params));
        return row?.value ?? 0;
    }

    /**
     * Shared WHERE for the feed page + count. `workspace_id` is always present
     * (tenant isolation); the optional filters and the keyset cursor are appended
     * only when supplied (Drizzle's `and()` drops `undefined` entries).
     */
    private feedWhere(
        params: ActivityFilters & {
            workspaceId: string;
            afterInternalId?: string;
        },
    ): SQL | undefined {
        return and(
            eq(workspaceActivity.workspaceId, params.workspaceId),
            params.entityType
                ? eq(workspaceActivity.entityType, params.entityType)
                : undefined,
            params.actorId
                ? eq(workspaceActivity.actorId, params.actorId)
                : undefined,
            params.from
                ? gte(workspaceActivity.createdAt, params.from)
                : undefined,
            params.to ? lte(workspaceActivity.createdAt, params.to) : undefined,
            params.afterInternalId
                ? lt(
                      workspaceActivity.internalId,
                      BigInt(params.afterInternalId),
                  )
                : undefined,
        );
    }
}
