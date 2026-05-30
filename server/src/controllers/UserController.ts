import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { UserService } from "../services/UserService";
import { toWireUser } from "../serializers/userSerializer";
import type { AuthRequest } from "../types";
import type { InviteUserRequest } from "../types/users";
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
}
