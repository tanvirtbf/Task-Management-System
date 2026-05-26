import type { Tag } from "../types";

export const tags: Tag[] = [
    // Operations tags
    { id: "tag-vip", spaceId: "sp-ops", name: "VIP", color: "#E11D48" },
    { id: "tag-bulk", spaceId: "sp-ops", name: "Bulk Order", color: "#8B5CF6" },
    { id: "tag-cod", spaceId: "sp-ops", name: "COD", color: "#F59E0B" },
    { id: "tag-prepaid", spaceId: "sp-ops", name: "Prepaid", color: "#10B981" },
    { id: "tag-urgent", spaceId: "sp-ops", name: "Urgent", color: "#E11D48" },
    { id: "tag-returning", spaceId: "sp-ops", name: "Returning", color: "#3B82F6" },
    { id: "tag-first-order", spaceId: "sp-ops", name: "First Order", color: "#06B6D4" },
    { id: "tag-dhaka", spaceId: "sp-ops", name: "Dhaka", color: "#4F46E5" },
    { id: "tag-outside-dhaka", spaceId: "sp-ops", name: "Outside Dhaka", color: "#94A3B8" },
    { id: "tag-same-day", spaceId: "sp-ops", name: "Same Day", color: "#F59E0B" },
    { id: "tag-festival", spaceId: "sp-ops", name: "Festival Order", color: "#EC4899" },

    // Inventory tags
    { id: "tag-low-stock", spaceId: "sp-inv", name: "Low Stock", color: "#F59E0B" },
    { id: "tag-reorder", spaceId: "sp-inv", name: "Reorder", color: "#3B82F6" },
    { id: "tag-bestseller", spaceId: "sp-inv", name: "Bestseller", color: "#10B981" },
    { id: "tag-slow-moving", spaceId: "sp-inv", name: "Slow Moving", color: "#94A3B8" },

    // Support tags
    { id: "tag-replacement", spaceId: "sp-cs", name: "Replacement", color: "#8B5CF6" },
    { id: "tag-damaged", spaceId: "sp-cs", name: "Damaged", color: "#E11D48" },
    { id: "tag-late-delivery", spaceId: "sp-cs", name: "Late Delivery", color: "#F59E0B" },
    { id: "tag-wrong-item", spaceId: "sp-cs", name: "Wrong Item", color: "#EC4899" },

    // Listing tags
    { id: "tag-photoshoot", spaceId: "sp-listing", name: "Photoshoot", color: "#06B6D4" },
    { id: "tag-new-arrival", spaceId: "sp-listing", name: "New Arrival", color: "#10B981" },

    // Marketing tags
    { id: "tag-eid", spaceId: "sp-mkt", name: "Eid", color: "#10B981" },
    { id: "tag-boishakh", spaceId: "sp-mkt", name: "Boishakh", color: "#EC4899" },
    { id: "tag-1111", spaceId: "sp-mkt", name: "11.11", color: "#4F46E5" },
    { id: "tag-weekend", spaceId: "sp-mkt", name: "Weekend Offer", color: "#F59E0B" },
];

export const tagsById = new Map(tags.map((t) => [t.id, t]));

export const tagsBySpace = (spaceId: string) =>
    tags.filter((t) => t.spaceId === spaceId);
