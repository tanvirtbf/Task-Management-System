import type { Attachment } from "../types/extras";

const now = "2025-09-10T08:00:00Z";

/**
 * Seeded attachments for some tasks. Real uploads go through the API in
 * production; here we maintain an in-memory array.
 */
export const attachments: Attachment[] = [
    {
        id: "att-001",
        taskId: "t-5001",
        name: "shipping_label.pdf",
        type: "application/pdf",
        size: 248_192,
        url: "/mock-files/shipping_label.pdf",
        uploadedBy: "u-001",
        uploadedAt: now,
    },
    {
        id: "att-002",
        taskId: "t-5001",
        name: "packed_box.jpg",
        type: "image/jpeg",
        size: 1_482_390,
        url: "/mock-files/packed_box.jpg",
        thumbnailUrl: "/mock-files/packed_box_thumb.jpg",
        uploadedBy: "u-002",
        uploadedAt: now,
    },
    {
        id: "att-003",
        taskId: "t-5002",
        name: "complaint_photo.jpg",
        type: "image/jpeg",
        size: 980_120,
        url: "/mock-files/complaint_photo.jpg",
        thumbnailUrl: "/mock-files/complaint_photo_thumb.jpg",
        uploadedBy: "u-007",
        uploadedAt: now,
    },
    {
        id: "att-004",
        taskId: "t-5005",
        name: "campaign_brief.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 56_318,
        url: "/mock-files/campaign_brief.docx",
        uploadedBy: "u-003",
        uploadedAt: now,
    },
    {
        id: "att-005",
        taskId: "t-5010",
        name: "product_shot_01.png",
        type: "image/png",
        size: 2_148_512,
        url: "/mock-files/product_shot_01.png",
        thumbnailUrl: "/mock-files/product_shot_01_thumb.png",
        uploadedBy: "u-009",
        uploadedAt: now,
    },
];

export const attachmentsByTask = (taskId: string): Attachment[] =>
    attachments
        .filter((a) => a.taskId === taskId)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
