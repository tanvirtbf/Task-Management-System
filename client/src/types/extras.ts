/**
 * Phase 3 — Comments + Checklists.
 * Co-located with main types but kept separate to make incremental
 * additions visible.
 */

export interface Comment {
    id: string;
    taskId: string;
    parentCommentId: string | null;
    authorId: string;
    body: string; // plain text for Phase 3 (Tiptap JSON in Phase 7+)
    assignedTo: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
    editedAt: string | null;
    deletedAt: string | null;
    reactions: CommentReaction[];
    createdAt: string;
}

export interface CommentReaction {
    emoji: string;
    userIds: string[];
}

export interface Checklist {
    id: string;
    taskId: string;
    name: string;
    position: number;
    items: ChecklistItem[];
}

export interface ChecklistItem {
    id: string;
    checklistId: string;
    parentItemId: string | null;
    text: string;
    isCompleted: boolean;
    assigneeId: string | null;
    position: number;
}

/**
 * Attachments on a task.
 */
export interface Attachment {
    id: string;
    taskId: string;
    name: string;
    type: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    uploadedBy: string;
    uploadedAt: string;
}

/**
 * Task dependency edges.
 *  - "blocks"        — this task blocks the related one
 *  - "blocked_by"    — this task is blocked by the related one
 *  - "waiting_on"    — soft dependency
 *  - "linked"        — informational link (no scheduling impact)
 */
export type DependencyType =
    | "blocks"
    | "blocked_by"
    | "waiting_on"
    | "linked";

export interface TaskDependency {
    id: string;
    taskId: string;
    relatedTaskId: string;
    type: DependencyType;
    createdAt: string;
    createdBy: string;
}
