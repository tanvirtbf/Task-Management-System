import type { NextFunction, Request, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { AppError } from "../errors";
import type { FormsService } from "../services/FormsService";
import type { AuthRequest } from "../types";
import type {
    AddFieldBody,
    AddFieldRequest,
    CreateFormBody,
    CreateFormRequest,
    DeleteFieldRequest,
    DeleteFormRequest,
    GetFormRequest,
    ListByListFormsRequest,
    ListSubmissionsRequest,
    ReorderFieldsRequest,
    SubmitFormRequest,
    UpdateFieldBody,
    UpdateFieldRequest,
    UpdateFormBody,
    UpdateFormRequest,
} from "../types/forms";

/**
 * §18 Forms HTTP layer. Maps validated input → a `FormsService` call → the spec
 * response. Identity + workspace scope come from the verified token
 * (`req.auth`), never the body. The public submit is the lone handler that reads
 * no `req.auth` (it is unauthenticated, rate-limited upstream).
 */
export class FormsController {
    constructor(
        private forms: FormsService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/forms (#1, 🔐). All forms in the caller's workspace. */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const data = await this.forms.list(req.auth.workspaceId);
            res.status(200).json(data);
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/lists/:listId/forms (#2, 🔐). */
    async listByList(
        req: ListByListFormsRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { listId } = matchedData<{ listId: string; }>(req, { locations: ["params"] });
            const data = await this.forms.listByList(
                listId,
                req.auth.workspaceId,
            );
            res.status(200).json(data);
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/forms/:id (#3, 🔐). */
    async get(req: GetFormRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const form = await this.forms.get(id, req.auth.workspaceId);
            res.status(200).json(form);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/forms (#4, 👑). 201 with the created form. */
    async create(req: CreateFormRequest, res: Response, next: NextFunction) {
        try {
            const b = matchedData<Partial<CreateFormBody>>(req, {
                locations: ["body"],
            });
            const form = await this.forms.create({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                listId: b.list_id as string,
                title: b.title as string,
                description: b.description,
                isPublic: b.is_public,
                settings: b.settings,
                branding: b.branding,
                publicSlug: b.public_slug,
            });
            this.logger.info("forms.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                formId: form.id,
            });
            res.status(201).json(form);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/forms/:id (#5, 👑). 200 with the updated form. */
    async update(req: UpdateFormRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const b = matchedData<Partial<UpdateFormBody>>(req, {
                locations: ["body"],
            });
            if (Object.keys(b).length === 0) {
                throw AppError.validationFailed([
                    { issue: "Provide at least one field to update" },
                ]);
            }
            const form = await this.forms.update({
                workspaceId: req.auth.workspaceId,
                formId: id,
                fields: Object.keys(b),
                title: b.title,
                description: b.description,
                isPublic: b.is_public,
                settings: b.settings,
                branding: b.branding,
                publicSlug: b.public_slug,
            });
            this.logger.info("forms.update.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                formId: id,
            });
            res.status(200).json(form);
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/forms/:id (#6, 👑). 204. */
    async delete(req: DeleteFormRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            await this.forms.delete(id, req.auth.workspaceId);
            this.logger.info("forms.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                formId: id,
            });
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/forms/:id/fields (#7, 👑). 201 with the created field. */
    async addField(req: AddFieldRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const b = matchedData<Partial<AddFieldBody>>(req, {
                locations: ["body"],
            });
            const field = await this.forms.addField({
                workspaceId: req.auth.workspaceId,
                formId: id,
                fieldKind: b.field_kind as AddFieldBody["field_kind"],
                fieldKey: b.field_key as string,
                label: b.label as string,
                isRequired: b.is_required,
                isHidden: b.is_hidden,
                position: b.position,
                placeholder: b.placeholder,
                helpText: b.help_text,
                defaultValue: b.default_value,
            });
            this.logger.info("forms.field.add.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                formId: id,
                fieldId: field.id,
            });
            res.status(201).json(field);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/form-fields/:id (#8, 👑). 200 with the updated field. */
    async updateField(
        req: UpdateFieldRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const b = matchedData<Partial<UpdateFieldBody>>(req, {
                locations: ["body"],
            });
            if (Object.keys(b).length === 0) {
                throw AppError.validationFailed([
                    { issue: "Provide at least one field to update" },
                ]);
            }
            const field = await this.forms.updateField({
                workspaceId: req.auth.workspaceId,
                fieldId: id,
                label: b.label,
                isRequired: b.is_required,
                isHidden: b.is_hidden,
                placeholder: b.placeholder,
                helpText: b.help_text,
                defaultValue: b.default_value,
            });
            res.status(200).json(field);
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/form-fields/:id (#9, 👑). 204. */
    async deleteField(
        req: DeleteFieldRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            await this.forms.deleteField(id, req.auth.workspaceId);
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/forms/:id/fields/reorder (#10, 👑). 200 with the form. */
    async reorderFields(
        req: ReorderFieldsRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const body = (req.body ?? {}) as {
                items?: { id: string; position: number }[];
            };
            const form = await this.forms.reorderFields({
                workspaceId: req.auth.workspaceId,
                formId: id,
                items: body.items ?? [],
            });
            res.status(200).json(form);
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/forms/:id/submissions (#11, 🔐). List envelope. */
    async listSubmissions(
        req: ListSubmissionsRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { id } = matchedData<{ id: string; }>(req, { locations: ["params"] });
            const q = matchedData<{ cursor?: string; limit?: number; }>(req, { locations: ["query"] });
            const result = await this.forms.listSubmissions({
                workspaceId: req.auth.workspaceId,
                formId: id,
                cursor: q.cursor,
                limit: q.limit,
            });
            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/public/forms/:slug (🔓). Anonymous render projection — title,
     * branding, success message, and the visible (non-hidden) fields. No
     * `req.auth`; the slug is the only input. 404 `form.not_found` if absent.
     */
    async publicGet(req: Request, res: Response, next: NextFunction) {
        try {
            const form = await this.forms.publicView(req.params.slug);
            res.status(200).json(form);
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/public/forms/:slug/submit (🔓). Reads no `req.auth`. The
     * arbitrary `data` map is read off `req.body` directly (its keys are
     * form-defined, so the validator only asserts it is an object). 201 with
     * `{ submission_id, task_id, message }`.
     */
    async submit(req: SubmitFormRequest, res: Response, next: NextFunction) {
        try {
            const { slug } = matchedData<{ slug: string; }>(req, { locations: ["params"] });
            const body = (req.body ?? {}) as { data?: Record<string, unknown> };
            const result = await this.forms.submit({
                slug,
                data: body.data ?? {},
                ip: req.ip ?? null,
            });
            this.logger.info("forms.submit.ok", {
                requestId: req.requestId,
                slug,
                taskId: result.task_id,
                submissionId: result.submission_id,
            });
            res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
}
