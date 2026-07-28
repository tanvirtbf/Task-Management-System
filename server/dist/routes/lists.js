"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ListController_1 = require("../controllers/ListController");
const ListService_1 = require("../services/ListService");
const TasksController_1 = require("../controllers/TasksController");
const TasksService_1 = require("../services/TasksService");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const lists_1 = require("../validators/lists");
const tasks_1 = require("../validators/tasks");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const listService = new ListService_1.ListService(db, spacesRepo, listsRepo, statusesRepo, taskTypesRepo, tasksRepo, workspaceActivityRepo, logger_1.default);
const listController = new ListController_1.ListController(listService, logger_1.default);
const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo);
const tasksController = new TasksController_1.TasksController(tasksService, logger_1.default);
// ─── GET /api/v1/spaces/:spaceId/lists ────────────────────────────────────────
// Authenticated — any role may list a space's lists (only create / archive are
// owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never client input: the space must resolve inside the
// caller's workspace or the service throws 404 `space.not_found`. This router
// declares full paths and mounts at the v1 root because §6's routes span the
// `/spaces` and `/lists` prefixes.
router.get("/spaces/:spaceId/lists", authenticate_1.default, lists_1.listBySpaceValidator, validate_1.validate, (req, res, next) => listController.listBySpace(req, res, next));
// ─── GET /api/v1/lists ────────────────────────────────────────────────────────
// Cross-space — every list in the caller's workspace. Any role may read; the
// optional `?space_id` filter is resolved inside `req.auth.workspaceId` (404
// `space.not_found` otherwise), and tenant isolation comes from the
// `lists → spaces` join in the repo, never client input. Declared as a full
// `/lists` path because this router mounts at the v1 root. Registered before the
// deeper `/lists/:listId/...` routes for readability (the exact `/lists` path
// cannot collide with them).
router.get("/lists", authenticate_1.default, lists_1.listAllValidator, validate_1.validate, (req, res, next) => listController.listAll(req, res, next));
// ─── POST /api/v1/lists ───────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Creates a list in
// a space the caller's workspace owns (`space_id` in the body), seeds the 5
// default statuses, and records the `created` activity — all in one transaction.
// Workspace scope and the actor come from `req.auth`, never the body; `position`
// appends server-side. Declared as a full `/lists` path because this router
// mounts at the v1 root.
router.post("/lists", authenticate_1.default, (0, requirePermission_1.requirePermission)("list.create"), lists_1.createListValidator, validate_1.validate, (req, res, next) => listController.create(req, res, next));
// ─── GET /api/v1/lists/:id ────────────────────────────────────────────────────
// Read one list by id. Any role may read; the list must resolve inside
// `req.auth.workspaceId` (via the repo's `lists → spaces` join) or the service
// throws 404 `list.not_found`. Returns the bare wire `List` (single-resource
// shape). Registered after the exact `/lists` route; the single `:id` segment
// cannot collide with `/lists/:listId/tasks` (extra segment) or the separate
// `/lists/:listId/statuses` router.
router.get("/lists/:id", authenticate_1.default, lists_1.getListValidator, validate_1.validate, (req, res, next) => listController.getById(req, res, next));
// ─── PATCH /api/v1/lists/:id ──────────────────────────────────────────────────
// 👑 admin/owner only. Partial update of name / description / icon / color /
// default_task_type_id (at least one required). Chain order encodes the spec's
// status precedence: `authenticate` (401) → `requirePermission` (403) → validation
// (422). The list is resolved within the caller's workspace (404
// `list.not_found` otherwise); an archived list is read-only (409
// `list.archived`). The `updated` activity is recorded in the same transaction.
router.patch("/lists/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("list.edit"), lists_1.updateListValidator, validate_1.validate, (req, res, next) => listController.update(req, res, next));
// ─── POST /api/v1/lists/:id/archive ───────────────────────────────────────────
// 👑 admin/owner only. Soft-delete: sets `archived_at`. Idempotent (already
// archived → 204 no-op). Resolved within the caller's workspace (404
// `list.not_found` otherwise); the `archived` activity is recorded on a real
// transition. Reuses `getListValidator` (just the `:id` param). Returns 204.
router.post("/lists/:id/archive", authenticate_1.default, (0, requirePermission_1.requirePermission)("list.archive"), lists_1.getListValidator, validate_1.validate, (req, res, next) => listController.archive(req, res, next));
// ─── POST /api/v1/lists/:id/unarchive ─────────────────────────────────────────
// 👑 admin/owner only. Reverse of archive: clears `archived_at`. Idempotent (not
// archived → 204 no-op). Same workspace resolution + `unarchived` activity on a
// real transition. Returns 204.
router.post("/lists/:id/unarchive", authenticate_1.default, (0, requirePermission_1.requirePermission)("list.archive"), lists_1.getListValidator, validate_1.validate, (req, res, next) => listController.unarchive(req, res, next));
// ─── DELETE /api/v1/lists/:id ─────────────────────────────────────────────────
// 🛡️ OWNER only (stricter than the 👑 create/update/archive verbs — Appendix B
// legend: 🛡️ = Owner role only). Hard-delete; the list must be archived AND
// empty (no tasks). Chain: `authenticate` (401) → `requirePermission` (403) → validation
// (422). Resolved within the caller's workspace (404 `list.not_found`); a
// non-archived list → 409 `list.not_archived`, a list with tasks → 409
// `list.not_empty`. The teardown + `deleted` activity run in one transaction.
router.delete("/lists/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("list.delete"), lists_1.getListValidator, validate_1.validate, (req, res, next) => listController.delete(req, res, next));
// ─── GET /api/v1/lists/:listId/tasks ──────────────────────────────────────────
// §10 "the big one" — a filtered, cursor-paginated page of a list's tasks, each
// fully hydrated. Any workspace member; the list must resolve inside
// `req.auth.workspaceId` or the service throws 404 `list.not_found`. Declared as
// a full `/lists/...` path because this router mounts at the v1 root.
router.get("/lists/:listId/tasks", authenticate_1.default, tasks_1.listTasksValidator, validate_1.validate, (req, res, next) => tasksController.listByList(req, res, next));
exports.default = router;
