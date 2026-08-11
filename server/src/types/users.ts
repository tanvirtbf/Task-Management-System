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
    /** Team-access P1 (B3): the team the person is invited into. */
    space_id?: string | null;
}

export interface InviteUserRequest extends AuthRequest {
    body: InviteUserBody;
}

/**
 * Body for `PATCH /api/v1/users/:id`. Every field is optional (a partial
 * update); the validator trims the names, lowercases the email, and caps every
 * length. `role` / `status` are intentionally absent — a profile edit can never
 * change privilege or lifecycle (those are §4 #5 / #6 / #7), so a stray `role`
 * in the body is ignored, not persisted. `avatar_url` may be an http(s) URL or
 * `null` (to clear it).
 */
export interface UpdateUserBody {
    first_name?: string;
    last_name?: string;
    email?: string;
    timezone?: string;
    avatar_url?: string | null;
}

export interface UpdateUserRequest extends AuthRequest {
    body: UpdateUserBody;
}

/**
 * Body for `PATCH /api/v1/users/:id/role`. `owner` is NOT an accepted value —
 * the validator constrains it to the invitation set, so this endpoint can never
 * mint a second workspace owner (there is exactly one: the creator).
 */
export interface ChangeRoleBody {
    role: "admin" | "member" | "guest";
}

export interface ChangeRoleRequest extends AuthRequest {
    body: ChangeRoleBody;
}
