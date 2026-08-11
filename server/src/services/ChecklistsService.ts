import { MySql2Database } from "drizzle-orm/mysql2";
import { assertTaskScoped } from "../rbac/scopeGuard";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    ChecklistsRepo,
    type ChecklistItemRow,
    type ChecklistRow,
} from "../repositories/ChecklistsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { UsersRepo } from "../repositories/UsersRepo";
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
    actorId: string;
    name: string;
}
export interface UpdateChecklistInput {
    id: string;
    workspaceId: string;
    /** The caller (`req.auth.sub`) — the `checklist_renamed` audit actor. */
    actorId: string;
    name?: string;
    position?: number;
}
export interface ChecklistRefInput {
    id: string;
    workspaceId: string;
    actorId: string;
}
export interface AddItemInput {
    checklistId: string;
    workspaceId: string;
    actorId: string;
    text: string;
    assigneeId?: string | null;
    parentItemId?: string | null;
    position?: number;
}
export interface BulkAddItemsInput {
    checklistId: string;
    workspaceId: string;
    actorId: string;
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
        private users: UsersRepo,
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
        // Team-access P7: a checklist is task CONTENT — mutating it requires
        // `task.edit` reach (assignee / creator / head of the owning space).
        await assertTaskScoped("task.edit", task, this.tasks);
        const created = await this.db.transaction(async (tx) => {
            const position = await this.checklists.nextChecklistPosition(
                task.id,
                tx,
            );
            const row = await this.checklists.insertChecklist(
                { taskId: task.id, name: input.name, position },
                tx,
            );
            // F21 (ISS-062): creating a checklist finally leaves a trace —
            // before this, ticking one box was logged while creating or
            // deleting the whole list was not, so "who deleted the acceptance
            // criteria?" was unanswerable.
            await this.activity.recordMany(
                [
                    {
                        taskId: task.id,
                        actorId: input.actorId,
                        action: "checklist_created",
                        context: { checklist_id: row.id, name: input.name },
                    },
                ],
                tx,
            );
            return row;
        });
        return toWireChecklist(created, []);
    }

    /** PATCH — rename / reposition a checklist. */
    async updateChecklist(
        input: UpdateChecklistInput,
    ): Promise<WireChecklist> {
        const { checklist, task } = await this.requireChecklist(
            input.id,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        const patch: { name?: string; position?: number } = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.position !== undefined) patch.position = input.position;
        if (Object.keys(patch).length > 0) {
            // Team-access P3 (plan G13): a RENAME is a real change and gets a
            // row with the before/after; a position shuffle is presentation
            // and stays silent (logging every drag would drown the feed).
            const renamed =
                input.name !== undefined && input.name !== checklist.name;
            await this.db.transaction(async (tx) => {
                await this.checklists.updateChecklist(
                    checklist.id,
                    patch,
                    tx,
                );
                if (renamed) {
                    await this.activity.recordMany(
                        [
                            {
                                taskId: checklist.taskId,
                                actorId: input.actorId,
                                action: "checklist_renamed",
                                context: {
                                    checklist_id: checklist.id,
                                    from: checklist.name,
                                    to: input.name,
                                },
                            },
                        ],
                        tx,
                    );
                }
            });
        }
        const fresh =
            (await this.checklists.findChecklistById(checklist.id)) ?? checklist;
        const items = await this.checklists.listItemsByChecklistIds([fresh.id]);
        return toWireChecklist(fresh, items);
    }

    /** DELETE — drop a checklist (items cascade). */
    async deleteChecklist(input: ChecklistRefInput): Promise<void> {
        const { checklist, task } = await this.requireChecklist(
            input.id,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        await this.db.transaction(async (tx) => {
            await this.checklists.deleteChecklist(checklist.id, tx);
            // F21 (ISS-062): the delete records WHAT was deleted (the name —
            // the row is gone, so the trace is the only place it survives).
            await this.activity.recordMany(
                [
                    {
                        taskId: checklist.taskId,
                        actorId: input.actorId,
                        action: "checklist_deleted",
                        context: {
                            checklist_id: checklist.id,
                            name: checklist.name,
                        },
                    },
                ],
                tx,
            );
        });
    }

    /** POST — add a single item, appended after the checklist's existing items. */
    async addItem(input: AddItemInput): Promise<WireChecklistItem> {
        const { checklist, task } = await this.requireChecklist(
            input.checklistId,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        // Validate the optional assignee (active workspace member) + parent (an
        // item in THIS checklist) BEFORE the insert, so an invalid id is a clean
        // 422 rather than an unhandled FK 500 / a cross-tenant write.
        if (input.assigneeId != null) {
            await this.assertAssigneeInWorkspace(
                input.assigneeId,
                input.workspaceId,
            );
        }
        if (input.parentItemId != null) {
            await this.assertParentInChecklist(input.parentItemId, checklist.id);
        }
        const created = await this.db.transaction(async (tx) => {
            const position =
                input.position ??
                (await this.checklists.nextItemPosition(checklist.id, tx));
            const row = await this.checklists.insertItem(
                {
                    checklistId: checklist.id,
                    text: input.text,
                    parentItemId: input.parentItemId ?? null,
                    assigneeId: input.assigneeId ?? null,
                    position,
                },
                tx,
            );
            await this.activity.recordMany(
                [
                    {
                        taskId: checklist.taskId,
                        actorId: input.actorId,
                        action: "checklist_item_added",
                        context: {
                            checklist_id: checklist.id,
                            item_id: row.id,
                            text: input.text.slice(0, 120),
                        },
                    },
                ],
                tx,
            );
            return row;
        });
        return toWireItem(created);
    }

    /** POST bulk — insert many items atomically (the §23 template workhorse). */
    async bulkAddItems(
        input: BulkAddItemsInput,
    ): Promise<WireChecklistItem[]> {
        const { checklist, task } = await this.requireChecklist(
            input.checklistId,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        const created = await this.db.transaction(async (tx) => {
            const base = await this.checklists.nextItemPosition(
                checklist.id,
                tx,
            );
            const rows = await this.checklists.insertItems(
                input.texts.map((text, i) => ({
                    checklistId: checklist.id,
                    text,
                    position: base + i,
                })),
                tx,
            );
            // Team-access P3 (plan G13): the bulk path was the ONE item-add
            // with zero audit. Same per-item shape as the single `addItem`.
            await this.activity.recordMany(
                rows.map((row) => ({
                    taskId: checklist.taskId,
                    actorId: input.actorId,
                    action: "checklist_item_added",
                    context: {
                        checklist_id: checklist.id,
                        item_id: row.id,
                        text: row.text.slice(0, 120),
                        bulk: true,
                    },
                })),
                tx,
            );
            return rows;
        });
        return created.map(toWireItem);
    }

    /** PATCH item — edit text / assignee / position; logs `task_activity`. */
    async updateItem(input: UpdateItemInput): Promise<WireChecklistItem> {
        const { item, checklist, task } = await this.requireItem(
            input.id,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        // A non-null assignee must be an active workspace member (a null clears
        // it). Validated before the write → 422, never a cross-tenant assign.
        if (input.assigneeId != null) {
            await this.assertAssigneeInWorkspace(
                input.assigneeId,
                input.workspaceId,
            );
        }
        const patch: {
            text?: string;
            assigneeId?: string | null;
            position?: number;
        } = {};
        if (input.text !== undefined) patch.text = input.text;
        if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
        if (input.position !== undefined) patch.position = input.position;

        if (Object.keys(patch).length > 0) {
            // Team-access P3 (plan G13): field-level detail. The row used to
            // say only WHICH item — not what happened to it. Text edits carry
            // the before/after (clipped like `checklist_item_added`).
            const detail: Record<string, unknown> = {
                checklist_id: checklist.id,
                item_id: item.id,
                fields: Object.keys(patch),
            };
            if (patch.text !== undefined && patch.text !== item.text) {
                detail.text_from = item.text.slice(0, 120);
                detail.text_to = patch.text.slice(0, 120);
            }
            if (
                patch.assigneeId !== undefined &&
                patch.assigneeId !== item.assigneeId
            ) {
                detail.assignee_from = item.assigneeId ?? null;
                detail.assignee_to = patch.assigneeId ?? null;
            }
            await this.db.transaction(async (tx) => {
                await this.checklists.updateItem(item.id, patch, tx);
                await this.activity.recordMany(
                    [
                        {
                            taskId: checklist.taskId,
                            actorId: input.actorId,
                            action: "checklist_item_updated",
                            context: detail,
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
        const { item, checklist, task } = await this.requireItem(
            input.id,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
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
        const { item, checklist, task } = await this.requireItem(
            input.id,
            input.workspaceId,
        );
        await assertTaskScoped("task.edit", task, this.tasks); // P7
        await this.db.transaction(async (tx) => {
            await this.checklists.deleteItem(item.id, tx);
            await this.activity.recordMany(
                [
                    {
                        taskId: checklist.taskId,
                        actorId: input.actorId,
                        action: "checklist_item_deleted",
                        context: {
                            checklist_id: checklist.id,
                            item_id: item.id,
                            text: item.text.slice(0, 120),
                        },
                    },
                ],
                tx,
            );
        });
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
     * Team-access P7: mutating a checklist is editing its TASK — the resolved
     * task rides back so callers can enforce the `task.edit` reach
     * (assignee / creator / head of the owning space).
     */
    private async requireChecklist(
        id: string,
        workspaceId: string,
    ): Promise<{ checklist: ChecklistRow; task: { id: string; createdBy: string } }> {
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
        return { checklist, task };
    }

    /**
     * An item + its checklist, both reachable in the caller's workspace, or
     * `404 checklist_item.not_found`.
     */
    private async requireItem(
        id: string,
        workspaceId: string,
    ): Promise<{
        item: ChecklistItemRow;
        checklist: ChecklistRow;
        task: { id: string; createdBy: string };
    }> {
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
        return { item, checklist, task };
    }

    /**
     * 422 `checklist_item.invalid_assignee` unless `userId` is an ACTIVE member
     * of the workspace — mirrors §11 task-assignee validation
     * (`findActiveIdsInWorkspace`), so a checklist item can never be assigned to
     * a non-existent user (which would FK-500) or a cross-tenant user.
     */
    private async assertAssigneeInWorkspace(
        userId: string,
        workspaceId: string,
    ): Promise<void> {
        const valid = await this.users.findActiveIdsInWorkspace(
            [userId],
            workspaceId,
        );
        if (!valid.has(userId)) {
            throw AppError.unprocessable(
                "checklist_item.invalid_assignee",
                "assignee_id is not an active member of this workspace",
                [
                    {
                        field: "assignee_id",
                        issue: `${userId} is not an active member of this workspace`,
                    },
                ],
            );
        }
    }

    /**
     * 422 `checklist_item.invalid_parent` unless `parentItemId` is an existing
     * item IN THE SAME checklist — a sub-item cannot point at a non-existent item
     * (FK-500) or an item in another checklist / workspace.
     */
    private async assertParentInChecklist(
        parentItemId: string,
        checklistId: string,
    ): Promise<void> {
        const parent = await this.checklists.findItemById(parentItemId);
        if (!parent || parent.checklistId !== checklistId) {
            throw AppError.unprocessable(
                "checklist_item.invalid_parent",
                "parent_item_id must be an item in the same checklist",
                [
                    {
                        field: "parent_item_id",
                        issue: "is not an item in this checklist",
                    },
                ],
            );
        }
    }
}
