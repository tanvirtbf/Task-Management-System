import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { AttachmentsController } from "../controllers/AttachmentsController";
import { AttachmentsService } from "../services/AttachmentsService";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { R2Service } from "../services/R2Service";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { uploadSignLimiter } from "../middlewares/rateLimit";
import {
    deleteAttachmentValidator,
    downloadAttachmentValidator,
    finalizeValidator,
    listAttachmentsValidator,
    signUploadValidator,
} from "../validators/attachments";
import type { AuthRequest } from "../types";
import type {
    FinalizeRequest,
    SignUploadRequest,
} from "../types/attachments";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const attachmentsRepo = new AttachmentsRepo(db);
const tasksRepo = new TasksRepo(db);
const r2 = new R2Service(logger);
const attachmentsService = new AttachmentsService(attachmentsRepo, tasksRepo, r2);
const attachmentsController = new AttachmentsController(
    attachmentsService,
    logger,
);

// This router declares FULL paths and mounts at the v1 root because §16's routes
// span the `/uploads`, `/attachments`, and `/tasks` prefixes.

// ─── POST /api/v1/uploads/sign ────────────────────────────────────────────────
// 🔐 + rate-limited (uploadSignLimiter 60/min/user; no-op in test). Validates
// size (≤25 MB → 413) + MIME (allow-list → 415) + scope (task in workspace → 404,
// guest → 403) BEFORE signing, creates the pending row, returns 201 with the
// signed PUT URL.
router.post(
    "/uploads/sign",
    authenticate,
    uploadSignLimiter,
    signUploadValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.sign(req as SignUploadRequest, res, next),
);

// ─── POST /api/v1/attachments/:id/finalize ────────────────────────────────────
// 🔐 any member. HEAD-verifies the R2 object (missing → 410 attachment.upload_
// expired), flips the row to complete, returns 200 with the Attachment.
router.post(
    "/attachments/:id/finalize",
    authenticate,
    finalizeValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.finalize(req as FinalizeRequest, res, next),
);

// ─── GET /api/v1/attachments/:id/download ─────────────────────────────────────
// 🔐 any member with read access to the parent task. 302 → fresh signed GET URL.
// Declared before `/attachments/:id` so the literal `download` segment wins.
router.get(
    "/attachments/:id/download",
    authenticate,
    downloadAttachmentValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.download(req as AuthRequest, res, next),
);

// ─── DELETE /api/v1/attachments/:id ───────────────────────────────────────────
// 🔐 uploader (own) OR 👑 owner/admin. Soft-delete (sets deleted_at; R2 object
// left for the janitor). 204.
router.delete(
    "/attachments/:id",
    authenticate,
    deleteAttachmentValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.remove(req as AuthRequest, res, next),
);

// ─── GET /api/v1/tasks/:id/attachments ────────────────────────────────────────
// 🔐 any member. Bare `Attachment[]` (finalised, non-deleted), newest first.
router.get(
    "/tasks/:id/attachments",
    authenticate,
    listAttachmentsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.listByTask(req as AuthRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/attachments ────────────────────────────────────────
// 🔐 PROXIED upload: the browser sends the raw file bytes to OUR server (so it
// never PUTs cross-origin to R2, which needs bucket CORS the dev bucket lacks);
// the server uploads to R2 itself. `express.raw` captures the body as a Buffer
// (the app-level express.json skips it — its Content-Type is the file's MIME,
// not application/json). filename via `X-Filename` header.
router.post(
    "/tasks/:id/attachments",
    authenticate,
    express.raw({ type: () => true, limit: "30mb" }),
    (req: Request, res: Response, next: NextFunction) =>
        attachmentsController.upload(req as AuthRequest, res, next),
);

export default router;
