"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const AuthController_1 = require("../controllers/AuthController");
const AuthService_1 = require("../services/AuthService");
const TokenService_1 = require("../services/TokenService");
const CredentialService_1 = require("../services/CredentialService");
const UsersRepo_1 = require("../repositories/UsersRepo");
const PasswordResetTokensRepo_1 = require("../repositories/PasswordResetTokensRepo");
const InvitationsRepo_1 = require("../repositories/InvitationsRepo");
const MailService_1 = require("../services/MailService");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const rateLimit_1 = require("../middlewares/rateLimit");
const validate_1 = require("../middlewares/validate");
const auth_1 = require("../validators/auth");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const usersRepo = new UsersRepo_1.UsersRepo(db);
const passwordResetTokensRepo = new PasswordResetTokensRepo_1.PasswordResetTokensRepo(db);
const invitationsRepo = new InvitationsRepo_1.InvitationsRepo(db);
const tokens = new TokenService_1.TokenService(db);
const creds = new CredentialService_1.CredentialService();
const mailService = new MailService_1.MailService(logger_1.default);
const authService = new AuthService_1.AuthService(db, tokens, creds, usersRepo, passwordResetTokensRepo, invitationsRepo, mailService, logger_1.default);
const authController = new AuthController_1.AuthController(authService, logger_1.default);
// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
router.post("/login", rateLimit_1.authStrictLimiter, auth_1.loginValidator, validate_1.validate, (req, res, next) => authController.login(req, res, next));
// ─── POST /api/v1/auth/forgot-password ───────────────────────────────────────
// Public — emails a reset link if the address maps to an active account, but
// ALWAYS responds 202 {} (never reveals whether the email is registered).
// Rate-limited 5/min/IP via the same authStrictLimiter as /login.
router.post("/forgot-password", rateLimit_1.authStrictLimiter, auth_1.forgotPasswordValidator, validate_1.validate, (req, res, next) => authController.forgotPassword(req, res, next));
// ─── POST /api/v1/auth/reset-password ────────────────────────────────────────
// Public — the emailed one-time token is the credential. `authStrictLimiter`
// (5/min/IP) bounds brute force as on login; the validator enforces the body
// shape. On success the user's password is set and ALL their sessions revoked
// (204). Invalid/expired/consumed tokens collapse to one 400 code (no oracle).
router.post("/reset-password", rateLimit_1.authStrictLimiter, auth_1.resetPasswordValidator, validate_1.validate, (req, res, next) => authController.resetPassword(req, res, next));
// ─── POST /api/v1/auth/refresh ───────────────────────────────────────────────
// Public — reads the `bb_refresh` cookie. The v1-level `apiLimiter` (600/min
// /IP) already covers it; no per-endpoint validator (the cookie is the input).
router.post("/refresh", (req, res, next) => authController.refresh(req, res, next));
// ─── POST /api/v1/auth/logout ────────────────────────────────────────────────
// Authenticated — revokes the session bound to the calling access token. The
// `authenticate` middleware sets `req.auth.id` to the session id so the
// controller can pass it straight to the service.
router.post("/logout", authenticate_1.default, (req, res, next) => authController.logout(req, res, next));
// ─── POST /api/v1/auth/logout-all ────────────────────────────────────────────
// Authenticated — revokes every active session for the calling user (signs
// out all devices). The access token itself stays valid until natural expiry.
router.post("/logout-all", authenticate_1.default, (req, res, next) => authController.logoutAll(req, res, next));
// ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
// Authenticated — returns the current user (Appendix-A `User`) resolved fresh
// from the DB via the verified `req.auth.sub`. No validator: identity is the
// token, and there is no body / path / query input to validate.
router.get("/me", authenticate_1.default, (req, res, next) => authController.me(req, res, next));
// ─── POST /api/v1/auth/change-password ───────────────────────────────────────
// Authenticated — rotate the caller's OWN password after re-verifying the
// current one (204). Other sessions stay valid (V1 — no forced global sign-out).
router.post("/change-password", authenticate_1.default, auth_1.changePasswordValidator, validate_1.validate, (req, res, next) => authController.changePassword(req, res, next));
// ─── GET /api/v1/auth/invitation/:token ──────────────────────────────────────
// Public — the emailed token is the input. Returns a small summary (email,
// role, workspace name) so the accept page can show who is being invited; a
// missing / already-accepted / expired token is a clear 404 / 409 / 410.
// Rate-limited (5/min/IP) to prevent brute-force token enumeration.
router.get("/invitation/:token", rateLimit_1.invitationLimiter, auth_1.invitationTokenValidator, validate_1.validate, (req, res, next) => authController.getInvitation(req, res, next));
// ─── POST /api/v1/auth/accept-invitation ─────────────────────────────────────
// Public — the emailed token is the credential (there is no prior session). It
// sets the invited user's first password, flips them to `active`, consumes the
// invitation, and auto-logs-them-in (sets the `bb_refresh` cookie + returns an
// access token, exactly like /login). `authStrictLimiter` (5/min/IP) bounds
// brute force as on login / reset-password.
router.post("/accept-invitation", rateLimit_1.authStrictLimiter, auth_1.acceptInvitationValidator, validate_1.validate, (req, res, next) => authController.acceptInvitation(req, res, next));
exports.default = router;
