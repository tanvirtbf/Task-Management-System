import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    TemplatesRepo,
    type TemplateRecord,
    type TemplateListFilters,
    type TemplateUpdateRow,
} from "../repositories/TemplatesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { fakeId } from "../utils";
import type { TemplateStructure, TemplateType } from "../types/templates";

/**
 * §23 Templates business logic. Reads are single workspace-scoped queries;
 * `create`/`update`/`delete` own validation + (for update) a row-locked
 * transaction. No `workspace_activity` row is written: the §23 contract does
 * not require workspace audit entries for template CRUD (and the
 * `workspace_activity.entity_type` enum has no `template` member), unlike the
 * 👑 catalog endpoints that do.
 */

export interface CreateTemplateInput {
    workspaceId: string;
    actorId: string;
    type: TemplateType;
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure: TemplateStructure;
}

export interface UpdateTemplateInput {
    workspaceId: string;
    actorId: string;
    id: string;
    /** Only the keys the client sent; `structure`, if present, is a full replacement. */
    patch: TemplateUpdateRow;
}

export interface DeleteTemplateInput {
    workspaceId: string;
    actorId: string;
    id: string;
}

/** True for the mysql2 unique-constraint violation (errno 1062). */
const isDuplicateKeyError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ER_DUP_ENTRY";

export class TemplatesService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private templates: TemplatesRepo,
        private taskTypes: TaskTypesRepo,
        private tags: TagsRepo,
    ) {}

    /**
     * List a workspace's templates, optionally filtered by `type` / name `q`.
     * `workspaceId` always comes from the caller's verified JWT, so there is no
     * cross-tenant read path.
     */
    async list(
        workspaceId: string,
        filters: TemplateListFilters,
    ): Promise<TemplateRecord[]> {
        return this.templates.listByWorkspace(workspaceId, filters);
    }

    /** Fetch one template in the caller's workspace, or 404 `template.not_found`. */
    async getById(
        workspaceId: string,
        id: string,
    ): Promise<TemplateRecord> {
        const template = await this.templates.findByIdInWorkspace(
            id,
            workspaceId,
        );
        if (!template) {
            throw AppError.notFound(
                "template.not_found",
                `Template ${id} does not exist`,
            );
        }
        return template;
    }

    /**
     * Create a template. Validates the structure (≥1 checklist item, a valid
     * `taskTypeId`, existing `tags[]`) before the insert. A duplicate name
     * (`(workspace_id, name)` UNIQUE, case-insensitive under
     * `utf8mb4_unicode_ci`) surfaces as `409 template.duplicate`.
     */
    async create(input: CreateTemplateInput): Promise<TemplateRecord> {
        await this.validateStructure(input.workspaceId, input.structure);

        const id = fakeId("tpl");
        try {
            return await this.templates.create({
                id,
                workspaceId: input.workspaceId,
                type: input.type,
                name: input.name,
                description: input.description ?? null,
                icon: input.icon ?? null,
                color: input.color ?? null,
                structure: input.structure,
                createdBy: input.actorId,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "template.duplicate",
                    `A template named "${input.name}" already exists in this workspace`,
                );
            }
            throw err;
        }
    }

    /**
     * Apply a partial update. The row is resolved + locked inside the
     * transaction first (404 `template.not_found` for a missing/cross-tenant
     * id), then — if `structure` is being replaced — re-validated, then written.
     * Precedence: empty-patch 422 → not_found 404 → structure 422 → duplicate
     * 409. `type` and `usage_count` are not part of the patch (immutable /
     * read-only).
     */
    async update(input: UpdateTemplateInput): Promise<TemplateRecord> {
        const { workspaceId, id, patch } = input;

        if (Object.keys(patch).length === 0) {
            throw AppError.validationFailed([
                { issue: "Provide at least one field to update" },
            ]);
        }

        try {
            return await this.db.transaction(async (tx) => {
                const existing = await this.templates.findByIdInWorkspace(
                    id,
                    workspaceId,
                    tx,
                    { forUpdate: true },
                );
                if (!existing) {
                    throw AppError.notFound(
                        "template.not_found",
                        `Template ${id} does not exist`,
                    );
                }

                if (patch.structure !== undefined) {
                    await this.validateStructure(workspaceId, patch.structure);
                }

                return await this.templates.update(id, patch, tx);
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "template.duplicate",
                    `A template named "${patch.name}" already exists in this workspace`,
                );
            }
            throw err;
        }
    }

    /**
     * Hard-delete a template in the caller's workspace. Resolved within the
     * workspace first (404 `template.not_found` for a missing/cross-tenant id),
     * then deleted by PK. Tasks already spawned from it are unaffected (no FK
     * from `tasks` to `templates`).
     */
    async delete(input: DeleteTemplateInput): Promise<void> {
        const { workspaceId, id } = input;

        const existing = await this.templates.findByIdInWorkspace(
            id,
            workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "template.not_found",
                `Template ${id} does not exist`,
            );
        }

        const affected = await this.templates.deleteById(id);
        if (affected === 0) {
            // The row vanished between the resolve and the delete (a concurrent
            // delete) — surface a 404, not a silent success.
            throw AppError.notFound(
                "template.not_found",
                `Template ${id} does not exist`,
            );
        }
    }

    /**
     * Validate a template `structure` against the workspace:
     *   - `template.empty_structure` (422) when there is no checklist item.
     *   - `template.invalid_task_type` (422) when `structure.taskTypeId` is set
     *     but does not exist in the workspace.
     *   - `template.invalid_tag` (422) when any `structure.tags[]` id does not
     *     exist in the workspace.
     * The cross-resource lookups run on the pool (not a tx handle) — they are
     * independent reads, safe to issue while the caller holds an unrelated row
     * lock.
     */
    private async validateStructure(
        workspaceId: string,
        structure: TemplateStructure,
    ): Promise<void> {
        const items = structure?.checklistItems;
        if (!Array.isArray(items) || items.length === 0) {
            throw AppError.unprocessable(
                "template.empty_structure",
                "Template structure must include at least one checklist item",
            );
        }

        if (structure.taskTypeId) {
            const taskType = await this.taskTypes.findByIdInWorkspace(
                structure.taskTypeId,
                workspaceId,
            );
            if (!taskType) {
                throw AppError.unprocessable(
                    "template.invalid_task_type",
                    `Task type ${structure.taskTypeId} does not exist in this workspace`,
                );
            }
        }

        if (structure.tags && structure.tags.length > 0) {
            const found = await this.tags.findIdsInWorkspace(
                structure.tags,
                workspaceId,
            );
            const missing = structure.tags.filter((tagId) => !found.has(tagId));
            if (missing.length > 0) {
                throw AppError.unprocessable(
                    "template.invalid_tag",
                    `Tag(s) not found in this workspace: ${missing.join(", ")}`,
                );
            }
        }
    }
}
