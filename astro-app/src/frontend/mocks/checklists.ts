import type { Checklist, ChecklistItem } from "../types/extras";
import { tasks } from "./tasks";

let _id = 1;
const id = (prefix: string) => `${prefix}-${_id++}`;

const orderPackingItems = [
    "Verify product matches order",
    "Check for damage",
    "Add invoice slip",
    "Bubble-wrap fragile items",
    "Seal package with branded tape",
];

const orderConfirmItems = [
    "Confirm phone number",
    "Verify shipping address",
    "Confirm payment method (COD/Prepaid)",
    "Check stock availability",
    "Send confirmation SMS",
];

const productListingItems = [
    "Product photography (front, back, in use)",
    "Edit photos + add watermark",
    "Write Bangla + English titles",
    "Set price + SKU",
    "Update inventory",
    "Upload to website",
    "Schedule Facebook post",
];

const contentItems = [
    "Research trending hashtags",
    "Draft copy (Bangla + English)",
    "Approve design with team",
    "Schedule in Buffer",
    "Monitor first-hour engagement",
];

export const checklists: Checklist[] = [];

// Add packing checklist to ~30% of order tasks
for (const task of tasks) {
    const isOrder = task.taskTypeId === "tt-order";
    const isProduct = task.taskTypeId === "tt-product";
    const isContent = task.primaryListId === "l-content";

    if (isOrder && Math.random() < 0.35) {
        // Confirm checklist
        const checklist: Checklist = {
            id: id("ch"),
            taskId: task.id,
            name: "Order Confirmation",
            position: 0,
            items: [],
        };
        orderConfirmItems.forEach((text, idx) => {
            checklist.items.push({
                id: id("ci"),
                checklistId: checklist.id,
                parentItemId: null,
                text,
                isCompleted: idx < 3 && Math.random() > 0.3,
                assigneeId: null,
                position: idx,
            });
        });
        checklists.push(checklist);

        if (Math.random() > 0.5) {
            const c2: Checklist = {
                id: id("ch"),
                taskId: task.id,
                name: "Packing Checklist",
                position: 1,
                items: [],
            };
            orderPackingItems.forEach((text, idx) => {
                c2.items.push({
                    id: id("ci"),
                    checklistId: c2.id,
                    parentItemId: null,
                    text,
                    isCompleted: idx < 2,
                    assigneeId: null,
                    position: idx,
                });
            });
            checklists.push(c2);
        }
    }

    if (isProduct) {
        const checklist: Checklist = {
            id: id("ch"),
            taskId: task.id,
            name: "New Product Pipeline",
            position: 0,
            items: [],
        };
        productListingItems.forEach((text, idx) => {
            checklist.items.push({
                id: id("ci"),
                checklistId: checklist.id,
                parentItemId: null,
                text,
                isCompleted: idx < 4,
                assigneeId: null,
                position: idx,
            });
        });
        checklists.push(checklist);
    }

    if (isContent && Math.random() < 0.5) {
        const checklist: Checklist = {
            id: id("ch"),
            taskId: task.id,
            name: "Content Workflow",
            position: 0,
            items: [],
        };
        contentItems.forEach((text, idx) => {
            checklist.items.push({
                id: id("ci"),
                checklistId: checklist.id,
                parentItemId: null,
                text,
                isCompleted: idx < 2,
                assigneeId: null,
                position: idx,
            });
        });
        checklists.push(checklist);
    }
}

export const checklistsByTask = (taskId: string) =>
    checklists
        .filter((c) => c.taskId === taskId)
        .sort((a, b) => a.position - b.position);

export type { Checklist, ChecklistItem };
