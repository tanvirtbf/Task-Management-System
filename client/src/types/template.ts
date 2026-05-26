/**
 * Phase 8 — Template types.
 */

export type TemplateType =
    | "task"
    | "list"
    | "folder"
    | "space"
    | "checklist"
    | "form"
    | "view";

export interface Template {
    id: string;
    workspaceId: string;
    type: TemplateType;
    name: string;
    description?: string;
    icon: string; // Lucide icon name
    color: string;
    /** Serialized blueprint — opaque for Phase 8 (re-hydrated on apply) */
    structure: Record<string, unknown>;
    sharing: "private" | "members" | "admins";
    /** Stats */
    usageCount: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    tags?: string[];
}
