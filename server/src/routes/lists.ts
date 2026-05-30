import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { ListController } from "../controllers/ListController";
import { ListService } from "../services/ListService";
import { TasksController } from "../controllers/TasksController";
import { TasksService } from "../services/TasksService";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
    getListValidator,
    listAllValidator,
    listBySpaceValidator,
} from "../validators/lists";
import { listTasksValidator } from "../validators/tasks";
import type {
    GetListRequest,
    ListAllRequest,
    ListBySpaceRequest,
} from "../types/lists";
import type { ListTasksRequest } from "../types/tasks";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const spacesRepo = new SpacesRepo(db);
const listsRepo = new ListsRepo(db);
const listService = new ListService(spacesRepo, listsRepo, logger);
const listController = new ListController(listService, logger);
const tasksRepo = new TasksRepo(db);
const tasksService = new TasksService(listsRepo, tasksRepo);
const tasksController = new TasksController(tasksService, logger);

// ─── GET /api/v1/spaces/:spaceId/lists ────────────────────────────────────────
// Authenticated — any role may list a space's lists (only create / archive are
// owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never client input: the space must resolve inside the
// caller's workspace or the service throws 404 `space.not_found`. This router
// declares full paths and mounts at the v1 root because §6's routes span the
// `/spaces` and `/lists` prefixes.
router.get(
    "/spaces/:spaceId/lists",
    authenticate,
    listBySpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.listBySpace(req as ListBySpaceRequest, res, next),
);

// ─── GET /api/v1/lists ────────────────────────────────────────────────────────
// Cross-space — every list in the caller's workspace. Any role may read; the
// optional `?space_id` filter is resolved inside `req.auth.workspaceId` (404
// `space.not_found` otherwise), and tenant isolation comes from the
// `lists → spaces` join in the repo, never client input. Declared as a full
// `/lists` path because this router mounts at the v1 root. Registered before the
// deeper `/lists/:listId/...` routes for readability (the exact `/lists` path
// cannot collide with them).
router.get(
    "/lists",
    authenticate,
    listAllValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.listAll(req as ListAllRequest, res, next),
);

// ─── GET /api/v1/lists/:id ────────────────────────────────────────────────────
// Read one list by id. Any role may read; the list must resolve inside
// `req.auth.workspaceId` (via the repo's `lists → spaces` join) or the service
// throws 404 `list.not_found`. Returns the bare wire `List` (single-resource
// shape). Registered after the exact `/lists` route; the single `:id` segment
// cannot collide with `/lists/:listId/tasks` (extra segment) or the separate
// `/lists/:listId/statuses` router.
router.get(
    "/lists/:id",
    authenticate,
    getListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.getById(req as GetListRequest, res, next),
);

// ─── GET /api/v1/lists/:listId/tasks ──────────────────────────────────────────
// §10 "the big one" — a filtered, cursor-paginated page of a list's tasks, each
// fully hydrated. Any workspace member; the list must resolve inside
// `req.auth.workspaceId` or the service throws 404 `list.not_found`. Declared as
// a full `/lists/...` path because this router mounts at the v1 root.
router.get(
    "/lists/:listId/tasks",
    authenticate,
    listTasksValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        tasksController.listByList(req as ListTasksRequest, res, next),
);

export default router;
