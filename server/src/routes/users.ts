import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { allowQuery } from "../middlewares/allowQuery";
import { UserController } from "../controllers/UserController";
import { UserService } from "../services/UserService";
import { UsersRepo } from "../repositories/UsersRepo";
import { InvitationsRepo } from "../repositories/InvitationsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { MailService } from "../services/MailService";
import { TokenService } from "../services/TokenService";
import { PasswordResetTokensRepo } from "../repositories/PasswordResetTokensRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    listUsersValidator,
    getUserValidator,
    inviteUserValidator,
    patchUserValidator,
    changeRoleValidator,
} from "../validators/users";
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
const spacesRepo = new SpacesRepo(db);
const userService = new UserService(
    db,
    usersRepo,
    invitationsRepo,
    workspaceActivityRepo,
    mailService,
    tokenService,
    passwordResetTokensRepo,
    spacesRepo,
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
    // F23 (ISS-014): a mistyped filter is a 422, not the full set.
    allowQuery(["status","role","q","cursor","limit"]),
    requirePermission("member.view"),
    listUsersValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/users/invite ─────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the inviting actor come from `req.auth`, never the body. Creates a pending
// `users` row (status `invited`) + an `invitations` token + a `workspace_activity`
// row in one transaction, then emails the accept link. Declared before `/:id` so
// the literal path is never captured by the param route.
router.post(
    "/invite",
    authenticate,
    requirePermission("member.invite"),
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
    requirePermission("member.view"),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.get(req as AuthRequest, res, next),
);

// ─── PATCH /api/v1/users/:id/role ──────────────────────────────────────────
// 👑 admin/owner. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403 `auth.forbidden`) → validation (422,
// where `role: "owner"` is rejected). The row-level rules (the owner's role is
// immutable here; a caller cannot change their own role) are enforced in the
// service as 403s. Declared before `PATCH /:id` so the more specific two-segment
// path is registered first (defensive — the segment counts already differ).
router.patch(
    "/:id/role",
    authenticate,
    requirePermission("member.role_change"),
    changeRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.changeRole(req as ChangeRoleRequest, res, next),
);

// ─── PATCH /api/v1/users/:id ───────────────────────────────────────────────
// 🔐 self / 👑 admin. Deliberately NO `requirePermission`: a member may edit their OWN
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
// 👑 admin/owner. `authenticate` (401) → `requirePermission` (403) → id-param validation
// (422). Reuses `getUserValidator` (a pure user-id param check). The row rules
// (owner cannot be deactivated; cannot deactivate self) are 403s in the service,
// which also flips `status` and revokes every refresh session in one
// transaction. Returns 204.
router.post(
    "/:id/deactivate",
    authenticate,
    requirePermission("member.deactivate"),
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
    requirePermission("member.deactivate"),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.reactivate(req as AuthRequest, res, next),
);

// ─── GET /api/v1/users/:id/deletion-preflight ──────────────────────────────
// 👑 admin/owner. Read-only: what a PERMANENT delete would hit. The UI calls it
// before offering the irreversible action, so the admin sees "3 tasks, 5
// comments — deactivate instead" in a dialog rather than as a 409 afterwards.
// Same chain + `getUserValidator`. 200 { deletable, reason, blockers, user }.
router.get(
    "/:id/deletion-preflight",
    authenticate,
    requirePermission("member.deactivate"),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.deletionPreflight(req as AuthRequest, res, next),
);

// ─── DELETE /api/v1/users/:id ──────────────────────────────────────────────
// 👑 owner/admin — the ONLY irreversible member action, for the "added by
// mistake" case. `member.deactivate` is the route key (the removal family);
// the service additionally requires a LIVE owner/admin legacy role, so a
// custom role carrying that key cannot delete people. It refuses (409
// `user.has_content`) the moment the person has created anything, and also
// guards the owner, self and the last admin. Everything personal (sessions,
// notifications, watches, assignments) goes with them by FK cascade; the
// audit row is written before the delete. Returns 204.
router.delete(
    "/:id",
    authenticate,
    requirePermission("member.deactivate"),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.hardDelete(req as AuthRequest, res, next),
);

// ─── POST /api/v1/users/:id/reset-password ─────────────────────────────────
// 👑 admin/owner. Same chain + `getUserValidator`. The active-only rule and the
// §2 forgot-password token mint + email live in the service. Returns 202.
router.post(
    "/:id/reset-password",
    authenticate,
    requirePermission("member.reset_password"),
    getUserValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        userController.resetPassword(req as AuthRequest, res, next),
);

export default router;
