import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { UserService } from "../services/UserService";
import { AppError } from "../errors";
import { toWireUser } from "../serializers/userSerializer";
import type { AuthRequest } from "../types";
import type {
    InviteUserRequest,
    UpdateUserRequest,
    ChangeRoleRequest,
} from "../types/users";
import type { ProfilePatch } from "../services/UserService";
import type { Role } from "../constants";
import type { UserStatus } from "../repositories/UsersRepo";

/**
 * §4 Users HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/** Validated, sanitized subset of the query string (see `listUsersValidator`). */
interface ListUsersQuery {
    status?: UserStatus;
    role?: Role;
    q?: string;
    cursor?: string;
    limit?: number;
}

export class UserController {
    constructor(
        private userService: UserService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/users — paginated list of the workspace's members.
     *
     * Workspace-scoped: the workspace id comes from the verified access token
     * (`req.auth.workspaceId`), never from client input. Supports ?status,
     * ?role, ?q filters + opaque cursor pagination (keyset on `id`, since
     * `users` has no `internal_id`).
     */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { status, role, q, cursor, limit }: ListUsersQuery =
                matchedData(req, { locations: ["query"] });

            const result = await this.userService.listUsers({
                workspaceId: req.auth.workspaceId,
                status,
                role,
                q,
                cursor,
                limit,
            });

            this.logger.debug("users.list.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                count: result.rows.length,
            });

            res.status(200).json({
                data: result.rows.map(toWireUser),
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/users/:id — read a single workspace member.
     *
     * Workspace-scoped: the service filters by `req.auth.workspaceId`, so an id
     * from another workspace returns 404 `user.not_found` (no cross-tenant read,
     * never a 403). Any authenticated member may read any member — §4 gates only
     * invite / role / status changes behind admin. Returns the bare Appendix-A
     * `User` (no list envelope), mirroring `GET /auth/me`.
     */
    async get(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id }: { id: string } = matchedData(req, {
                locations: ["params"],
            });

            const user = await this.userService.getUser({
                workspaceId: req.auth.workspaceId,
                userId: id,
            });

            this.logger.debug("users.get.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                userId: id,
            });

            res.status(200).json(toWireUser(user));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/users/invite — invite a person to the workspace (👑
     * admin/owner; the role gate runs in the route's `canAccess` middleware).
     *
     * Identity is taken from the verified access token (`req.auth`), never the
     * body — so the invite always lands in the caller's own workspace and
     * `invited_by` cannot be spoofed. Only the four validated fields are read
     * from the body (the validator trimmed the names and lowercased the email),
     * so stray fields such as `status` or `id` are ignored, not persisted.
     * Returns the new `User` (status `invited`) as a bare object per the spec's
     * single-resource shape; the raw invite token is emailed, never returned.
     */
    async invite(req: InviteUserRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const { first_name, last_name, email, role } = req.body;

            const user = await this.userService.invite({
                workspaceId,
                actorId,
                firstName: first_name,
                lastName: last_name,
                email,
                role,
            });

            this.logger.info("users.invite.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                userId: user.id,
            });

            res.status(201).json(toWireUser(user));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/users/:id — update a member's profile fields.
     *
     * The self-or-admin authorization and tenant scoping live in the service.
     * Only the validated, sanitized profile fields are forwarded (names trimmed,
     * email lowercased); `role` / `status` are not accepted, so a stray key can
     * never escalate privilege or lifecycle. At least one field must be present
     * — an empty patch is a 422 `validation.failed`, not a silent no-op write.
     * `avatar_url: null` is honoured (clears the avatar).
     */
    async update(req: UpdateUserRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };
            const data = matchedData(req, {
                locations: ["body"],
            }) as Partial<{
                first_name: string;
                last_name: string;
                email: string;
                timezone: string;
                avatar_url: string | null;
            }>;

            const patch: ProfilePatch = {};
            if (data.first_name !== undefined) patch.firstName = data.first_name;
            if (data.last_name !== undefined) patch.lastName = data.last_name;
            if (data.email !== undefined) patch.email = data.email;
            if (data.timezone !== undefined) patch.timezone = data.timezone;
            if (data.avatar_url !== undefined) patch.avatarUrl = data.avatar_url;

            if (Object.keys(patch).length === 0) {
                throw AppError.validationFailed([
                    {
                        issue: "Provide at least one field to update: first_name, last_name, email, timezone, or avatar_url",
                    },
                ]);
            }

            const user = await this.userService.updateProfile({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
                userId: id,
                patch,
            });

            this.logger.info("users.update.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
                fields: Object.keys(patch),
            });

            res.status(200).json(toWireUser(user));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/users/:id/role — promote / demote a member.
     *
     * The coarse 👑 admin/owner gate runs in the route's `canAccess`; the
     * row-level rules (owner's role is immutable here; you cannot change your
     * own role) and the workspace scoping live in the service. The validator has
     * already constrained `role` to `admin|member|guest`, so `owner` can never
     * be assigned. Returns the updated `User`.
     */
    async changeRole(req: ChangeRoleRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };
            const { role } = matchedData(req, { locations: ["body"] }) as {
                role: "admin" | "member" | "guest";
            };

            const user = await this.userService.changeRole({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
                newRole: role,
            });

            this.logger.info("users.role.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
                role,
            });

            res.status(200).json(toWireUser(user));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/users/:id/deactivate — disable a member's account.
     *
     * The coarse 👑 admin/owner gate runs in the route's `canAccess`; the
     * row-level rules (owner cannot be deactivated; cannot deactivate self),
     * tenant scoping, the status flip + session revoke (one transaction), and
     * the audit row all live in the service. Returns 204 with no body.
     */
    async deactivate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };

            await this.userService.deactivate({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            this.logger.info("users.deactivate.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/users/:id/reactivate — re-enable a deactivated member.
     *
     * The coarse 👑 admin/owner gate runs in the route's `canAccess`; the row
     * rules (cannot reactivate self; a pending invite is not reactivatable),
     * tenant scoping, the status flip, and the audit row live in the service.
     * Returns 204 with no body.
     */
    async reactivate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };

            await this.userService.reactivate({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            this.logger.info("users.reactivate.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/users/:id/reset-password — admin-initiated password reset.
     *
     * The coarse 👑 admin/owner gate runs in the route's `canAccess`; the
     * active-only rule, tenant scoping, token mint, audit row, and best-effort
     * email all live in the service (reusing the §2 forgot-password contract).
     * Returns 202 with an empty body (mirrors `POST /auth/forgot-password`); the
     * raw token is emailed, never returned.
     */
    async resetPassword(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };

            await this.userService.resetPassword({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            this.logger.info("users.reset_password.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                userId: id,
            });

            res.status(202).json({});
        } catch (err) {
            next(err);
        }
    }
}
