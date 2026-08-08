import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §6 Lists.
 *
 * `GET /spaces/:spaceId/lists` reads `:spaceId` from the (merged) route params
 * and `workspaceId` from `req.auth`; the optional `include_archived` query flag
 * is validated by `listBySpaceValidator`. The request therefore carries no body
 * fields — it is aliased to `AuthRequest` for typing parallelism with the auth
 * feature's request types.
 */
export type ListBySpaceRequest = AuthRequest;

/**
 * `GET /api/v1/lists` reads `workspaceId` from `req.auth` and the optional
 * `space_id` / `include_archived` query flags (validated by `listAllValidator`).
 * It carries no body fields, so — like `ListBySpaceRequest` — it is aliased to
 * `AuthRequest`.
 */
export type ListAllRequest = AuthRequest;

/**
 * `GET /api/v1/lists/:id` reads `:id` from the route params and `workspaceId`
 * from `req.auth` (validated by `getListValidator`). It carries no body fields,
 * so — like the other §6 read requests — it is aliased to `AuthRequest`.
 */
export type GetListRequest = AuthRequest;

/**
 * Body for `POST /api/v1/lists`. `space_id` + `name` are required; the rest are
 * optional and the controller applies the schema defaults (`icon` →
 * `ListChecks`, `color` → `#4F46E5`, `is_private` → `false`,
 * `default_task_type_id` → `null`) when omitted. `createListValidator` has
 * already trimmed the strings, enforced lengths / the hex-colour format, and
 * type-checked `is_private`. `position` / `created_by` / `workspace_id` are
 * never read from the body — position appends server-side and identity comes
 * from `req.auth`.
 */
export interface CreateListBody {
    space_id: string;
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    /** A task-type id, or explicit `null` to leave the list with no default. */
    default_task_type_id?: string | null;
    is_private?: boolean;
}

export interface CreateListRequest extends AuthRequest {
    body: CreateListBody;
}

/**
 * Body for `PATCH /api/v1/lists/:id`. Every field is optional; the controller
 * enforces that at least one is present (422 otherwise). `description` and
 * `default_task_type_id` accept an explicit `null` to clear the field.
 * `space_id` / `is_private` / `position` are NOT patchable here (§6 PATCH covers
 * name / description / icon / color / default task type only).
 */
export interface UpdateListBody {
    name?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    default_task_type_id?: string | null;
    /**
     * F28 (ISS-036, D12.7) — move the list to another space. Never nullable: a
     * list always belongs to a space. `is_private` stays absent by design.
     */
    space_id?: string;
}

export interface UpdateListRequest extends AuthRequest {
    body: UpdateListBody;
}

/**
 * `POST /api/v1/lists/:id/archive` and `.../unarchive`. Both read only the `:id`
 * path param (validated by `getListValidator`) and the identity from `req.auth`;
 * they carry no body, so — like the read requests — they alias `AuthRequest`.
 */
export type ArchiveListRequest = AuthRequest;
export type UnarchiveListRequest = AuthRequest;

/**
 * `DELETE /api/v1/lists/:id` (hard delete). Reads only the `:id` path param
 * (validated by `getListValidator`) and the identity from `req.auth`; no body,
 * so it aliases `AuthRequest`.
 */
export type DeleteListRequest = AuthRequest;
