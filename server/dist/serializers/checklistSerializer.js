"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireChecklists = exports.toWireChecklist = exports.toWireItem = void 0;
const toWireItem = (i) => ({
    id: i.id,
    checklist_id: i.checklistId,
    parent_item_id: i.parentItemId,
    text: i.text,
    is_completed: i.isCompleted,
    completed_at: i.completedAt ? i.completedAt.toISOString() : null,
    completed_by: i.completedBy,
    assignee_id: i.assigneeId,
    position: i.position,
});
exports.toWireItem = toWireItem;
const toWireChecklist = (c, items) => ({
    id: c.id,
    task_id: c.taskId,
    name: c.name,
    position: c.position,
    items: items.map(exports.toWireItem),
});
exports.toWireChecklist = toWireChecklist;
/**
 * Assemble the §15 read shape from a flat checklist list + a flat item list:
 * each checklist with its `items` nested (both already position-ordered by the
 * repo). Buckets the items by `checklist_id` in a single pass.
 */
const toWireChecklists = (checklists, items) => {
    const byChecklist = new Map();
    for (const item of items) {
        const arr = byChecklist.get(item.checklistId) ?? [];
        arr.push(item);
        byChecklist.set(item.checklistId, arr);
    }
    return checklists.map((c) => (0, exports.toWireChecklist)(c, byChecklist.get(c.id) ?? []));
};
exports.toWireChecklists = toWireChecklists;
