import type { AuthRequest } from "./index";

/**
 * §29 SLA management — endpoint request shapes.
 */

/**
 * `GET /api/v1/sla/breached` — identity from `req.auth` + optional
 * `?team=` / `?severity=` query filters (parsed in the controller).
 */
export type ListBreachedRequest = AuthRequest;

/** Body for `PATCH /api/v1/tasks/:id/sla`. ISO-8601 string to set, null to clear. */
export interface OverrideSlaBody {
    sla_due_at: string | null;
}

export interface OverrideSlaRequest extends AuthRequest {
    body: OverrideSlaBody;
}
