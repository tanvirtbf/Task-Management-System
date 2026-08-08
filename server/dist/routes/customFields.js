"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const CustomFieldsController_1 = require("../controllers/CustomFieldsController");
const CustomFieldsService_1 = require("../services/CustomFieldsService");
const CustomFieldsRepo_1 = require("../repositories/CustomFieldsRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TasksService_1 = require("../services/TasksService");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const customFields_1 = require("../validators/customFields");
/**
 * §17 Custom Fields router. Declares FULL paths and is mounted at the `/api/v1`
 * ROOT (BEFORE the `/lists` and `/tasks` mounts) so its multi-segment routes
 * (`/lists/:listId/custom-fields`, `/tasks/:id/custom-fields/:fieldId`) resolve
 * ahead of those routers' catch-alls — the same pattern as `listsRouter` /
 * `taskDependenciesRouter`.
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const customFieldsRepo = new CustomFieldsRepo_1.CustomFieldsRepo(db);
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const taskActivityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo);
const customFieldsService = new CustomFieldsService_1.CustomFieldsService(db, customFieldsRepo, spacesRepo, listsRepo, tasksRepo, workspaceActivityRepo, taskActivityRepo, tasksService);
const customFieldsController = new CustomFieldsController_1.CustomFieldsController(customFieldsService, logger_1.default);
// ─── GET /api/v1/custom-fields ────────────────────────────────────────────────
// 🔐 Any member. All custom fields in the workspace (optional ?scope_type /
// ?scope_id filter). Bare CustomField[] (options inline for dropdown).
router.get("/custom-fields", authenticate_1.default, customFields_1.listCustomFieldsValidator, validate_1.validate, (req, res, next) => customFieldsController.listAll(req, res, next));
// ─── GET /api/v1/lists/:listId/custom-fields ──────────────────────────────────
// 🔐 Any member. Fields applicable to a list = workspace + the list's space +
// list-scoped fields. Bare CustomField[].
router.get("/lists/:listId/custom-fields", authenticate_1.default, customFields_1.listForListValidator, validate_1.validate, (req, res, next) => customFieldsController.listForList(req, res, next));
// ─── POST /api/v1/custom-fields ───────────────────────────────────────────────
// 👑 admin/owner. Create a field definition (+ dropdown options). Validates the
// type against the 6 supported values (422 custom_field.unsupported_type) and
// the scope_id against a real space/list in the workspace. 201 + CustomField.
router.post("/custom-fields", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.custom_fields"), customFields_1.createCustomFieldValidator, validate_1.validate, (req, res, next) => customFieldsController.create(req, res, next));
// ─── PATCH /api/v1/custom-fields/:id ──────────────────────────────────────────
// 👑 admin/owner. Update name/config/is_required/position. type + scope are
// immutable (422 if supplied). 200 + CustomField.
router.patch("/custom-fields/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.custom_fields"), customFields_1.updateCustomFieldValidator, validate_1.validate, (req, res, next) => customFieldsController.update(req, res, next));
// ─── DELETE /api/v1/custom-fields/:id ─────────────────────────────────────────
// 👑 admin/owner. Hard-delete; DB cascades all options + all stored task values.
// 204.
router.delete("/custom-fields/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.custom_fields"), customFields_1.customFieldIdParamValidator, validate_1.validate, (req, res, next) => customFieldsController.remove(req, res, next));
// ─── PUT /api/v1/tasks/:id/custom-fields/:fieldId ─────────────────────────────
// 🔐 Any member. Set/replace a task's value for a field. Validates the value
// envelope against the field type. Writes a task_activity row + bumps the task
// ETag. 200 + the full updated Task.
router.put("/tasks/:id/custom-fields/:fieldId", authenticate_1.default, (0, requirePermission_1.requirePermission)("customfield.set_value"), customFields_1.taskFieldParamsValidator, validate_1.validate, (req, res, next) => customFieldsController.setValue(req, res, next));
// ─── DELETE /api/v1/tasks/:id/custom-fields/:fieldId ──────────────────────────
// 🔐 Any member. Clear a task's value for a field (idempotent — 204 even when no
// value was set). Writes a task_activity row when a value was actually removed.
router.delete("/tasks/:id/custom-fields/:fieldId", authenticate_1.default, (0, requirePermission_1.requirePermission)("customfield.set_value"), customFields_1.taskFieldParamsValidator, validate_1.validate, (req, res, next) => customFieldsController.clearValue(req, res, next));
exports.default = router;
