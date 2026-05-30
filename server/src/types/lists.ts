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
