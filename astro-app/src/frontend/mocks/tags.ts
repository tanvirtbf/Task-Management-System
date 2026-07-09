import type { Tag } from "../types";

const ws = "ws-main";

/**
 * Workspace-wide tag pool per FINAL_REQUIREMENTS.md §5.10.
 * Tags are NOT space-scoped — any task in any space can apply any tag.
 */
export const tags: Tag[] = [
    // ─── General / status-style ───
    { id: "tag-vip", workspaceId: ws, name: "VIP", color: "#E11D48" },
    { id: "tag-urgent", workspaceId: ws, name: "Urgent", color: "#E11D48" },
    { id: "tag-bulk", workspaceId: ws, name: "Bulk Order", color: "#8B5CF6" },
    { id: "tag-returning", workspaceId: ws, name: "Returning", color: "#3B82F6" },
    { id: "tag-first-order", workspaceId: ws, name: "First Order", color: "#06B6D4" },
    { id: "tag-same-day", workspaceId: ws, name: "Same Day", color: "#F59E0B" },

    // ─── Geographic ───
    { id: "tag-dhaka", workspaceId: ws, name: "Dhaka", color: "#4F46E5" },
    { id: "tag-outside-dhaka", workspaceId: ws, name: "Outside Dhaka", color: "#94A3B8" },

    // ─── Operations workflow ───
    { id: "tag-cod", workspaceId: ws, name: "COD", color: "#F59E0B" },
    { id: "tag-prepaid", workspaceId: ws, name: "Prepaid", color: "#10B981" },
    { id: "tag-festival", workspaceId: ws, name: "Festival Order", color: "#EC4899" },

    // ─── Inventory workflow ───
    { id: "tag-low-stock", workspaceId: ws, name: "Low Stock", color: "#F59E0B" },
    { id: "tag-reorder", workspaceId: ws, name: "Reorder", color: "#3B82F6" },
    { id: "tag-bestseller", workspaceId: ws, name: "Bestseller", color: "#10B981" },
    { id: "tag-slow-moving", workspaceId: ws, name: "Slow Moving", color: "#94A3B8" },

    // ─── Support workflow ───
    { id: "tag-replacement", workspaceId: ws, name: "Replacement", color: "#8B5CF6" },
    { id: "tag-damaged", workspaceId: ws, name: "Damaged", color: "#E11D48" },
    { id: "tag-late-delivery", workspaceId: ws, name: "Late Delivery", color: "#F59E0B" },
    { id: "tag-wrong-item", workspaceId: ws, name: "Wrong Item", color: "#EC4899" },

    // ─── Listing workflow ───
    { id: "tag-photoshoot", workspaceId: ws, name: "Photoshoot", color: "#06B6D4" },
    { id: "tag-new-arrival", workspaceId: ws, name: "New Arrival", color: "#10B981" },

    // ─── Marketing campaigns ───
    { id: "tag-eid", workspaceId: ws, name: "Eid", color: "#10B981" },
    { id: "tag-boishakh", workspaceId: ws, name: "Boishakh", color: "#EC4899" },
    { id: "tag-1111", workspaceId: ws, name: "11.11", color: "#4F46E5" },
    { id: "tag-weekend", workspaceId: ws, name: "Weekend Offer", color: "#F59E0B" },
];

export const tagsById = new Map(tags.map((t) => [t.id, t]));

/** Workspace-wide pool — all tags available to all tasks per spec §5.10. */
export const allTags = (): Tag[] => tags;

/**
 * @deprecated Tags are now workspace-wide per spec §5.10. Returns all tags
 * regardless of space. Kept for callers that still pass a spaceId arg.
 */
export const tagsBySpace = (_spaceId: string): Tag[] => tags;
