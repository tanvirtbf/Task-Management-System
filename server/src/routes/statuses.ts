import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { StatusesController } from "../controllers/StatusesController";
import { StatusesService } from "../services/StatusesService";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { validate } from "../middlewares/validate";
import { Roles } from "../constants";
import {
    createStatusValidator,
    listStatusesValidator,
    updateStatusValidator,
} from "../validators/statuses";
import type {
    CreateStatusRequest,
    ListStatusesRequest,
    UpdateStatusRequest,
} from "../types/statuses";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const listsRepo = new ListsRepo(db);
const statusesRepo = new StatusesRepo(db);
const statusesService = new StatusesService(listsRepo, statusesRepo, logger);
const statusesController = new StatusesController(statusesService, logger);

// ─── GET /api/v1/lists/:listId/statuses ──────────────────────────────────────
// Authenticated — any role may list a list's statuses. Workspace scoping comes
// from `req.auth.workspaceId`, never client input: the list must resolve inside
// the caller's workspace or the service throws 404 `list.not_found`. This
// router declares full paths and mounts at the v1 root because §7's routes span
// the `/lists` and `/statuses` prefixes.
router.get(
    "/lists/:listId/statuses",
    authenticate,
    listStatusesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        statusesController.listByList(req as ListStatusesRequest, res, next),
);

// ─── POST /api/v1/lists/:listId/statuses ──────────────────────────────────────
// 👑 Owner/Admin only — `canAccess` rejects member/guest with the spec
// `auth.forbidden` envelope (the global error handler maps its http-errors 403).
// Adds a status to a list the caller's workspace owns (404 `list.not_found`
// otherwise), appended to the end of the list's order unless `position` is given.
// A duplicate name in the list (`uq_statuses_scope_name`) → 409 `status.duplicate`.
// Returns 201 with the created Status.
router.post(
    "/lists/:listId/statuses",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    createStatusValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        statusesController.create(req as CreateStatusRequest, res, next),
);

// ─── PATCH /api/v1/statuses/:id ───────────────────────────────────────────────
// 👑 Owner/Admin only. Updates a status's name / color / status_group (partial —
// at least one field). The bare id is resolved within the caller's workspace via
// its list's space (404 `status.not_found` otherwise) before the PK-keyed write.
// A name collision in the same list (`uq_statuses_scope_name`) → 409
// `status.duplicate`. Returns 200 with the updated Status.
router.patch(
    "/statuses/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    updateStatusValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        statusesController.update(req as UpdateStatusRequest, res, next),
);

export default router;
