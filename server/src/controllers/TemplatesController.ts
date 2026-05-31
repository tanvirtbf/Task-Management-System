import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { TemplatesService } from "../services/TemplatesService";
import { TemplateApplyService } from "../services/TemplateApplyService";
import type { AuthRequest } from "../types";
import type {
    ApplyTemplateRequest,
    CreateTemplateRequest,
    TemplateStructure,
    TemplateType,
    UpdateTemplateRequest,
} from "../types/templates";
import type {
    TemplateRecord,
    TemplateUpdateRow,
} from "../repositories/TemplatesRepo";

/**
 * §23 Templates HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `Template` per API_DESIGN.md §23. Top-level keys are snake_case
 * (matching the wire examples and every other endpoint's serializer); the
 * nested `structure` object is passed through verbatim with its camelCase keys
 * (`taskTypeId`, `checklistItems`, `dueOffsetDays`, …).
 */
interface WireTemplate {
    id: string;
    workspace_id: string;
    type: TemplateType;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    structure: TemplateStructure;
    usage_count: number;
    created_by: string;
    created_at: string;
    updated_at: string;
}

const toWireTemplate = (t: TemplateRecord): WireTemplate => ({
    id: t.id,
    workspace_id: t.workspaceId,
    type: t.type,
    name: t.name,
    description: t.description ?? null,
    icon: t.icon ?? null,
    color: t.color ?? null,
    structure: (t.structure ?? {}) as TemplateStructure,
    usage_count: t.usageCount,
    created_by: t.createdBy,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
});

/**
 * Map an optional free-text field to what the data layer wants: `undefined`
 * (so the column NULL applies) for an absent or blank value, or the
 * already-trimmed string otherwise. The validator trims the input, so a blank
 * entry arrives as `""`.
 */
const optionalText = (value: string | undefined): string | undefined =>
    value && value.length > 0 ? value : undefined;

export class TemplatesController {
    constructor(
        private templatesService: TemplatesService,
        private applyService: TemplateApplyService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/templates — list the caller's workspace templates, with
     * optional `?type=` and `?q=` filters. Workspace-scoped via
     * `req.auth.workspaceId`, never client input.
     */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const type =
                typeof req.query.type === "string"
                    ? (req.query.type as TemplateType)
                    : undefined;
            const q =
                typeof req.query.q === "string" ? req.query.q : undefined;

            const rows = await this.templatesService.list(workspaceId, {
                type,
                q,
            });

            this.logger.debug("templates.list.ok", {
                requestId: req.requestId,
                workspaceId,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireTemplate),
                pagination: {
                    next_cursor: null,
                    has_more: false,
                    total_estimate: rows.length,
                },
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/templates/:id — fetch one template (any authenticated member).
     * 404 `template.not_found` for a missing or cross-workspace id.
     */
    async get(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const id = req.params.id;

            const template = await this.templatesService.getById(
                workspaceId,
                id,
            );

            res.status(200).json(toWireTemplate(template));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/templates — create a template (👑 owner/admin, enforced by
     * the route's `canAccess`). Workspace + actor come from `req.auth`;
     * `id`/`workspace_id`/`usage_count`/`created_by` are server-owned and
     * ignored if sent in the body.
     */
    async create(req: CreateTemplateRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const body = req.body;

            const record = await this.templatesService.create({
                workspaceId,
                actorId,
                type: body.type,
                name: body.name,
                description: optionalText(body.description ?? undefined),
                icon: optionalText(body.icon ?? undefined),
                color: body.color ?? undefined,
                structure: body.structure,
            });

            this.logger.info("templates.create.ok", {
                requestId: req.requestId,
                workspaceId,
                templateId: record.id,
            });

            res.status(201).json(toWireTemplate(record));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/templates/:id — partial update (👑 owner/admin). Only the
     * body keys actually sent are forwarded; `description`/`icon`/`color` are
     * tri-state (absent = unchanged, null/blank = cleared). `type` and
     * `usage_count` are immutable / read-only and are never read off the body.
     */
    async update(req: UpdateTemplateRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const id = req.params.id;
            const body = req.body;

            const patch: TemplateUpdateRow = {};
            if (body.name !== undefined) patch.name = body.name;
            if (body.description !== undefined) {
                patch.description =
                    optionalText(body.description ?? undefined) ?? null;
            }
            if (body.icon !== undefined) {
                patch.icon = optionalText(body.icon ?? undefined) ?? null;
            }
            if (body.color !== undefined) patch.color = body.color;
            if (body.structure !== undefined) patch.structure = body.structure;

            const record = await this.templatesService.update({
                workspaceId,
                actorId,
                id,
                patch,
            });

            this.logger.info("templates.update.ok", {
                requestId: req.requestId,
                workspaceId,
                templateId: id,
                fields: Object.keys(patch),
            });

            res.status(200).json(toWireTemplate(record));
        } catch (err) {
            next(err);
        }
    }

    /**
     * DELETE /api/v1/templates/:id — hard delete (👑 owner/admin). Spawned tasks
     * are unaffected. Returns 204 No Content; 404 `template.not_found` for a
     * missing or cross-workspace id.
     */
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const id = req.params.id;

            await this.templatesService.delete({ workspaceId, actorId, id });

            this.logger.info("templates.delete.ok", {
                requestId: req.requestId,
                workspaceId,
                templateId: id,
            });

            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/templates/:id/apply — spawn a task + checklist from a template
     * (🔐 any member). Returns 201 with the materialised task summary +
     * checklist. Workspace + actor come from `req.auth`.
     */
    async apply(req: ApplyTemplateRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const body = req.body;

            const result = await this.applyService.apply({
                workspaceId,
                actorId,
                templateId: req.params.id,
                listId: body.list_id,
                taskName: optionalText(body.task_name ?? undefined),
                anchorDate: body.anchor_date ?? null,
            });

            this.logger.info("templates.apply.ok", {
                requestId: req.requestId,
                workspaceId,
                templateId: req.params.id,
                taskId: result.id,
            });

            res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    }
}
