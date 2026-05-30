import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the Users resource family (§4).
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

/**
 * Body for `POST /api/v1/users/invite`. The validator has already trimmed the
 * names, lowercased + format-checked the email, and constrained `role` to the
 * invitation set (`owner` is never invitable). The controller reads only these
 * fields, so any stray body keys (`status`, `id`, …) are ignored, not persisted.
 */
export interface InviteUserBody {
    first_name: string;
    last_name: string;
    email: string;
    role: "admin" | "member" | "guest";
}

export interface InviteUserRequest extends AuthRequest {
    body: InviteUserBody;
}
