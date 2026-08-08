"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const allowQuery_1 = require("../middlewares/allowQuery");
const UserController_1 = require("../controllers/UserController");
const UserService_1 = require("../services/UserService");
const UsersRepo_1 = require("../repositories/UsersRepo");
const InvitationsRepo_1 = require("../repositories/InvitationsRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const MailService_1 = require("../services/MailService");
const TokenService_1 = require("../services/TokenService");
const PasswordResetTokensRepo_1 = require("../repositories/PasswordResetTokensRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const users_1 = require("../validators/users");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const usersRepo = new UsersRepo_1.UsersRepo(db);
const invitationsRepo = new InvitationsRepo_1.InvitationsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const mailService = new MailService_1.MailService(logger_1.default);
const tokenService = new TokenService_1.TokenService(db);
const passwordResetTokensRepo = new PasswordResetTokensRepo_1.PasswordResetTokensRepo(db);
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const userService = new UserService_1.UserService(db, usersRepo, invitationsRepo, workspaceActivityRepo, mailService, tokenService, passwordResetTokensRepo, spacesRepo, logger_1.default);
const userController = new UserController_1.UserController(userService, logger_1.default);
// ─── GET /api/v1/users ───────────────────────────────────────────────────────
// Authenticated (any workspace member). Workspace-scoped via
// `req.auth.workspaceId`; supports ?status / ?role / ?q filters + opaque cursor
// pagination (keyset on `id`). The v1-level `apiLimiter` (600/min/user) applies.
router.get("/", authenticate_1.default, 
// F23 (ISS-014): a mistyped filter is a 422, not the full set.
(0, allowQuery_1.allowQuery)(["status", "role", "q", "cursor", "limit"]), (0, requirePermission_1.requirePermission)("member.view"), users_1.listUsersValidator, validate_1.validate, (req, res, next) => userController.list(req, res, next));
// ─── POST /api/v1/users/invite ─────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the inviting actor come from `req.auth`, never the body. Creates a pending
// `users` row (status `invited`) + an `invitations` token + a `workspace_activity`
// row in one transaction, then emails the accept link. Declared before `/:id` so
// the literal path is never captured by the param route.
router.post("/invite", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.invite"), users_1.inviteUserValidator, validate_1.validate, (req, res, next) => userController.invite(req, res, next));
// ─── GET /api/v1/users/:id ─────────────────────────────────────────────────
// Authenticated (any workspace member). Workspace-scoped via
// `req.auth.workspaceId`: an id outside the caller's workspace resolves to 404
// `user.not_found`, never a cross-tenant read. Returns the bare Appendix-A
// `User`. Registered after `GET /` and before any future static `/users/<word>`
// GET route, so the `:id` param does not shadow them.
router.get("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.view"), users_1.getUserValidator, validate_1.validate, (req, res, next) => userController.get(req, res, next));
// ─── PATCH /api/v1/users/:id/role ──────────────────────────────────────────
// 👑 admin/owner. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403 `auth.forbidden`) → validation (422,
// where `role: "owner"` is rejected). The row-level rules (the owner's role is
// immutable here; a caller cannot change their own role) are enforced in the
// service as 403s. Declared before `PATCH /:id` so the more specific two-segment
// path is registered first (defensive — the segment counts already differ).
router.patch("/:id/role", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.role_change"), users_1.changeRoleValidator, validate_1.validate, (req, res, next) => userController.changeRole(req, res, next));
// ─── PATCH /api/v1/users/:id ───────────────────────────────────────────────
// 🔐 self / 👑 admin. Deliberately NO `requirePermission`: a member may edit their OWN
// profile, so the rule is row-dependent ("self OR owner/admin") and enforced in
// the service — a member editing someone else → 403 `user.forbidden_edit`; a
// cross-workspace id → 404 `user.not_found`. Partial body: any of first_name,
// last_name, email, timezone, avatar_url. `role` / `status` are not accepted, so
// a profile edit can never escalate privilege or lifecycle.
router.patch("/:id", authenticate_1.default, users_1.patchUserValidator, validate_1.validate, (req, res, next) => userController.update(req, res, next));
// ─── POST /api/v1/users/:id/deactivate ─────────────────────────────────────
// 👑 admin/owner. `authenticate` (401) → `requirePermission` (403) → id-param validation
// (422). Reuses `getUserValidator` (a pure user-id param check). The row rules
// (owner cannot be deactivated; cannot deactivate self) are 403s in the service,
// which also flips `status` and revokes every refresh session in one
// transaction. Returns 204.
router.post("/:id/deactivate", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.deactivate"), users_1.getUserValidator, validate_1.validate, (req, res, next) => userController.deactivate(req, res, next));
// ─── POST /api/v1/users/:id/reactivate ─────────────────────────────────────
// 👑 admin/owner. The inverse of deactivate. Same chain + `getUserValidator`.
// Row rules (cannot reactivate self; a pending invite is not reactivatable) are
// enforced in the service. Returns 204.
router.post("/:id/reactivate", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.deactivate"), users_1.getUserValidator, validate_1.validate, (req, res, next) => userController.reactivate(req, res, next));
// ─── POST /api/v1/users/:id/reset-password ─────────────────────────────────
// 👑 admin/owner. Same chain + `getUserValidator`. The active-only rule and the
// §2 forgot-password token mint + email live in the service. Returns 202.
router.post("/:id/reset-password", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.reset_password"), users_1.getUserValidator, validate_1.validate, (req, res, next) => userController.resetPassword(req, res, next));
exports.default = router;
