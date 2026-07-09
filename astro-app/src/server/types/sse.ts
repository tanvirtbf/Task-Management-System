import type { AuthRequest } from "./index";

/**
 * §27 SSE request shape. `GET /api/v1/stream/inbox` reads only the caller's
 * identity from `req.auth` (the owning user is always `req.auth.sub`, never
 * client input) plus the `Last-Event-Id` header / `?last_event_id` query for
 * resume, so it aliases `AuthRequest`.
 */
export type StreamInboxRequest = AuthRequest;
