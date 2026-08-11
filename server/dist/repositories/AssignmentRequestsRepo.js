"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentRequestsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const REQUEST_COLUMNS = {
    id: schema_1.taskAssignmentRequests.id,
    internalId: schema_1.taskAssignmentRequests.internalId,
    workspaceId: schema_1.taskAssignmentRequests.workspaceId,
    spaceId: schema_1.taskAssignmentRequests.spaceId,
    taskId: schema_1.taskAssignmentRequests.taskId,
    targetUserId: schema_1.taskAssignmentRequests.targetUserId,
    requestedBy: schema_1.taskAssignmentRequests.requestedBy,
    status: schema_1.taskAssignmentRequests.status,
    requestNote: schema_1.taskAssignmentRequests.requestNote,
    queryNote: schema_1.taskAssignmentRequests.queryNote,
    proposedDueDate: schema_1.taskAssignmentRequests.proposedDueDate,
    decidedBy: schema_1.taskAssignmentRequests.decidedBy,
    decidedAt: schema_1.taskAssignmentRequests.decidedAt,
    expiresAt: schema_1.taskAssignmentRequests.expiresAt,
    createdAt: schema_1.taskAssignmentRequests.createdAt,
    updatedAt: schema_1.taskAssignmentRequests.updatedAt,
};
class AssignmentRequestsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
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
    async pendingPairs(pairs, exec = this.db) {
        if (pairs.length === 0)
            return new Set();
        const rows = await exec
            .select({
            taskId: schema_1.taskAssignmentRequests.taskId,
            targetUserId: schema_1.taskAssignmentRequests.targetUserId,
        })
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending"), (0, drizzle_orm_1.inArray)(schema_1.taskAssignmentRequests.taskId, [...new Set(pairs.map((p) => p.taskId))]), (0, drizzle_orm_1.inArray)(schema_1.taskAssignmentRequests.targetUserId, [...new Set(pairs.map((p) => p.targetUserId))])));
        return new Set(rows.map((r) => `${r.taskId}|${r.targetUserId}`));
    }
    async insertRequests(rows, exec = this.db) {
        if (rows.length === 0)
            return;
        await exec.insert(schema_1.taskAssignmentRequests).values(rows);
    }
    async insertEvents(rows, exec = this.db) {
        if (rows.length === 0)
            return;
        await exec.insert(schema_1.taskAssignmentRequestEvents).values(rows);
    }
    async findByIdInWorkspace(id, workspaceId, exec = this.db) {
        const [row] = await exec
            .select(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * Tx re-read by primary key alone — the claim post-mortem ("did the miss
     * mean decided, or expired?"). Only called on an id that already passed
     * the workspace-pinned lookup above.
     */
    async findById(id, exec = this.db) {
        const [row] = await exec
            .select(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.id, id))
            .limit(1);
        return row ?? null;
    }
    /** Requests addressed TO this person ("received"). */
    async listByTarget(userId, workspaceId, onlyPending, limit) {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.targetUserId, userId), onlyPending
            ? (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending")
            : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskAssignmentRequests.internalId))
            .limit(limit);
    }
    /** Requests this person sent ("sent"). */
    async listByRequester(userId, workspaceId, onlyPending, limit) {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.requestedBy, userId), onlyPending
            ? (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending")
            : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskAssignmentRequests.internalId))
            .limit(limit);
    }
    /**
     * Requests whose TARGET belongs to a team this person heads ("team") —
     * the Q2 half where a Head accepts/declines on the member's behalf.
     * DISTINCT because a target can belong to two spaces the same head runs.
     */
    async listByHeadOf(headUserId, workspaceId, onlyPending, limit) {
        return this.db
            .selectDistinct(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .innerJoin(schema_1.userRoleGrants, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRoleGrants.userId, schema_1.taskAssignmentRequests.targetUserId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, "space")))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.userRoleGrants.scopeId), (0, drizzle_orm_1.eq)(schema_1.spaces.headUserId, headUserId)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.workspaceId, workspaceId), onlyPending
            ? (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending")
            : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskAssignmentRequests.internalId))
            .limit(limit);
    }
    /** The whole negotiation history of one task (drawer panel). */
    async listByTask(taskId, limit) {
        return this.db
            .select(REQUEST_COLUMNS)
            .from(schema_1.taskAssignmentRequests)
            .where((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.taskId, taskId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskAssignmentRequests.internalId))
            .limit(limit);
    }
    /** Events for a set of requests, oldest-first per request. */
    async eventsByRequests(requestIds) {
        const out = new Map();
        if (requestIds.length === 0)
            return out;
        const rows = await this.db
            .select()
            .from(schema_1.taskAssignmentRequestEvents)
            .where((0, drizzle_orm_1.inArray)(schema_1.taskAssignmentRequestEvents.requestId, requestIds))
            .orderBy(schema_1.taskAssignmentRequestEvents.internalId);
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
    async claimDecision(id, input, exec = this.db) {
        const [result] = await exec
            .update(schema_1.taskAssignmentRequests)
            .set({
            status: input.to,
            decidedBy: input.decidedBy,
            decidedAt: input.now,
            updatedAt: input.now,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending"), input.requireUnexpired
            ? (0, drizzle_orm_1.gt)(schema_1.taskAssignmentRequests.expiresAt, input.now)
            : undefined));
        return result.affectedRows === 1;
    }
    /**
     * Record the receiver side's latest query on a LIVE pending row (status
     * does not change — the negotiation stays open). Same conditional-UPDATE
     * guard as the claims.
     */
    async recordQuery(id, input, exec = this.db) {
        const [result] = await exec
            .update(schema_1.taskAssignmentRequests)
            .set({
            queryNote: input.queryNote,
            proposedDueDate: input.proposedDueDate,
            updatedAt: input.now,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending"), (0, drizzle_orm_1.gt)(schema_1.taskAssignmentRequests.expiresAt, input.now)));
        return result.affectedRows === 1;
    }
    /** Bump a LIVE pending row's `updated_at` (the requester answered). */
    async touchPending(id, now, exec = this.db) {
        const [result] = await exec
            .update(schema_1.taskAssignmentRequests)
            .set({ updatedAt: now })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending"), (0, drizzle_orm_1.gt)(schema_1.taskAssignmentRequests.expiresAt, now)));
        return result.affectedRows === 1;
    }
    /** Pending rows whose window has lapsed — the janitor's scan. */
    async findExpiredPending(now, limit) {
        return this.db
            .select({
            id: schema_1.taskAssignmentRequests.id,
            workspaceId: schema_1.taskAssignmentRequests.workspaceId,
            taskId: schema_1.taskAssignmentRequests.taskId,
            taskName: schema_1.tasks.name,
            targetUserId: schema_1.taskAssignmentRequests.targetUserId,
            requestedBy: schema_1.taskAssignmentRequests.requestedBy,
        })
            .from(schema_1.taskAssignmentRequests)
            .leftJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.tasks.id, schema_1.taskAssignmentRequests.taskId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequests.status, "pending"), (0, drizzle_orm_1.lte)(schema_1.taskAssignmentRequests.expiresAt, now)))
            .orderBy(schema_1.taskAssignmentRequests.internalId)
            .limit(limit);
    }
    /**
     * Task context for the request wire shape — DELIBERATELY unfiltered by the
     * caller's visibility (see the class header): the receiver must see what
     * they are consenting to. Workspace-pinned; nothing else escapes.
     */
    async taskSnapshotByIds(taskIds, workspaceId, exec = this.db) {
        const out = new Map();
        if (taskIds.length === 0)
            return out;
        const rows = await exec
            .select({
            id: schema_1.tasks.id,
            name: schema_1.tasks.name,
            customId: schema_1.tasks.customId,
            listId: schema_1.lists.id,
            listName: schema_1.lists.name,
            spaceId: schema_1.spaces.id,
            spaceName: schema_1.spaces.name,
            dueDate: schema_1.tasks.dueDate,
            priority: schema_1.tasks.priority,
            archivedAt: schema_1.tasks.archivedAt,
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.tasks.primaryListId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, taskIds), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)));
        for (const row of rows)
            out.set(row.id, row);
        return out;
    }
    /**
     * Heads of every space each user belongs to (Q2's "their Head" — decider
     * set + request fanout). A user's own id is never their head here unless
     * they literally head a team they also belong to.
     */
    async headsOfUserSpaces(userIds, workspaceId) {
        const out = new Map();
        if (userIds.length === 0)
            return out;
        const rows = await this.db
            .selectDistinct({
            userId: schema_1.userRoleGrants.userId,
            headUserId: schema_1.spaces.headUserId,
        })
            .from(schema_1.userRoleGrants)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.userRoleGrants.scopeId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.userRoleGrants.userId, userIds), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.userRoleGrants.scopeType, "space"), (0, drizzle_orm_1.isNotNull)(schema_1.spaces.headUserId)));
        for (const row of rows) {
            if (!row.headUserId)
                continue;
            const list = out.get(row.userId) ?? [];
            if (!list.includes(row.headUserId))
                list.push(row.headUserId);
            out.set(row.userId, list);
        }
        return out;
    }
    /** The actor of the LATEST 'queried' event (answer-notification target). */
    async lastQueryActor(requestId) {
        const [row] = await this.db
            .select({ actorId: schema_1.taskAssignmentRequestEvents.actorId })
            .from(schema_1.taskAssignmentRequestEvents)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequestEvents.requestId, requestId), (0, drizzle_orm_1.eq)(schema_1.taskAssignmentRequestEvents.action, "queried")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskAssignmentRequestEvents.internalId))
            .limit(1);
        return row?.actorId ?? null;
    }
}
exports.AssignmentRequestsRepo = AssignmentRequestsRepo;
