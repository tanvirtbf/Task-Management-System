import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the Workspace-activity family (§26).
 *
 * Both endpoints are authenticated and workspace-scoped: the workspace id comes
 * from `req.auth.workspaceId` (verified JWT claim), never client input. Filters
 * / cursor / limit arrive as validated query params.
 */

/** `GET /api/v1/activity/recent` — `?limit`. Identity/scope from `req.auth`. */
export type RecentActivityRequest = AuthRequest;

/**
 * `GET /api/v1/activity` — `?entity_type` / `?actor_id` / `?from` / `?to` /
 * `?cursor` / `?limit`. Identity/scope from `req.auth`.
 */
export type ActivityFeedRequest = AuthRequest;
