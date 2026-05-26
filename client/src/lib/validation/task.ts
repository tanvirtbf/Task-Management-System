import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";

export const taskSchema = z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().optional().or(z.literal("")),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    due_date: z.string().optional().or(z.literal("")),
    assignee_id: z.number().int().positive().optional().nullable(),
});

export type TaskInput = z.infer<typeof taskSchema>;
