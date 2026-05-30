import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §12 Task dependencies.
 *
 * `GET /api/v1/tasks/:id/dependencies` and `DELETE /api/v1/task-dependencies/:id`
 * read only the `:id` path param + identity from `req.auth`, so they alias
 * `AuthRequest`.
 */
export type GetDependenciesRequest = AuthRequest;
export type DeleteDependencyRequest = AuthRequest;

/**
 * Body for `POST /api/v1/task-dependencies`. `task_id` blocks `related_task_id`.
 * `type` is optional and, when present, must be `"blocks"` (V1's only stored
 * `dep_type`); the server always creates a `blocks` edge. The validator has
 * trimmed the ids and bounded their length.
 */
export interface CreateDependencyBody {
    task_id: string;
    related_task_id: string;
    type?: "blocks";
}

export interface CreateDependencyRequest extends AuthRequest {
    body: CreateDependencyBody;
}
