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
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    createListValidator,
    getListValidator,
    listAllValidator,
    listBySpaceValidator,
    updateListValidator,
} from "../validators/lists";
import { listTasksValidator } from "../validators/tasks";
import type {
    ArchiveListRequest,
    CreateListRequest,
    DeleteListRequest,
    GetListRequest,
    ListAllRequest,
    ListBySpaceRequest,
    UnarchiveListRequest,
    UpdateListRequest,
} from "../types/lists";
import type { ListTasksRequest } from "../types/tasks";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const spacesRepo = new SpacesRepo(db);
const listsRepo = new ListsRepo(db);
const statusesRepo = new StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo(db);
const tasksRepo = new TasksRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const listService = new ListService(
    db,
    spacesRepo,
    listsRepo,
    statusesRepo,
    taskTypesRepo,
    tasksRepo,
    workspaceActivityRepo,
    logger,
);
const listController = new ListController(listService, logger);
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

// ─── POST /api/v1/lists ───────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Creates a list in
// a space the caller's workspace owns (`space_id` in the body), seeds the 5
// default statuses, and records the `created` activity — all in one transaction.
// Workspace scope and the actor come from `req.auth`, never the body; `position`
// appends server-side. Declared as a full `/lists` path because this router
// mounts at the v1 root.
router.post(
    "/lists",
    authenticate,
    requirePermission("list.create"),
    createListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.create(req as CreateListRequest, res, next),
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

// ─── PATCH /api/v1/lists/:id ──────────────────────────────────────────────────
// 👑 admin/owner only. Partial update of name / description / icon / color /
// default_task_type_id (at least one required). Chain order encodes the spec's
// status precedence: `authenticate` (401) → `requirePermission` (403) → validation
// (422). The list is resolved within the caller's workspace (404
// `list.not_found` otherwise); an archived list is read-only (409
// `list.archived`). The `updated` activity is recorded in the same transaction.
router.patch(
    "/lists/:id",
    authenticate,
    requirePermission("list.edit"),
    updateListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.update(req as UpdateListRequest, res, next),
);

// ─── POST /api/v1/lists/:id/archive ───────────────────────────────────────────
// 👑 admin/owner only. Soft-delete: sets `archived_at`. Idempotent (already
// archived → 204 no-op). Resolved within the caller's workspace (404
// `list.not_found` otherwise); the `archived` activity is recorded on a real
// transition. Reuses `getListValidator` (just the `:id` param). Returns 204.
router.post(
    "/lists/:id/archive",
    authenticate,
    requirePermission("list.archive"),
    getListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.archive(req as ArchiveListRequest, res, next),
);

// ─── POST /api/v1/lists/:id/unarchive ─────────────────────────────────────────
// 👑 admin/owner only. Reverse of archive: clears `archived_at`. Idempotent (not
// archived → 204 no-op). Same workspace resolution + `unarchived` activity on a
// real transition. Returns 204.
router.post(
    "/lists/:id/unarchive",
    authenticate,
    requirePermission("list.archive"),
    getListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.unarchive(req as UnarchiveListRequest, res, next),
);

// ─── DELETE /api/v1/lists/:id ─────────────────────────────────────────────────
// 🛡️ OWNER only (stricter than the 👑 create/update/archive verbs — Appendix B
// legend: 🛡️ = Owner role only). Hard-delete; the list must be archived AND
// empty (no tasks). Chain: `authenticate` (401) → `requirePermission` (403) → validation
// (422). Resolved within the caller's workspace (404 `list.not_found`); a
// non-archived list → 409 `list.not_archived`, a list with tasks → 409
// `list.not_empty`. The teardown + `deleted` activity run in one transaction.
router.delete(
    "/lists/:id",
    authenticate,
    requirePermission("list.delete"),
    getListValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        listController.delete(req as DeleteListRequest, res, next),
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
