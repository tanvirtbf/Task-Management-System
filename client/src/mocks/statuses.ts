import type { Status } from "../types";

/**
 * Status workflows per list.
 * Status colors picked to align with the design system status palette.
 */
export const statuses: Status[] = [
    // Order workflows (shared between Facebook Orders + Website Orders)
    ...orderStatuses("l-fb-orders"),
    ...orderStatuses("l-web-orders"),

    // Returns
    ...returnStatuses("l-returns"),

    // Daily Operations
    ...simpleStatuses("l-daily-ops"),

    // Stock Master (simple — not Started / Low / Out / In Stock)
    ...stockStatuses("l-stock"),

    // Purchase Orders
    ...poStatuses("l-po"),

    // Damaged Stock
    ...simpleStatuses("l-damaged"),

    // Complaints
    ...complaintStatuses("l-complaints"),

    // Queries
    ...simpleStatuses("l-queries"),

    // COD Issues
    ...simpleStatuses("l-cod-issues"),

    // New Product Pipeline
    ...productPipelineStatuses("l-new-products"),

    // Photo Shoots
    ...simpleStatuses("l-photo-shoots"),

    // Content Calendar
    ...contentStatuses("l-content"),

    // Active Campaigns
    ...simpleStatuses("l-campaigns"),

    // Boost Manager
    ...simpleStatuses("l-boost"),
];

function orderStatuses(listId: string): Status[] {
    const prefix = listId;
    return [
        { id: `${prefix}-s-new`, scopeType: "list", scopeId: listId, name: "New Order", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${prefix}-s-confirmed`, scopeType: "list", scopeId: listId, name: "Confirmed", color: "#3B82F6", statusGroup: "active", position: 1 },
        { id: `${prefix}-s-packed`, scopeType: "list", scopeId: listId, name: "Packed", color: "#8B5CF6", statusGroup: "active", position: 2 },
        { id: `${prefix}-s-courier`, scopeType: "list", scopeId: listId, name: "Handed to Courier", color: "#06B6D4", statusGroup: "active", position: 3 },
        { id: `${prefix}-s-out`, scopeType: "list", scopeId: listId, name: "Out for Delivery", color: "#F59E0B", statusGroup: "active", position: 4 },
        { id: `${prefix}-s-delivered`, scopeType: "list", scopeId: listId, name: "Delivered", color: "#10B981", statusGroup: "active", position: 5 },
        { id: `${prefix}-s-cod`, scopeType: "list", scopeId: listId, name: "COD Collected", color: "#059669", statusGroup: "done", position: 6 },
        { id: `${prefix}-s-cancel`, scopeType: "list", scopeId: listId, name: "Cancelled", color: "#E11D48", statusGroup: "done", position: 7 },
        { id: `${prefix}-s-closed`, scopeType: "list", scopeId: listId, name: "Completed", color: "#6B7280", statusGroup: "closed", position: 8 },
    ];
}

function returnStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-req`, scopeType: "list", scopeId: listId, name: "Requested", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-approved`, scopeType: "list", scopeId: listId, name: "Approved", color: "#3B82F6", statusGroup: "active", position: 1 },
        { id: `${listId}-s-pickup`, scopeType: "list", scopeId: listId, name: "Pickup Scheduled", color: "#06B6D4", statusGroup: "active", position: 2 },
        { id: `${listId}-s-recv`, scopeType: "list", scopeId: listId, name: "Received", color: "#F59E0B", statusGroup: "active", position: 3 },
        { id: `${listId}-s-refunded`, scopeType: "list", scopeId: listId, name: "Refunded", color: "#10B981", statusGroup: "done", position: 4 },
        { id: `${listId}-s-rejected`, scopeType: "list", scopeId: listId, name: "Rejected", color: "#E11D48", statusGroup: "done", position: 5 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Closed", color: "#6B7280", statusGroup: "closed", position: 6 },
    ];
}

function simpleStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-todo`, scopeType: "list", scopeId: listId, name: "To Do", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-inprogress`, scopeType: "list", scopeId: listId, name: "In Progress", color: "#3B82F6", statusGroup: "active", position: 1 },
        { id: `${listId}-s-review`, scopeType: "list", scopeId: listId, name: "In Review", color: "#F59E0B", statusGroup: "active", position: 2 },
        { id: `${listId}-s-done`, scopeType: "list", scopeId: listId, name: "Done", color: "#10B981", statusGroup: "done", position: 3 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Closed", color: "#6B7280", statusGroup: "closed", position: 4 },
    ];
}

function stockStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-in`, scopeType: "list", scopeId: listId, name: "In Stock", color: "#10B981", statusGroup: "active", position: 0 },
        { id: `${listId}-s-low`, scopeType: "list", scopeId: listId, name: "Low", color: "#F59E0B", statusGroup: "active", position: 1 },
        { id: `${listId}-s-out`, scopeType: "list", scopeId: listId, name: "Out of Stock", color: "#E11D48", statusGroup: "active", position: 2 },
        { id: `${listId}-s-disc`, scopeType: "list", scopeId: listId, name: "Discontinued", color: "#6B7280", statusGroup: "closed", position: 3 },
    ];
}

function poStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-to-order`, scopeType: "list", scopeId: listId, name: "To Order", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-ordered`, scopeType: "list", scopeId: listId, name: "Ordered", color: "#3B82F6", statusGroup: "active", position: 1 },
        { id: `${listId}-s-transit`, scopeType: "list", scopeId: listId, name: "In Transit", color: "#06B6D4", statusGroup: "active", position: 2 },
        { id: `${listId}-s-recv`, scopeType: "list", scopeId: listId, name: "Received", color: "#F59E0B", statusGroup: "active", position: 3 },
        { id: `${listId}-s-stock`, scopeType: "list", scopeId: listId, name: "Stock Updated", color: "#10B981", statusGroup: "done", position: 4 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Closed", color: "#6B7280", statusGroup: "closed", position: 5 },
    ];
}

function complaintStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-new`, scopeType: "list", scopeId: listId, name: "New", color: "#E11D48", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-review`, scopeType: "list", scopeId: listId, name: "In Review", color: "#F59E0B", statusGroup: "active", position: 1 },
        { id: `${listId}-s-contacted`, scopeType: "list", scopeId: listId, name: "Contacted", color: "#3B82F6", statusGroup: "active", position: 2 },
        { id: `${listId}-s-resolving`, scopeType: "list", scopeId: listId, name: "Resolving", color: "#06B6D4", statusGroup: "active", position: 3 },
        { id: `${listId}-s-resolved`, scopeType: "list", scopeId: listId, name: "Resolved", color: "#10B981", statusGroup: "done", position: 4 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Closed", color: "#6B7280", statusGroup: "closed", position: 5 },
    ];
}

function productPipelineStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-idea`, scopeType: "list", scopeId: listId, name: "Idea / Sourced", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-photo`, scopeType: "list", scopeId: listId, name: "Photography", color: "#06B6D4", statusGroup: "active", position: 1 },
        { id: `${listId}-s-content`, scopeType: "list", scopeId: listId, name: "Content Writing", color: "#8B5CF6", statusGroup: "active", position: 2 },
        { id: `${listId}-s-price`, scopeType: "list", scopeId: listId, name: "Price/SKU Set", color: "#F59E0B", statusGroup: "active", position: 3 },
        { id: `${listId}-s-upload`, scopeType: "list", scopeId: listId, name: "Website Upload", color: "#3B82F6", statusGroup: "active", position: 4 },
        { id: `${listId}-s-fb`, scopeType: "list", scopeId: listId, name: "Facebook Post Ready", color: "#1877F2", statusGroup: "active", position: 5 },
        { id: `${listId}-s-live`, scopeType: "list", scopeId: listId, name: "Live", color: "#10B981", statusGroup: "done", position: 6 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Archived", color: "#6B7280", statusGroup: "closed", position: 7 },
    ];
}

function contentStatuses(listId: string): Status[] {
    return [
        { id: `${listId}-s-idea`, scopeType: "list", scopeId: listId, name: "Idea", color: "#94A3B8", statusGroup: "not_started", position: 0 },
        { id: `${listId}-s-copy`, scopeType: "list", scopeId: listId, name: "Copywriting", color: "#8B5CF6", statusGroup: "active", position: 1 },
        { id: `${listId}-s-design`, scopeType: "list", scopeId: listId, name: "Design", color: "#06B6D4", statusGroup: "active", position: 2 },
        { id: `${listId}-s-approval`, scopeType: "list", scopeId: listId, name: "Approval", color: "#F59E0B", statusGroup: "active", position: 3 },
        { id: `${listId}-s-scheduled`, scopeType: "list", scopeId: listId, name: "Scheduled", color: "#3B82F6", statusGroup: "active", position: 4 },
        { id: `${listId}-s-published`, scopeType: "list", scopeId: listId, name: "Published", color: "#10B981", statusGroup: "done", position: 5 },
        { id: `${listId}-s-closed`, scopeType: "list", scopeId: listId, name: "Archived", color: "#6B7280", statusGroup: "closed", position: 6 },
    ];
}

export const statusesById = new Map(statuses.map((s) => [s.id, s]));

export const statusesByList = (listId: string): Status[] =>
    statuses
        .filter((s) => s.scopeType === "list" && s.scopeId === listId)
        .sort((a, b) => a.position - b.position);
