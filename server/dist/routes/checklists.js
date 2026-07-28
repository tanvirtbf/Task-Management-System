"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ChecklistsController_1 = require("../controllers/ChecklistsController");
const ChecklistsService_1 = require("../services/ChecklistsService");
const ChecklistsRepo_1 = require("../repositories/ChecklistsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const checklists_1 = require("../validators/checklists");
/**
 * §15 Checklists router. Declares FULL paths (spanning `/tasks/:id/checklists`,
 * `/checklists/:id*`, and `/checklist-items/:id*`), so it mounts at the v1 ROOT
 * — and BEFORE the `/tasks` mount, so the 3-segment `/tasks/:id/checklists`
 * resolves ahead of the tasks router's `/:id` catch-alls (same pattern as §14
 * comments / §17 custom-fields).
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const checklistsRepo = new ChecklistsRepo_1.ChecklistsRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const service = new ChecklistsService_1.ChecklistsService(db, checklistsRepo, tasksRepo, usersRepo, activityRepo);
const controller = new ChecklistsController_1.ChecklistsController(service, logger_1.default);
// ─── GET /api/v1/tasks/:id/checklists ─────────────────────────────────────────
// 🔐 any member. All checklists for a task, each with its items nested.
router.get("/tasks/:id/checklists", authenticate_1.default, checklists_1.listChecklistsValidator, validate_1.validate, (req, res, next) => controller.listForTask(req, res, next));
// ─── POST /api/v1/tasks/:id/checklists ────────────────────────────────────────
// 🔐 any member. Create an empty checklist on the task. 201.
router.post("/tasks/:id/checklists", authenticate_1.default, checklists_1.createChecklistValidator, validate_1.validate, (req, res, next) => controller.createChecklist(req, res, next));
// ─── PATCH /api/v1/checklists/:id ─────────────────────────────────────────────
// 🔐 any member. Rename / reposition a checklist. 200.
router.patch("/checklists/:id", authenticate_1.default, checklists_1.updateChecklistValidator, validate_1.validate, (req, res, next) => controller.updateChecklist(req, res, next));
// ─── DELETE /api/v1/checklists/:id ────────────────────────────────────────────
// 🔐 any member. Delete a checklist (cascades to items). 204.
router.delete("/checklists/:id", authenticate_1.default, checklists_1.checklistIdParamValidator, validate_1.validate, (req, res, next) => controller.removeChecklist(req, res, next));
// ─── POST /api/v1/checklists/:id/items ────────────────────────────────────────
// 🔐 any member. Add a single item. 201.
router.post("/checklists/:id/items", authenticate_1.default, checklists_1.addItemValidator, validate_1.validate, (req, res, next) => controller.addItem(req, res, next));
// ─── POST /api/v1/checklists/:id/items/bulk ───────────────────────────────────
// 🔐 any member. Add many items in one transaction (template apply). 201.
router.post("/checklists/:id/items/bulk", authenticate_1.default, checklists_1.bulkAddItemsValidator, validate_1.validate, (req, res, next) => controller.bulkAddItems(req, res, next));
// ─── PATCH /api/v1/checklist-items/:id ────────────────────────────────────────
// 🔐 any member. Edit item text / assignee / position. Logs task_activity. 200.
router.patch("/checklist-items/:id", authenticate_1.default, checklists_1.updateItemValidator, validate_1.validate, (req, res, next) => controller.updateItem(req, res, next));
// ─── POST /api/v1/checklist-items/:id/toggle ──────────────────────────────────
// 🔐 any member. Tick / untick the checkbox. Logs task_activity. 200.
router.post("/checklist-items/:id/toggle", authenticate_1.default, checklists_1.itemIdParamValidator, validate_1.validate, (req, res, next) => controller.toggleItem(req, res, next));
// ─── DELETE /api/v1/checklist-items/:id ───────────────────────────────────────
// 🔐 any member. Remove an item. 204.
router.delete("/checklist-items/:id", authenticate_1.default, checklists_1.itemIdParamValidator, validate_1.validate, (req, res, next) => controller.removeItem(req, res, next));
exports.default = router;
