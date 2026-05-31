import { checkSchema, type ParamSchema } from "express-validator";
import { sprintStatuses, SHORT_NAME_LENGTH } from "../db/schema/_shared";

/**
 * Validators for §20 Sprints. Pair each `checkSchema(...)` with the `validate`
 * middleware so failures become the spec envelope (422 / `validation.failed`).
 *
 * Cross-field date order (`end_date >= start_date`) and name uniqueness are NOT
 * here — they live in the service so they return the precise spec codes
 * (`validation.failed` for date order after merging with the stored row on
 * PATCH; `409 sprint.duplicate` for a clashing name) and the DB
 * `ck_sprints_dates` / `uq_sprints_workspace_name` are the race-safe backstops.
 */

const ID_MAX = 64; // VARCHAR(64) id columns
const NAME_MAX = SHORT_NAME_LENGTH; // sprints.name VARCHAR(80)
const GOAL_MAX = 300; // sprints.goal VARCHAR(300)
const POINTS_MAX = 4294967295; // committed_points INT UNSIGNED

/** `optional` that also tolerates an explicit `null` (clear on nullable keys). */
const optNullable = { options: { nullable: true } };

/** Shared `:id` path-param rule — bounded to the column width. */
const idParam: ParamSchema = {
    in: ["params"],
    trim: true,
    notEmpty: { errorMessage: "id is required" },
    isLength: {
        options: { max: ID_MAX },
        errorMessage: `id is too long (max ${ID_MAX} chars)`,
    },
};

/** `GET /api/v1/sprints` — optional `?status=` filter restricted to the enum. */
export const listSprintsValidator = checkSchema({
    status: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [[...sprintStatuses]],
            errorMessage: `status must be one of: ${sprintStatuses.join(", ")}`,
        },
    },
});

/** Shared `:id` guard for `GET /sprints/:id`, `POST /:id/start`, `/:id/close`. */
export const sprintIdParamValidator = checkSchema({ id: idParam });

/**
 * `POST /api/v1/sprints`. `name` + `start_date` + `end_date` are required;
 * `goal` is optional/nullable, `committed_points` optional (defaults to 0 in the
 * controller). `workspace_id` is never read from the body — it comes from
 * `req.auth` — so stray fields are ignored.
 */
export const createSprintValidator = checkSchema({
    name: {
        in: ["body"],
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `name must be at most ${NAME_MAX} characters`,
        },
    },
    goal: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "goal must be a string", bail: true },
        trim: true,
        isLength: {
            options: { max: GOAL_MAX },
            errorMessage: `goal must be at most ${GOAL_MAX} characters`,
        },
    },
    start_date: {
        in: ["body"],
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "start_date must be a YYYY-MM-DD date",
        },
    },
    end_date: {
        in: ["body"],
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "end_date must be a YYYY-MM-DD date",
        },
    },
    committed_points: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: POINTS_MAX },
            errorMessage: `committed_points must be an integer between 0 and ${POINTS_MAX}`,
        },
        toInt: true,
    },
});

/**
 * `PATCH /api/v1/sprints/:id`. Every body field is OPTIONAL (a partial update)
 * but, when present, obeys the same rules as create. A body with no updatable
 * fields is accepted and handled as a no-op by the service.
 */
export const updateSprintValidator = checkSchema({
    id: idParam,
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `name must be at most ${NAME_MAX} characters`,
        },
    },
    goal: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "goal must be a string", bail: true },
        trim: true,
        isLength: {
            options: { max: GOAL_MAX },
            errorMessage: `goal must be at most ${GOAL_MAX} characters`,
        },
    },
    start_date: {
        in: ["body"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "start_date must be a YYYY-MM-DD date",
        },
    },
    end_date: {
        in: ["body"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "end_date must be a YYYY-MM-DD date",
        },
    },
    committed_points: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: POINTS_MAX },
            errorMessage: `committed_points must be an integer between 0 and ${POINTS_MAX}`,
        },
        toInt: true,
    },
});

/**
 * `POST /api/v1/sprints/:id/tasks`. `task_ids` is a required non-empty array of
 * id strings; each element is trimmed + bounded. Whether each id is a real task
 * in the workspace is checked in the service (the whole batch is rejected with
 * `404 task.not_found` if any is invalid).
 */
export const addSprintTasksValidator = checkSchema({
    id: idParam,
    task_ids: {
        in: ["body"],
        isArray: {
            options: { min: 1 },
            errorMessage: "task_ids must be a non-empty array",
        },
    },
    "task_ids.*": {
        in: ["body"],
        isString: { errorMessage: "each task_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "task_id must not be empty" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `task_id is too long (max ${ID_MAX} chars)`,
        },
    },
});

/** `DELETE /api/v1/sprints/:id/tasks/:taskId` — both path params bounded. */
export const removeSprintTaskValidator = checkSchema({
    id: idParam,
    taskId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "taskId is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `taskId is too long (max ${ID_MAX} chars)`,
        },
    },
});
