import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { AuthController } from "../controllers/AuthController";
import { AuthService } from "../services/AuthService";
import { TokenService } from "../services/TokenService";
import { CredentialService } from "../services/CredentialService";
import { UsersRepo } from "../repositories/UsersRepo";
import { PasswordResetTokensRepo } from "../repositories/PasswordResetTokensRepo";
import { InvitationsRepo } from "../repositories/InvitationsRepo";
import { MailService } from "../services/MailService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { authStrictLimiter } from "../middlewares/rateLimit";
import { validate } from "../middlewares/validate";
import {
    acceptInvitationValidator,
    changePasswordValidator,
    forgotPasswordValidator,
    invitationTokenValidator,
    loginValidator,
    resetPasswordValidator,
} from "../validators/auth";
import authenticate from "../middlewares/authenticate";
import type { AuthRequest } from "../types";
import type {
    AcceptInvitationRequest,
    ForgotPasswordRequest,
    GetInvitationRequest,
    LoginRequest,
    LogoutAllRequest,
    LogoutRequest,
    MeRequest,
    RefreshRequest,
    ResetPasswordRequest,
} from "../types/auth";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const usersRepo = new UsersRepo(db);
const passwordResetTokensRepo = new PasswordResetTokensRepo(db);
const invitationsRepo = new InvitationsRepo(db);
const tokens = new TokenService(db);
const creds = new CredentialService();
const mailService = new MailService(logger);
const authService = new AuthService(
    db,
    tokens,
    creds,
    usersRepo,
    passwordResetTokensRepo,
    invitationsRepo,
    mailService,
    logger,
);
const authController = new AuthController(authService, logger);

// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
router.post(
    "/login",
    authStrictLimiter,
    loginValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.login(req as LoginRequest, res, next),
);

// ─── POST /api/v1/auth/forgot-password ───────────────────────────────────────
// Public — emails a reset link if the address maps to an active account, but
// ALWAYS responds 202 {} (never reveals whether the email is registered).
// Rate-limited 5/min/IP via the same authStrictLimiter as /login.
router.post(
    "/forgot-password",
    authStrictLimiter,
    forgotPasswordValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.forgotPassword(req as ForgotPasswordRequest, res, next),
);

// ─── POST /api/v1/auth/reset-password ────────────────────────────────────────
// Public — the emailed one-time token is the credential. `authStrictLimiter`
// (5/min/IP) bounds brute force as on login; the validator enforces the body
// shape. On success the user's password is set and ALL their sessions revoked
// (204). Invalid/expired/consumed tokens collapse to one 400 code (no oracle).
router.post(
    "/reset-password",
    authStrictLimiter,
    resetPasswordValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.resetPassword(req as ResetPasswordRequest, res, next),
);

// ─── POST /api/v1/auth/refresh ───────────────────────────────────────────────
// Public — reads the `bb_refresh` cookie. The v1-level `apiLimiter` (600/min
// /IP) already covers it; no per-endpoint validator (the cookie is the input).
router.post(
    "/refresh",
    (req: Request, res: Response, next: NextFunction) =>
        authController.refresh(req as RefreshRequest, res, next),
);

// ─── POST /api/v1/auth/logout ────────────────────────────────────────────────
// Authenticated — revokes the session bound to the calling access token. The
// `authenticate` middleware sets `req.auth.id` to the session id so the
// controller can pass it straight to the service.
router.post(
    "/logout",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.logout(req as LogoutRequest, res, next),
);

// ─── POST /api/v1/auth/logout-all ────────────────────────────────────────────
// Authenticated — revokes every active session for the calling user (signs
// out all devices). The access token itself stays valid until natural expiry.
router.post(
    "/logout-all",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.logoutAll(req as LogoutAllRequest, res, next),
);

// ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
// Authenticated — returns the current user (Appendix-A `User`) resolved fresh
// from the DB via the verified `req.auth.sub`. No validator: identity is the
// token, and there is no body / path / query input to validate.
router.get(
    "/me",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.me(req as MeRequest, res, next),
);

// ─── POST /api/v1/auth/change-password ───────────────────────────────────────
// Authenticated — rotate the caller's OWN password after re-verifying the
// current one (204). Other sessions stay valid (V1 — no forced global sign-out).
router.post(
    "/change-password",
    authenticate,
    changePasswordValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.changePassword(req as AuthRequest, res, next),
);

// ─── GET /api/v1/auth/invitation/:token ──────────────────────────────────────
// Public — the emailed token is the input. Returns a small summary (email,
// role, workspace name) so the accept page can show who is being invited; a
// missing / already-accepted / expired token is a clear 404 / 409 / 410.
router.get(
    "/invitation/:token",
    invitationTokenValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.getInvitation(req as GetInvitationRequest, res, next),
);

// ─── POST /api/v1/auth/accept-invitation ─────────────────────────────────────
// Public — the emailed token is the credential (there is no prior session). It
// sets the invited user's first password, flips them to `active`, consumes the
// invitation, and auto-logs-them-in (sets the `bb_refresh` cookie + returns an
// access token, exactly like /login). `authStrictLimiter` (5/min/IP) bounds
// brute force as on login / reset-password.
router.post(
    "/accept-invitation",
    authStrictLimiter,
    acceptInvitationValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.acceptInvitation(
            req as AcceptInvitationRequest,
            res,
            next,
        ),
);

export default router;
