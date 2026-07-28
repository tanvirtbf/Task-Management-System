"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceActivityService = void 0;
const errors_1 = require("../errors");
const userSerializer_1 = require("../serializers/userSerializer");
/**
 * §26 Workspace-activity read logic. Two reads over `workspace_activity`:
 *   - `recent` — the last N events for the home card (§26 #1), no filters/cursor.
 *   - `feed` — the filtered, cursor-paginated full feed (§26 #2).
 *
 * Both are workspace-isolated (the `workspaceId` is the verified JWT claim, never
 * client input) and hydrate each row's `actor` to the full wire `User` (or `null`
 * for a system event / since-deleted actor). The wire shape + cursor codec +
 * `clampLimit` mirror `TaskActivityService` (the codebase keeps one copy per
 * paginated service — there is no shared pagination helper yet). Per the §26 spec
 * ("distinct from per-task activity §13") this reads `workspace_activity` ONLY —
 * it does not UNION `task_activity`.
 */
const DEFAULT_RECENT = 20;
const MAX_RECENT = 50;
const DEFAULT_FEED = 50;
const MAX_FEED = 200;
class WorkspaceActivityService {
    activityRepo;
    usersRepo;
    constructor(activityRepo, usersRepo) {
        this.activityRepo = activityRepo;
        this.usersRepo = usersRepo;
    }
    /** Last N workspace events, newest-first, actor hydrated (§26 #1). */
    async recent(input) {
        const limit = clampLimit(input.limit, DEFAULT_RECENT, MAX_RECENT);
        const rows = await this.activityRepo.listRecent(input.workspaceId, limit);
        const actorsById = await this.hydrateActors(rows, input.workspaceId);
        return { data: rows.map((r) => this.toWire(r, actorsById)) };
    }
    /** One filtered, cursor-paginated, newest-first page of the feed (§26 #2). */
    async feed(input) {
        const limit = clampLimit(input.limit, DEFAULT_FEED, MAX_FEED);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const afterInternalId = input.cursor
            ? decodeCursor(input.cursor)
            : undefined;
        const filters = {
            entityType: input.entityType,
            actorId: input.actorId,
            from: input.from ? new Date(input.from) : undefined,
            to: input.to ? new Date(input.to) : undefined,
        };
        // Fetch one row beyond `limit` so `has_more` needs no extra round-trip;
        // the exact count runs concurrently.
        const [rows, total] = await Promise.all([
            this.activityRepo.listFeed({
                ...filters,
                workspaceId: input.workspaceId,
                afterInternalId,
                limit: limit + 1,
            }),
            this.activityRepo.countFeed({
                ...filters,
                workspaceId: input.workspaceId,
            }),
        ]);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const actorsById = await this.hydrateActors(page, input.workspaceId);
        const data = page.map((r) => this.toWire(r, actorsById));
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(last.internalId.toString()) : null;
        return { data, nextCursor, hasMore, total };
    }
    /**
     * One batched read for every distinct, non-null actor on the page (no N+1),
     * scoped to the workspace — an actor is always a member of the workspace the
     * event belongs to, so a workspace-scoped fetch is both correct and a defence
     * against ever hydrating a foreign user.
     */
    async hydrateActors(page, workspaceId) {
        const actorIds = [
            ...new Set(page
                .map((r) => r.actorId)
                .filter((id) => id !== null)),
        ];
        if (actorIds.length === 0)
            return new Map();
        const users = await this.usersRepo.findManyByIdsInWorkspace(actorIds, workspaceId);
        return new Map(users.map((u) => [u.id, u]));
    }
    toWire(row, actorsById) {
        const actor = row.actorId !== null ? actorsById.get(row.actorId) : undefined;
        return {
            id: row.id,
            actor: actor ? (0, userSerializer_1.toWireUser)(actor) : null,
            entity_type: row.entityType,
            entity_id: row.entityId,
            action: row.action,
            context: row.context,
            created_at: row.createdAt.toISOString(),
        };
    }
}
exports.WorkspaceActivityService = WorkspaceActivityService;
/** Window clamp: min 1, with per-endpoint default + max (API_DESIGN.md §1). */
const clampLimit = (raw, def, max) => {
    if (raw === undefined)
        return def;
    if (raw < 1)
        return 1;
    if (raw > max)
        return max;
    return Math.floor(raw);
};
// Opaque cursor codec — wraps the last row's `internal_id` (a positive integer),
// mirroring `TaskActivityService`. Kept local: one copy per paginated service.
const encodeCursor = (value) => Buffer.from(value, "utf8").toString("base64url");
/**
 * Decode an opaque feed cursor to its `internal_id` keyset value. A malformed
 * cursor is a bad request *parameter* (400 `pagination.invalid_cursor`), not a
 * 422 — the client cannot "fix" an opaque token, only drop it and restart.
 */
const decodeCursor = (cursor) => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded)) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    return decoded;
};
