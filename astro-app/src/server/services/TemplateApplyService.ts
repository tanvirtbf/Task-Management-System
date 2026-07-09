import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { checklistItems, checklists, type NewTask } from "../db/schema";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { TemplatesRepo } from "../repositories/TemplatesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import type { TemplateStructure } from "../types/templates";

/**
 * §23 #6 — "Apply template": spawn a parent task with the template's checklist
 * materialised, in ONE transaction. Kept separate from the CRUD
 * `TemplatesService` (mirrors the §10 `TasksService` / `TaskWriteService`
 * split) because it pulls in the task/list/status/membership/activity repos.
 *
 * Per-item due dates: the spec computes `due_date = anchor_date + dueOffsetDays`,
 * but `checklist_items` has no `due_date` column (it is absent from the Drizzle
 * schema, the migrations, and `database/schema.sql`), and the frontend's
 * checklist-item type models no due date. Per the product decision, per-item due
 * dates are DEFERRED: `anchor_date` is accepted (and format-validated) but not
 * materialised. Adding a `checklist_items.due_date` column later is the path to
 * enabling it.
 */

const DONE_GROUPS = new Set(["done", "closed"]);
const TASK_NUMBER_MAX_RETRIES = 4;

/** libSQL surfaces a unique-violation as `SQLITE_CONSTRAINT_UNIQUE` (or a
 *  generic `SQLITE_CONSTRAINT` whose message names the UNIQUE constraint). */
const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; message?: string } | null;
    return (
        e?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
        (typeof e?.message === "string" &&
            e.message.includes("UNIQUE constraint failed"))
    );
};

export interface ApplyTemplateInput {
    workspaceId: string;
    actorId: string;
    templateId: string;
    listId: string;
    /** Defaults to the template's `name`. */
    taskName?: string;
    /** Accepted + format-validated, but not materialised (see class note). */
    anchorDate?: string | null;
}

export interface ApplyResultChecklistItem {
    id: string;
    checklist_id: string;
    parent_item_id: string | null;
    text: string;
    is_completed: boolean;
    completed_at: string | null;
    completed_by: string | null;
    assignee_id: string | null;
    position: number;
}

export interface ApplyResultChecklist {
    id: string;
    name: string;
    items: ApplyResultChecklistItem[];
}

/** §23 #6 `201` body — a task summary plus the materialised checklist(s). */
export interface ApplyResult {
    id: string;
    task_number: number;
    name: string;
    primary_list_id: string;
    task_type_id: string;
    priority: number;
    tags: string[];
    subtasks_count: number;
    checklists: ApplyResultChecklist[];
    created_at: string;
}

export class TemplateApplyService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private templates: TemplatesRepo,
        private taskTypes: TaskTypesRepo,
        private tags: TagsRepo,
        private lists: ListsRepo,
        private statuses: StatusesRepo,
        private tasks: TasksRepo,
        private membership: TaskMembershipRepo,
        private activity: TaskActivityRepo,
    ) {}

    /**
     * Spawn a task + checklist from a template (`POST /templates/:id/apply`, 🔐).
     *
     * Validation precedence (all fail-fast, before any write):
     *   404 `template.not_found` → 422 `template.empty_structure`
     *   → 404 `list.not_found` / 409 `list.archived`
     *   → 422 `template.invalid_task_type` → 422 `template.invalid_tag`.
     *
     * Then, in one transaction (with the per-list `task_number` retry the §10
     * create uses): insert the task, attach the template's tags, insert the
     * checklist + one item per `structure.checklistItems[]`, bump
     * `templates.usage_count`, and append a `created_from_template` activity row.
     */
    async apply(input: ApplyTemplateInput): Promise<ApplyResult> {
        // 1. Template must exist in the workspace.
        const template = await this.templates.findByIdInWorkspace(
            input.templateId,
            input.workspaceId,
        );
        if (!template) {
            throw AppError.notFound(
                "template.not_found",
                `Template ${input.templateId} does not exist`,
            );
        }
        const structure = (template.structure ?? {}) as TemplateStructure;

        // 2. List must exist in the workspace and not be archived. Resolved
        //    BEFORE the empty-structure check to match the §23 apply error order
        //    (template.not_found → list.not_found → template.empty_structure).
        const list = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }
        if (list.archivedAt) {
            throw AppError.conflict(
                "list.archived",
                "Cannot apply a template to an archived list",
            );
        }

        // 3. There must be at least one checklist item to materialise.
        const items = Array.isArray(structure.checklistItems)
            ? structure.checklistItems
            : [];
        if (items.length === 0) {
            throw AppError.unprocessable(
                "template.empty_structure",
                "Template has no checklist items to materialise",
            );
        }

        // 4. Resolve + re-validate the task type (template structure, else the
        //    list default). A type valid at template-create time may since have
        //    been deleted.
        const taskTypeId = structure.taskTypeId ?? list.defaultTaskTypeId;
        if (!taskTypeId) {
            throw AppError.unprocessable(
                "template.invalid_task_type",
                "Template has no task type and the target list has no default",
            );
        }
        const taskType = await this.taskTypes.findByIdInWorkspace(
            taskTypeId,
            input.workspaceId,
        );
        if (!taskType) {
            throw AppError.unprocessable(
                "template.invalid_task_type",
                `Task type ${taskTypeId} does not exist in this workspace`,
            );
        }

        // 5. Re-validate the template's tags.
        const tagIds = Array.isArray(structure.tags)
            ? structure.tags.filter((t): t is string => typeof t === "string")
            : [];
        if (tagIds.length > 0) {
            const found = await this.tags.findIdsInWorkspace(
                tagIds,
                input.workspaceId,
            );
            const missing = tagIds.filter((t) => !found.has(t));
            if (missing.length > 0) {
                throw AppError.unprocessable(
                    "template.invalid_tag",
                    `Tag(s) not found in this workspace: ${missing.join(", ")}`,
                );
            }
        }

        // 6. Default status = the list's lowest-position status.
        const listStatuses = await this.statuses.listByList(input.listId);
        if (listStatuses.length === 0) {
            throw AppError.internal(
                "List has no statuses configured; cannot place a task",
            );
        }
        const status = listStatuses.reduce((lo, s) =>
            s.position < lo.position ? s : lo,
        );

        const now = new Date();
        const taskName = input.taskName ?? template.name;
        const checklistName = structure.checklistName ?? template.name;
        const priority =
            typeof structure.priority === "number" ? structure.priority : 0;
        const completedAt = DONE_GROUPS.has(status.statusGroup) ? now : null;

        const taskId = fakeId("t");
        const checklistId = fakeId("ch");
        // Pre-generate item rows so the ids are stable for the response.
        const itemRows = items.map((it, i) => ({
            id: fakeId("ci"),
            checklistId,
            text: it.text,
            position: i,
        }));

        // 7. Atomic spawn, retrying only on a per-list task_number collision.
        let taskNumber = 0;
        for (let attempt = 1; ; attempt += 1) {
            taskNumber = await this.tasks.nextTaskNumber(input.listId);
            try {
                await this.db.transaction(async (tx) => {
                    const row: NewTask = {
                        id: taskId,
                        workspaceId: input.workspaceId,
                        primaryListId: input.listId,
                        taskNumber,
                        name: taskName,
                        description: structure.description ?? null,
                        statusId: status.id,
                        priority,
                        taskTypeId,
                        completedAt,
                        createdBy: input.actorId,
                    };
                    await this.tasks.insert(row, tx);

                    if (tagIds.length > 0) {
                        await this.membership.addTags(taskId, tagIds, tx);
                    }

                    await tx.insert(checklists).values({
                        id: checklistId,
                        taskId,
                        name: checklistName,
                        position: 0,
                    });
                    await tx.insert(checklistItems).values(itemRows);

                    await this.templates.incrementUsage(input.templateId, tx);

                    await this.activity.recordMany(
                        [
                            {
                                taskId,
                                actorId: input.actorId,
                                action: "created_from_template",
                                context: {
                                    templateId: input.templateId,
                                    templateName: template.name,
                                },
                            },
                        ],
                        tx,
                    );
                });
                break; // committed
            } catch (err) {
                if (
                    isDuplicateKeyError(err) &&
                    attempt < TASK_NUMBER_MAX_RETRIES
                ) {
                    continue; // a racing per-list task_number — recompute + retry
                }
                throw err;
            }
        }

        // 8. Authoritative created_at from the persisted row.
        const created = await this.tasks.findByIdOrCustomIdInWorkspace(
            taskId,
            input.workspaceId,
        );
        const createdAt = (created?.createdAt ?? now).toISOString();

        return {
            id: taskId,
            task_number: taskNumber,
            name: taskName,
            primary_list_id: input.listId,
            task_type_id: taskTypeId,
            priority,
            tags: tagIds,
            subtasks_count: 0,
            checklists: [
                {
                    id: checklistId,
                    name: checklistName,
                    items: itemRows.map((r) => ({
                        id: r.id,
                        checklist_id: checklistId,
                        parent_item_id: null,
                        text: r.text,
                        is_completed: false,
                        completed_at: null,
                        completed_by: null,
                        assignee_id: null,
                        position: r.position,
                    })),
                },
            ],
            created_at: createdAt,
        };
    }
}
