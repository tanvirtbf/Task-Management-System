import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §5 Spaces.
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

/**
 * `GET /api/v1/spaces`. Identity — and the workspace to scope by — is
 * established by the `authenticate` middleware, which decorates the request
 * with `req.auth`. The only input is the optional `?include_archived` query
 * flag, read off `req.query` in the controller.
 */
export type ListSpacesRequest = AuthRequest;

/**
 * `GET /api/v1/spaces/:id`. Like the list endpoint the workspace scope comes
 * from `req.auth`; the only input is the `:id` path param, read off
 * `req.params` in the controller (validated by `getSpaceValidator`).
 */
export type GetSpaceRequest = AuthRequest;

/**
 * Body for `POST /api/v1/spaces`. Only `name` is required; the controller
 * applies the schema defaults for the omitted fields. `createSpaceValidator`
 * has already trimmed the strings, enforced the lengths / hex-colour format and
 * range-checked `position`.
 */
export interface CreateSpaceBody {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    is_private?: boolean;
    position?: number;
}

export interface CreateSpaceRequest extends AuthRequest {
    body: CreateSpaceBody;
}

/**
 * Body for `PATCH /api/v1/spaces/:id`. Every field is optional — a partial
 * update. `updateSpaceValidator` has already trimmed strings, enforced the
 * lengths / hex-colour format and range-checked `position`. The `:id` path
 * param is read off `req.params` in the controller.
 */
export interface UpdateSpaceBody {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    is_private?: boolean;
    position?: number;
}

export interface UpdateSpaceRequest extends AuthRequest {
    body: UpdateSpaceBody;
}

/**
 * Request shape for the param-only space endpoints — `POST /:id/archive`,
 * `POST /:id/unarchive`, `DELETE /:id`. No body; the workspace scope comes from
 * `req.auth` and the only input is the `:id` path param (validated by
 * `spaceIdParamValidator`).
 */
export type SpaceIdRequest = AuthRequest;
