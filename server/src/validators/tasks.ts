import { checkSchema, type Meta } from "express-validator";
import {
    bugEnvironments,
    bugReproducibilities,
    bugSeverities,
    prStatuses,
    recurrencePatterns,
    reporterTeams,
    statusGroups,
    weekDays,
} from "../db/schema/_shared";

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

/** Optional + null-allowed (a nullable field may be omitted or sent as null). */
const optNullable = { options: { nullable: true } };

/**
 * Reject a repeated query key. `?limit=1&limit=2` arrives as an array, which the
 * element-wise `isInt`/`isIn`/`isDate` validators pass — then the array reaches
 * the service as a scalar filter. Mirrors the §4 users-list `notRepeated` guard;
 * applied to the non-string query params (the string filters already reject an
 * array via `isString`).
 */
const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

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
 * `GET /api/v1/tasks/my-work` (§10 #11). `bucket` optionally narrows the
 * response to one of the five buckets; omitted returns all five.
 */
export const myWorkValidator = checkSchema({
    bucket: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["today", "overdue", "next", "unscheduled", "done"]],
            errorMessage:
                "bucket must be one of: today, overdue, next, unscheduled, done",
        },
    },
});

/**
 * `POST /api/v1/tasks/bulk` (§10 #10). `ids` is 1–200 task ids; `patch` is an
 * object of supported keys. Per-key types are validated here; the controller
 * rejects unknown patch keys + an empty patch, and the service fails-atomic on
 * any invalid id/reference. `optNullable` allows null (clear) on nullable keys.
 */
export const bulkTasksValidator = checkSchema({
    ids: {
        in: ["body"],
        isArray: {
            options: { min: 1, max: 200 },
            errorMessage: "ids must be an array of 1–200 task ids",
        },
    },
    "ids.*": {
        in: ["body"],
        isString: { errorMessage: "each id must be a string" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    patch: {
        in: ["body"],
        custom: {
            options: (value: unknown): boolean => {
                if (
                    value === null ||
                    typeof value !== "object" ||
                    Array.isArray(value)
                ) {
                    throw new Error("patch must be an object");
                }
                return true;
            },
        },
    },
    "patch.status_id": {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "patch.status_id must be a string" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    "patch.priority": {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 4 },
            errorMessage: "patch.priority must be an integer 0–4",
        },
        toInt: true,
    },
    "patch.due_date": {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "patch.due_date must be a YYYY-MM-DD date",
        },
    },
    "patch.start_date": {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "patch.start_date must be a YYYY-MM-DD date",
        },
    },
    "patch.sprint_id": {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "patch.sprint_id must be a string or null" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    "patch.archived_at": {
        in: ["body"],
        optional: optNullable,
        isISO8601: {
            errorMessage: "patch.archived_at must be an ISO-8601 timestamp",
        },
    },
    "patch.assignee_add": {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "patch.assignee_add must be an array" },
    },
    "patch.assignee_add.*": {
        in: ["body"],
        isString: { errorMessage: "each assignee id must be a string" },
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    "patch.assignee_remove": {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "patch.assignee_remove must be an array" },
    },
    "patch.assignee_remove.*": {
        in: ["body"],
        isString: { errorMessage: "each assignee id must be a string" },
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    "patch.tag_add": {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "patch.tag_add must be an array" },
    },
    "patch.tag_add.*": {
        in: ["body"],
        isString: { errorMessage: "each tag id must be a string" },
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    "patch.tag_remove": {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "patch.tag_remove must be an array" },
    },
    "patch.tag_remove.*": {
        in: ["body"],
        isString: { errorMessage: "each tag id must be a string" },
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
});

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
 * `POST /api/v1/tasks/:id/tags`.
 *
 * Mirrors `addAssigneesValidator`: accepts `{ tag_id }` or `{ tag_ids: [...] }`.
 * The `tag_id` field owns the cross-field "exactly one source of ids is
 * required" rule (so it is NOT `optional` — its custom validator must run even
 * when the field is absent); `tag_ids` / `tag_ids.*` give per-element errors.
 */
export const addTagsValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    tag_ids: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { min: 1, max: MAX_ASSIGNEES_PER_REQUEST },
            errorMessage: "tag_ids must be a non-empty array of at most 50 ids",
        },
    },
    "tag_ids.*": {
        in: ["body"],
        isString: { errorMessage: "Each tag id must be a string" },
        trim: true,
        isLength: {
            options: { min: 1, max: MAX_ID_LENGTH },
            errorMessage: "Each tag id must be 1–64 characters",
        },
    },
    tag_id: {
        in: ["body"],
        custom: {
            options: (_value: unknown, { req }) => {
                const body = (req.body ?? {}) as {
                    tag_id?: unknown;
                    tag_ids?: unknown;
                };
                const hasId = body.tag_id !== undefined && body.tag_id !== null;
                const hasIds =
                    body.tag_ids !== undefined && body.tag_ids !== null;

                if (hasId) {
                    const value = body.tag_id;
                    if (
                        typeof value !== "string" ||
                        value.trim().length < 1 ||
                        value.trim().length > MAX_ID_LENGTH
                    ) {
                        throw new Error(
                            "tag_id must be a string of 1–64 characters",
                        );
                    }
                }
                if (!hasId && !hasIds) {
                    throw new Error("Provide tag_id or tag_ids");
                }
                return true;
            },
        },
    },
});

/**
 * `DELETE /api/v1/tasks/:id/tags/:tagId`.
 *
 * Both ids are path params; there is no body. `trim` runs before `notEmpty`, so
 * a whitespace-only `tagId` collapses to empty and fails. Mirrors
 * `deleteAssigneeValidator`.
 */
export const removeTagValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    tagId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Tag id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Tag id is too long (max 64 chars)",
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
        custom: notRepeated("include_archived"),
        isIn: {
            options: [["true", "false"]],
            errorMessage: "include_archived must be true or false",
        },
    },
    include_subtasks: {
        in: ["query"],
        optional: true,
        custom: notRepeated("include_subtasks"),
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
        custom: notRepeated("limit"),
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});

/**
 * `GET /api/v1/tasks/:id/activity` (§13). `:id` is an internal task id or a
 * `custom_id`. `?action=` is an OPTIONAL exact-match filter accepted as a free
 * string (≤ the `action` column's 60 chars) rather than a closed enum — the set
 * of action codes is owned by the WRITING endpoints and grows over time, so an
 * unknown value simply yields an empty page, never a 422. `cursor`/`limit` match
 * the list-tasks pagination contract.
 */
export const taskActivityValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    action: {
        in: ["query"],
        optional: true,
        trim: true,
        isString: { errorMessage: "action must be a string" },
        notEmpty: { errorMessage: "action must not be empty" },
        isLength: {
            options: { max: 60 },
            errorMessage: "action is too long (max 60 chars)",
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

/**
 * `POST /api/v1/tasks` (§10 #4) — create a task. Only `primary_list_id` + `name`
 * are required; every other field is optional. Enums are constrained here so a
 * bad value is a clean 422; the SERVICE owns the cross-row rules (status∈list,
 * task_type∈workspace, parent nesting, assignee/tag membership) and the computed
 * fields (task_number, custom_id, sla_due_at, completed_at). Counter columns are
 * not accepted (trigger-maintained). `assignees`/`tags` are id arrays for the
 * initial membership writes.
 */
export const createTaskValidator = checkSchema({
    primary_list_id: {
        in: ["body"],
        isString: { errorMessage: "primary_list_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "primary_list_id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "primary_list_id is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: 500 },
            errorMessage: "name must be at most 500 characters",
        },
    },
    description: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "description must be a string or null" },
    },
    status_id: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "status_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "status_id must not be empty" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    task_type_id: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "task_type_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "task_type_id must not be empty" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    parent_task_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "parent_task_id must be a string or null", bail: true },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "parent_task_id is too long (max 64 chars)",
        },
    },
    priority: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 4 },
            errorMessage: "priority must be an integer 0–4",
        },
        toInt: true,
    },
    is_milestone: {
        in: ["body"],
        optional: true,
        isBoolean: { errorMessage: "is_milestone must be a boolean" },
        toBoolean: true,
    },
    custom_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "custom_id must be a string or null", bail: true },
        trim: true,
        isLength: {
            options: { max: 40 },
            errorMessage: "custom_id must be at most 40 characters",
        },
    },
    start_date: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "start_date must be a YYYY-MM-DD date",
        },
    },
    due_date: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "due_date must be a YYYY-MM-DD date",
        },
    },
    recurrence_pattern: {
        in: ["body"],
        optional: true,
        isIn: {
            options: [[...recurrencePatterns]],
            errorMessage: `recurrence_pattern must be one of: ${recurrencePatterns.join(", ")}`,
        },
    },
    recurrence_days: {
        in: ["body"],
        optional: optNullable,
        isArray: { errorMessage: "recurrence_days must be an array" },
    },
    "recurrence_days.*": {
        in: ["body"],
        isIn: {
            options: [[...weekDays]],
            errorMessage: `recurrence_days members must be one of: ${weekDays.join(", ")}`,
        },
    },
    recurrence_ends_at: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "recurrence_ends_at must be a YYYY-MM-DD date",
        },
    },
    time_estimate_seconds: {
        in: ["body"],
        optional: optNullable,
        isInt: {
            options: { min: 0 },
            errorMessage: "time_estimate_seconds must be a non-negative integer",
        },
        toInt: true,
    },
    assignees: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { max: MAX_ASSIGNEES_PER_REQUEST },
            errorMessage: "assignees must be an array of at most 50 ids",
        },
    },
    "assignees.*": {
        in: ["body"],
        isString: { errorMessage: "each assignee id must be a string" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    tags: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { max: 50 },
            errorMessage: "tags must be an array of at most 50 ids",
        },
    },
    "tags.*": {
        in: ["body"],
        isString: { errorMessage: "each tag id must be a string" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    // ─── Engineering-space fields (all optional, nullable) ───────────────────
    sprint_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "sprint_id must be a string or null" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    story_points: {
        in: ["body"],
        optional: optNullable,
        isInt: {
            options: { min: 0, max: 255 },
            errorMessage: "story_points must be an integer 0–255",
        },
        toInt: true,
    },
    reviewer_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "reviewer_id must be a string or null" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    branch_name: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "branch_name must be a string or null" },
        isLength: { options: { max: 200 } },
    },
    pr_url: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "pr_url must be a string or null" },
        isLength: { options: { max: 500 } },
    },
    pr_status: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...prStatuses]],
            errorMessage: `pr_status must be one of: ${prStatuses.join(", ")}`,
        },
    },
    bug_severity: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugSeverities]],
            errorMessage: `bug_severity must be one of: ${bugSeverities.join(", ")}`,
        },
    },
    bug_reproducibility: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugReproducibilities]],
            errorMessage: `bug_reproducibility must be one of: ${bugReproducibilities.join(", ")}`,
        },
    },
    bug_environment: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugEnvironments]],
            errorMessage: `bug_environment must be one of: ${bugEnvironments.join(", ")}`,
        },
    },
    bug_browser: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "bug_browser must be a string or null" },
        isLength: { options: { max: 120 } },
    },
    reporter_team: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...reporterTeams]],
            errorMessage: `reporter_team must be one of: ${reporterTeams.join(", ")}`,
        },
    },
    deployed_at: {
        in: ["body"],
        optional: optNullable,
        isISO8601: { errorMessage: "deployed_at must be an ISO-8601 timestamp" },
    },
    rollback_reason: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "rollback_reason must be a string or null" },
        isLength: { options: { max: 500 } },
    },
});

/**
 * `PATCH /api/v1/tasks/:id` (§10 #5) — partial scalar update. EVERY field is
 * optional (the controller enforces "≥1 field"); the same per-field rules as
 * create apply. `primary_list_id`, `assignees`, `tags`, and `parent_task_id` are
 * deliberately NOT accepted — moving lists (per-list task_number), membership
 * (§11 / #10 bulk), and reparenting are separate concerns. The `If-Match` header
 * (optional optimistic lock) is read by the controller, not validated here.
 */
export const updateTaskValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "Task id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "Task id is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: 500 },
            errorMessage: "name must be at most 500 characters",
        },
    },
    description: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "description must be a string or null" },
    },
    status_id: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "status_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "status_id must not be empty" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    task_type_id: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "task_type_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "task_type_id must not be empty" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    priority: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 4 },
            errorMessage: "priority must be an integer 0–4",
        },
        toInt: true,
    },
    is_milestone: {
        in: ["body"],
        optional: true,
        isBoolean: { errorMessage: "is_milestone must be a boolean" },
        toBoolean: true,
    },
    custom_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "custom_id must be a string or null", bail: true },
        trim: true,
        isLength: {
            options: { max: 40 },
            errorMessage: "custom_id must be at most 40 characters",
        },
    },
    start_date: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "start_date must be a YYYY-MM-DD date",
        },
    },
    due_date: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "due_date must be a YYYY-MM-DD date",
        },
    },
    recurrence_pattern: {
        in: ["body"],
        optional: true,
        isIn: {
            options: [[...recurrencePatterns]],
            errorMessage: `recurrence_pattern must be one of: ${recurrencePatterns.join(", ")}`,
        },
    },
    recurrence_days: {
        in: ["body"],
        optional: optNullable,
        isArray: { errorMessage: "recurrence_days must be an array" },
    },
    "recurrence_days.*": {
        in: ["body"],
        isIn: {
            options: [[...weekDays]],
            errorMessage: `recurrence_days members must be one of: ${weekDays.join(", ")}`,
        },
    },
    recurrence_ends_at: {
        in: ["body"],
        optional: optNullable,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "recurrence_ends_at must be a YYYY-MM-DD date",
        },
    },
    time_estimate_seconds: {
        in: ["body"],
        optional: optNullable,
        isInt: {
            options: { min: 0 },
            errorMessage: "time_estimate_seconds must be a non-negative integer",
        },
        toInt: true,
    },
    sprint_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "sprint_id must be a string or null" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    story_points: {
        in: ["body"],
        optional: optNullable,
        isInt: {
            options: { min: 0, max: 255 },
            errorMessage: "story_points must be an integer 0–255",
        },
        toInt: true,
    },
    reviewer_id: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "reviewer_id must be a string or null" },
        isLength: { options: { max: MAX_ID_LENGTH } },
    },
    branch_name: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "branch_name must be a string or null" },
        isLength: { options: { max: 200 } },
    },
    pr_url: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "pr_url must be a string or null" },
        isLength: { options: { max: 500 } },
    },
    pr_status: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...prStatuses]],
            errorMessage: `pr_status must be one of: ${prStatuses.join(", ")}`,
        },
    },
    bug_severity: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugSeverities]],
            errorMessage: `bug_severity must be one of: ${bugSeverities.join(", ")}`,
        },
    },
    bug_reproducibility: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugReproducibilities]],
            errorMessage: `bug_reproducibility must be one of: ${bugReproducibilities.join(", ")}`,
        },
    },
    bug_environment: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...bugEnvironments]],
            errorMessage: `bug_environment must be one of: ${bugEnvironments.join(", ")}`,
        },
    },
    bug_browser: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "bug_browser must be a string or null" },
        isLength: { options: { max: 120 } },
    },
    reporter_team: {
        in: ["body"],
        optional: optNullable,
        isIn: {
            options: [[...reporterTeams]],
            errorMessage: `reporter_team must be one of: ${reporterTeams.join(", ")}`,
        },
    },
    deployed_at: {
        in: ["body"],
        optional: optNullable,
        isISO8601: { errorMessage: "deployed_at must be an ISO-8601 timestamp" },
    },
    rollback_reason: {
        in: ["body"],
        optional: optNullable,
        isString: { errorMessage: "rollback_reason must be a string or null" },
        isLength: { options: { max: 500 } },
    },
});
