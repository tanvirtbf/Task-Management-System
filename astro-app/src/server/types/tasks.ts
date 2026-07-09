import type { AuthRequest } from "./index";
import type { bugSeverities, statusGroups } from "../db/schema/_shared";

/**
 * Endpoint-specific request shapes for the Tasks resource family (§10–§14).
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

export type StatusGroupValue = (typeof statusGroups)[number];
export type BugSeverityValue = (typeof bugSeverities)[number];

/**
 * Normalised, typed filters for `GET /api/v1/lists/:listId/tasks`, built by the
 * controller from the validated query string (CSV params already split; enum
 * members already narrowed; booleans already coerced). Every field is a pure
 * WHERE predicate — none affects the `internal_id` keyset, so they compose
 * freely with cursor pagination.
 */
export interface ListTasksFilters {
    statusIds?: string[];
    statusGroups?: StatusGroupValue[];
    assigneeIds?: string[];
    reviewerId?: string;
    priorities?: number[];
    taskTypeIds?: string[];
    tagIds?: string[];
    sprintId?: string;
    bugSeverities?: BugSeverityValue[];
    q?: string;
    dueBefore?: string;
    dueAfter?: string;
    includeArchived: boolean;
    includeSubtasks: boolean;
}

/**
 * Authenticated request for `GET /api/v1/lists/:listId/tasks`. The list id is a
 * path param; filters/cursor/limit come from the validated `req.query`;
 * identity (and workspace scope) from `req.auth`.
 */
export type ListTasksRequest = AuthRequest;

/**
 * Authenticated request for `GET /api/v1/tasks/:id`. The `:id` path param is
 * either an internal task id or a `custom_id`; identity and workspace scope
 * come from `req.auth`.
 */
export type GetTaskRequest = AuthRequest;

/**
 * Authenticated request for `GET /api/v1/tasks/:id/subtasks`. The parent `:id`
 * (internal id or `custom_id`) is a path param; `include_archived` is an
 * optional query flag; identity and workspace scope come from `req.auth`.
 */
export type SubtasksRequest = AuthRequest;

/**
 * Authenticated request for `GET /api/v1/tasks/:id/activity` (§13). The `:id`
 * (internal id or `custom_id`) is a path param; `action` / `cursor` / `limit`
 * are optional query params; identity and workspace scope come from `req.auth`.
 */
export type TaskActivityRequest = AuthRequest;

/**
 * `POST /api/v1/tasks/:id/assignees` body. Either a single `user_id` or a
 * `user_ids` array (bulk) — the validator guarantees at least one is present
 * and well-typed; the controller normalises them into one deduped list.
 */
export interface AddAssigneesBody {
    user_id?: string;
    user_ids?: string[];
}

/**
 * Authenticated request for `POST /api/v1/tasks/:id/assignees`. Identity comes
 * from the `authenticate` middleware (`req.auth`); the task id is a path param.
 */
export interface AddAssigneesRequest extends AuthRequest {
    body: AddAssigneesBody;
}

/**
 * Body for `POST /api/v1/tasks` (§10 #4). Only `primary_list_id` + `name` are
 * required; the validator constrains every other field. `assignees`/`tags` are
 * id arrays for the initial membership writes. Counter columns and server-
 * computed fields (`task_number`, `internal_id`, `subtasks_count`, …) are not
 * accepted. `recurrence_pattern` is the `none|daily|weekly` enum.
 */
export interface CreateTaskBody {
    primary_list_id: string;
    name: string;
    description?: string | null;
    status_id?: string;
    task_type_id?: string;
    parent_task_id?: string | null;
    priority?: number;
    is_milestone?: boolean;
    custom_id?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    recurrence_pattern?: string;
    recurrence_days?: string[] | null;
    recurrence_ends_at?: string | null;
    time_estimate_seconds?: number | null;
    assignees?: string[];
    tags?: string[];
    sprint_id?: string | null;
    story_points?: number | null;
    reviewer_id?: string | null;
    branch_name?: string | null;
    pr_url?: string | null;
    pr_status?: string | null;
    bug_severity?: string | null;
    bug_reproducibility?: string | null;
    bug_environment?: string | null;
    bug_browser?: string | null;
    reporter_team?: string | null;
    deployed_at?: string | null;
    rollback_reason?: string | null;
}

export interface CreateTaskRequest extends AuthRequest {
    body: CreateTaskBody;
}

/**
 * Body for `PATCH /api/v1/tasks/:id` (§10 #5) — partial scalar update; every
 * field optional (the controller enforces ≥1). Excludes `primary_list_id`,
 * `assignees`, `tags`, `parent_task_id` (separate concerns). V1 limitation:
 * nullable fields can be SET but not cleared-to-null via this body (the
 * validator treats a null as "not provided").
 */
export interface UpdateTaskBody {
    name?: string;
    description?: string | null;
    status_id?: string;
    task_type_id?: string;
    priority?: number;
    is_milestone?: boolean;
    custom_id?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    recurrence_pattern?: string;
    recurrence_days?: string[] | null;
    recurrence_ends_at?: string | null;
    time_estimate_seconds?: number | null;
    sprint_id?: string | null;
    story_points?: number | null;
    reviewer_id?: string | null;
    branch_name?: string | null;
    pr_url?: string | null;
    pr_status?: string | null;
    bug_severity?: string | null;
    bug_reproducibility?: string | null;
    bug_environment?: string | null;
    bug_browser?: string | null;
    reporter_team?: string | null;
    deployed_at?: string | null;
    rollback_reason?: string | null;
}

export interface UpdateTaskRequest extends AuthRequest {
    body: UpdateTaskBody;
}

/**
 * Authenticated request for `DELETE /api/v1/tasks/:id/assignees/:userId`.
 * Identity comes from `authenticate` (`req.auth`); the task id and the assignee
 * to remove are path params (`req.params.id` / `req.params.userId`). No body.
 */
export type RemoveAssigneeRequest = AuthRequest;

/**
 * Authenticated request for `POST /api/v1/tasks/:id/watchers/self`. The watcher
 * is always the caller (`req.auth.sub`); the task id is a path param. No body.
 * `DELETE /api/v1/tasks/:id/watchers/self` (unwatch) reuses this same shape.
 */
export type WatchSelfRequest = AuthRequest;

/**
 * `POST /api/v1/tasks/:id/tags` body. Either a single `tag_id` or a `tag_ids`
 * array (bulk) — the validator guarantees at least one is present and
 * well-typed; the controller normalises them into one deduped list.
 */
export interface AddTagsBody {
    tag_id?: string;
    tag_ids?: string[];
}

/**
 * Authenticated request for `POST /api/v1/tasks/:id/tags`. Identity comes from
 * the `authenticate` middleware (`req.auth`); the task id is a path param.
 */
export interface AddTagsRequest extends AuthRequest {
    body: AddTagsBody;
}

/**
 * Authenticated request for `DELETE /api/v1/tasks/:id/tags/:tagId`. Identity
 * comes from `authenticate` (`req.auth`); the task id and the tag to remove are
 * path params (`req.params.id` / `req.params.tagId`). No body.
 */
export type RemoveTagRequest = AuthRequest;
