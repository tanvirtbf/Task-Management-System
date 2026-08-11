"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const validate_1 = require("../middlewares/validate");
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const rateLimit_1 = require("../middlewares/rateLimit");
const FormsRepo_1 = require("../repositories/FormsRepo");
const FormFieldsRepo_1 = require("../repositories/FormFieldsRepo");
const FormSubmissionsRepo_1 = require("../repositories/FormSubmissionsRepo");
const CustomFieldsRepo_1 = require("../repositories/CustomFieldsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const TasksService_1 = require("../services/TasksService");
const TaskWriteService_1 = require("../services/TaskWriteService");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const FormsService_1 = require("../services/FormsService");
const FormsController_1 = require("../controllers/FormsController");
const forms_1 = require("../validators/forms");
/**
 * §18 Forms router. Declares FULL paths (spanning `/forms`,
 * `/lists/:listId/forms`, `/form-fields/:id`, and the public
 * `/public/forms/:slug/submit`), so it mounts at the v1 root rather than under a
 * single prefix — the same shape §6/§7/§17 use. 👑 (admin/owner) endpoints chain
 * `requirePermission`; the public submit omits `authenticate` and rate-limits per IP.
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const formsRepo = new FormsRepo_1.FormsRepo(db);
const formFieldsRepo = new FormFieldsRepo_1.FormFieldsRepo(db);
const formSubmissionsRepo = new FormSubmissionsRepo_1.FormSubmissionsRepo(db);
const customFieldsRepo = new CustomFieldsRepo_1.CustomFieldsRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const statusesRepo = new StatusesRepo_1.StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo_1.TaskTypesRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const membershipRepo = new TaskMembershipRepo_1.TaskMembershipRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const tagsRepo = new TagsRepo_1.TagsRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
// The public submit creates a task through the same write path a member would,
// so it reuses the §10 TaskWriteService (own transaction, default status/type
// resolution, activity + notifications).
const tasksReadService = new TasksService_1.TasksService(listsRepo, tasksRepo);
const taskWriteService = new TaskWriteService_1.TaskWriteService(db, listsRepo, statusesRepo, taskTypesRepo, tasksRepo, membershipRepo, usersRepo, tagsRepo, activityRepo, notificationsRepo, new AttachmentsRepo_1.AttachmentsRepo(db), new WorkspaceRepo_1.WorkspaceRepo(db), new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), tasksReadService, logger_1.default);
const formsService = new FormsService_1.FormsService(db, formsRepo, formFieldsRepo, formSubmissionsRepo, customFieldsRepo, listsRepo, taskWriteService, notificationsRepo, logger_1.default);
const controller = new FormsController_1.FormsController(formsService, logger_1.default);
const admin = (0, requirePermission_1.requirePermission)("form.manage");
// ─── #1 GET /api/v1/forms ─────────────────────────────────────────────────────
// 🔐 Any member. All forms in the caller's workspace (newest first), each with
// its fields inline. A literal path — order vs `/forms/:id` is irrelevant.
router.get("/forms", authenticate_1.default, (req, res, next) => controller.list(req, res, next));
// ─── #2 GET /api/v1/lists/:listId/forms ───────────────────────────────────────
// 🔐 Any member. Forms attached to one list (404 if the list is absent / in
// another workspace).
router.get("/lists/:listId/forms", authenticate_1.default, forms_1.listByListFormsValidator, validate_1.validate, (req, res, next) => controller.listByList(req, res, next));
// ─── #4 POST /api/v1/forms ────────────────────────────────────────────────────
// 👑 Admin/owner. Creates a form on a list (auto-generates a unique public_slug
// unless one is supplied). 201 + the form.
router.post("/forms", authenticate_1.default, admin, forms_1.createFormValidator, validate_1.validate, (req, res, next) => controller.create(req, res, next));
// ─── #10 PATCH /api/v1/forms/:id/fields/reorder ───────────────────────────────
// 👑 Admin/owner. Bulk position update for a form's fields (every id must belong
// to the form). Declared BEFORE the 2-segment `/forms/:id` routes. 200 + form.
router.patch("/forms/:id/fields/reorder", authenticate_1.default, admin, forms_1.reorderFieldsValidator, validate_1.validate, (req, res, next) => controller.reorderFields(req, res, next));
// ─── #7 POST /api/v1/forms/:id/fields ─────────────────────────────────────────
// 👑 Admin/owner. Appends a field (task_attr or custom_field) to the form. 201.
router.post("/forms/:id/fields", authenticate_1.default, admin, forms_1.addFieldValidator, validate_1.validate, (req, res, next) => controller.addField(req, res, next));
// ─── #11 GET /api/v1/forms/:id/submissions ────────────────────────────────────
// 🔐 Any member. Newest-first, cursor-paginated submissions for a form.
router.get("/forms/:id/submissions", authenticate_1.default, (0, requirePermission_1.requirePermission)("form.view_submissions"), forms_1.listSubmissionsValidator, validate_1.validate, (req, res, next) => controller.listSubmissions(req, res, next));
// ─── #3 GET /api/v1/forms/:id ─────────────────────────────────────────────────
// 🔐 Any member. One form (admin view, fields inline). Catch-all `:id`, declared
// after the more-specific `/forms/:id/...` routes above.
router.get("/forms/:id", authenticate_1.default, forms_1.formIdParamValidator, validate_1.validate, (req, res, next) => controller.get(req, res, next));
// ─── #5 PATCH /api/v1/forms/:id ───────────────────────────────────────────────
// 👑 Admin/owner. Update metadata / settings / branding / slug / is_public.
router.patch("/forms/:id", authenticate_1.default, admin, forms_1.updateFormValidator, validate_1.validate, (req, res, next) => controller.update(req, res, next));
// ─── #6 DELETE /api/v1/forms/:id ──────────────────────────────────────────────
// 👑 Admin/owner. Hard-delete (cascades to fields + submissions). 204.
router.delete("/forms/:id", authenticate_1.default, admin, forms_1.formIdParamValidator, validate_1.validate, (req, res, next) => controller.delete(req, res, next));
// ─── #8 PATCH /api/v1/form-fields/:id ─────────────────────────────────────────
// 👑 Admin/owner. Update a single field (scoped to the workspace via its form).
router.patch("/form-fields/:id", authenticate_1.default, admin, forms_1.updateFieldValidator, validate_1.validate, (req, res, next) => controller.updateField(req, res, next));
// ─── #9 DELETE /api/v1/form-fields/:id ────────────────────────────────────────
// 👑 Admin/owner. Remove a single field. 204.
router.delete("/form-fields/:id", authenticate_1.default, admin, forms_1.fieldIdParamValidator, validate_1.validate, (req, res, next) => controller.deleteField(req, res, next));
// ─── GET /api/v1/public/forms/:slug ───────────────────────────────────────────
// 🔓 PUBLIC — no authentication. Rate-limited per IP (publicFormLimiter). The
// anonymous render projection (title, branding, success message, visible
// fields). 404 `form.not_found` if the slug is unknown.
router.get("/public/forms/:slug", rateLimit_1.publicFormLimiter, (req, res, next) => controller.publicGet(req, res, next));
// ─── POST /api/v1/public/forms/:slug/submit ───────────────────────────────────
// 🔓 PUBLIC — no authentication. Rate-limited per IP (publicFormLimiter,
// 30/min). Validates the submitted data against the form's fields, creates a
// task, records the submission, and notifies the form owner. 201.
router.post("/public/forms/:slug/submit", rateLimit_1.publicFormLimiter, forms_1.submitFormValidator, validate_1.validate, (req, res, next) => controller.submit(req, res, next));
exports.default = router;
