import type { AuthRequest } from "./index";
import type { statusGroups } from "../db/schema/_shared";

/**
 * Endpoint-specific request shapes for §7 Statuses.
 *
 * `GET /lists/:listId/statuses` reads `:listId` from the route params and
 * `workspaceId` from `req.auth`; it carries no body or query fields, so it is
 * aliased to `AuthRequest` for typing parallelism with the other feature
 * request types (see `types/lists.ts`).
 */
export type ListStatusesRequest = AuthRequest;

/** Allowed `status_group` values — mirrors the DB enum. */
export type StatusGroupValue = (typeof statusGroups)[number];

/**
 * `POST /api/v1/lists/:listId/statuses` body. `name` + `status_group` are
 * required (the validator guarantees this); `color` / `position` are optional.
 * `scope_type` / `scope_id` are NOT client input — the service pins them to the
 * `:listId` path param.
 */
export interface CreateStatusBody {
    name: string;
    status_group: StatusGroupValue;
    color?: string;
    position?: number;
}

/**
 * Authenticated request for `POST /api/v1/lists/:listId/statuses`. The list id is
 * a path param; identity and workspace scope come from `req.auth`.
 */
export interface CreateStatusRequest extends AuthRequest {
    body: CreateStatusBody;
}

/**
 * `PATCH /api/v1/statuses/:id` body. All fields are optional; the controller
 * guarantees at least one of `name` / `color` / `status_group` is present.
 * `scope_type` / `scope_id` / `position` are not editable here.
 */
export interface UpdateStatusBody {
    name?: string;
    color?: string;
    status_group?: StatusGroupValue;
}

/**
 * Authenticated request for `PATCH /api/v1/statuses/:id`. The status id is a path
 * param; identity and workspace scope come from `req.auth`.
 */
export interface UpdateStatusRequest extends AuthRequest {
    body: UpdateStatusBody;
}

/**
 * Authenticated request for `DELETE /api/v1/statuses/:id`. The status id is a
 * path param; there is no body. Identity and workspace scope come from
 * `req.auth`. Aliased to `AuthRequest` for typing parallelism with the other §7
 * request shapes.
 */
export type DeleteStatusRequest = AuthRequest;

/**
 * Authenticated request for `PATCH /api/v1/lists/:listId/statuses/reorder`. The
 * list id is a path param; the body is a bare JSON array of `{ id, position }`
 * items (validated/normalised in the controller). Identity and workspace scope
 * come from `req.auth`. Typed as `AuthRequest` because the body is a top-level
 * array, not an object literal.
 */
export type ReorderStatusesRequest = AuthRequest;
