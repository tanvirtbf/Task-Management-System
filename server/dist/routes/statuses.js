"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const StatusesController_1 = require("../controllers/StatusesController");
const StatusesService_1 = require("../services/StatusesService");
const ListsRepo_1 = require("../repositories/ListsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const statuses_1 = require("../validators/statuses");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const listsRepo = new ListsRepo_1.ListsRepo(db);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const statusesService = new StatusesService_1.StatusesService(db, listsRepo, statusesRepo, logger_1.default);
const statusesController = new StatusesController_1.StatusesController(statusesService, logger_1.default);
// ─── GET /api/v1/lists/:listId/statuses ──────────────────────────────────────
// Authenticated — any role may list a list's statuses. Workspace scoping comes
// from `req.auth.workspaceId`, never client input: the list must resolve inside
// the caller's workspace or the service throws 404 `list.not_found`. This
// router declares full paths and mounts at the v1 root because §7's routes span
// the `/lists` and `/statuses` prefixes.
router.get("/lists/:listId/statuses", authenticate_1.default, statuses_1.listStatusesValidator, validate_1.validate, (req, res, next) => statusesController.listByList(req, res, next));
// ─── POST /api/v1/lists/:listId/statuses ──────────────────────────────────────
// 👑 Owner/Admin only — `requirePermission` rejects member/guest with the spec
// `auth.forbidden` envelope (the global error handler maps its http-errors 403).
// Adds a status to a list the caller's workspace owns (404 `list.not_found`
// otherwise), appended to the end of the list's order unless `position` is given.
// A duplicate name in the list (`uq_statuses_scope_name`) → 409 `status.duplicate`.
// Returns 201 with the created Status.
router.post("/lists/:listId/statuses", authenticate_1.default, (0, requirePermission_1.requirePermission)("status.manage"), statuses_1.createStatusValidator, validate_1.validate, (req, res, next) => statusesController.create(req, res, next));
// ─── PATCH /api/v1/lists/:listId/statuses/reorder ─────────────────────────────
// 👑 Owner/Admin only. Bulk-repositions a list's statuses from a bare JSON array
// of `{ id, position }` items (array structure validated in the controller).
// 404 `list.not_found` if the list is missing/cross-workspace; 404
// `status.not_found` if any id is not a status in this list. Returns 200 with the
// full list reordered. Declared before `/statuses/:id` for readability; the paths
// do not overlap (different prefixes), so order does not affect matching.
router.patch("/lists/:listId/statuses/reorder", authenticate_1.default, (0, requirePermission_1.requirePermission)("status.manage"), statuses_1.reorderStatusesValidator, validate_1.validate, (req, res, next) => statusesController.reorder(req, res, next));
// ─── PATCH /api/v1/statuses/:id ───────────────────────────────────────────────
// 👑 Owner/Admin only. Updates a status's name / color / status_group (partial —
// at least one field). The bare id is resolved within the caller's workspace via
// its list's space (404 `status.not_found` otherwise) before the PK-keyed write.
// A name collision in the same list (`uq_statuses_scope_name`) → 409
// `status.duplicate`. Returns 200 with the updated Status.
router.patch("/statuses/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("status.manage"), statuses_1.updateStatusValidator, validate_1.validate, (req, res, next) => statusesController.update(req, res, next));
// ─── DELETE /api/v1/statuses/:id ──────────────────────────────────────────────
// 👑 Owner/Admin only. Deletes a status the caller's workspace owns (404
// `status.not_found` otherwise). Refuses with 409 `status.in_use` if any task
// references it, and 422 `status.last_in_group` if it is the last status of its
// group (the Board view needs ≥1 status per group). Returns 204 No Content.
router.delete("/statuses/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("status.manage"), statuses_1.deleteStatusValidator, validate_1.validate, (req, res, next) => statusesController.remove(req, res, next));
exports.default = router;
