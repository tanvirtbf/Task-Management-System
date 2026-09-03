import { Roles, type Role } from "../constants";
import {
    SearchRepo,
    type SearchCommentRow,
    type SearchListRow,
    type SearchSpaceRow,
} from "../repositories/SearchRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskDeleteRequestsRepo } from "../repositories/TaskDeleteRequestsRepo";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";
import { toWireUser, type WireUser } from "../serializers/userSerializer";
import type { SearchType, WireSearchComment } from "../types/search";

/**
 * §24 Search business logic. Runs the requested per-type LIKE searches in
 * parallel, hydrates matched tasks into full wire `Task`s (reusing TasksRepo's
 * batched no-N+1 hydration + the §10 guest custom-field redaction), and shapes
 * every result to the SAME wire shape its own GET endpoint returns. Read-only —
 * no transactions.
 */

const VALID_TYPES: readonly SearchType[] = [
    "task",
    "list",
    "space",
    "user",
    "comment",
];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50; // §24 hard cap

/** Clamp the per-type result limit to [1, 50], defaulting to 20. */
const clampLimit = (limit?: number): number => {
    if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
    return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
};

/**
 * Parse the `types` CSV into a Set of valid kinds, or `null` for "all".
 * Unknown tokens (e.g. the frontend's stale `note`) are dropped, not rejected.
 * Absent / blank `types` ⇒ `null` ⇒ search every kind.
 */
const parseTypes = (raw?: string): Set<SearchType> | null => {
    if (!raw) return null;
    const tokens = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    if (tokens.length === 0) return null;
    const valid = tokens.filter((t): t is SearchType =>
        (VALID_TYPES as readonly string[]).includes(t),
    );
    return new Set(valid);
};

// ── wire mappers for resources without a shared serializer ──
// (lists/spaces are inline in their controllers; comments has no §14 serializer)

const toWireList = (l: SearchListRow) => ({
    id: l.id,
    space_id: l.spaceId,
    name: l.name,
    description: l.description,
    icon: l.icon,
    color: l.color,
    position: l.position,
    default_task_type_id: l.defaultTaskTypeId,
    is_private: l.isPrivate,
    archived_at: l.archivedAt ? l.archivedAt.toISOString() : null,
    created_by: l.createdBy,
    created_at: l.createdAt.toISOString(),
});

const toWireSpace = (s: SearchSpaceRow) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    color: s.color,
    is_private: s.isPrivate,
    position: s.position,
    archived_at: s.archivedAt ? s.archivedAt.toISOString() : null,
    created_by: s.createdBy,
    created_at: s.createdAt.toISOString(),
});

const toWireComment = (c: SearchCommentRow): WireSearchComment => ({
    id: c.id,
    task_id: c.taskId,
    parent_comment_id: c.parentCommentId,
    author_id: c.authorId,
    body: c.body,
    edited_at: c.editedAt ? c.editedAt.toISOString() : null,
    created_at: c.createdAt.toISOString(),
});

export interface SearchInput {
    workspaceId: string;
    role: Role;
    q: string;
    /** Raw CSV from `?types=`. */
    types?: string;
    /** Raw `?limit=` (already int-validated). */
    limit?: number;
}

export interface SearchResult {
    tasks: WireTask[];
    lists: ReturnType<typeof toWireList>[];
    spaces: ReturnType<typeof toWireSpace>[];
    users: WireUser[];
    comments: WireSearchComment[];
    total: number;
}

export class SearchService {
    constructor(
        private searchRepo: SearchRepo,
        private tasksRepo: TasksRepo,
        /**
         * Optional, mirroring `TasksService` and `TaskWriteService`: it exists
         * only to hydrate the "deletion pending" badge, so a caller that has
         * not wired it degrades to `false` rather than failing to construct.
         */
        private deleteRequestsRepo?: TaskDeleteRequestsRepo,
    ) {}

    async search(input: SearchInput): Promise<SearchResult> {
        const q = input.q.trim();
        const limit = clampLimit(input.limit);
        const requested = parseTypes(input.types);
        const want = (t: SearchType): boolean =>
            requested === null || requested.has(t);

        // Blank query ⇒ empty result (no 422) — matches the frontend contract.
        if (q.length === 0) {
            return {
                tasks: [],
                lists: [],
                spaces: [],
                users: [],
                comments: [],
                total: 0,
            };
        }

        const { workspaceId } = input;
        const [taskRows, listRows, spaceRows, userRows, commentRows] =
            await Promise.all([
                want("task")
                    ? this.searchRepo.searchTasks(workspaceId, q, limit)
                    : Promise.resolve([]),
                want("list")
                    ? this.searchRepo.searchLists(workspaceId, q, limit)
                    : Promise.resolve([]),
                want("space")
                    ? this.searchRepo.searchSpaces(workspaceId, q, limit)
                    : Promise.resolve([]),
                want("user")
                    ? this.searchRepo.searchUsers(workspaceId, q, limit)
                    : Promise.resolve([]),
                want("comment")
                    ? this.searchRepo.searchComments(workspaceId, q, limit)
                    : Promise.resolve([]),
            ]);

        // Hydrate matched tasks into full wire Tasks (no N+1; guest redaction).
        let tasks: WireTask[] = [];
        if (taskRows.length > 0) {
            const ids = taskRows.map((row) => row.id);
            const redactGuest = input.role === Roles.GUEST;
            const [assignees, watchers, tags, customFieldValues, pendingDeletes] =
                await Promise.all([
                    this.tasksRepo.assigneesByTask(ids),
                    this.tasksRepo.watchersByTask(ids),
                    this.tasksRepo.tagsByTask(ids),
                    this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
                    // KI-35, decided in P6: search hydrates the flag like every
                    // other task surface. No component renders the badge in the
                    // results list TODAY, so nothing visible changes — but P4
                    // found that a serializer default of `false` stops being an
                    // "honest default" the moment one does, and search is a
                    // primary way people reach a task. One batched, indexed
                    // lookup over ids already in hand.
                    this.deleteRequestsRepo?.pendingTaskIds(ids) ??
                        Promise.resolve(new Set<string>()),
                ]);
            tasks = taskRows.map((row) =>
                toWireTask(row, {
                    assignees: assignees.get(row.id) ?? [],
                    watchers: watchers.get(row.id) ?? [],
                    tags: tags.get(row.id) ?? [],
                    customFieldValues: customFieldValues.get(row.id) ?? {},
                    deleteRequestPending: pendingDeletes.has(row.id),
                }),
            );
        }

        const lists = listRows.map(toWireList);
        const spaces = spaceRows.map(toWireSpace);
        const users = userRows.map(toWireUser);
        const comments = commentRows.map(toWireComment);

        const total =
            tasks.length +
            lists.length +
            spaces.length +
            users.length +
            comments.length;

        return { tasks, lists, spaces, users, comments, total };
    }
}
