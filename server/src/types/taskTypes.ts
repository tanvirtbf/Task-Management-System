import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §8 Task types.
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

/**
 * Validated body of `POST /api/v1/task-types`. Every field has already been
 * sanitised by `createTaskTypeValidator` (strings trimmed, booleans confirmed
 * real JSON booleans); the optional fields are `undefined` — never `null` —
 * when the client omits them, so the repo can let the column DEFAULT apply.
 *
 * Note the absence of `is_system`, `position`, `id`, and `workspace_id`: those
 * are server-owned and are deliberately NOT read off the body (mass-assignment
 * guard).
 */
export interface CreateTaskTypeBody {
    name: string;
    icon?: string;
    color?: string;
    is_milestone_type?: boolean;
    is_dev_type?: boolean;
    description?: string;
}

/**
 * `POST /api/v1/task-types`. The workspace to create in and the acting user
 * both come from `req.auth` (set by `authenticate`); the payload is `req.body`.
 */
export interface CreateTaskTypeRequest extends AuthRequest {
    body: CreateTaskTypeBody;
}

/**
 * Validated body of `PATCH /api/v1/task-types/:id`. Every field is optional —
 * the controller builds a patch from only the keys actually present, so an
 * absent field is left untouched. `description` is the one tri-state field:
 * `undefined` (absent) leaves it unchanged, while `null` or a blank string
 * clears it to NULL.
 *
 * As with create, `is_system`, `position`, `id`, and `workspace_id` are NOT
 * accepted — they are server-owned (mass-assignment guard).
 */
export interface UpdateTaskTypeBody {
    name?: string;
    icon?: string;
    color?: string;
    is_milestone_type?: boolean;
    is_dev_type?: boolean;
    description?: string | null;
}

/**
 * `PATCH /api/v1/task-types/:id`. The workspace and acting user come from
 * `req.auth`; the target id is `req.params.id` and the payload is `req.body`.
 */
export interface UpdateTaskTypeRequest extends AuthRequest {
    body: UpdateTaskTypeBody;
}
