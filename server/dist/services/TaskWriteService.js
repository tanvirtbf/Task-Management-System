"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskWriteService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema = __importStar(require("../db/schema"));
const errors_1 = require("../errors");
const utils_1 = require("../utils");
const constants_1 = require("../constants");
const taskSerializer_1 = require("../serializers/taskSerializer");
/**
 * §10 Tasks WRITE logic (create / update / archive / delete / bulk + the
 * my-work rollup). Kept separate from the read-side `TasksService` so the
 * existing read endpoints' 2-arg DI (in `routes/tasks.ts` AND `routes/lists.ts`)
 * is untouched — this is the same split the codebase already uses for
 * `TaskMembershipService`. Owns transactions; the read `TasksService` is reused
 * to hydrate + serialize the response so the wire `Task` is identical to a GET.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TASK_NUMBER_MAX_RETRIES = 4;
/** mysql2 surfaces a unique-violation as `ER_DUP_ENTRY` / errno 1062. */
const isDuplicateKeyError = (err) => {
    const e = err;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};
/** mysql2 surfaces a missing-FK-target as `ER_NO_REFERENCED_ROW(_2)` / 1452. */
const isForeignKeyError = (err) => {
    const e = err;
    return (e?.code === "ER_NO_REFERENCED_ROW_2" ||
        e?.code === "ER_NO_REFERENCED_ROW" ||
        e?.errno === 1452);
};
/**
 * §29 implicit SLA policy, relative to create time. Keyed on the task-type NAME
 * (case-insensitive "bug"/"complaint") + `bug_severity` — the only signals the
 * spec names. Returns `null` (no SLA) for every other type and for Bug S3.
 */
const computeSlaDueAt = (typeName, severity, now) => {
    const t = typeName.trim().toLowerCase();
    if (t === "bug") {
        switch (severity) {
            case "S0":
                return new Date(now.getTime() + 2 * HOUR_MS);
            case "S1":
                return new Date(now.getTime() + 24 * HOUR_MS);
            case "S2":
                return new Date(now.getTime() + 7 * DAY_MS);
            default:
                return null; // S3 or unset
        }
    }
    if (t === "complaint")
        return new Date(now.getTime() + 24 * HOUR_MS);
    return null;
};
/**
 * Parse a `YYYY-MM-DD` wire date into a LOCAL-midnight `Date` for a MySQL DATE
 * column (Drizzle `date()` is in `mode: "date"`). Local midnight round-trips
 * cleanly through the serializer's local-component formatting (`toWireDate`),
 * avoiding the UTC-boundary shift a `new Date("YYYY-MM-DD")` (UTC midnight)
 * would cause.
 */
const toLocalDate = (value) => {
    if (value === null || value === undefined)
        return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
};
/** Local `YYYY-MM-DD` for a Date (matches the serializer's date formatting). */
const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
const DONE_GROUPS = new Set(["done", "closed"]);
class TaskWriteService {
    db;
    lists;
    statuses;
    taskTypes;
    tasks;
    membership;
    users;
    tags;
    activity;
    notifications;
    reads;
    logger;
    constructor(db, lists, statuses, taskTypes, tasks, membership, users, tags, activity, notifications, reads, logger) {
        this.db = db;
        this.lists = lists;
        this.statuses = statuses;
        this.taskTypes = taskTypes;
        this.tasks = tasks;
        this.membership = membership;
        this.users = users;
        this.tags = tags;
        this.activity = activity;
        this.notifications = notifications;
        this.reads = reads;
        this.logger = logger;
    }
    /**
     * Create a task (`POST /api/v1/tasks`, 🔐 any member).
     *
     * Resolves + validates the list (404 / 409 archived), task type (default =
     * list's `default_task_type_id`; 422 if none/invalid), status (default = the
     * list's lowest-position status; 422 if the supplied one is not in the list),
     * parent (422 if not in workspace or nesting would exceed 2), and the initial
     * assignees/tags (422 if any is not a workspace member / workspace tag). The
     * app computes `task_number` (per-list, race-retried), `nesting_depth`,
     * `completed_at` (set when the landing status is done/closed), `sla_due_at`
     * (§29 policy), and defaults a Bug task's severity to S2. The row insert,
     * parent link, assignee/watcher/tag writes, the `task_created` activity row
     * (+ one `assignee_added` per initial assignee), and the assignee
     * notifications all commit in ONE transaction. The response is hydrated by
     * the read service so it is byte-identical to a later GET.
     *
     * NOTE: `custom_id` is left null when omitted — the documented
     * `<list.prefix>-<task_number>` recipe has no source (`lists` has no `prefix`
     * column), so auto-generation is deferred rather than fabricated. A
     * client-supplied `custom_id` is honoured (unique per workspace).
     */
    async create(input) {
        const now = new Date();
        // 1. List must exist in the workspace and not be archived.
        const list = await this.lists.findRecordByIdInWorkspace(input.primaryListId, input.workspaceId);
        if (!list) {
            throw errors_1.AppError.notFound("list.not_found", `List ${input.primaryListId} does not exist`);
        }
        if (list.archivedAt) {
            throw errors_1.AppError.conflict("list.archived", "Cannot create a task in an archived list");
        }
        // 2. Resolve the task type: explicit body value → the list's default →
        //    fall back to ANY task type in the workspace. The fallback keeps
        //    creation from dead-ending when a list has no default (e.g. public
        //    form submits, quick-adds); only a workspace with ZERO task types 422s.
        let taskTypeId = input.taskTypeId ?? list.defaultTaskTypeId ?? undefined;
        if (!taskTypeId) {
            const [fallback] = await this.taskTypes.listByWorkspace(input.workspaceId);
            taskTypeId = fallback?.id;
        }
        if (!taskTypeId) {
            throw errors_1.AppError.unprocessable("task.invalid_task_type", "This workspace has no task types; create one before adding tasks", [{ field: "task_type_id", issue: "no task type available" }]);
        }
        const taskType = await this.taskTypes.findByIdInWorkspace(taskTypeId, input.workspaceId);
        if (!taskType) {
            throw errors_1.AppError.unprocessable("task.invalid_task_type", `${taskTypeId} is not a task type in this workspace`, [{ field: "task_type_id", issue: "is not a task type in this workspace" }]);
        }
        // 3. Resolve + validate the status (body, else the list's first status).
        const listStatuses = await this.statuses.listByList(input.primaryListId);
        if (listStatuses.length === 0) {
            throw errors_1.AppError.internal("List has no statuses configured; cannot place a task");
        }
        let status;
        if (input.statusId !== undefined) {
            status = listStatuses.find((s) => s.id === input.statusId);
            if (!status) {
                throw errors_1.AppError.unprocessable("task.invalid_status", `${input.statusId} is not a status of this list`, [{ field: "status_id", issue: "is not a status of this list" }]);
            }
        }
        else {
            status = listStatuses.reduce((lo, s) => s.position < lo.position ? s : lo);
        }
        // 4. Parent nesting: parent must be in-workspace; child depth ≤ 2.
        let nestingDepth = 0;
        if (input.parentTaskId) {
            const parent = await this.tasks.findByIdOrCustomIdInWorkspace(input.parentTaskId, input.workspaceId);
            if (!parent) {
                throw errors_1.AppError.unprocessable("task.invalid_parent", `${input.parentTaskId} is not a task in this workspace`, [{ field: "parent_task_id", issue: "is not a task in this workspace" }]);
            }
            nestingDepth = parent.nestingDepth + 1;
            if (nestingDepth > 2) {
                throw errors_1.AppError.unprocessable("task.nesting_too_deep", "Subtasks may nest at most 2 levels deep", [{ field: "parent_task_id", issue: "nesting would exceed 2 levels" }]);
            }
            // Re-point parentTaskId at the parent's internal id (the body may
            // have referenced it by custom_id).
            input.parentTaskId = parent.id;
        }
        // 5. Validate initial assignees + tags (no partial writes).
        const assignees = dedupe(input.assignees);
        if (assignees.length > 0) {
            const valid = await this.users.findActiveIdsInWorkspace(assignees, input.workspaceId);
            const invalid = assignees.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw errors_1.AppError.unprocessable("task.invalid_assignee", "One or more assignees are not active members of this workspace", invalid.map((id) => ({
                    field: "assignees",
                    issue: `${id} is not an active member of this workspace`,
                })));
            }
        }
        const tagIds = dedupe(input.tags);
        if (tagIds.length > 0) {
            const valid = await this.tags.findIdsInWorkspace(tagIds, input.workspaceId);
            const invalid = tagIds.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw errors_1.AppError.unprocessable("task.invalid_tag", "One or more tags do not exist in this workspace", invalid.map((id) => ({
                    field: "tags",
                    issue: `${id} is not a tag in this workspace`,
                })));
            }
        }
        // 5b. Custom-id (if supplied) is unique per workspace — friendly 409
        //     pre-check; the `uq_tasks_custom_id` index is the race backstop.
        if (input.customId) {
            const clash = await this.tasks.findByIdOrCustomIdInWorkspace(input.customId, input.workspaceId);
            if (clash) {
                throw errors_1.AppError.conflict("task.duplicate_custom_id", `A task with custom_id ${input.customId} already exists`);
            }
        }
        // 5c. Date ordering — start must not be after due. The HTTP task
        //     validator checks each date's FORMAT but not their order, and the
        //     public form submit path skips that validator entirely; the
        //     `ck_tasks_dates` CHECK would otherwise surface as a raw 500. Both
        //     values are canonical YYYY-MM-DD here, so a lexical compare is safe.
        if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
            throw errors_1.AppError.unprocessable("task.invalid_date_range", "start_date must not be after due_date", [{ field: "start_date", issue: "must be on or before due_date" }]);
        }
        // 6. Bug severity default + SLA + completed_at.
        const isBug = taskType.name.trim().toLowerCase() === "bug";
        const bugSeverity = isBug && (input.bugSeverity ?? null) === null
            ? "S2"
            : (input.bugSeverity ?? null);
        const slaDueAt = computeSlaDueAt(taskType.name, bugSeverity, now);
        const completedAt = DONE_GROUPS.has(status.statusGroup) ? now : null;
        const taskId = (0, utils_1.fakeId)("t");
        // 7. Atomic create, retrying only on a per-list task_number collision.
        for (let attempt = 1;; attempt += 1) {
            const taskNumber = await this.tasks.nextTaskNumber(input.primaryListId);
            try {
                await this.db.transaction(async (tx) => {
                    const row = {
                        id: taskId,
                        workspaceId: input.workspaceId,
                        primaryListId: input.primaryListId,
                        taskNumber,
                        customId: input.customId ?? null,
                        name: input.name,
                        description: input.description ?? null,
                        statusId: status.id,
                        priority: input.priority ?? 0,
                        taskTypeId,
                        // parent set AFTER insert (error-1442 workaround); depth ok now.
                        nestingDepth,
                        isMilestone: input.isMilestone ?? false,
                        startDate: toLocalDate(input.startDate),
                        dueDate: toLocalDate(input.dueDate),
                        completedAt,
                        slaDueAt,
                        recurrencePattern: input.recurrencePattern ?? "none",
                        recurrenceDays: (input.recurrenceDays ??
                            null),
                        recurrenceEndsAt: toLocalDate(input.recurrenceEndsAt),
                        timeEstimateSeconds: input.timeEstimateSeconds ?? null,
                        sprintId: input.sprintId ?? null,
                        storyPoints: input.storyPoints ?? null,
                        reviewerId: input.reviewerId ?? null,
                        branchName: input.branchName ?? null,
                        prUrl: input.prUrl ?? null,
                        prStatus: (input.prStatus ?? null),
                        bugSeverity: bugSeverity,
                        bugReproducibility: (input.bugReproducibility ?? null),
                        bugEnvironment: (input.bugEnvironment ?? null),
                        bugBrowser: input.bugBrowser ?? null,
                        reporterTeam: (input.reporterTeam ?? null),
                        deployedAt: input.deployedAt
                            ? new Date(input.deployedAt)
                            : null,
                        rollbackReason: input.rollbackReason ?? null,
                        createdBy: input.actorId,
                    };
                    await this.tasks.insert(row, tx);
                    if (input.parentTaskId) {
                        await this.tasks.setParent(taskId, input.parentTaskId, nestingDepth, tx);
                    }
                    if (assignees.length > 0) {
                        await this.membership.addAssignees(taskId, assignees, input.actorId, tx);
                        await this.membership.addWatchers(taskId, assignees, tx);
                    }
                    if (tagIds.length > 0) {
                        await this.membership.addTags(taskId, tagIds, tx);
                    }
                    await this.activity.recordMany([
                        {
                            taskId,
                            actorId: input.actorId,
                            action: "task_created",
                            context: {
                                name: input.name,
                                list_id: input.primaryListId,
                            },
                        },
                        ...assignees.map((userId) => ({
                            taskId,
                            actorId: input.actorId,
                            action: "assignee_added",
                            context: { user_id: userId },
                        })),
                    ], tx);
                    const recipients = assignees.filter((id) => id !== input.actorId);
                    await this.notifications.createMany(recipients.map((userId) => ({
                        userId,
                        type: "assigned",
                        entityType: "task",
                        entityId: taskId,
                        actorId: input.actorId,
                        title: assignedTitle(input.name),
                    })), tx);
                });
                break; // committed
            }
            catch (err) {
                if (isDuplicateKeyError(err)) {
                    const msg = err.sqlMessage ?? "";
                    // A racing custom_id (both passed the pre-check) — a 409, not
                    // something a fresh task_number can fix.
                    if (msg.includes("uq_tasks_custom_id")) {
                        throw errors_1.AppError.conflict("task.duplicate_custom_id", `A task with custom_id ${input.customId} already exists`);
                    }
                    // A racing per-list task_number — recompute MAX+1 and retry.
                    if (attempt < TASK_NUMBER_MAX_RETRIES) {
                        this.logger.debug("tasks.create.task_number_retry", {
                            listId: input.primaryListId,
                            attempt,
                        });
                        continue;
                    }
                }
                throw err;
            }
        }
        // 8. Hydrate + serialize via the read path (identical to a GET).
        return this.reads.getById({
            idOrKey: taskId,
            workspaceId: input.workspaceId,
            role: input.role,
        });
    }
    /**
     * Update a task's scalar fields (`PATCH /api/v1/tasks/:id`, 🔐 any member).
     *
     * Optimistic concurrency: when `If-Match` is sent it must equal the current
     * `updated_at` (the ETag) or it is a 409 `task.conflict`. An archived task is
     * read-only (409 `task.archived`). Reference fields are validated
     * (status∈list, task_type∈workspace, reviewer∈workspace, custom_id unique).
     * A status move into / out of a done|closed group sets / clears
     * `completed_at`; changing `bug_severity` recomputes `sla_due_at` per the §29
     * policy. The update + a `status_changed` row (when status moves) + a
     * `task_updated` row commit in one transaction. Assignees / tags / parent are
     * NOT updatable here — use the §11 membership endpoints, #10 bulk, or a
     * dedicated reparent flow. Returns the updated `Task` with a fresh ETag.
     */
    async update(input) {
        const now = new Date();
        const p = input.patch;
        const current = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!current) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        if (input.ifMatch !== undefined &&
            input.ifMatch !== current.updatedAt.toISOString()) {
            throw errors_1.AppError.conflict("task.conflict", "The task was modified since you last read it (ETag mismatch)");
        }
        if (current.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot update an archived task; unarchive it first");
        }
        // ─── Reference validation ────────────────────────────────────────────
        const listStatuses = await this.statuses.listByList(current.primaryListId);
        let newStatusGroup;
        if (p.statusId !== undefined && p.statusId !== current.statusId) {
            const status = listStatuses.find((s) => s.id === p.statusId);
            if (!status) {
                throw errors_1.AppError.unprocessable("task.invalid_status", `${p.statusId} is not a status of this list`, [{ field: "status_id", issue: "is not a status of this list" }]);
            }
            newStatusGroup = status.statusGroup;
        }
        let typeName = "";
        if (p.taskTypeId !== undefined) {
            const tt = await this.taskTypes.findByIdInWorkspace(p.taskTypeId, input.workspaceId);
            if (!tt) {
                throw errors_1.AppError.unprocessable("task.invalid_task_type", `${p.taskTypeId} is not a task type in this workspace`, [{ field: "task_type_id", issue: "is not a task type in this workspace" }]);
            }
            typeName = tt.name;
        }
        if (p.reviewerId !== undefined && p.reviewerId !== null) {
            const valid = await this.users.findActiveIdsInWorkspace([p.reviewerId], input.workspaceId);
            if (!valid.has(p.reviewerId)) {
                throw errors_1.AppError.unprocessable("task.invalid_reviewer", `${p.reviewerId} is not an active member of this workspace`, [{ field: "reviewer_id", issue: "is not an active member of this workspace" }]);
            }
        }
        if (p.customId !== undefined &&
            p.customId !== null &&
            p.customId !== current.customId) {
            const clash = await this.tasks.findByIdOrCustomIdInWorkspace(p.customId, input.workspaceId);
            if (clash && clash.id !== current.id) {
                throw errors_1.AppError.conflict("task.duplicate_custom_id", `A task with custom_id ${p.customId} already exists`);
            }
        }
        // Date ordering on PATCH is partial-aware: a change to only start OR only
        // due must still respect start <= due against the STORED counterpart, else
        // the `ck_tasks_dates` CHECK surfaces as a raw 500. Patch values are
        // canonical YYYY-MM-DD; stored values are Dates → normalize via `ymd`.
        const effStart = p.startDate !== undefined
            ? p.startDate
            : current.startDate
                ? ymd(current.startDate)
                : null;
        const effDue = p.dueDate !== undefined
            ? p.dueDate
            : current.dueDate
                ? ymd(current.dueDate)
                : null;
        if (effStart && effDue && effStart > effDue) {
            throw errors_1.AppError.unprocessable("task.invalid_date_range", "start_date must not be after due_date", [{ field: "start_date", issue: "must be on or before due_date" }]);
        }
        // ─── Build the column patch ──────────────────────────────────────────
        const dbPatch = {};
        if (p.name !== undefined)
            dbPatch.name = p.name;
        if (p.description !== undefined)
            dbPatch.description = p.description;
        if (p.statusId !== undefined)
            dbPatch.statusId = p.statusId;
        if (p.priority !== undefined)
            dbPatch.priority = p.priority;
        if (p.taskTypeId !== undefined)
            dbPatch.taskTypeId = p.taskTypeId;
        if (p.isMilestone !== undefined)
            dbPatch.isMilestone = p.isMilestone;
        if (p.customId !== undefined)
            dbPatch.customId = p.customId;
        if (p.startDate !== undefined)
            dbPatch.startDate = toLocalDate(p.startDate);
        if (p.dueDate !== undefined)
            dbPatch.dueDate = toLocalDate(p.dueDate);
        if (p.recurrencePattern !== undefined)
            dbPatch.recurrencePattern = p.recurrencePattern;
        if (p.recurrenceDays !== undefined)
            dbPatch.recurrenceDays =
                p.recurrenceDays;
        if (p.recurrenceEndsAt !== undefined)
            dbPatch.recurrenceEndsAt = toLocalDate(p.recurrenceEndsAt);
        if (p.timeEstimateSeconds !== undefined)
            dbPatch.timeEstimateSeconds = p.timeEstimateSeconds;
        if (p.sprintId !== undefined)
            dbPatch.sprintId = p.sprintId;
        if (p.storyPoints !== undefined)
            dbPatch.storyPoints = p.storyPoints;
        if (p.reviewerId !== undefined)
            dbPatch.reviewerId = p.reviewerId;
        if (p.branchName !== undefined)
            dbPatch.branchName = p.branchName;
        if (p.prUrl !== undefined)
            dbPatch.prUrl = p.prUrl;
        if (p.prStatus !== undefined)
            dbPatch.prStatus = p.prStatus;
        if (p.bugSeverity !== undefined)
            dbPatch.bugSeverity = p.bugSeverity;
        if (p.bugReproducibility !== undefined)
            dbPatch.bugReproducibility =
                p.bugReproducibility;
        if (p.bugEnvironment !== undefined)
            dbPatch.bugEnvironment =
                p.bugEnvironment;
        if (p.bugBrowser !== undefined)
            dbPatch.bugBrowser = p.bugBrowser;
        if (p.reporterTeam !== undefined)
            dbPatch.reporterTeam = p.reporterTeam;
        if (p.deployedAt !== undefined)
            dbPatch.deployedAt = p.deployedAt ? new Date(p.deployedAt) : null;
        if (p.rollbackReason !== undefined)
            dbPatch.rollbackReason = p.rollbackReason;
        // completed_at follows the landing status group on a status change.
        // Dept Review V1 (P9): leaving a done group also clears the current-
        // review denorm trio (the task_reviews ledger keeps history) — a
        // reopened task must be re-reviewed once it is completed again.
        if (newStatusGroup !== undefined) {
            const landsDone = DONE_GROUPS.has(newStatusGroup);
            dbPatch.completedAt = landsDone
                ? (current.completedAt ?? now)
                : null;
            if (!landsDone) {
                dbPatch.reviewStatus = null;
                dbPatch.reviewedAt = null;
                dbPatch.reviewedBy = null;
            }
        }
        // §29: a bug_severity change recomputes sla_due_at (unless overridden —
        // sla_due_at is not a PATCH field, it has its own §29 endpoint).
        if (p.bugSeverity !== undefined) {
            const resolvedTypeName = typeName ||
                (await this.taskTypes.findByIdInWorkspace(current.taskTypeId, input.workspaceId))?.name ||
                "";
            dbPatch.slaDueAt = computeSlaDueAt(resolvedTypeName, p.bugSeverity, now);
        }
        // ─── Write (atomic) ──────────────────────────────────────────────────
        try {
            await this.db.transaction(async (tx) => {
                // Gap-scan C5: write against the RESOLVED id — `input.taskId`
                // may be a custom_id (e.g. BUG-12), which `TasksRepo.update`
                // matches against tasks.id only → silent 0-row no-op.
                await this.tasks.update(current.id, dbPatch, tx);
                const rows = [];
                if (p.statusId !== undefined &&
                    p.statusId !== current.statusId) {
                    rows.push({
                        taskId: current.id,
                        actorId: input.actorId,
                        action: "status_changed",
                        context: { from: current.statusId, to: p.statusId },
                    });
                }
                rows.push({
                    taskId: current.id,
                    actorId: input.actorId,
                    action: "task_updated",
                    context: { fields: input.fields },
                });
                await this.activity.recordMany(rows, tx);
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("task.duplicate_custom_id", "A task with that custom_id already exists");
            }
            if (isForeignKeyError(err)) {
                throw errors_1.AppError.unprocessable("task.invalid_reference", "A referenced sprint, reviewer, status, or task type does not exist");
            }
            throw err;
        }
        return this.reads.getById({
            idOrKey: current.id,
            workspaceId: input.workspaceId,
            role: input.role,
        });
    }
    /**
     * Archive a task (`POST /api/v1/tasks/:id/archive`, 🔐). Sets `archived_at`
     * and cascades to descendants (children + grandchildren), all in one
     * transaction. Idempotent: a no-op re-archive (or a concurrent double) writes
     * exactly one `task_archived` activity row (gated on the conditional UPDATE's
     * `transitioned` flag). 204.
     */
    async archive(input) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        await this.archiveInTx(task.id, input.actorId);
    }
    /**
     * Unarchive a task (`POST /api/v1/tasks/:id/unarchive`, 🔐). Clears
     * `archived_at` on the task and its descendants. Idempotent; 204.
     */
    async unarchive(input) {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.unarchive(task.id, tx);
            await this.tasks.unarchiveDescendants(task.id, tx);
            if (transitioned) {
                await this.activity.recordMany([
                    {
                        taskId: task.id,
                        actorId: input.actorId,
                        action: "task_unarchived",
                    },
                ], tx);
            }
        });
    }
    /**
     * Delete a task (`DELETE /api/v1/tasks/:id`). Soft by default (🔐) — an
     * alias for archive (sets `archived_at`, cascades). `?hard=true` is a 👑
     * admin/owner permanent delete: the row + its children + all junction rows
     * cascade away via the DB FKs. The role gate is in-handler (the same route
     * serves both the 🔐 soft and 👑 hard paths). Hard-delete is audit-LOGGED
     * (not a DB row — `task_activity` cascades away with the task, and
     * `workspace_activity` has no `task` entity type). 204.
     */
    async del(input) {
        if (input.hard &&
            input.role !== constants_1.Roles.OWNER &&
            input.role !== constants_1.Roles.ADMIN) {
            throw errors_1.AppError.forbidden("auth.forbidden", "A hard delete requires the admin or owner role");
        }
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        if (input.hard) {
            await this.db.transaction(async (tx) => {
                await this.tasks.hardDelete(task.id, tx);
            });
            this.logger.info("tasks.hard_deleted", {
                taskId: task.id,
                workspaceId: input.workspaceId,
                actorId: input.actorId,
            });
            return;
        }
        await this.archiveInTx(task.id, input.actorId);
    }
    /** Archive `taskId` + descendants + one gated `task_archived` row, atomically. */
    async archiveInTx(taskId, actorId) {
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.archive(taskId, tx);
            await this.tasks.archiveDescendants(taskId, tx);
            if (transitioned) {
                await this.activity.recordMany([{ taskId, actorId, action: "task_archived" }], tx);
            }
        });
    }
    /**
     * Per-user "my work" rollup (`GET /api/v1/tasks/my-work`, 🔐). Buckets the
     * caller's assigned, non-archived tasks: `done` (status_group ∈ done/closed,
     * evaluated first), then by due date — `overdue` (< today), `today` (==),
     * `next` (within 7 days), `unscheduled` (no due date). A task due more than 7
     * days out and not done is intentionally in NO bucket (my-work is "what needs
     * attention now"). The spec leaves these predicates undefined — this is the
     * documented default. Returns all five buckets, or just the requested one.
     */
    async myWork(input) {
        const rows = await this.tasks.myWorkRows(input.userId, input.workspaceId);
        const ids = rows.map((r) => r.task.id);
        const redactGuest = input.role === constants_1.Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] = await Promise.all([
            this.tasks.assigneesByTask(ids),
            this.tasks.watchersByTask(ids),
            this.tasks.tagsByTask(ids),
            this.tasks.customFieldValuesByTask(ids, redactGuest),
        ]);
        const wire = (t) => (0, taskSerializer_1.toWireTask)(t, {
            assignees: assignees.get(t.id) ?? [],
            watchers: watchers.get(t.id) ?? [],
            tags: tags.get(t.id) ?? [],
            customFieldValues: customFieldValues.get(t.id) ?? {},
        });
        const today = ymd(new Date());
        const in7 = ymd(new Date(Date.now() + 7 * DAY_MS));
        const buckets = {
            today: [],
            overdue: [],
            next: [],
            unscheduled: [],
            done: [],
        };
        for (const { task, statusGroup } of rows) {
            let bucket;
            if (DONE_GROUPS.has(statusGroup)) {
                bucket = "done";
            }
            else if (task.dueDate === null) {
                bucket = "unscheduled";
            }
            else {
                const d = ymd(task.dueDate);
                if (d < today)
                    bucket = "overdue";
                else if (d === today)
                    bucket = "today";
                else if (d <= in7)
                    bucket = "next";
                else
                    bucket = null; // due > 7d out, not done → not "work for now"
            }
            if (bucket)
                buckets[bucket].push(wire(task));
        }
        if (input.bucket) {
            return { [input.bucket]: buckets[input.bucket] };
        }
        return buckets;
    }
    /**
     * Bulk-edit up to 200 tasks (`POST /api/v1/tasks/bulk`, 🔐). FAIL-ATOMIC:
     * every id must resolve in the workspace and every reference in the patch
     * must be valid, or nothing is written (404 / 422 up front). The scalar
     * fields apply via one UPDATE; assignee/tag add/remove apply per task; a
     * `task_updated` activity row is written per task — all in one transaction.
     * Returns `{ updated, tasks }` with the re-hydrated tasks.
     */
    async bulk(input) {
        const now = new Date();
        const ids = dedupe(input.ids);
        if (ids.length === 0) {
            throw errors_1.AppError.validationFailed([
                { field: "ids", issue: "at least one task id is required" },
            ]);
        }
        // 1. Every id must resolve in the workspace (fail-atomic — no partial).
        const found = await this.tasks.findManyByIdsInWorkspace(ids, input.workspaceId);
        const foundIds = new Set(found.map((t) => t.id));
        const missing = ids.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
            throw errors_1.AppError.notFound("task.not_found", "One or more tasks do not exist in this workspace");
        }
        const p = input.patch;
        // Dept Review V1 (P9) hardening: archived tasks cannot be bulk-EDITED
        // (mirror of the single-PATCH rule, which was bypassable here). The one
        // exception: a patch that provides `archived_at` is operating ON
        // archival state (bulk unarchive / re-archive) and may target archived
        // rows.
        if (!p.archivedAtProvided) {
            const archivedTargets = found.filter((t) => t.archivedAt !== null);
            if (archivedTargets.length > 0) {
                const shown = archivedTargets
                    .map((t) => t.id)
                    .slice(0, 5)
                    .join(", ");
                throw errors_1.AppError.conflict("task.archived", `Cannot bulk-edit archived task(s): ${shown}${archivedTargets.length > 5 ? ", …" : ""}`);
            }
        }
        // 2. Validate references in the patch.
        let newGroup;
        if (p.statusId !== undefined) {
            const st = await this.statuses.findByIdInWorkspace(p.statusId, input.workspaceId);
            if (!st) {
                throw errors_1.AppError.unprocessable("task.invalid_status", `${p.statusId} is not a status in this workspace`, [{ field: "patch.status_id", issue: "is not a status in this workspace" }]);
            }
            newGroup = st.statusGroup;
        }
        const assigneeAdd = dedupe(p.assigneeAdd);
        if (assigneeAdd.length > 0) {
            const valid = await this.users.findActiveIdsInWorkspace(assigneeAdd, input.workspaceId);
            const invalid = assigneeAdd.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw errors_1.AppError.unprocessable("task.invalid_assignee", "One or more assignees are not active members of this workspace", invalid.map((id) => ({ field: "patch.assignee_add", issue: `${id} is not an active member` })));
            }
        }
        const tagAdd = dedupe(p.tagAdd);
        if (tagAdd.length > 0) {
            const valid = await this.tags.findIdsInWorkspace(tagAdd, input.workspaceId);
            const invalid = tagAdd.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw errors_1.AppError.unprocessable("task.invalid_tag", "One or more tags do not exist in this workspace", invalid.map((id) => ({ field: "patch.tag_add", issue: `${id} is not a tag in this workspace` })));
            }
        }
        const assigneeRemove = dedupe(p.assigneeRemove);
        const tagRemove = dedupe(p.tagRemove);
        // 3. Build the uniform scalar patch (`updated_at` always, so the ETag
        //    bumps even on a membership-only bulk).
        const dbPatch = { updatedAt: now };
        if (p.statusId !== undefined)
            dbPatch.statusId = p.statusId;
        if (p.priority !== undefined)
            dbPatch.priority = p.priority;
        if (p.dueDate !== undefined)
            dbPatch.dueDate = toLocalDate(p.dueDate);
        if (p.startDate !== undefined)
            dbPatch.startDate = toLocalDate(p.startDate);
        if (p.sprintId !== undefined)
            dbPatch.sprintId = p.sprintId;
        if (p.archivedAtProvided) {
            dbPatch.archivedAt = p.archivedAt ? new Date(p.archivedAt) : null;
        }
        // completed_at follows the landing group. Moving TO done PRESERVES an
        // existing completion instant per task (SQL COALESCE — the old
        // unconditional `now` re-dated already-done tasks, double-counting
        // them across weekly dept-report windows). Leaving done clears it AND
        // the Dept Review denorm trio — same reset rule as the single-PATCH
        // path (P9: no done→not-done transition may keep a review verdict).
        if (newGroup !== undefined) {
            if (DONE_GROUPS.has(newGroup)) {
                dbPatch.completedAt = (0, drizzle_orm_1.sql) `COALESCE(${schema.tasks.completedAt}, ${now})`;
            }
            else {
                dbPatch.completedAt = null;
                dbPatch.reviewStatus = null;
                dbPatch.reviewedAt = null;
                dbPatch.reviewedBy = null;
            }
        }
        // 4. Atomic write (batched: bulk operations instead of per-task loop).
        try {
            await this.db.transaction(async (tx) => {
                await this.tasks.updateMany(ids, dbPatch, tx);
                if (assigneeAdd.length > 0) {
                    await this.membership.addAssigneesBulk(ids, assigneeAdd, input.actorId, tx);
                    await this.membership.addWatchersBulk(ids, assigneeAdd, tx);
                }
                if (assigneeRemove.length > 0)
                    await this.membership.removeAssigneesBulk(ids, assigneeRemove, tx);
                if (tagAdd.length > 0)
                    await this.membership.addTagsBulk(ids, tagAdd, tx);
                if (tagRemove.length > 0)
                    await this.membership.removeTagsBulk(ids, tagRemove, tx);
                await this.activity.recordMany(ids.map((id) => ({
                    taskId: id,
                    actorId: input.actorId,
                    action: "task_updated",
                    context: { bulk: true },
                })), tx);
            });
        }
        catch (err) {
            if (isForeignKeyError(err)) {
                throw errors_1.AppError.unprocessable("task.invalid_reference", "A referenced sprint or status does not exist");
            }
            throw err;
        }
        // 5. Re-read + batch-hydrate the affected tasks.
        const rows = await this.tasks.findManyByIdsInWorkspace(ids, input.workspaceId);
        const redactGuest = input.role === constants_1.Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] = await Promise.all([
            this.tasks.assigneesByTask(ids),
            this.tasks.watchersByTask(ids),
            this.tasks.tagsByTask(ids),
            this.tasks.customFieldValuesByTask(ids, redactGuest),
        ]);
        const wireTasks = rows.map((t) => (0, taskSerializer_1.toWireTask)(t, {
            assignees: assignees.get(t.id) ?? [],
            watchers: watchers.get(t.id) ?? [],
            tags: tags.get(t.id) ?? [],
            customFieldValues: customFieldValues.get(t.id) ?? {},
        }));
        return { updated: ids.length, tasks: wireTasks };
    }
}
exports.TaskWriteService = TaskWriteService;
/** Drop nullish + duplicate ids, preserving first-seen order. */
const dedupe = (ids) => {
    if (!ids || ids.length === 0)
        return [];
    return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
};
const NOTIFICATION_TITLE_MAX = 300;
const ASSIGNED_TITLE_PREFIX = "You were assigned to ";
const assignedTitle = (taskName) => {
    const room = NOTIFICATION_TITLE_MAX - ASSIGNED_TITLE_PREFIX.length;
    const name = taskName.length > room ? `${taskName.slice(0, room - 1)}…` : taskName;
    return `${ASSIGNED_TITLE_PREFIX}${name}`;
};
