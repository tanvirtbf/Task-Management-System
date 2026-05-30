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
import { TokenService } from "../services/TokenService";
import { PasswordResetTokensRepo } from "../repositories/PasswordResetTokensRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import {
    listUsersValidator,
    getUserValidator,
    inviteUserValidator,
    patchUserValidator,
    changeRoleValidator,
} from "../validators/users";
import { Roles } from "../constants";
import type { AuthRequest } from "../types";
import type {
    InviteUserRequest,
    UpdateUserRequest,
    ChangeRoleRequest,
} from "../types/users";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const usersRepo = new UsersRepo(db);
const invitationsRepo = new InvitationsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const mailService = new MailService(logger);
const tokenService = new TokenService(db);
const passwordResetTokensRepo = new PasswordResetTokensRepo(db);
const userService = new UserService(
    db,
    usersRepo,
    invitationsRepo,
    workspaceActivityRepo,
    mailService,
    tokenService,
    passwordResetTokensRepo,
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

// ─── PATCH /api/v1/users/:id/role ──────────────────────────────────────────
// 👑 admin/owner. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `canAccess` (403 `auth.forbidden`) → validation (422,
// where `role: "owner"` is rejected). The row-level rules (the owner's role is
// immutable here; a caller cannot change their own role) are enforced in the
// service as 403s. Declared before `PATCH /:id` so the more specific two-segment
// path is registered first (defensive — the segment counts already differ).
router.patch(
    "/:id/role",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    changeRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.changeRole(req as ChangeRoleRequest, res, next),
);

// ─── PATCH /api/v1/users/:id ───────────────────────────────────────────────
// 🔐 self / 👑 admin. Deliberately NO `canAccess`: a member may edit their OWN
// profile, so the rule is row-dependent ("self OR owner/admin") and enforced in
// the service — a member editing someone else → 403 `user.forbidden_edit`; a
// cross-workspace id → 404 `user.not_found`. Partial body: any of first_name,
// last_name, email, timezone, avatar_url. `role` / `status` are not accepted, so
// a profile edit can never escalate privilege or lifecycle.
router.patch(
    "/:id",
    authenticate,
    patchUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.update(req as UpdateUserRequest, res, next),
);

// ─── POST /api/v1/users/:id/deactivate ─────────────────────────────────────
// 👑 admin/owner. `authenticate` (401) → `canAccess` (403) → id-param validation
// (422). Reuses `getUserValidator` (a pure user-id param check). The row rules
// (owner cannot be deactivated; cannot deactivate self) are 403s in the service,
// which also flips `status` and revokes every refresh session in one
// transaction. Returns 204.
router.post(
    "/:id/deactivate",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.deactivate(req as AuthRequest, res, next),
);

// ─── POST /api/v1/users/:id/reactivate ─────────────────────────────────────
// 👑 admin/owner. The inverse of deactivate. Same chain + `getUserValidator`.
// Row rules (cannot reactivate self; a pending invite is not reactivatable) are
// enforced in the service. Returns 204.
router.post(
    "/:id/reactivate",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.reactivate(req as AuthRequest, res, next),
);

// ─── POST /api/v1/users/:id/reset-password ─────────────────────────────────
// 👑 admin/owner. Same chain + `getUserValidator`. The active-only rule and the
// §2 forgot-password token mint + email live in the service. Returns 202.
router.post(
    "/:id/reset-password",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.resetPassword(req as AuthRequest, res, next),
);

export default router;
