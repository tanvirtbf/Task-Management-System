import { and, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    lists,
    spaces,
    taskAssignmentRequestEvents,
    taskAssignmentRequests,
    tasks,
    userRoleGrants,
    type NewTaskAssignmentRequest,
    type NewTaskAssignmentRequestEvent,
    type TaskAssignmentRequest,
    type TaskAssignmentRequestEvent,
} from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for cross-team assignment approval (team-access P8, §43/§44).
 *
 * Two deliberate departures from the ordinary repo rules, both consent-driven:
 *
 *   - `taskSnapshotByIds` reads tasks WITHOUT the caller's visibility filter.
 *     The receiver of a request is, by definition, someone the task's team
 *     boundary excludes — they must still see WHAT they are being asked to
 *     take on (title, team, list, due date) to give informed consent. The
 *     snapshot is the narrow, deliberate exception; task listing/search stay
 *     scope-filtered everywhere else.
 *   - State flips are ATOMIC CLAIMS (`UPDATE … WHERE status='pending'`), the
 *     overdue-alert pattern — a double-click or two open tabs can never
 *     double-accept, and the janitor can never expire a just-accepted row.
 */

export type AssignmentRequestRow = TaskAssignmentRequest;
export type AssignmentRequestEventRow = TaskAssignmentRequestEvent;

/** What the receiver is shown about the task they are asked to join. */
export interface RequestTaskSnapshot {
    id: string;
    name: string;
    customId: string | null;
    listId: string;
    listName: string;
    spaceId: string;
    spaceName: string;
    dueDate: Date | null;
    priority: number;
    archivedAt: Date | null;
}

/** An expired-pending row joined with its task name (janitor fanout). */
export interface ExpiredPendingRow {
    id: string;
    workspaceId: string;
    taskId: string;
    taskName: string | null;
    targetUserId: string;
    requestedBy: string;
}

const REQUEST_COLUMNS = {
    id: taskAssignmentRequests.id,
    internalId: taskAssignmentRequests.internalId,
    workspaceId: taskAssignmentRequests.workspaceId,
    spaceId: taskAssignmentRequests.spaceId,
    taskId: taskAssignmentRequests.taskId,
    targetUserId: taskAssignmentRequests.targetUserId,
    requestedBy: taskAssignmentRequests.requestedBy,
    status: taskAssignmentRequests.status,
    requestNote: taskAssignmentRequests.requestNote,
    queryNote: taskAssignmentRequests.queryNote,
    proposedDueDate: taskAssignmentRequests.proposedDueDate,
    decidedBy: taskAssignmentRequests.decidedBy,
    decidedAt: taskAssignmentRequests.decidedAt,
    expiresAt: taskAssignmentRequests.expiresAt,
    createdAt: taskAssignmentRequests.createdAt,
    updatedAt: taskAssignmentRequests.updatedAt,
} as const;

export class AssignmentRequestsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * The already-pending (task, target) pairs among the candidates — the
     * duplicate filter `createRequestsInTx` applies BEFORE inserting. Run
     * inside the caller's transaction, under the task row lock every
     * assignment path holds, so the read-then-insert cannot race (the
     * `uq_tar_one_pending` key stays as the loud backstop). A driver-flag
     * `affectedRows` probe on `ON DUPLICATE KEY UPDATE` was the first cut —
     * mysql2's CLIENT_FOUND_ROWS makes that count ambiguous, so the no-op
     * dup looked "created" and the events insert hit a broken FK.
     */
    async pendingPairs(
        pairs: { taskId: string; targetUserId: string }[],
        exec: DbExecutor = this.db,
    ): Promise<Set<string>> {
        if (pairs.length === 0) return new Set();
        const rows = await exec
            .select({
                taskId: taskAssignmentRequests.taskId,
                targetUserId: taskAssignmentRequests.targetUserId,
            })
            .from(taskAssignmentRequests)
            .where(
                and(
                    eq(taskAssignmentRequests.status, "pending"),
                    inArray(
                        taskAssignmentRequests.taskId,
                        [...new Set(pairs.map((p) => p.taskId))],
                    ),
                    inArray(
                        taskAssignmentRequests.targetUserId,
                        [...new Set(pairs.map((p) => p.targetUserId))],
                    ),
                ),
            );
        return new Set(rows.map((r) => `${r.taskId}|${r.targetUserId}`));
    }

    async insertRequests(
        rows: NewTaskAssignmentRequest[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(taskAssignmentRequests).values(rows);
    }

    async insertEvents(
        rows: NewTaskAssignmentRequestEvent[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(taskAssignmentRequestEvents).values(rows);
    }

    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRequestRow | null> {
        const [row] = await exec
            .select(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .where(
                and(
                    eq(taskAssignmentRequests.id, id),
                    eq(taskAssignmentRequests.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Tx re-read by primary key alone — the claim post-mortem ("did the miss
     * mean decided, or expired?"). Only called on an id that already passed
     * the workspace-pinned lookup above.
     */
    async findById(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<AssignmentRequestRow | null> {
        const [row] = await exec
            .select(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .where(eq(taskAssignmentRequests.id, id))
            .limit(1);
        return row ?? null;
    }

    /** Requests addressed TO this person ("received"). */
    async listByTarget(
        userId: string,
        workspaceId: string,
        onlyPending: boolean,
        limit: number,
    ): Promise<AssignmentRequestRow[]> {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .where(
                and(
                    eq(taskAssignmentRequests.workspaceId, workspaceId),
                    eq(taskAssignmentRequests.targetUserId, userId),
                    onlyPending
                        ? eq(taskAssignmentRequests.status, "pending")
                        : undefined,
                ),
            )
            .orderBy(desc(taskAssignmentRequests.internalId))
            .limit(limit);
    }

    /** Requests this person sent ("sent"). */
    async listByRequester(
        userId: string,
        workspaceId: string,
        onlyPending: boolean,
        limit: number,
    ): Promise<AssignmentRequestRow[]> {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .where(
                and(
                    eq(taskAssignmentRequests.workspaceId, workspaceId),
                    eq(taskAssignmentRequests.requestedBy, userId),
                    onlyPending
                        ? eq(taskAssignmentRequests.status, "pending")
                        : undefined,
                ),
            )
            .orderBy(desc(taskAssignmentRequests.internalId))
            .limit(limit);
    }

    /**
     * Requests whose TARGET belongs to a team this person heads ("team") —
     * the Q2 half where a Head accepts/declines on the member's behalf.
     * DISTINCT because a target can belong to two spaces the same head runs.
     */
    async listByHeadOf(
        headUserId: string,
        workspaceId: string,
        onlyPending: boolean,
        limit: number,
    ): Promise<AssignmentRequestRow[]> {
        return this.db
            .selectDistinct(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .innerJoin(
                userRoleGrants,
                and(
                    eq(
                        userRoleGrants.userId,
                        taskAssignmentRequests.targetUserId,
                    ),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                ),
            )
            .innerJoin(
                spaces,
                and(
                    eq(spaces.id, userRoleGrants.scopeId),
                    eq(spaces.headUserId, headUserId),
                ),
            )
            .where(
                and(
                    eq(taskAssignmentRequests.workspaceId, workspaceId),
                    onlyPending
                        ? eq(taskAssignmentRequests.status, "pending")
                        : undefined,
                ),
            )
            .orderBy(desc(taskAssignmentRequests.internalId))
            .limit(limit);
    }

    /** The whole negotiation history of one task (drawer panel). */
    async listByTask(
        taskId: string,
        limit: number,
    ): Promise<AssignmentRequestRow[]> {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(taskAssignmentRequests)
            .where(eq(taskAssignmentRequests.taskId, taskId))
            .orderBy(desc(taskAssignmentRequests.internalId))
            .limit(limit);
    }

    /** Events for a set of requests, oldest-first per request. */
    async eventsByRequests(
        requestIds: string[],
    ): Promise<Map<string, AssignmentRequestEventRow[]>> {
        const out = new Map<string, AssignmentRequestEventRow[]>();
        if (requestIds.length === 0) return out;
        const rows = await this.db
            .select()
            .from(taskAssignmentRequestEvents)
            .where(inArray(taskAssignmentRequestEvents.requestId, requestIds))
            .orderBy(taskAssignmentRequestEvents.internalId);
        for (const row of rows) {
            const list = out.get(row.requestId) ?? [];
            list.push(row);
            out.set(row.requestId, list);
        }
        return out;
    }

    /**
     * The atomic claim: flip a LIVE pending row to its final status. Returns
     * false when someone else decided first, the janitor expired it, or —
     * with `requireUnexpired` — the 7-day window has lapsed unclaimed (the
     * janitor formalises those; nobody may act on a dead request meanwhile).
     */
    async claimDecision(
        id: string,
        input: {
            to: "accepted" | "declined" | "cancelled" | "expired";
            decidedBy: string | null;
            now: Date;
            requireUnexpired: boolean;
        },
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .update(taskAssignmentRequests)
            .set({
                status: input.to,
                decidedBy: input.decidedBy,
                decidedAt: input.now,
                updatedAt: input.now,
            })
            .where(
                and(
                    eq(taskAssignmentRequests.id, id),
                    eq(taskAssignmentRequests.status, "pending"),
                    input.requireUnexpired
                        ? gt(taskAssignmentRequests.expiresAt, input.now)
                        : undefined,
                ),
            );
        return result.affectedRows === 1;
    }

    /**
     * Record the receiver side's latest query on a LIVE pending row (status
     * does not change — the negotiation stays open). Same conditional-UPDATE
     * guard as the claims.
     */
    async recordQuery(
        id: string,
        input: {
            queryNote: string;
            proposedDueDate: string | null;
            now: Date;
        },
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .update(taskAssignmentRequests)
            .set({
                queryNote: input.queryNote,
                proposedDueDate: input.proposedDueDate,
                updatedAt: input.now,
            })
            .where(
                and(
                    eq(taskAssignmentRequests.id, id),
                    eq(taskAssignmentRequests.status, "pending"),
                    gt(taskAssignmentRequests.expiresAt, input.now),
                ),
            );
        return result.affectedRows === 1;
    }

    /** Bump a LIVE pending row's `updated_at` (the requester answered). */
    async touchPending(
        id: string,
        now: Date,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .update(taskAssignmentRequests)
            .set({ updatedAt: now })
            .where(
                and(
                    eq(taskAssignmentRequests.id, id),
                    eq(taskAssignmentRequests.status, "pending"),
                    gt(taskAssignmentRequests.expiresAt, now),
                ),
            );
        return result.affectedRows === 1;
    }

    /** Pending rows whose window has lapsed — the janitor's scan. */
    async findExpiredPending(
        now: Date,
        limit: number,
    ): Promise<ExpiredPendingRow[]> {
        return this.db
            .select({
                id: taskAssignmentRequests.id,
                workspaceId: taskAssignmentRequests.workspaceId,
                taskId: taskAssignmentRequests.taskId,
                taskName: tasks.name,
                targetUserId: taskAssignmentRequests.targetUserId,
                requestedBy: taskAssignmentRequests.requestedBy,
            })
            .from(taskAssignmentRequests)
            .leftJoin(tasks, eq(tasks.id, taskAssignmentRequests.taskId))
            .where(
                and(
                    eq(taskAssignmentRequests.status, "pending"),
                    lte(taskAssignmentRequests.expiresAt, now),
                ),
            )
            .orderBy(taskAssignmentRequests.internalId)
            .limit(limit);
    }

    /**
     * Task context for the request wire shape — DELIBERATELY unfiltered by the
     * caller's visibility (see the class header): the receiver must see what
     * they are consenting to. Workspace-pinned; nothing else escapes.
     */
    async taskSnapshotByIds(
        taskIds: string[],
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<Map<string, RequestTaskSnapshot>> {
        const out = new Map<string, RequestTaskSnapshot>();
        if (taskIds.length === 0) return out;
        const rows = await exec
            .select({
                id: tasks.id,
                name: tasks.name,
                customId: tasks.customId,
                listId: lists.id,
                listName: lists.name,
                spaceId: spaces.id,
                spaceName: spaces.name,
                dueDate: tasks.dueDate,
                priority: tasks.priority,
                archivedAt: tasks.archivedAt,
            })
            .from(tasks)
            .innerJoin(lists, eq(lists.id, tasks.primaryListId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    inArray(tasks.id, taskIds),
                    eq(tasks.workspaceId, workspaceId),
                ),
            );
        for (const row of rows) out.set(row.id, row);
        return out;
    }

    /**
     * Heads of every space each user belongs to (Q2's "their Head" — decider
     * set + request fanout). A user's own id is never their head here unless
     * they literally head a team they also belong to.
     */
    async headsOfUserSpaces(
        userIds: string[],
        workspaceId: string,
    ): Promise<Map<string, string[]>> {
        const out = new Map<string, string[]>();
        if (userIds.length === 0) return out;
        const rows = await this.db
            .selectDistinct({
                userId: userRoleGrants.userId,
                headUserId: spaces.headUserId,
            })
            .from(userRoleGrants)
            .innerJoin(spaces, eq(spaces.id, userRoleGrants.scopeId))
            .where(
                and(
                    inArray(userRoleGrants.userId, userIds),
                    eq(userRoleGrants.workspaceId, workspaceId),
                    eq(userRoleGrants.scopeType, "space"),
                    isNotNull(spaces.headUserId),
                ),
            );
        for (const row of rows) {
            if (!row.headUserId) continue;
            const list = out.get(row.userId) ?? [];
            if (!list.includes(row.headUserId)) list.push(row.headUserId);
            out.set(row.userId, list);
        }
        return out;
    }

    /** The actor of the LATEST 'queried' event (answer-notification target). */
    async lastQueryActor(requestId: string): Promise<string | null> {
        const [row] = await this.db
            .select({ actorId: taskAssignmentRequestEvents.actorId })
            .from(taskAssignmentRequestEvents)
            .where(
                and(
                    eq(taskAssignmentRequestEvents.requestId, requestId),
                    eq(taskAssignmentRequestEvents.action, "queried"),
                ),
            )
            .orderBy(desc(taskAssignmentRequestEvents.internalId))
            .limit(1);
        return row?.actorId ?? null;
    }
}
