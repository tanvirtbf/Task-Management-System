import type { Role } from "../constants";
import type { UserStatus } from "../repositories/UsersRepo";

/**
 * Wire-format `User` per API_DESIGN.md Appendix A. snake_case fields; never
 * leaks `password_hash`, `workspace_id`, or `updated_at`. Single source for the
 * `User` response shape, shared by the auth and users endpoints.
 */
export interface WireUser {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: Role;
    avatar_url: string | null;
    status: UserStatus;
    timezone: string;
    created_at: string;
    last_login_at: string | null;
}

/**
 * The camelCase source fields `toWireUser` reads. Both the full `UserRecord`
 * (auth flow) and the narrower list-row projection satisfy this structurally.
 */
export interface WireUserSource {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
    avatarUrl: string | null;
    status: UserStatus;
    timezone: string;
    createdAt: Date;
    lastLoginAt: Date | null;
}

export const toWireUser = (u: WireUserSource): WireUser => ({
    id: u.id,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    role: u.role,
    avatar_url: u.avatarUrl,
    status: u.status,
    timezone: u.timezone,
    created_at: u.createdAt.toISOString(),
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});
