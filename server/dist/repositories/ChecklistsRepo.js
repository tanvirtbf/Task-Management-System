"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChecklistsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const CHECKLIST_COLUMNS = {
    id: schema_1.checklists.id,
    taskId: schema_1.checklists.taskId,
    name: schema_1.checklists.name,
    position: schema_1.checklists.position,
    createdAt: schema_1.checklists.createdAt,
    updatedAt: schema_1.checklists.updatedAt,
};
const ITEM_COLUMNS = {
    id: schema_1.checklistItems.id,
    checklistId: schema_1.checklistItems.checklistId,
    parentItemId: schema_1.checklistItems.parentItemId,
    text: schema_1.checklistItems.text,
    isCompleted: schema_1.checklistItems.isCompleted,
    completedAt: schema_1.checklistItems.completedAt,
    completedBy: schema_1.checklistItems.completedBy,
    assigneeId: schema_1.checklistItems.assigneeId,
    position: schema_1.checklistItems.position,
    createdAt: schema_1.checklistItems.createdAt,
};
class ChecklistsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    // ─── checklists ────────────────────────────────────────────────────────────
    /** A task's checklists, position-ordered (created_at tie-break). */
    async listByTask(taskId) {
        return this.db
            .select(CHECKLIST_COLUMNS)
            .from(schema_1.checklists)
            .where((0, drizzle_orm_1.eq)(schema_1.checklists.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.checklists.position), (0, drizzle_orm_1.asc)(schema_1.checklists.createdAt));
    }
    async findChecklistById(id) {
        const [row] = await this.db
            .select(CHECKLIST_COLUMNS)
            .from(schema_1.checklists)
            .where((0, drizzle_orm_1.eq)(schema_1.checklists.id, id))
            .limit(1);
        return row ?? null;
    }
    /** Append position = (max for this task) + 1 — keeps new checklists last. */
    async nextChecklistPosition(taskId, exec = this.db) {
        const [top] = await exec
            .select({ position: schema_1.checklists.position })
            .from(schema_1.checklists)
            .where((0, drizzle_orm_1.eq)(schema_1.checklists.taskId, taskId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.checklists.position))
            .limit(1);
        return (top?.position ?? -1) + 1;
    }
    async insertChecklist(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("ch");
        await exec.insert(schema_1.checklists).values({
            id,
            taskId: input.taskId,
            name: input.name,
            position: input.position,
        });
        const [row] = await exec
            .select(CHECKLIST_COLUMNS)
            .from(schema_1.checklists)
            .where((0, drizzle_orm_1.eq)(schema_1.checklists.id, id))
            .limit(1);
        if (!row)
            throw new Error("checklist insert did not persist");
        return row;
    }
    async updateChecklist(id, patch, exec = this.db) {
        await exec.update(schema_1.checklists).set(patch).where((0, drizzle_orm_1.eq)(schema_1.checklists.id, id));
    }
    /** Delete a checklist — items cascade via `fk` (ON DELETE CASCADE). */
    async deleteChecklist(id, exec = this.db) {
        await exec.delete(schema_1.checklists).where((0, drizzle_orm_1.eq)(schema_1.checklists.id, id));
    }
    // ─── checklist_items ───────────────────────────────────────────────────────
    /** Items across many checklists, position-ordered — feeds the GET read. */
    async listItemsByChecklistIds(checklistIds) {
        if (checklistIds.length === 0)
            return [];
        return this.db
            .select(ITEM_COLUMNS)
            .from(schema_1.checklistItems)
            .where((0, drizzle_orm_1.inArray)(schema_1.checklistItems.checklistId, checklistIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.checklistItems.position), (0, drizzle_orm_1.asc)(schema_1.checklistItems.createdAt));
    }
    async findItemById(id) {
        const [row] = await this.db
            .select(ITEM_COLUMNS)
            .from(schema_1.checklistItems)
            .where((0, drizzle_orm_1.eq)(schema_1.checklistItems.id, id))
            .limit(1);
        return row ?? null;
    }
    async nextItemPosition(checklistId, exec = this.db) {
        const [top] = await exec
            .select({ position: schema_1.checklistItems.position })
            .from(schema_1.checklistItems)
            .where((0, drizzle_orm_1.eq)(schema_1.checklistItems.checklistId, checklistId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.checklistItems.position))
            .limit(1);
        return (top?.position ?? -1) + 1;
    }
    async insertItem(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("ci");
        await exec.insert(schema_1.checklistItems).values({
            id,
            checklistId: input.checklistId,
            text: input.text,
            parentItemId: input.parentItemId ?? null,
            assigneeId: input.assigneeId ?? null,
            position: input.position,
        });
        const [row] = await exec
            .select(ITEM_COLUMNS)
            .from(schema_1.checklistItems)
            .where((0, drizzle_orm_1.eq)(schema_1.checklistItems.id, id))
            .limit(1);
        if (!row)
            throw new Error("checklist item insert did not persist");
        return row;
    }
    /** Atomic bulk insert; returns the persisted rows, position-ordered. */
    async insertItems(inputs, exec = this.db) {
        if (inputs.length === 0)
            return [];
        const rows = inputs.map((input) => ({
            id: (0, utils_1.fakeId)("ci"),
            checklistId: input.checklistId,
            text: input.text,
            parentItemId: input.parentItemId ?? null,
            assigneeId: input.assigneeId ?? null,
            position: input.position,
        }));
        await exec.insert(schema_1.checklistItems).values(rows);
        const ids = rows.map((r) => r.id);
        return exec
            .select(ITEM_COLUMNS)
            .from(schema_1.checklistItems)
            .where((0, drizzle_orm_1.inArray)(schema_1.checklistItems.id, ids))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.checklistItems.position));
    }
    async updateItem(id, patch, exec = this.db) {
        await exec
            .update(schema_1.checklistItems)
            .set(patch)
            .where((0, drizzle_orm_1.eq)(schema_1.checklistItems.id, id));
    }
    /** Set/clear the checkbox state in one shot (toggle). */
    async setItemCompletion(id, state, exec = this.db) {
        await exec
            .update(schema_1.checklistItems)
            .set(state)
            .where((0, drizzle_orm_1.eq)(schema_1.checklistItems.id, id));
    }
    async deleteItem(id, exec = this.db) {
        await exec.delete(schema_1.checklistItems).where((0, drizzle_orm_1.eq)(schema_1.checklistItems.id, id));
    }
}
exports.ChecklistsRepo = ChecklistsRepo;
