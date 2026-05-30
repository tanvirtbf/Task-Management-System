import { AppError } from "../errors";
import { Roles, type Role } from "../constants";
import { ListsRepo } from "../repositories/ListsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";
import type { ListTasksFilters } from "../types/tasks";

/**
 * Read-side logic for §10's `GET /lists/:listId/tasks`. Owns the
 * workspace-isolation guard, limit clamping, the opaque cursor codec, and
 * hydration assembly; the repository owns the SQL. No transaction — the page,
 * count, and hydration are independent reads and `total` is best-effort per the
 * spec's `total_estimate` contract.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListTasksInput {
    listId: string;
    workspaceId: string;
    role: Role;
    filters: ListTasksFilters;
    cursor?: string;
    limit?: number;
}

export interface ListTasksResult {
    data: WireTask[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
}

export interface GetTaskInput {
    idOrKey: string;
    workspaceId: string;
    role: Role;
}

export interface GetSubtasksInput {
    idOrKey: string;
    workspaceId: string;
    role: Role;
    includeArchived: boolean;
}

export class TasksService {
    constructor(
        private lists: ListsRepo,
        private tasksRepo: TasksRepo,
    ) {}

    async listByList(input: ListTasksInput): Promise<ListTasksResult> {
        // Workspace-isolation guard: a missing or cross-workspace list id is
        // 404 `list.not_found` — never another workspace's tasks, never a
        // misleading empty 200.
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        const limit = clampLimit(input.limit);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const afterId = input.cursor ? decodeCursor(input.cursor) : undefined;

        const scope = {
            ...input.filters,
            workspaceId: input.workspaceId,
            listId: input.listId,
        };

        // Fetch one row beyond `limit` so `has_more` needs no extra round-trip;
        // the exact count runs concurrently.
        const [rows, total] = await Promise.all([
            this.tasksRepo.listByList({ ...scope, afterId, limit: limit + 1 }),
            this.tasksRepo.countByList(scope),
        ]);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        // Hydrate the page's tasks in four batched reads (no N+1). Guests never
        // see custom-field values flagged `hidden_from_guests`.
        const taskIds = page.map((row) => row.id);
        const redactGuest = input.role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasksRepo.assigneesByTask(taskIds),
                this.tasksRepo.watchersByTask(taskIds),
                this.tasksRepo.tagsByTask(taskIds),
                this.tasksRepo.customFieldValuesByTask(taskIds, redactGuest),
            ]);

        const data = page.map((row) =>
            toWireTask(row, {
                assignees: assignees.get(row.id) ?? [],
                watchers: watchers.get(row.id) ?? [],
                tags: tags.get(row.id) ?? [],
                customFieldValues: customFieldValues.get(row.id) ?? {},
            }),
        );

        const last = page[page.length - 1];
        const nextCursor =
            hasMore && last ? encodeCursor(last.internalId.toString()) : null;

        return { data, nextCursor, hasMore, total };
    }

    /**
     * Read one fully-hydrated task by internal `id` or `custom_id`, scoped to
     * the caller's workspace. A missing or cross-workspace id is `404
     * task.not_found` (never another tenant's task). Archived tasks ARE
     * returned — `archived_at` is soft-delete, and the detail view, unarchive
     * flow, and activity links all need to fetch them; the list-only
     * `archived_at IS NULL` filter does not apply to a direct read.
     *
     * Hydration mirrors `listByList`: four batched reads (no N+1), with guests
     * never seeing custom-field values flagged `hidden_from_guests`. No
     * transaction — a detail read needs no cross-table snapshot.
     */
    async getById(input: GetTaskInput): Promise<WireTask> {
        const row = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.idOrKey,
            input.workspaceId,
        );
        if (!row) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.idOrKey} does not exist`,
            );
        }

        const redactGuest = input.role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasksRepo.assigneesByTask([row.id]),
                this.tasksRepo.watchersByTask([row.id]),
                this.tasksRepo.tagsByTask([row.id]),
                this.tasksRepo.customFieldValuesByTask([row.id], redactGuest),
            ]);

        return toWireTask(row, {
            assignees: assignees.get(row.id) ?? [],
            watchers: watchers.get(row.id) ?? [],
            tags: tags.get(row.id) ?? [],
            customFieldValues: customFieldValues.get(row.id) ?? {},
        });
    }

    /**
     * List the direct children of a parent task (resolved by internal `id` or
     * `custom_id`), each fully hydrated. A missing or cross-workspace parent is
     * `404 task.not_found`; a parent with no matching children is an empty
     * array, never a 404. Archived children are excluded unless
     * `includeArchived`.
     *
     * Hydration mirrors `listByList` / `getById`: four batched reads (no N+1),
     * with guests never seeing custom-field values flagged `hidden_from_guests`.
     * No transaction — independent reads.
     */
    async getSubtasks(input: GetSubtasksInput): Promise<WireTask[]> {
        const parent = await this.tasksRepo.findByIdOrCustomIdInWorkspace(
            input.idOrKey,
            input.workspaceId,
        );
        if (!parent) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.idOrKey} does not exist`,
            );
        }

        const rows = await this.tasksRepo.listChildren({
            parentId: parent.id,
            workspaceId: input.workspaceId,
            includeArchived: input.includeArchived,
        });
        if (rows.length === 0) return [];

        const ids = rows.map((row) => row.id);
        const redactGuest = input.role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasksRepo.assigneesByTask(ids),
                this.tasksRepo.watchersByTask(ids),
                this.tasksRepo.tagsByTask(ids),
                this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
            ]);

        return rows.map((row) =>
            toWireTask(row, {
                assignees: assignees.get(row.id) ?? [],
                watchers: watchers.get(row.id) ?? [],
                tags: tags.get(row.id) ?? [],
                customFieldValues: customFieldValues.get(row.id) ?? {},
            }),
        );
    }
}

/** Tasks pagination window: default 50, max 200, min 1 (API_DESIGN.md §1). */
const clampLimit = (raw?: number): number => {
    if (raw === undefined) return DEFAULT_LIMIT;
    if (raw < 1) return 1;
    if (raw > MAX_LIMIT) return MAX_LIMIT;
    return Math.floor(raw);
};

// Opaque cursor codec, kept local to the service (mirrors `UserService` — the
// codebase has no shared pagination helper yet). The tasks cursor wraps the
// last row's `internal_id`, so the decoded value must be a positive integer.
const encodeCursor = (value: string): string =>
    Buffer.from(value, "utf8").toString("base64url");

/**
 * Decode an opaque tasks cursor to its `internal_id` keyset value. A malformed
 * cursor is a bad request *parameter* (400 `pagination.invalid_cursor`), not a
 * 422 — the client cannot "fix" an opaque token, only drop it and restart.
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
