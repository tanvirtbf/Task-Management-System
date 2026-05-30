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
 * Authenticated request for `DELETE /api/v1/tasks/:id/assignees/:userId`.
 * Identity comes from `authenticate` (`req.auth`); the task id and the assignee
 * to remove are path params (`req.params.id` / `req.params.userId`). No body.
 */
export type RemoveAssigneeRequest = AuthRequest;

/**
 * Authenticated request for `POST /api/v1/tasks/:id/watchers/self`. The watcher
 * is always the caller (`req.auth.sub`); the task id is a path param. No body.
 */
export type WatchSelfRequest = AuthRequest;
