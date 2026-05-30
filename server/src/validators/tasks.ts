import { checkSchema } from "express-validator";
import { bugSeverities, statusGroups } from "../db/schema/_shared";

/**
 * Validators for the Tasks resource family. Pair each `checkSchema(...)` with
 * the `validate` middleware so failures become the spec envelope (422 /
 * `validation.failed`).
 */

const MAX_ASSIGNEES_PER_REQUEST = 50;
const MAX_ID_LENGTH = 64;
const MAX_CSV_LENGTH = 1000;
const MAX_Q_LENGTH = 200;
const PRIORITY_VALUES = ["0", "1", "2", "3", "4"];

/**
 * Build a custom validator asserting every member of a comma-separated value is
 * in `allowed`. Empty members (e.g. a trailing comma) are ignored — the
 * controller drops them too.
 */
const csvMembersAllowed =
    (allowed: readonly string[]) =>
    (value: string): boolean =>
        value
            .split(",")
            .map((member) => member.trim())
            .filter((member) => member.length > 0)
            .every((member) => allowed.includes(member));

/**
 * `POST /api/v1/tasks/:id/assignees`.
 *
 * Accepts `{ user_id }` or `{ user_ids: [...] }`. The `user_id` field owns the
 * cross-field rule ("exactly one source of ids is required"), so it is NOT
 * marked `optional` — its custom validator must run even when the field is
 * absent. `user_ids` / `user_ids.*` give precise per-element errors.
 */
export const addAssigneesValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    user_ids: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { min: 1, max: MAX_ASSIGNEES_PER_REQUEST },
            errorMessage:
                "user_ids must be a non-empty array of at most 50 ids",
        },
    },
    "user_ids.*": {
        in: ["body"],
        isString: { errorMessage: "Each user id must be a string" },
        trim: true,
        isLength: {
            options: { min: 1, max: MAX_ID_LENGTH },
            errorMessage: "Each user id must be 1–64 characters",
        },
    },
    user_id: {
        in: ["body"],
        custom: {
            options: (_value: unknown, { req }) => {
                const body = (req.body ?? {}) as {
                    user_id?: unknown;
                    user_ids?: unknown;
                };
                const hasId =
                    body.user_id !== undefined && body.user_id !== null;
                const hasIds =
                    body.user_ids !== undefined && body.user_ids !== null;

                if (hasId) {
                    const value = body.user_id;
                    if (
                        typeof value !== "string" ||
                        value.trim().length < 1 ||
                        value.trim().length > MAX_ID_LENGTH
                    ) {
                        throw new Error(
                            "user_id must be a string of 1–64 characters",
                        );
                    }
                }
                if (!hasId && !hasIds) {
                    throw new Error("Provide user_id or user_ids");
                }
                return true;
            },
        },
    },
});

/**
 * `DELETE /api/v1/tasks/:id/assignees/:userId`.
 *
 * Both ids are path params; there is no body. `trim` runs before `notEmpty`, so
 * a whitespace-only `userId` collapses to empty and fails. Mirrors the `id`
 * rules on `addAssigneesValidator`.
 */
export const deleteAssigneeValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    userId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "User id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "User id is too long (max 64 chars)",
        },
    },
});

/**
 * `POST /api/v1/tasks/:id/watchers/self`.
 *
 * Only the `:id` path param; there is no body (the watcher is `req.auth.sub`).
 * `trim` runs before `notEmpty`, so a whitespace-only id collapses to empty and
 * fails. Mirrors the `id` rules on the sibling membership validators.
 */
export const watchSelfValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
});

/**
 * `GET /api/v1/tasks/:id`.
 *
 * The `:id` path segment is either an internal task id (`t-…`) or a `custom_id`
 * (`ORD-…`); both fit in 64 chars. This is format-only — the service resolves
 * the value within the caller's workspace or throws `404 task.not_found`.
 */
export const getTaskValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
});

/**
 * `GET /api/v1/tasks/:id/subtasks`.
 *
 * `:id` is the parent task's internal id (`t-…`) or `custom_id` (`ORD-…`).
 * `include_archived` defaults off; pass `true` to surface archived children
 * (mirrors `GET /lists/:listId/tasks`). Format-only — the service resolves the
 * parent within the caller's workspace or throws `404 task.not_found`.
 */
export const subtasksValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    include_archived: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["true", "false"]],
            errorMessage: "include_archived must be true or false",
        },
    },
});

/**
 * `GET /api/v1/lists/:listId/tasks`.
 *
 * All filters are optional. Multi-value filters are comma-separated strings
 * (repeated query keys arrive as arrays and fail `isString` → 422). `limit` is
 * coerced to an int and clamped to ≤200 in the service; the opaque `cursor` is
 * decoded (and a malformed one rejected as 400) in the service. Server-side
 * `sort` is not part of V1 — results are ordered by the stable `internal_id`.
 */
export const listTasksValidator = checkSchema({
    listId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "listId is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "listId is too long (max 64 chars)",
        },
    },
    status: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "status must be a comma-separated string" },
        isLength: { options: { max: MAX_CSV_LENGTH } },
    },
    status_group: {
        in: ["query"],
        optional: true,
        isString: {
            errorMessage: "status_group must be a comma-separated string",
        },
        custom: {
            options: csvMembersAllowed(statusGroups),
            errorMessage: `status_group members must be one of: ${statusGroups.join(", ")}`,
        },
    },
    assignee: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "assignee must be a comma-separated string" },
        isLength: { options: { max: MAX_CSV_LENGTH } },
    },
    reviewer: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "reviewer must be a string" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "reviewer is too long (max 64 chars)",
        },
    },
    priority: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "priority must be a comma-separated string" },
        custom: {
            options: csvMembersAllowed(PRIORITY_VALUES),
            errorMessage: "priority members must be integers 0–4",
        },
    },
    task_type: {
        in: ["query"],
        optional: true,
        isString: {
            errorMessage: "task_type must be a comma-separated string",
        },
        isLength: { options: { max: MAX_CSV_LENGTH } },
    },
    tag: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "tag must be a comma-separated string" },
        isLength: { options: { max: MAX_CSV_LENGTH } },
    },
    sprint: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "sprint must be a string" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "sprint is too long (max 64 chars)",
        },
    },
    bug_severity: {
        in: ["query"],
        optional: true,
        isString: {
            errorMessage: "bug_severity must be a comma-separated string",
        },
        custom: {
            options: csvMembersAllowed(bugSeverities),
            errorMessage: `bug_severity members must be one of: ${bugSeverities.join(", ")}`,
        },
    },
    q: {
        in: ["query"],
        optional: true,
        trim: true,
        isLength: {
            options: { max: MAX_Q_LENGTH },
            errorMessage: "q must be at most 200 characters",
        },
    },
    due_before: {
        in: ["query"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "due_before must be a YYYY-MM-DD date",
        },
    },
    due_after: {
        in: ["query"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "due_after must be a YYYY-MM-DD date",
        },
    },
    include_archived: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["true", "false"]],
            errorMessage: "include_archived must be true or false",
        },
    },
    include_subtasks: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["true", "false"]],
            errorMessage: "include_subtasks must be true or false",
        },
    },
    cursor: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "cursor must be a string" },
        notEmpty: { errorMessage: "cursor must not be empty" },
    },
    limit: {
        in: ["query"],
        optional: true,
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});
