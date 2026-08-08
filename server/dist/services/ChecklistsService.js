"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChecklistsService = void 0;
const errors_1 = require("../errors");
const checklistSerializer_1 = require("../serializers/checklistSerializer");
class ChecklistsService {
    db;
    checklists;
    tasks;
    users;
    activity;
    constructor(db, checklists, tasks, users, activity) {
        this.db = db;
        this.checklists = checklists;
        this.tasks = tasks;
        this.users = users;
        this.activity = activity;
    }
    /** GET — all checklists for a task, each with its items nested. */
    async listForTask(input) {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);
        const lists = await this.checklists.listByTask(task.id);
        const items = await this.checklists.listItemsByChecklistIds(lists.map((l) => l.id));
        return (0, checklistSerializer_1.toWireChecklists)(lists, items);
    }
    /** POST — create an empty checklist, appended after the task's existing ones. */
    async createChecklist(input) {
        const task = await this.requireTask(input.idOrKey, input.workspaceId);
        const created = await this.db.transaction(async (tx) => {
            const position = await this.checklists.nextChecklistPosition(task.id, tx);
            const row = await this.checklists.insertChecklist({ taskId: task.id, name: input.name, position }, tx);
            // F21 (ISS-062): creating a checklist finally leaves a trace —
            // before this, ticking one box was logged while creating or
            // deleting the whole list was not, so "who deleted the acceptance
            // criteria?" was unanswerable.
            await this.activity.recordMany([
                {
                    taskId: task.id,
                    actorId: input.actorId,
                    action: "checklist_created",
                    context: { checklist_id: row.id, name: input.name },
                },
            ], tx);
            return row;
        });
        return (0, checklistSerializer_1.toWireChecklist)(created, []);
    }
    /** PATCH — rename / reposition a checklist. */
    async updateChecklist(input) {
        const checklist = await this.requireChecklist(input.id, input.workspaceId);
        const patch = {};
        if (input.name !== undefined)
            patch.name = input.name;
        if (input.position !== undefined)
            patch.position = input.position;
        if (Object.keys(patch).length > 0) {
            await this.checklists.updateChecklist(checklist.id, patch);
        }
        const fresh = (await this.checklists.findChecklistById(checklist.id)) ?? checklist;
        const items = await this.checklists.listItemsByChecklistIds([fresh.id]);
        return (0, checklistSerializer_1.toWireChecklist)(fresh, items);
    }
    /** DELETE — drop a checklist (items cascade). */
    async deleteChecklist(input) {
        const checklist = await this.requireChecklist(input.id, input.workspaceId);
        await this.db.transaction(async (tx) => {
            await this.checklists.deleteChecklist(checklist.id, tx);
            // F21 (ISS-062): the delete records WHAT was deleted (the name —
            // the row is gone, so the trace is the only place it survives).
            await this.activity.recordMany([
                {
                    taskId: checklist.taskId,
                    actorId: input.actorId,
                    action: "checklist_deleted",
                    context: {
                        checklist_id: checklist.id,
                        name: checklist.name,
                    },
                },
            ], tx);
        });
    }
    /** POST — add a single item, appended after the checklist's existing items. */
    async addItem(input) {
        const checklist = await this.requireChecklist(input.checklistId, input.workspaceId);
        // Validate the optional assignee (active workspace member) + parent (an
        // item in THIS checklist) BEFORE the insert, so an invalid id is a clean
        // 422 rather than an unhandled FK 500 / a cross-tenant write.
        if (input.assigneeId != null) {
            await this.assertAssigneeInWorkspace(input.assigneeId, input.workspaceId);
        }
        if (input.parentItemId != null) {
            await this.assertParentInChecklist(input.parentItemId, checklist.id);
        }
        const created = await this.db.transaction(async (tx) => {
            const position = input.position ??
                (await this.checklists.nextItemPosition(checklist.id, tx));
            const row = await this.checklists.insertItem({
                checklistId: checklist.id,
                text: input.text,
                parentItemId: input.parentItemId ?? null,
                assigneeId: input.assigneeId ?? null,
                position,
            }, tx);
            await this.activity.recordMany([
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
            ], tx);
            return row;
        });
        return (0, checklistSerializer_1.toWireItem)(created);
    }
    /** POST bulk — insert many items atomically (the §23 template workhorse). */
    async bulkAddItems(input) {
        const checklist = await this.requireChecklist(input.checklistId, input.workspaceId);
        const created = await this.db.transaction(async (tx) => {
            const base = await this.checklists.nextItemPosition(checklist.id, tx);
            return this.checklists.insertItems(input.texts.map((text, i) => ({
                checklistId: checklist.id,
                text,
                position: base + i,
            })), tx);
        });
        return created.map(checklistSerializer_1.toWireItem);
    }
    /** PATCH item — edit text / assignee / position; logs `task_activity`. */
    async updateItem(input) {
        const { item, checklist } = await this.requireItem(input.id, input.workspaceId);
        // A non-null assignee must be an active workspace member (a null clears
        // it). Validated before the write → 422, never a cross-tenant assign.
        if (input.assigneeId != null) {
            await this.assertAssigneeInWorkspace(input.assigneeId, input.workspaceId);
        }
        const patch = {};
        if (input.text !== undefined)
            patch.text = input.text;
        if (input.assigneeId !== undefined)
            patch.assigneeId = input.assigneeId;
        if (input.position !== undefined)
            patch.position = input.position;
        if (Object.keys(patch).length > 0) {
            await this.db.transaction(async (tx) => {
                await this.checklists.updateItem(item.id, patch, tx);
                await this.activity.recordMany([
                    {
                        taskId: checklist.taskId,
                        actorId: input.actorId,
                        action: "checklist_item_updated",
                        context: {
                            checklist_id: checklist.id,
                            item_id: item.id,
                        },
                    },
                ], tx);
            });
        }
        const fresh = (await this.checklists.findItemById(item.id)) ?? item;
        return (0, checklistSerializer_1.toWireItem)(fresh);
    }
    /** POST toggle — flip is_completed, stamp completed_by/at; logs activity. */
    async toggleItem(input) {
        const { item, checklist } = await this.requireItem(input.id, input.workspaceId);
        const isCompleted = !item.isCompleted;
        const now = new Date();
        const completedAt = isCompleted ? now : null;
        const completedBy = isCompleted ? input.actorId : null;
        await this.db.transaction(async (tx) => {
            await this.checklists.setItemCompletion(item.id, { isCompleted, completedAt, completedBy }, tx);
            await this.activity.recordMany([
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
            ], tx);
        });
        return (0, checklistSerializer_1.toWireItem)({ ...item, isCompleted, completedAt, completedBy });
    }
    /** DELETE item. */
    async deleteItem(input) {
        const { item, checklist } = await this.requireItem(input.id, input.workspaceId);
        await this.db.transaction(async (tx) => {
            await this.checklists.deleteItem(item.id, tx);
            await this.activity.recordMany([
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
            ], tx);
        });
    }
    // ─── helpers ──────────────────────────────────────────────────────────────
    /** Resolve `:id` (internal id or custom_id) to a task in the workspace. */
    async requireTask(idOrKey, workspaceId) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(idOrKey, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${idOrKey} does not exist`);
        }
        return task;
    }
    /**
     * A checklist whose task is in the caller's workspace, or
     * `404 checklist.not_found` (missing + cross-tenant collapse to one 404).
     */
    async requireChecklist(id, workspaceId) {
        const checklist = await this.checklists.findChecklistById(id);
        if (!checklist) {
            throw errors_1.AppError.notFound("checklist.not_found", `Checklist ${id} does not exist`);
        }
        const task = await this.tasks.findByIdInWorkspace(checklist.taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("checklist.not_found", `Checklist ${id} does not exist`);
        }
        return checklist;
    }
    /**
     * An item + its checklist, both reachable in the caller's workspace, or
     * `404 checklist_item.not_found`.
     */
    async requireItem(id, workspaceId) {
        const item = await this.checklists.findItemById(id);
        if (!item) {
            throw errors_1.AppError.notFound("checklist_item.not_found", `Checklist item ${id} does not exist`);
        }
        const checklist = await this.checklists.findChecklistById(item.checklistId);
        if (!checklist) {
            throw errors_1.AppError.notFound("checklist_item.not_found", `Checklist item ${id} does not exist`);
        }
        const task = await this.tasks.findByIdInWorkspace(checklist.taskId, workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("checklist_item.not_found", `Checklist item ${id} does not exist`);
        }
        return { item, checklist };
    }
    /**
     * 422 `checklist_item.invalid_assignee` unless `userId` is an ACTIVE member
     * of the workspace — mirrors §11 task-assignee validation
     * (`findActiveIdsInWorkspace`), so a checklist item can never be assigned to
     * a non-existent user (which would FK-500) or a cross-tenant user.
     */
    async assertAssigneeInWorkspace(userId, workspaceId) {
        const valid = await this.users.findActiveIdsInWorkspace([userId], workspaceId);
        if (!valid.has(userId)) {
            throw errors_1.AppError.unprocessable("checklist_item.invalid_assignee", "assignee_id is not an active member of this workspace", [
                {
                    field: "assignee_id",
                    issue: `${userId} is not an active member of this workspace`,
                },
            ]);
        }
    }
    /**
     * 422 `checklist_item.invalid_parent` unless `parentItemId` is an existing
     * item IN THE SAME checklist — a sub-item cannot point at a non-existent item
     * (FK-500) or an item in another checklist / workspace.
     */
    async assertParentInChecklist(parentItemId, checklistId) {
        const parent = await this.checklists.findItemById(parentItemId);
        if (!parent || parent.checklistId !== checklistId) {
            throw errors_1.AppError.unprocessable("checklist_item.invalid_parent", "parent_item_id must be an item in the same checklist", [
                {
                    field: "parent_item_id",
                    issue: "is not an item in this checklist",
                },
            ]);
        }
    }
}
exports.ChecklistsService = ChecklistsService;
