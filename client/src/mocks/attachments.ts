import type { Attachment } from "../types/extras";

export const attachments: Attachment[] = [];

export const attachmentsByTask = (taskId: string): Attachment[] =>
    attachments.filter((a) => a.taskId === taskId);
