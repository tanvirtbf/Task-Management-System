/**
 * Phase 11 — Personal notes.
 */

export interface Note {
    id: string;
    userId: string;
    title: string;
    /** Markdown body */
    body: string;
    isPinned: boolean;
    color?: string;
    createdAt: string;
    updatedAt: string;
}
