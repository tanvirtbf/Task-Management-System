import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { TagController } from "../controllers/TagController";
import { TagService } from "../services/TagService";
import { TagsRepo } from "../repositories/TagsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    createTagValidator,
    deleteTagValidator,
    updateTagValidator,
} from "../validators/tags";
import type { AuthRequest } from "../types";
import type {
    CreateTagRequest,
    DeleteTagRequest,
    UpdateTagRequest,
} from "../types/tags";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const tagsRepo = new TagsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const tagService = new TagService(db, tagsRepo, workspaceActivityRepo, logger);
const tagController = new TagController(tagService, logger);

// ─── GET /api/v1/tags ──────────────────────────────────────────────────────
// Authenticated — any role may list the workspace's tags (only create / update
// / delete are owner/admin per §9). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input. Tags are workspace-wide.
router.get(
    "/",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        tagController.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/tags ─────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body.
router.post(
    "/",
    authenticate,
    requirePermission("catalog.tags"),
    createTagValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tagController.create(req as CreateTagRequest, res, next),
);

// ─── PATCH /api/v1/tags/:id ────────────────────────────────────────────────
// 👑 admin/owner only. Same chain/precedence as POST: `authenticate` (401) →
// `requirePermission` (403) → validation (422). The tag id is a path param; workspace
// scope and the actor come from `req.auth`, never the body.
router.patch(
    "/:id",
    authenticate,
    requirePermission("catalog.tags"),
    updateTagValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tagController.update(req as UpdateTagRequest, res, next),
);

// ─── DELETE /api/v1/tags/:id ───────────────────────────────────────────────
// 👑 admin/owner only. Same chain/precedence as POST/PATCH: `authenticate`
// (401) → `requirePermission` (403) → validation (422). Deleting a tag also removes it
// from every task that had it (via the `task_tags` FK cascade). The tag id is a
// path param; workspace scope and the actor come from `req.auth`, never the body.
router.delete(
    "/:id",
    authenticate,
    requirePermission("catalog.tags"),
    deleteTagValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tagController.delete(req as DeleteTagRequest, res, next),
);

export default router;
