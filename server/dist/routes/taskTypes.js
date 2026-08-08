"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const allowQuery_1 = require("../middlewares/allowQuery");
const TaskTypeController_1 = require("../controllers/TaskTypeController");
const TaskTypeService_1 = require("../services/TaskTypeService");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const taskTypes_1 = require("../validators/taskTypes");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const taskTypeService = new TaskTypeService_1.TaskTypeService(db, taskTypesRepo, workspaceActivityRepo);
const taskTypeController = new TaskTypeController_1.TaskTypeController(taskTypeService, logger_1.default);
// ─── GET /api/v1/task-types ──────────────────────────────────────────────────
// Authenticated — any role may list the workspace's task types (only create /
// update / delete are owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input.
router.get("/", authenticate_1.default, 
// F23 (ISS-014): a mistyped filter is a 422, not the full set.
(0, allowQuery_1.allowQuery)(["limit", "cursor"]), (req, res, next) => taskTypeController.list(req, res, next));
// ─── POST /api/v1/task-types ─────────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected. The new type is created
// in the caller's workspace (`req.auth.workspaceId`).
router.post("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.task_types"), taskTypes_1.createTaskTypeValidator, validate_1.validate, (req, res, next) => taskTypeController.create(req, res, next));
// ─── PATCH /api/v1/task-types/:id ────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected. Editing the seeded
// `is_system` types is restricted to icon/color/description (enforced in the
// service); workspace scoping comes from `req.auth.workspaceId`.
router.patch("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.task_types"), taskTypes_1.updateTaskTypeValidator, validate_1.validate, (req, res, next) => taskTypeController.update(req, res, next));
// ─── DELETE /api/v1/task-types/:id ───────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their target being inspected. Refuses with 403
// `task_type.system` for a seeded system type and 409 `task_type.in_use` when a
// task or list still references it; otherwise deletes the row + writes a
// `workspace_activity` "deleted" row in one transaction and returns 204.
router.delete("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.task_types"), taskTypes_1.deleteTaskTypeValidator, validate_1.validate, (req, res, next) => taskTypeController.remove(req, res, next));
exports.default = router;
