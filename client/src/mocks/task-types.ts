import type { TaskType } from "../types";
import { workspace } from "./workspace";

export const taskTypes: TaskType[] = [
    {
        id: "tt-task",
        workspaceId: workspace.id,
        name: "Task",
        icon: "CheckSquare",
        color: "#6B7280",
        isMilestoneType: false,
        isSystem: true,
    },
    {
        id: "tt-milestone",
        workspaceId: workspace.id,
        name: "Milestone",
        icon: "Diamond",
        color: "#F59E0B",
        isMilestoneType: true,
        isSystem: true,
    },
    {
        id: "tt-order",
        workspaceId: workspace.id,
        name: "Order",
        description: "Customer orders",
        icon: "ShoppingCart",
        color: "#4F46E5",
        isMilestoneType: false,
        isSystem: false,
    },
    {
        id: "tt-complaint",
        workspaceId: workspace.id,
        name: "Complaint",
        description: "Customer complaints",
        icon: "AlertCircle",
        color: "#E11D48",
        isMilestoneType: false,
        isSystem: false,
    },
    {
        id: "tt-product",
        workspaceId: workspace.id,
        name: "Product Listing",
        icon: "Image",
        color: "#10B981",
        isMilestoneType: false,
        isSystem: false,
    },
    {
        id: "tt-campaign",
        workspaceId: workspace.id,
        name: "Campaign",
        icon: "Megaphone",
        color: "#8B5CF6",
        isMilestoneType: false,
        isSystem: false,
    },
    {
        id: "tt-return",
        workspaceId: workspace.id,
        name: "Return",
        icon: "RotateCcw",
        color: "#F59E0B",
        isMilestoneType: false,
        isSystem: false,
    },
];

export const taskTypesById = new Map(taskTypes.map((t) => [t.id, t]));
