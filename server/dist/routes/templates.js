"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const TemplatesController_1 = require("../controllers/TemplatesController");
const TemplatesService_1 = require("../services/TemplatesService");
const TemplateApplyService_1 = require("../services/TemplateApplyService");
const TemplatesRepo_1 = require("../repositories/TemplatesRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const templates_1 = require("../validators/templates");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const templatesRepo = new TemplatesRepo_1.TemplatesRepo(db);
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const tagsRepo = new TagsRepo_1.TagsRepo(db);
const templatesService = new TemplatesService_1.TemplatesService(db, templatesRepo, taskTypesRepo, tagsRepo);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const taskMembershipRepo = new TaskMembershipRepo_1.TaskMembershipRepo(db);
const taskActivityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const templateApplyService = new TemplateApplyService_1.TemplateApplyService(db, templatesRepo, taskTypesRepo, tagsRepo, listsRepo, statusesRepo, tasksRepo, taskMembershipRepo, taskActivityRepo);
const templatesController = new TemplatesController_1.TemplatesController(templatesService, templateApplyService, logger_1.default);
// ─── GET /api/v1/templates ───────────────────────────────────────────────────
// Authenticated — any role may list the workspace's templates. Optional
// `?type=` and `?q=` filters. Workspace scoping comes from `req.auth`.
router.get("/", authenticate_1.default, templates_1.listTemplatesValidator, validate_1.validate, (req, res, next) => templatesController.list(req, res, next));
// ─── GET /api/v1/templates/:id ───────────────────────────────────────────────
// Authenticated — any role may read a single template in their workspace.
router.get("/:id", authenticate_1.default, templates_1.templateIdParamValidator, validate_1.validate, (req, res, next) => templatesController.get(req, res, next));
// ─── POST /api/v1/templates ──────────────────────────────────────────────────
// 👑 Owner/admin only. `requirePermission` runs before validation so a member is
// rejected (403) without their body being inspected.
router.post("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.templates"), templates_1.createTemplateValidator, validate_1.validate, (req, res, next) => templatesController.create(req, res, next));
// ─── PATCH /api/v1/templates/:id ─────────────────────────────────────────────
// 👑 Owner/admin only. `type` is immutable and `usage_count` read-only (the
// controller never reads them off the body).
router.patch("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.templates"), templates_1.updateTemplateValidator, validate_1.validate, (req, res, next) => templatesController.update(req, res, next));
// ─── DELETE /api/v1/templates/:id ────────────────────────────────────────────
// 👑 Owner/admin only. Hard delete; spawned tasks are unaffected. Returns 204.
router.delete("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.templates"), templates_1.templateIdParamValidator, validate_1.validate, (req, res, next) => templatesController.remove(req, res, next));
// ─── POST /api/v1/templates/:id/apply ────────────────────────────────────────
// 🔐 Any authenticated member may apply a template — it spawns a task +
// checklist in their workspace. Workspace scoping comes from `req.auth`.
router.post("/:id/apply", authenticate_1.default, templates_1.applyTemplateValidator, validate_1.validate, (req, res, next) => templatesController.apply(req, res, next));
exports.default = router;
