import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { SpacesController } from "../controllers/SpacesController";
import { SpacesService } from "../services/SpacesService";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import {
    createSpaceValidator,
    getSpaceValidator,
    listSpacesValidator,
} from "../validators/spaces";
import { Roles } from "../constants";
import type {
    CreateSpaceRequest,
    GetSpaceRequest,
    ListSpacesRequest,
} from "../types/spaces";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const spacesRepo = new SpacesRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const spacesService = new SpacesService(
    db,
    spacesRepo,
    workspaceActivityRepo,
    logger,
);
const spacesController = new SpacesController(spacesService, logger);

// ─── GET /api/v1/spaces ────────────────────────────────────────────────────
// Authenticated — any role may list the workspace's spaces (only create /
// archive are owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input.
router.get(
    "/",
    authenticate,
    listSpacesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.list(req as ListSpacesRequest, res, next),
);

// ─── POST /api/v1/spaces ─────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `canAccess` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body.
router.post(
    "/",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    createSpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.create(req as CreateSpaceRequest, res, next),
);

// ─── GET /api/v1/spaces/:id ──────────────────────────────────────────────────
// Authenticated — any role may read a space in their workspace (only create /
// archive are owner/admin per Appendix B). The space is resolved within
// `req.auth.workspaceId`, so a cross-workspace id yields 404 `space.not_found`.
router.get(
    "/:id",
    authenticate,
    getSpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.getById(req as GetSpaceRequest, res, next),
);

export default router;
