import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { validate } from "../middlewares/validate";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { publicFormLimiter } from "../middlewares/rateLimit";
import type { AuthRequest } from "../types";

import { FormsRepo } from "../repositories/FormsRepo";
import { FormFieldsRepo } from "../repositories/FormFieldsRepo";
import { FormSubmissionsRepo } from "../repositories/FormSubmissionsRepo";
import { CustomFieldsRepo } from "../repositories/CustomFieldsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { TasksService } from "../services/TasksService";
import { TaskWriteService } from "../services/TaskWriteService";
import { FormsService } from "../services/FormsService";
import { FormsController } from "../controllers/FormsController";
import {
    addFieldValidator,
    createFormValidator,
    fieldIdParamValidator,
    formIdParamValidator,
    listByListFormsValidator,
    listSubmissionsValidator,
    reorderFieldsValidator,
    submitFormValidator,
    updateFieldValidator,
    updateFormValidator,
} from "../validators/forms";
import type {
    AddFieldRequest,
    CreateFormRequest,
    DeleteFieldRequest,
    DeleteFormRequest,
    GetFormRequest,
    ListByListFormsRequest,
    ListSubmissionsRequest,
    ReorderFieldsRequest,
    SubmitFormRequest,
    UpdateFieldRequest,
    UpdateFormRequest,
} from "../types/forms";

/**
 * §18 Forms router. Declares FULL paths (spanning `/forms`,
 * `/lists/:listId/forms`, `/form-fields/:id`, and the public
 * `/public/forms/:slug/submit`), so it mounts at the v1 root rather than under a
 * single prefix — the same shape §6/§7/§17 use. 👑 (admin/owner) endpoints chain
 * `requirePermission`; the public submit omits `authenticate` and rate-limits per IP.
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const formsRepo = new FormsRepo(db);
const formFieldsRepo = new FormFieldsRepo(db);
const formSubmissionsRepo = new FormSubmissionsRepo(db);
const customFieldsRepo = new CustomFieldsRepo(db);
const listsRepo = new ListsRepo(db);
const statusesRepo = new StatusesRepo(db);
const taskTypesRepo = new TaskTypesRepo(db);
const tasksRepo = new TasksRepo(db);
const membershipRepo = new TaskMembershipRepo(db);
const usersRepo = new UsersRepo(db);
const tagsRepo = new TagsRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);

// The public submit creates a task through the same write path a member would,
// so it reuses the §10 TaskWriteService (own transaction, default status/type
// resolution, activity + notifications).
const tasksReadService = new TasksService(listsRepo, tasksRepo);
const taskWriteService = new TaskWriteService(
    db,
    listsRepo,
    statusesRepo,
    taskTypesRepo,
    tasksRepo,
    membershipRepo,
    usersRepo,
    tagsRepo,
    activityRepo,
    notificationsRepo,
    tasksReadService,
    logger,
);

const formsService = new FormsService(
    db,
    formsRepo,
    formFieldsRepo,
    formSubmissionsRepo,
    customFieldsRepo,
    listsRepo,
    taskWriteService,
    notificationsRepo,
    logger,
);
const controller = new FormsController(formsService, logger);

const admin = requirePermission("form.manage");

// ─── #1 GET /api/v1/forms ─────────────────────────────────────────────────────
// 🔐 Any member. All forms in the caller's workspace (newest first), each with
// its fields inline. A literal path — order vs `/forms/:id` is irrelevant.
router.get(
    "/forms",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(req as AuthRequest, res, next),
);

// ─── #2 GET /api/v1/lists/:listId/forms ───────────────────────────────────────
// 🔐 Any member. Forms attached to one list (404 if the list is absent / in
// another workspace).
router.get(
    "/lists/:listId/forms",
    authenticate,
    listByListFormsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listByList(req as ListByListFormsRequest, res, next),
);

// ─── #4 POST /api/v1/forms ────────────────────────────────────────────────────
// 👑 Admin/owner. Creates a form on a list (auto-generates a unique public_slug
// unless one is supplied). 201 + the form.
router.post(
    "/forms",
    authenticate,
    admin,
    createFormValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(req as CreateFormRequest, res, next),
);

// ─── #10 PATCH /api/v1/forms/:id/fields/reorder ───────────────────────────────
// 👑 Admin/owner. Bulk position update for a form's fields (every id must belong
// to the form). Declared BEFORE the 2-segment `/forms/:id` routes. 200 + form.
router.patch(
    "/forms/:id/fields/reorder",
    authenticate,
    admin,
    reorderFieldsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.reorderFields(req as ReorderFieldsRequest, res, next),
);

// ─── #7 POST /api/v1/forms/:id/fields ─────────────────────────────────────────
// 👑 Admin/owner. Appends a field (task_attr or custom_field) to the form. 201.
router.post(
    "/forms/:id/fields",
    authenticate,
    admin,
    addFieldValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.addField(req as AddFieldRequest, res, next),
);

// ─── #11 GET /api/v1/forms/:id/submissions ────────────────────────────────────
// 🔐 Any member. Newest-first, cursor-paginated submissions for a form.
router.get(
    "/forms/:id/submissions",
    authenticate,
    listSubmissionsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listSubmissions(req as ListSubmissionsRequest, res, next),
);

// ─── #3 GET /api/v1/forms/:id ─────────────────────────────────────────────────
// 🔐 Any member. One form (admin view, fields inline). Catch-all `:id`, declared
// after the more-specific `/forms/:id/...` routes above.
router.get(
    "/forms/:id",
    authenticate,
    formIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.get(req as GetFormRequest, res, next),
);

// ─── #5 PATCH /api/v1/forms/:id ───────────────────────────────────────────────
// 👑 Admin/owner. Update metadata / settings / branding / slug / is_public.
router.patch(
    "/forms/:id",
    authenticate,
    admin,
    updateFormValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.update(req as UpdateFormRequest, res, next),
);

// ─── #6 DELETE /api/v1/forms/:id ──────────────────────────────────────────────
// 👑 Admin/owner. Hard-delete (cascades to fields + submissions). 204.
router.delete(
    "/forms/:id",
    authenticate,
    admin,
    formIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.delete(req as DeleteFormRequest, res, next),
);

// ─── #8 PATCH /api/v1/form-fields/:id ─────────────────────────────────────────
// 👑 Admin/owner. Update a single field (scoped to the workspace via its form).
router.patch(
    "/form-fields/:id",
    authenticate,
    admin,
    updateFieldValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.updateField(req as UpdateFieldRequest, res, next),
);

// ─── #9 DELETE /api/v1/form-fields/:id ────────────────────────────────────────
// 👑 Admin/owner. Remove a single field. 204.
router.delete(
    "/form-fields/:id",
    authenticate,
    admin,
    fieldIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.deleteField(req as DeleteFieldRequest, res, next),
);

// ─── GET /api/v1/public/forms/:slug ───────────────────────────────────────────
// 🔓 PUBLIC — no authentication. Rate-limited per IP (publicFormLimiter). The
// anonymous render projection (title, branding, success message, visible
// fields). 404 `form.not_found` if the slug is unknown.
router.get(
    "/public/forms/:slug",
    publicFormLimiter,
    (req: Request, res: Response, next: NextFunction) =>
        controller.publicGet(req, res, next),
);

// ─── POST /api/v1/public/forms/:slug/submit ───────────────────────────────────
// 🔓 PUBLIC — no authentication. Rate-limited per IP (publicFormLimiter,
// 30/min). Validates the submitted data against the form's fields, creates a
// task, records the submission, and notifies the form owner. 201.
router.post(
    "/public/forms/:slug/submit",
    publicFormLimiter,
    submitFormValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.submit(req as SubmitFormRequest, res, next),
);

export default router;
