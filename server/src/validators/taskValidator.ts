import { checkSchema } from "express-validator";
import { TASK_PRIORITIES, TASK_STATUSES } from "../constant";

export const createTaskValidator = checkSchema({
    title: {
        in: ["body"],
        isString: true,
        trim: true,
        notEmpty: { errorMessage: "Title is required" },
        isLength: { options: { max: 255 } },
    },
    description: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
    },
    status: {
        in: ["body"],
        optional: true,
        isIn: { options: [TASK_STATUSES], errorMessage: "Invalid status" },
    },
    priority: {
        in: ["body"],
        optional: true,
        isIn: { options: [TASK_PRIORITIES], errorMessage: "Invalid priority" },
    },
    due_date: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isISO8601: { errorMessage: "due_date must be an ISO 8601 datetime" },
    },
    assignee_id: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isInt: { options: { min: 1 } },
        toInt: true,
    },
});

export const updateTaskValidator = checkSchema({
    title: {
        in: ["body"],
        optional: true,
        isString: true,
        trim: true,
        notEmpty: true,
        isLength: { options: { max: 255 } },
    },
    description: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
    },
    status: {
        in: ["body"],
        optional: true,
        isIn: { options: [TASK_STATUSES] },
    },
    priority: {
        in: ["body"],
        optional: true,
        isIn: { options: [TASK_PRIORITIES] },
    },
    due_date: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isISO8601: true,
    },
    assignee_id: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isInt: { options: { min: 1 } },
        toInt: true,
    },
});
