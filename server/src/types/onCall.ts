import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §21 On-call.
 *
 * Body for `PUT /api/v1/on-call/:weekStart`: assigns `engineer_id` to the
 * Monday-keyed week in the path (idempotent upsert). The validator has trimmed
 * `engineer_id` and bounded its length; `:weekStart` is validated as a
 * `YYYY-MM-DD` Monday by `setOnCallValidator`.
 */
export interface SetOnCallBody {
    engineer_id: string;
}

export interface SetOnCallRequest extends AuthRequest {
    body: SetOnCallBody;
}
