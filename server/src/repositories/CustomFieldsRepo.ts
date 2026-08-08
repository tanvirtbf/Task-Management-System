import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    attachments,
    customFieldOptions,
    customFields,
    taskCustomFieldValues,
    tasks,
} from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for the §17 Custom Fields domain (`custom_fields`,
 * `custom_field_options`, `task_custom_field_values`). The service composes the
 * workspace-scoping + per-type value rules over the rows this repo returns.
 *
 * The select lists are tight: a field row carries only what the wire
 * `CustomField` (API_DESIGN.md Appendix A) + the service's value-validation need
 * (`type`, `config`) — never `workspace_id` / `created_by` / timestamps, which
 * must not leak into the wire shape.
 */

export type CustomFieldType = (typeof customFields.$inferSelect)["type"];
export type CustomFieldScopeType =
    (typeof customFields.$inferSelect)["scopeType"];

/** A custom-field definition in the shape the service + wire need. */
export interface CustomFieldRecord {
    id: string;
    scopeType: CustomFieldScopeType;
    scopeId: string | null;
    name: string;
    type: CustomFieldType;
    config: Record<string, unknown>;
    isRequired: boolean;
    /** F26 (ISS-042): the guest-redaction flag, now on the wire. */
    hiddenFromGuests: boolean;
    defaultValue: unknown;
    position: number;
}

/** A dropdown option in wire shape. */
export interface CustomFieldOptionRecord {
    id: string;
    customFieldId: string;
    label: string;
    color: string;
    position: number;
}

/** Partial mutable fields for `PATCH /custom-fields/:id` (type/scope immutable). */
export interface CustomFieldUpdateFields {
    name?: string;
    config?: Record<string, unknown>;
    isRequired?: boolean;
    hiddenFromGuests?: boolean;
    position?: number;
}

const FIELD_COLUMNS = {
    id: customFields.id,
    scopeType: customFields.scopeType,
    scopeId: customFields.scopeId,
    name: customFields.name,
    type: customFields.type,
    config: customFields.config,
    isRequired: customFields.isRequired,
    hiddenFromGuests: customFields.hiddenFromGuests,
    defaultValue: customFields.defaultValue,
    position: customFields.position,
};

export class CustomFieldsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    // ─── field definitions ──────────────────────────────────────────────────

    /**
     * All custom fields in a workspace, ordered by scope then position then id
     * (deterministic). Optionally narrow to one `scopeType` (+ `scopeId`).
     * Backed by `idx_custom_fields_workspace` / `idx_custom_fields_scope`.
     */
    async listByWorkspace(
        workspaceId: string,
        opts: { scopeType?: CustomFieldScopeType; scopeId?: string } = {},
    ): Promise<CustomFieldRecord[]> {
        const where: SQL[] = [eq(customFields.workspaceId, workspaceId)];
        if (opts.scopeType !== undefined) {
            where.push(eq(customFields.scopeType, opts.scopeType));
        }
        if (opts.scopeId !== undefined) {
            where.push(eq(customFields.scopeId, opts.scopeId));
        }
        const rows = await this.db
            .select(FIELD_COLUMNS)
            .from(customFields)
            .where(and(...where))
            .orderBy(
                asc(customFields.scopeType),
                asc(customFields.position),
                asc(customFields.id),
            );
        return rows as CustomFieldRecord[];
    }

    /**
     * The fields that APPLY to a list: the union of (a) workspace-scoped fields,
     * (b) space-scoped fields for the list's parent space, and (c) list-scoped
     * fields for the list itself — all within the workspace. Ordered by scope,
     * position, id.
     */
    async listForList(
        workspaceId: string,
        spaceId: string,
        listId: string,
    ): Promise<CustomFieldRecord[]> {
        const rows = await this.db
            .select(FIELD_COLUMNS)
            .from(customFields)
            .where(
                and(
                    eq(customFields.workspaceId, workspaceId),
                    or(
                        and(
                            eq(customFields.scopeType, "workspace"),
                            isNull(customFields.scopeId),
                        ),
                        and(
                            eq(customFields.scopeType, "space"),
                            eq(customFields.scopeId, spaceId),
                        ),
                        and(
                            eq(customFields.scopeType, "list"),
                            eq(customFields.scopeId, listId),
                        ),
                    ),
                ),
            )
            .orderBy(
                asc(customFields.scopeType),
                asc(customFields.position),
                asc(customFields.id),
            );
        return rows as CustomFieldRecord[];
    }

    /**
     * Resolve one field by id within a workspace. Returns `null` when the id
     * does not exist OR belongs to another workspace (callers map both to `404
     * custom_field.not_found` — no cross-workspace existence oracle). Pass `exec`
     * to read inside a transaction.
     */
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<CustomFieldRecord | null> {
        const [row] = await exec
            .select(FIELD_COLUMNS)
            .from(customFields)
            .where(
                and(
                    eq(customFields.id, id),
                    eq(customFields.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return (row as CustomFieldRecord | undefined) ?? null;
    }

    /**
     * Lock a field row (`SELECT … FOR UPDATE`) scoped to the workspace, for the
     * update/delete read-modify-write. Must run inside a transaction.
     */
    async lockByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor,
    ): Promise<CustomFieldRecord | null> {
        const [row] = await exec
            .select(FIELD_COLUMNS)
            .from(customFields)
            .where(
                and(
                    eq(customFields.id, id),
                    eq(customFields.workspaceId, workspaceId),
                ),
            )
            .for("update");
        return (row as CustomFieldRecord | undefined) ?? null;
    }

    /**
     * Insert a field definition and return its generated id. `created_at` /
     * `updated_at` default in the DB. Pass `exec` to run inside the create tx so
     * the option rows + activity row are atomic with this insert.
     */
    async insert(
        input: {
            workspaceId: string;
            scopeType: CustomFieldScopeType;
            scopeId: string | null;
            name: string;
            type: CustomFieldType;
            config: Record<string, unknown>;
            isRequired: boolean;
            defaultValue: unknown;
            position: number;
            hiddenFromGuests: boolean;
            createdBy: string;
        },
        exec: DbExecutor = this.db,
    ): Promise<string> {
        const id = fakeId("cf");
        await exec.insert(customFields).values({
            id,
            workspaceId: input.workspaceId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            name: input.name,
            type: input.type,
            config: input.config,
            isRequired: input.isRequired,
            defaultValue: input.defaultValue,
            position: input.position,
            hiddenFromGuests: input.hiddenFromGuests,
            createdBy: input.createdBy,
        });
        return id;
    }

    /** Apply a partial update to a field (name/config/is_required/position). */
    async updateFields(
        id: string,
        fields: CustomFieldUpdateFields,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(customFields)
            .set(fields)
            .where(eq(customFields.id, id));
    }

    /**
     * Hard-delete a field by id. The DB cascades `custom_field_options` and
     * `task_custom_field_values` via their `ON DELETE CASCADE` FKs, so no manual
     * child cleanup is needed. Returns rows removed (0 if a concurrent delete
     * already won). Pass `exec` to run inside the delete tx.
     */
    async deleteById(id: string, exec: DbExecutor = this.db): Promise<number> {
        const [result] = await exec
            .delete(customFields)
            .where(eq(customFields.id, id));
        return result.affectedRows;
    }

    // ─── dropdown options ────────────────────────────────────────────────────

    /**
     * Insert dropdown option rows for a field. Each gets a generated id; the
     * `(custom_field_id, label)` UNIQUE index rejects duplicate labels.
     */
    async insertOptions(
        customFieldId: string,
        options: { label: string; color?: string; position?: number }[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (options.length === 0) return;
        await exec.insert(customFieldOptions).values(
            options.map((o, i) => ({
                id: fakeId("cfo"),
                customFieldId,
                label: o.label,
                ...(o.color !== undefined ? { color: o.color } : {}),
                position: o.position ?? i,
            })),
        );
    }

    /** Options for a set of fields, grouped by field id, ordered by position. */
    async optionsByFieldIds(
        fieldIds: string[],
    ): Promise<Map<string, CustomFieldOptionRecord[]>> {
        const map = new Map<string, CustomFieldOptionRecord[]>();
        if (fieldIds.length === 0) return map;
        const rows = await this.db
            .select({
                id: customFieldOptions.id,
                customFieldId: customFieldOptions.customFieldId,
                label: customFieldOptions.label,
                color: customFieldOptions.color,
                position: customFieldOptions.position,
            })
            .from(customFieldOptions)
            .where(inArray(customFieldOptions.customFieldId, fieldIds))
            .orderBy(
                asc(customFieldOptions.customFieldId),
                asc(customFieldOptions.position),
                asc(customFieldOptions.id),
            );
        for (const row of rows) {
            const arr = map.get(row.customFieldId) ?? [];
            arr.push(row);
            map.set(row.customFieldId, arr);
        }
        return map;
    }

    /** True when `optionId` is an option of `customFieldId` (dropdown validate). */
    async optionExists(
        customFieldId: string,
        optionId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [row] = await exec
            .select({ id: customFieldOptions.id })
            .from(customFieldOptions)
            .where(
                and(
                    eq(customFieldOptions.id, optionId),
                    eq(customFieldOptions.customFieldId, customFieldId),
                ),
            )
            .limit(1);
        return row !== undefined;
    }

    // ─── per-task values ──────────────────────────────────────────────────────

    /**
     * Upsert a single task's value for a field (PK `(task_id, custom_field_id)`).
     * Stores the typed JSON envelope verbatim — the value's `$.option_id` powers
     * the VIRTUAL `option_id_generated` column for dropdown filters. Pass `exec`
     * to run inside the set-value tx.
     */
    async upsertValue(
        taskId: string,
        customFieldId: string,
        value: unknown,
        updatedBy: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .insert(taskCustomFieldValues)
            .values({ taskId, customFieldId, value, updatedBy })
            .onDuplicateKeyUpdate({ set: { value, updatedBy } });
    }

    /**
     * Delete a single task's value for a field. Returns `true` when a row was
     * removed, `false` on an idempotent no-op (no value was set).
     */
    async deleteValue(
        taskId: string,
        customFieldId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .delete(taskCustomFieldValues)
            .where(
                and(
                    eq(taskCustomFieldValues.taskId, taskId),
                    eq(taskCustomFieldValues.customFieldId, customFieldId),
                ),
            );
        return result.affectedRows > 0;
    }

    // ─── files-value attachment validation ─────────────────────────────────────

    /**
     * Return the subset of `fileIds` that are live attachments belonging to the
     * given workspace (an attachment reaches a workspace only through its task:
     * `attachments.task_id → tasks.workspace_id`). Soft-deleted attachments
     * (`deleted_at IS NOT NULL`) are excluded. The caller rejects the difference
     * → so a cross-workspace or missing id is indistinguishable (no oracle).
     */
    async findAttachmentIdsInWorkspace(
        fileIds: string[],
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<Set<string>> {
        if (fileIds.length === 0) return new Set();
        const rows = await exec
            .select({ id: attachments.id })
            .from(attachments)
            .innerJoin(tasks, eq(attachments.taskId, tasks.id))
            .where(
                and(
                    inArray(attachments.id, fileIds),
                    eq(tasks.workspaceId, workspaceId),
                    isNull(attachments.deletedAt),
                ),
            );
        return new Set(rows.map((r) => r.id));
    }
}
