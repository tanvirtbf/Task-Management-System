import type {
    ChecklistItemRow,
    ChecklistRow,
} from "../repositories/ChecklistsRepo";

/**
 * Wire-format `Checklist` / `ChecklistItem` per API_DESIGN.md §15. snake_case;
 * timestamps are ISO-8601 (or `null`). The GET read shape nests each checklist's
 * items; item-level writes return the bare item.
 */

export interface WireChecklistItem {
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

export interface WireChecklist {
    id: string;
    task_id: string;
    name: string;
    position: number;
    items: WireChecklistItem[];
}

export const toWireItem = (i: ChecklistItemRow): WireChecklistItem => ({
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

export const toWireChecklist = (
    c: ChecklistRow,
    items: ChecklistItemRow[],
): WireChecklist => ({
    id: c.id,
    task_id: c.taskId,
    name: c.name,
    position: c.position,
    items: items.map(toWireItem),
});

/**
 * Assemble the §15 read shape from a flat checklist list + a flat item list:
 * each checklist with its `items` nested (both already position-ordered by the
 * repo). Buckets the items by `checklist_id` in a single pass.
 */
export const toWireChecklists = (
    checklists: ChecklistRow[],
    items: ChecklistItemRow[],
): WireChecklist[] => {
    const byChecklist = new Map<string, ChecklistItemRow[]>();
    for (const item of items) {
        const arr = byChecklist.get(item.checklistId) ?? [];
        arr.push(item);
        byChecklist.set(item.checklistId, arr);
    }
    return checklists.map((c) => toWireChecklist(c, byChecklist.get(c.id) ?? []));
};
