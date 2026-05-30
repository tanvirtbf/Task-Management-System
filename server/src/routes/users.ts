import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { UserController } from "../controllers/UserController";
import { UserService } from "../services/UserService";
import { UsersRepo } from "../repositories/UsersRepo";
import { InvitationsRepo } from "../repositories/InvitationsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { MailService } from "../services/MailService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import {
    listUsersValidator,
    getUserValidator,
    inviteUserValidator,
} from "../validators/users";
import { Roles } from "../constants";
import type { AuthRequest } from "../types";
import type { InviteUserRequest } from "../types/users";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const usersRepo = new UsersRepo(db);
const invitationsRepo = new InvitationsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const mailService = new MailService(logger);
const userService = new UserService(
    db,
    usersRepo,
    invitationsRepo,
    workspaceActivityRepo,
    mailService,
    logger,
);
const userController = new UserController(userService, logger);

// ─── GET /api/v1/users ───────────────────────────────────────────────────────
// Authenticated (any workspace member). Workspace-scoped via
// `req.auth.workspaceId`; supports ?status / ?role / ?q filters + opaque cursor
// pagination (keyset on `id`). The v1-level `apiLimiter` (600/min/user) applies.
router.get(
    "/",
    authenticate,
    listUsersValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/users/invite ─────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `canAccess` (403) → validation (422). Workspace scope
// and the inviting actor come from `req.auth`, never the body. Creates a pending
// `users` row (status `invited`) + an `invitations` token + a `workspace_activity`
// row in one transaction, then emails the accept link. Declared before `/:id` so
// the literal path is never captured by the param route.
router.post(
    "/invite",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    inviteUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.invite(req as InviteUserRequest, res, next),
);

// ─── GET /api/v1/users/:id ─────────────────────────────────────────────────
// Authenticated (any workspace member). Workspace-scoped via
// `req.auth.workspaceId`: an id outside the caller's workspace resolves to 404
// `user.not_found`, never a cross-tenant read. Returns the bare Appendix-A
// `User`. Registered after `GET /` and before any future static `/users/<word>`
// GET route, so the `:id` param does not shadow them.
router.get(
    "/:id",
    authenticate,
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.get(req as AuthRequest, res, next),
);

export default router;
