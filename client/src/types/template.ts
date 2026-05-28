/**
 * Task templates — reusable task structures with pre-filled checklist items.
 * Used by the "Apply template" feature in campaign lists + Settings UI.
 */

export type TemplateType = "task" | "list" | "space";

export interface TemplateChecklistItem {
    text: string;
    /** Offset in days from anchor date — for scheduling future steps. */
    dueOffsetDays?: number;
}

export interface TemplateStructure {
    /** Default task type to use when applying (e.g., "tt-campaign", "tt-task"). */
    taskTypeId?: string;
    /** Default priority (0-4). */
    priority?: number;
    /** Default tags to apply. */
    tags?: string[];
    /** Pre-built checklist. */
    checklistName?: string;
    checklistItems?: TemplateChecklistItem[];
    /** Pre-filled description (plaintext for ops tasks, Tiptap JSON for dev). */
    description?: string;
}

export interface Template {
    id: string;
    workspaceId: string;
    type: TemplateType;
    name: string;
    description?: string;
    /** Optional icon name (lucide-react). */
    icon?: string;
    color?: string;
    structure: TemplateStructure;
    usageCount: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
