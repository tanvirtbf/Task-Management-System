import { AppError } from "../errors";
import { TasksRepo } from "../repositories/TasksRepo";
import {
    TaskActivityRepo,
    type ActivityRow,
} from "../repositories/TaskActivityRepo";
import { UsersRepo, type UserListRow } from "../repositories/UsersRepo";
import { toWireUser, type WireUser } from "../serializers/userSerializer";

/**
 * §13 Task activity read logic. Owns the workspace-isolation guard (via the
 * task's own resolution), limit clamping, the opaque `internal_id` cursor codec,
 * and actor hydration. No transaction — the page, count, and actor reads are
 * independent and `total` is best-effort per the `total_estimate` contract.
 *
 * The cursor codec + `clampLimit` mirror `TasksService` (the codebase keeps one
 * copy per paginated service — there is no shared pagination helper yet).
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListTaskActivityInput {
    /** Internal task id OR `custom_id` (same as `GET /tasks/:id`). */
    idOrKey: string;
    workspaceId: string;
    /** `?action=` exact-match filter; absent = all actions. */
    action?: string;
    cursor?: string;
    limit?: number;
}

/**
 * Wire-format `TaskActivity` per API_DESIGN.md §13. `actor` is the full `User`
 * object (hydrated so the UI needs no extra call) or `null` for a system event /
 * a since-deleted actor. `context` is the stored JSON payload verbatim.
 */
export interface WireTaskActivity {
    id: string;
    task_id: string;
    actor: WireUser | null;
    action: string;
    context: Record<string, unknown> | null;
    created_at: string;
}

export interface ListTaskActivityResult {
    data: WireTaskActivity[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
}

export class TaskActivityService {
    constructor(
        private tasksRepo: TasksRepo,
        private activityRepo: TaskActivityRepo,
        private usersRepo: UsersRepo,
    ) {}

    /**
     * One newest-first page of a task's activity feed. The task is resolved
     * inside the caller's workspace first: a missing or cross-workspace id is
     * `404 task.not_found` (never another tenant's feed, never a misleading
     * empty 200). Archived tasks DO return their activity — `archived_at` is a
     * soft-delete and the detail view links here.
     */
    async listByTask(
        input: ListTaskActivityInput,
    ): Promise<ListTaskActivityResult> {
        const task = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.idOrKey,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.idOrKey} does not exist`,
            );
        }

        const limit = clampLimit(input.limit);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const afterInternalId = input.cursor
            ? decodeCursor(input.cursor)
            : undefined;

        const feed = { taskId: task.id, action: input.action };

        // Fetch one row beyond `limit` so `has_more` needs no extra round-trip;
        // the exact count runs concurrently.
        const [rows, total] = await Promise.all([
            this.activityRepo.listByTask({
                ...feed,
                afterInternalId,
                limit: limit + 1,
            }),
            this.activityRepo.countByTask(feed),
        ]);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        const actorsById = await this.hydrateActors(page, input.workspaceId);

        const data = page.map((row) => this.toWire(row, actorsById));

        const last = page[page.length - 1];
        const nextCursor =
            hasMore && last ? encodeCursor(last.internalId.toString()) : null;

        return { data, nextCursor, hasMore, total };
    }

    /**
     * One batched read for every distinct, non-null actor on the page (no N+1),
     * scoped to the workspace — an actor is always a member of the task's own
     * workspace, so a workspace-scoped fetch is both correct and a defence
     * against ever hydrating a foreign user.
     */
    private async hydrateActors(
        page: ActivityRow[],
        workspaceId: string,
    ): Promise<Map<string, UserListRow>> {
        const actorIds = [
            ...new Set(
                page
                    .map((r) => r.actorId)
                    .filter((id): id is string => id !== null),
            ),
        ];
        if (actorIds.length === 0) return new Map();

        const users = await this.usersRepo.findManyByIdsInWorkspace(
            actorIds,
            workspaceId,
        );
        return new Map(users.map((u) => [u.id, u]));
    }

    private toWire(
        row: ActivityRow,
        actorsById: Map<string, UserListRow>,
    ): WireTaskActivity {
        const actor =
            row.actorId !== null ? actorsById.get(row.actorId) : undefined;
        return {
            id: row.id,
            task_id: row.taskId,
            actor: actor ? toWireUser(actor) : null,
            action: row.action,
            context: row.context,
            created_at: row.createdAt.toISOString(),
        };
    }
}

/**
 * Activity feed window: default 50, max 200, min 1 (API_DESIGN.md §1).
 *
 * Defensive against a non-scalar `limit`: a repeated query key (`?limit=1&limit=2`)
 * survives `isInt`/`toInt` validation as an ARRAY, and a bare array would coerce
 * to `NaN` here — which Drizzle renders as *no* `LIMIT` clause, dumping the whole
 * feed unpaginated. So normalise an array to its last element and fall back to the
 * default for anything non-finite.
 */
const clampLimit = (raw: unknown): number => {
    const candidate: unknown = Array.isArray(raw)
        ? (raw as unknown[])[raw.length - 1]
        : raw;
    if (candidate === undefined || candidate === null) return DEFAULT_LIMIT;
    const n = Number(candidate);
    if (!Number.isFinite(n)) return DEFAULT_LIMIT;
    if (n < 1) return 1;
    if (n > MAX_LIMIT) return MAX_LIMIT;
    return Math.floor(n);
};

// Opaque cursor codec — wraps the last row's `internal_id` (a positive integer),
// mirroring `TasksService`. Kept local: the codebase has one copy per paginated
// service rather than a shared helper.
const encodeCursor = (value: string): string =>
    Buffer.from(value, "utf8").toString("base64url");

/**
 * Decode an opaque activity cursor to its `internal_id` keyset value. A
 * malformed cursor is a bad request *parameter* (400 `pagination.invalid_cursor`),
 * not a 422 — the client cannot "fix" an opaque token, only drop it and restart.
 */
const decodeCursor = (cursor: string): string => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    return decoded;
};
