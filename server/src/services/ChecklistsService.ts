import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    ChecklistsRepo,
    type ChecklistItemRow,
    type ChecklistRow,
} from "../repositories/ChecklistsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import {
    toWireChecklist,
    toWireChecklists,
    toWireItem,
    type WireChecklist,
    type WireChecklistItem,
} from "../serializers/checklistSerializer";

/**
 * §15 Checklists domain logic. Owns workspace isolation (every checklist /
 * item is reached through its task, which must be in the caller's workspace),
 * append-positioning, the toggle's completed_by/at bookkeeping, and the
 * spec-mandated `task_activity` rows on item edit + toggle (written in the same
 * transaction as the change). Deleting a checklist cascades to its items.
 */

export interface ListChecklistsInput {
    idOrKey: string;
    workspaceId: string;
}
export interface CreateChecklistInput {
    idOrKey: string;
    workspaceId: string;
    name: string;
}
export interface UpdateChecklistInput {
    id: string;
    workspaceId: string;
    name?: string;
    position?: number;
}
export interface ChecklistRefInput {
    id: string;
    workspaceId: string;
}
export interface AddItemInput {
    checklistId: string;
    workspaceId: string;
    text: string;
    assigneeId?: string | null;
    parentItemId?: string | null;
    position?: number;
}
export interface BulkAddItemsInput {
    checklistId: string;
    workspaceId: string;
    texts: string[];
}
export interface UpdateItemInput {
    id: string;
    workspaceId: string;
    actorId: string;
    text?: string;
    assigneeId?: string | null;
    position?: number;
}
export interface ItemActionInput {
    id: string;
    workspaceId: string;
    actorId: string;
}

export class ChecklistsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private checklists: ChecklistsRepo,
        private tasks: TasksRepo,
        private activity: TaskActivityRepo,
    ) {}

    /** GET — all checklists for a task, each with its items nested. */
    async listForTask(input: ListChecklistsInput): Promise<WireChecklist[]> {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);
        const lists = await this.checklists.listByTask(task.id);
        const items = await this.checklists.listItemsByChecklistIds(
            lists.map((l) => l.id),
        );
        return toWireChecklists(lists, items);
    }

    /** POST — create an empty checklist, appended after the task's existing ones. */
    async createChecklist(
        input: CreateChecklistInput,
    ): Promise<WireChecklist> {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);
        const created = await this.db.transaction(async (tx) => {
            const position = await this.checklists.nextChecklistPosition(
                task.id,
                tx,
            );
            return this.checklists.insertChecklist(
                { taskId: task.id, name: input.name, position },
                tx,
            );
        });
        return toWireChecklist(created, []);
    }

    /** PATCH — rename / reposition a checklist. */
    async updateChecklist(
        input: UpdateChecklistInput,
    ): Promise<WireChecklist> {
        const checklist = await this.requireChecklist(
            input.id,
            input.workspaceId,
        );
        const patch: { name?: string; position?: number } = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.position !== undefined) patch.position = input.position;
        if (Object.keys(patch).length > 0) {
            await this.checklists.updateChecklist(checklist.id, patch);
        }
        const fresh =
            (await this.checklists.findChecklistById(checklist.id)) ?? checklist;
        const items = await this.checklists.listItemsByChecklistIds([fresh.id]);
        return toWireChecklist(fresh, items);
    }

    /** DELETE — drop a checklist (items cascade). */
    async deleteChecklist(input: ChecklistRefInput): Promise<void> {
        const checklist = await this.requireChecklist(
            input.id,
            input.workspaceId,
        );
        await this.checklists.deleteChecklist(checklist.id);
    }

    /** POST — add a single item, appended after the checklist's existing items. */
    async addItem(input: AddItemInput): Promise<WireChecklistItem> {
        const checklist = await this.requireChecklist(
            input.checklistId,
            input.workspaceId,
        );
        const created = await this.db.transaction(async (tx) => {
            const position =
                input.position ??
                (await this.checklists.nextItemPosition(checklist.id, tx));
            return this.checklists.insertItem(
                {
                    checklistId: checklist.id,
                    text: input.text,
                    parentItemId: input.parentItemId ?? null,
                    assigneeId: input.assigneeId ?? null,
                    position,
                },
                tx,
            );
        });
        return toWireItem(created);
    }

    /** POST bulk — insert many items atomically (the §23 template workhorse). */
    async bulkAddItems(
        input: BulkAddItemsInput,
    ): Promise<WireChecklistItem[]> {
        const checklist = await this.requireChecklist(
            input.checklistId,
            input.workspaceId,
        );
        const created = await this.db.transaction(async (tx) => {
            const base = await this.checklists.nextItemPosition(
                checklist.id,
                tx,
            );
            return this.checklists.insertItems(
                input.texts.map((text, i) => ({
                    checklistId: checklist.id,
                    text,
                    position: base + i,
                })),
                tx,
            );
        });
        return created.map(toWireItem);
    }

    /** PATCH item — edit text / assignee / position; logs `task_activity`. */
    async updateItem(input: UpdateItemInput): Promise<WireChecklistItem> {
        const { item, checklist } = await this.requireItem(
            input.id,
            input.workspaceId,
        );
        const patch: {
            text?: string;
            assigneeId?: string | null;
            position?: number;
        } = {};
        if (input.text !== undefined) patch.text = input.text;
        if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
        if (input.position !== undefined) patch.position = input.position;

        if (Object.keys(patch).length > 0) {
            await this.db.transaction(async (tx) => {
                await this.checklists.updateItem(item.id, patch, tx);
                await this.activity.recordMany(
                    [
                        {
                            taskId: checklist.taskId,
                            actorId: input.actorId,
                            action: "checklist_item_updated",
                            context: {
                                checklist_id: checklist.id,
                                item_id: item.id,
                            },
                        },
                    ],
                    tx,
                );
            });
        }
        const fresh = (await this.checklists.findItemById(item.id)) ?? item;
        return toWireItem(fresh);
    }

    /** POST toggle — flip is_completed, stamp completed_by/at; logs activity. */
    async toggleItem(input: ItemActionInput): Promise<WireChecklistItem> {
        const { item, checklist } = await this.requireItem(
            input.id,
            input.workspaceId,
        );
        const isCompleted = !item.isCompleted;
        const now = new Date();
        const completedAt = isCompleted ? now : null;
        const completedBy = isCompleted ? input.actorId : null;

        await this.db.transaction(async (tx) => {
            await this.checklists.setItemCompletion(
                item.id,
                { isCompleted, completedAt, completedBy },
                tx,
            );
            await this.activity.recordMany(
                [
                    {
                        taskId: checklist.taskId,
                        actorId: input.actorId,
                        action: "checklist_item_toggled",
                        context: {
                            checklist_id: checklist.id,
                            item_id: item.id,
                            is_completed: isCompleted,
                        },
                    },
                ],
                tx,
            );
        });
        return toWireItem({ ...item, isCompleted, completedAt, completedBy });
    }

    /** DELETE item. */
    async deleteItem(input: ChecklistRefInput): Promise<void> {
        const { item } = await this.requireItem(input.id, input.workspaceId);
        await this.checklists.deleteItem(item.id);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /** Resolve `:id` (internal id or custom_id) to a task in the workspace. */
    private async requireTask(idOrKey: string, workspaceId: string) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            idOrKey,
            workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${idOrKey} does not exist`,
            );
        }
        return task;
    }

    /**
     * A checklist whose task is in the caller's workspace, or
     * `404 checklist.not_found` (missing + cross-tenant collapse to one 404).
     */
    private async requireChecklist(
        id: string,
        workspaceId: string,
    ): Promise<ChecklistRow> {
        const checklist = await this.checklists.findChecklistById(id);
        if (!checklist) {
            throw AppError.notFound(
                "checklist.not_found",
                `Checklist ${id} does not exist`,
            );
        }
        const task = await this.tasks.findByIdInWorkspace(
            checklist.taskId,
            workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "checklist.not_found",
                `Checklist ${id} does not exist`,
            );
        }
        return checklist;
    }

    /**
     * An item + its checklist, both reachable in the caller's workspace, or
     * `404 checklist_item.not_found`.
     */
    private async requireItem(
        id: string,
        workspaceId: string,
    ): Promise<{ item: ChecklistItemRow; checklist: ChecklistRow }> {
        const item = await this.checklists.findItemById(id);
        if (!item) {
            throw AppError.notFound(
                "checklist_item.not_found",
                `Checklist item ${id} does not exist`,
            );
        }
        const checklist = await this.checklists.findChecklistById(
            item.checklistId,
        );
        if (!checklist) {
            throw AppError.notFound(
                "checklist_item.not_found",
                `Checklist item ${id} does not exist`,
            );
        }
        const task = await this.tasks.findByIdInWorkspace(
            checklist.taskId,
            workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "checklist_item.not_found",
                `Checklist item ${id} does not exist`,
            );
        }
        return { item, checklist };
    }
}
