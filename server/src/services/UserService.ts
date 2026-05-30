import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { Config } from "../config";
import { AppError } from "../errors";
import { fakeId, randomToken, sha256 } from "../utils";
import type { Role } from "../constants";
import type {
    UsersRepo,
    UserListRow,
    UserStatus,
} from "../repositories/UsersRepo";
import type { InvitationsRepo } from "../repositories/InvitationsRepo";
import type { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import type { MailService } from "./MailService";

/**
 * §4 Users domain logic. The read paths (`list`, `getUser`) delegate straight
 * to the repository; `invite` owns the transaction that pairs the invited-user
 * row with its `invitations` token and `workspace_activity` audit row.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/** Invitations are valid for 7 days (spec is silent; reset tokens are ≤30 min). */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `password_hash` is NOT NULL but an invited user has no password until they
 * accept (§2 #10 sets it). Login gates on `status === 'active'` BEFORE any
 * bcrypt compare, so this sentinel is never verified; an empty string keeps the
 * column satisfied without minting a throwaway bcrypt hash on every invite.
 */
const INVITED_PLACEHOLDER_HASH = "";

/** mysql2 surfaces a unique-violation as `ER_DUP_ENTRY` / errno 1062. */
interface MySqlError {
    code?: string;
    errno?: number;
}

const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as MySqlError | null;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};

export interface ListUsersInput {
    workspaceId: string;
    status?: UserStatus;
    role?: Role;
    q?: string;
    cursor?: string;
    limit?: number;
}

export interface ListUsersResult {
    rows: UserListRow[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
}

export interface GetUserInput {
    workspaceId: string;
    userId: string;
}

export interface InviteUserInput {
    workspaceId: string;
    /** The inviting owner/admin (`req.auth.sub`) — recorded as `invited_by`. */
    actorId: string;
    firstName: string;
    lastName: string;
    /** Already lowercased + format-checked by the validator. */
    email: string;
    role: "admin" | "member" | "guest";
}

export class UserService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private users: UsersRepo,
        private invitations: InvitationsRepo,
        private activity: WorkspaceActivityRepo,
        private mail: MailService,
        private logger: Logger,
    ) {}

    /**
     * Read a single member of `workspaceId` by id (`GET /api/v1/users/:id`).
     *
     * Workspace-scoped at the query level: an id outside the caller's workspace
     * resolves to `null` and surfaces as 404 `user.not_found` — never a 403 and
     * never a cross-tenant read. Returns regardless of `status` (an `invited` or
     * `deactivated` member is still a readable profile); the optional status
     * filter belongs to the list endpoint, not the by-id read.
     */
    async getUser(input: GetUserInput): Promise<UserListRow> {
        const user = await this.users.findByIdInWorkspace(
            input.userId,
            input.workspaceId,
        );
        if (!user) {
            throw AppError.notFound(
                "user.not_found",
                `User ${input.userId} does not exist`,
            );
        }
        return user;
    }

    /**
     * Invite a person to the caller's workspace (`POST /api/v1/users/invite`,
     * 👑 admin/owner — the role gate runs in the route's `canAccess`).
     *
     * Creates a pending `users` row (`status: 'invited'`, no password yet), an
     * `invitations` token row, and a `workspace_activity` audit row in ONE
     * transaction (all-or-nothing). The `invitations` table has no name columns,
     * so the names live on the user row from the start; the §2 accept flow later
     * sets the password and flips the same row to `active`.
     *
     * Email is treated as globally unique (the app-wide invariant `findByEmail`
     * relies on): a pre-check yields a friendly 409, and the per-workspace
     * `uq_users_workspace_email` index is the race-free backstop, also mapped to
     * 409. `workspace_id` and `invited_by` come from `req.auth`, never the body,
     * so this can never touch another tenant. The invite email carries the raw
     * token and is sent best-effort AFTER commit — a mail hiccup must not roll
     * back a persisted invitation (the admin can resend).
     */
    async invite(input: InviteUserInput): Promise<UserListRow> {
        // 1. Friendly duplicate check before any write (global, case-insensitive).
        const existing = await this.users.findByEmail(input.email);
        if (existing) {
            throw AppError.conflict(
                "user.email_already_exists",
                `A user with email ${input.email} already exists`,
            );
        }

        // 2. Mint ids + the single-use invite token. Only `sha256(token)` is
        //    persisted; the raw token lives only in the emailed link.
        const userId = fakeId("u");
        const invitationId = fakeId("inv");
        const rawToken = randomToken();
        const tokenHash = sha256(rawToken);
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

        // 3. Atomic: invited user + invitation + activity. A duplicate email
        //    racing two invites trips `uq_users_workspace_email` → 409.
        try {
            await this.db.transaction(async (tx) => {
                await this.users.create(
                    {
                        id: userId,
                        workspaceId: input.workspaceId,
                        firstName: input.firstName,
                        lastName: input.lastName,
                        email: input.email,
                        passwordHash: INVITED_PLACEHOLDER_HASH,
                        role: input.role,
                        status: "invited",
                    },
                    tx,
                );
                await this.invitations.create(
                    {
                        id: invitationId,
                        workspaceId: input.workspaceId,
                        email: input.email,
                        role: input.role,
                        tokenHash,
                        invitedBy: input.actorId,
                        expiresAt,
                    },
                    tx,
                );
                await this.activity.record(
                    {
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "user",
                        entityId: userId,
                        action: "invited",
                        context: {
                            email: input.email,
                            role: input.role,
                            invitation_id: invitationId,
                        },
                    },
                    tx,
                );
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "user.email_already_exists",
                    `A user with email ${input.email} already exists`,
                );
            }
            throw err;
        }

        // 4. Re-read the committed row so the response carries the authoritative
        //    DB `created_at` (same shape the list / by-id reads return).
        const created = await this.users.findByIdInWorkspace(
            userId,
            input.workspaceId,
        );
        if (!created) {
            // Just committed; absence would mean a concurrent hard-delete, which
            // V1 never does. Surface as an internal inconsistency, not a 404.
            throw AppError.internal(
                "Invited user could not be loaded after creation",
            );
        }

        // 5. Best-effort invite email (after commit). A failure never undoes the
        //    invitation — log and return 201.
        const acceptUrl = `${Config.FRONTEND_URL ?? ""}/invitation/${rawToken}`;
        try {
            await this.mail.sendInvitation(input.email, acceptUrl);
        } catch (err: unknown) {
            this.logger.warn("users.invite.email_failed", {
                userId,
                email: input.email,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return created;
    }

    async listUsers(input: ListUsersInput): Promise<ListUsersResult> {
        const limit = clampLimit(input.limit);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const afterId = input.cursor ? decodeCursor(input.cursor) : undefined;

        const filters = {
            workspaceId: input.workspaceId,
            status: input.status,
            role: input.role,
            q: input.q,
        };

        // Fetch one row beyond `limit` so `has_more` needs no extra round-trip;
        // the exact count runs concurrently.
        const [rows, total] = await Promise.all([
            this.users.listByWorkspace({
                ...filters,
                afterId,
                limit: limit + 1,
            }),
            this.users.countByWorkspace(filters),
        ]);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(last.id) : null;

        return { rows: page, nextCursor, hasMore, total };
    }
}

/** Apply the spec's users pagination window: default 100, max 200, min 1. */
const clampLimit = (raw?: number): number => {
    if (raw === undefined) return DEFAULT_LIMIT;
    if (raw < 1) return 1;
    if (raw > MAX_LIMIT) return MAX_LIMIT;
    return Math.floor(raw);
};

// Opaque cursor codec. Kept local to the service because `users` is the first
// (and, so far, only) cursor-paginated list and the codebase has no shared
// pagination helper; lift this into a shared util when a second one appears.
const encodeCursor = (value: string): string =>
    Buffer.from(value, "utf8").toString("base64url");

/**
 * Decode an opaque cursor to its keyset value. A malformed cursor is a bad
 * request *parameter* (400 `pagination.invalid_cursor`), not a 422 — the client
 * cannot "fix" an opaque token, only drop it and restart paging.
 */
const decodeCursor = (cursor: string): string => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (decoded.length === 0) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    return decoded;
};
