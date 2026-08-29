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
const TaskEmailService_1 = require("./TaskEmailService");
const PushService_1 = require("./PushService");
const AssignmentRequestsService_1 = require("./AssignmentRequestsService");
const taskSerializer_1 = require("../serializers/taskSerializer");
const dhakaTime_1 = require("../utils/dhakaTime");
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
const scopeGuard_1 = require("../rbac/scopeGuard");
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
 *
 * **F28 (ISS-029, decision D12.2): these durations are measured on the BUSINESS
 * clock.** They used to be wall-clock, which is how an S0 filed 17:30 on a
 * Thursday got a 19:30-Thursday deadline — after hours, on the last working day
 * before BeautyBooth's Friday-Saturday weekend. The numbers are unchanged; what
 * changed is the clock they are counted on, so the team now gets the working
 * time the policy promises:
 *
 * | severity   | policy | was (wall-clock) | now (business clock)          |
 * |------------|--------|------------------|-------------------------------|
 * | Bug S0     | 2h     | +2 hours         | 2 working hours               |
 * | Bug S1     | 24h    | +24 hours        | 1 working day (same time next)|
 * | Bug S2     | 7d     | +7 days          | 7 working days                |
 * | Complaint  | 24h    | +24 hours        | 1 working day                 |
 *
 * "24 hours" becomes ONE WORKING DAY rather than 24 working hours: a human who
 * writes a 24-hour SLA means "by this time tomorrow", and 24 working hours would
 * silently stretch it to 2.7 days on a 9-hour day. Re-tuning the numbers
 * themselves is a separate product decision — this only moves the clock.
 *
 * `cal` is null when the workspace row cannot be read; the arithmetic then falls
 * back to wall-clock, i.e. exactly the pre-F28 behaviour. A deadline is never
 * the reason a task create fails.
 */
/** True for the two task types §29 gives an SLA. Keeps the calendar lookup off
 *  the common create path. */
const hasSlaPolicy = (typeName) => {
    const t = typeName.trim().toLowerCase();
    return t === "bug" || t === "complaint";
};
/** True when the type is the product's bug concept — the same NAME key §29's
 *  SLA switch and the S2 severity default have always used. */
const isBugType = (typeName) => typeName.trim().toLowerCase() === "bug";
/**
 * F29 (ISS-039): the git/planning columns `task_types.is_dev_type` gates.
 * `schema/tasks.ts` promised this gate ("NULL for non-dev task types, gated in
 * the application layer") since P11 and nothing enforced it — a Marketing
 * "Campaign" could carry a branch, a PR link and S1 severity, and the drawer's
 * Git panel rendered them.
 *
 * `sprint_id` is deliberately NOT in this list: sprint membership has its own
 * endpoints (`POST /sprints/:id/tasks`) with its own `sprint.assign_tasks`
 * gate, and attaching non-dev work to a sprint is an established, tested
 * behaviour of that surface. `reporter_team` is not either — complaints (a
 * non-dev CS type) legitimately carry it.
 */
const DEV_ONLY_FIELDS = [
    ["story_points", "storyPoints"],
    ["reviewer_id", "reviewerId"],
    ["branch_name", "branchName"],
    ["pr_url", "prUrl"],
    ["pr_status", "prStatus"],
];
/**
 * F29 (ISS-039, decision D13): refuse caller-supplied engineering values on a
 * type that cannot carry them. 422, never a silent NULL — silently dropping a
 * field the caller explicitly sent is the family of lie Block F existed to
 * remove.
 *
 * Two different keys on purpose:
 *   - the five git/planning fields require `is_dev_type` — they belong to DEV
 *     WORK (`422 task.not_dev_type`);
 *   - `bug_severity` requires a **bug-named** type — the same name key the §29
 *     SLA switch and the S2 default have always used, so severity and its SLA
 *     travel together and ISS-039's "looks like an S1, invisible to every SLA
 *     view" state becomes unrepresentable (`422 task.severity_requires_bug_type`).
 *
 * Explicit `null`s always pass: null is the columns' rest state, and clearing
 * junk must never be blocked.
 */
const assertEngFieldsAllowed = (taskType, supplied) => {
    if (!taskType.isDevType) {
        const offending = DEV_ONLY_FIELDS.filter(([, prop]) => supplied[prop] !== undefined && supplied[prop] !== null);
        if (offending.length > 0) {
            throw errors_1.AppError.unprocessable("task.not_dev_type", `Task type "${taskType.name}" is not a dev type; it cannot carry ${offending
                .map(([wire]) => wire)
                .join(", ")}`, offending.map(([wire]) => ({
                field: wire,
                issue: "requires a task type with is_dev_type",
            })));
        }
    }
    if (supplied.bugSeverity !== undefined &&
        supplied.bugSeverity !== null &&
        !isBugType(taskType.name)) {
        throw errors_1.AppError.unprocessable("task.severity_requires_bug_type", `Task type "${taskType.name}" is not a Bug type; bug_severity does not apply`, [{ field: "bug_severity", issue: "requires a Bug task type" }]);
    }
};
const computeSlaDueAt = (typeName, severity, now, cal) => {
    const hours = (n) => cal ? (0, dhakaTime_1.addBusinessMs)(now, n * HOUR_MS, cal) : new Date(now.getTime() + n * HOUR_MS);
    const days = (n) => cal ? (0, dhakaTime_1.addBusinessDays)(now, n, cal) : new Date(now.getTime() + n * DAY_MS);
    const t = typeName.trim().toLowerCase();
    if (t === "bug") {
        switch (severity) {
            case "S0":
                return hours(2);
            case "S1":
                return days(1);
            case "S2":
                return days(7);
            default:
                return null; // S3 or unset
        }
    }
    if (t === "complaint")
        return days(1);
    return null;
};
/**
 * Parse a `YYYY-MM-DD` wire date into a UTC-midnight `Date` for a MySQL DATE
 * column (Drizzle `date()` is in `mode: "date"`).
 *
 * F3: this used to build LOCAL midnight, which was only correct while the mysql2
 * driver's `timezone` matched the process TZ. It no longer does — the driver is
 * pinned to `+00:00` so Drizzle's hardcoded-UTC TIMESTAMP mapper is right (see
 * `db/client.ts`). Local midnight in Dhaka is 18:00 UTC the PREVIOUS day, which
 * a DATE column truncates to the wrong calendar day.
 *
 * UTC midnight is the only value that is stable here, and it is symmetric with
 * the READ path: `MySqlDate.mapFromDriverValue` does `new Date("YYYY-MM-DD")`,
 * which is also UTC midnight. Write and read now agree by construction.
 */
/**
 * `HH:MM` → the `HH:MM:00` a MySQL TIME column stores (upgrades/024).
 * Undefined and null both mean "no time set", which the spawn job reads as
 * 09:00 — a recurrence with no time must still fire, not silently never.
 */
const toClockOnly = (value) => value ? `${value.slice(0, 5)}:00` : null;
const toDateOnly = (value) => {
    if (value === null || value === undefined)
        return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};
/**
 * `YYYY-MM-DD` for a **stored DATE column** — matches `taskSerializer.toWireDate`.
 *
 * UTC components, because Drizzle materialises a DATE at UTC midnight and
 * `toDateOnly` above writes it there. Exact under any process TZ.
 *
 * F3 note: this used LOCAL components and was named `ymd`, and it was called for
 * two genuinely different jobs — formatting a stored DATE (this) and deriving
 * "today" from a now-instant (below). Those coincide only while the box sits at
 * a non-negative UTC offset, so the single helper hid the difference. They are
 * split now: a stored DATE is a calendar day already fixed at UTC midnight, but
 * "today" is a *business* question and must be asked on the workspace's own
 * calendar — see `todayInZone` (F5 wired it to `workspaces.timezone`).
 */
const storedDateYmd = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
const DONE_GROUPS = new Set(["done", "closed"]);
/**
 * F21 (ISS-049): the before/after of every scalar that ACTUALLY changed in a
 * PATCH — `{ priority: { from: 2, to: 3 }, … }`. Wire (snake_case) names.
 * `status_id` is excluded: a status move already has its own `status_changed`
 * row with `{from, to}` (the one action that always did this properly).
 */
const scalarChanges = (current, patch) => {
    const wire = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const norm = (v) => {
        if (v instanceof Date)
            return storedDateYmd(v);
        if (v === undefined)
            return null;
        return v;
    };
    // Meta/membership keys are not scalar columns: the bulk patch carries the
    // `archivedAtProvided` flag and the assignee/tag arrays, none of which
    // belong in a before/after diff (membership has its own activity rows).
    // `archivedAt` too (team-access P3): a bulk (un)archive writes proper
    // `task_archived`/`task_unarchived` rows now — an `archived_at` timestamp
    // diff inside `task_updated` double-logged it, unreadably.
    const NOT_SCALAR = new Set([
        "statusId",
        "archivedAt",
        "archivedAtProvided",
        "assigneeAdd",
        "assigneeRemove",
        "tagAdd",
        "tagRemove",
    ]);
    const changes = {};
    for (const [key, to] of Object.entries(patch)) {
        if (to === undefined || NOT_SCALAR.has(key))
            continue;
        const from = norm(current[key]);
        const next = norm(to);
        if (JSON.stringify(from) === JSON.stringify(next))
            continue; // no-op
        // Team-access P3: a description edit used to write the ENTIRE old +
        // new text into one activity row. Clip both sides — the audit answers
        // "who, when, roughly what"; the current text lives on the task.
        changes[wire(key)] =
            key === "description"
                ? { from: clipDiffText(from), to: clipDiffText(next) }
                : { from, to: next };
    }
    return changes;
};
/** Max characters a text value may occupy inside a `task_updated` diff. */
const DIFF_TEXT_LIMIT = 280;
const clipDiffText = (v) => typeof v === "string" && v.length > DIFF_TEXT_LIMIT
    ? `${v.slice(0, DIFF_TEXT_LIMIT)}…`
    : v;
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
    attachmentsRepo;
    workspaces;
    wsActivity;
    reads;
    logger;
    constructor(db, lists, statuses, taskTypes, tasks, membership, users, tags, activity, notifications, attachmentsRepo, workspaces, 
    /**
     * Team-access P3: the hard-delete trail. `task_activity` rows die in
     * the FK cascade with their task, so the deletion event has to live
     * in the workspace-level log (entity_type 'task', upgrades/017).
     */
    wsActivity, reads, logger) {
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
        this.attachmentsRepo = attachmentsRepo;
        this.workspaces = workspaces;
        this.wsActivity = wsActivity;
        this.reads = reads;
        this.logger = logger;
    }
    /**
     * The workspace's business calendar for `computeSlaDueAt` (F28 / D12.2), or
     * null if the row cannot be read — in which case SLA arithmetic falls back
     * to the pre-F28 wall clock rather than failing the write.
     *
     * Loaded ONLY for a task type that actually carries an SLA policy (see
     * `hasSlaPolicy`), so the common create path adds no query.
     */
    async businessCalendar(workspaceId) {
        const ws = await this.workspaces.findById(workspaceId);
        return ws
            ? {
                workingDays: ws.workingDays,
                businessHoursStart: ws.businessHoursStart,
                businessHoursEnd: ws.businessHoursEnd,
                timeZone: ws.timezone,
            }
            : null;
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
        // F8 (ISS-047): a space-narrowed `task.create` grant only reaches the
        // spaces its assignment names — the route gate proved the verb, this
        // proves the reach. `isOwn: true` because the creator owns what they
        // create; no-actor contexts (public form submit, jobs) pass untouched.
        await (0, scopeGuard_1.assertScoped)("task.create", {
            spaceId: list.spaceId,
            isOwn: true,
        });
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
        // F29 (ISS-039): the type decides which engineering fields it may
        // carry — checked on the RESOLVED type, so the list-default and
        // fallback paths are gated identically to an explicit body value.
        assertEngFieldsAllowed(taskType, input);
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
        // F18 (ISS-044): the SAME reviewer check `update()` has always had.
        // `reviewer_id` was the only reference on the create path with no
        // validation — every other unknown id is a clean 422/404, this one was
        // a raw 500 from the FK.
        if (input.reviewerId !== undefined && input.reviewerId !== null) {
            const valid = await this.users.findActiveIdsInWorkspace([input.reviewerId], input.workspaceId);
            if (!valid.has(input.reviewerId)) {
                throw errors_1.AppError.unprocessable("task.invalid_reviewer", `${input.reviewerId} is not an active member of this workspace`, [
                    {
                        field: "reviewer_id",
                        issue: "is not an active member of this workspace",
                    },
                ]);
            }
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
        const slaDueAt = computeSlaDueAt(taskType.name, bugSeverity, now, hasSlaPolicy(taskType.name)
            ? await this.businessCalendar(input.workspaceId)
            : null);
        const completedAt = DONE_GROUPS.has(status.statusGroup) ? now : null;
        const taskId = (0, utils_1.fakeId)("t");
        // P9: filled inside the tx when the gate parks assignees as requests;
        // fired AFTER the commit (the delivery-layer rule).
        let requestDeliveries = [];
        // 6b. Team-access P8 (Q11): split the initial assignees into DIRECT
        //     (same-team / self / full-reach / the Q7 on-call exemption) and
        //     approval-GATED — the latter become pending requests riding the
        //     same transaction as the task insert. Read-only, so it runs
        //     before the tx; dormant while every target folds to `all` reach.
        let directAssignees = assignees;
        let approvalSplit = null;
        if (assignees.length > 0) {
            approvalSplit = await (0, AssignmentRequestsService_1.assignmentGate)().splitByApproval({
                workspaceId: input.workspaceId,
                requesterId: input.actorId,
                exempt: input.exemptAssignmentApproval,
                pairs: assignees.map((targetUserId) => ({
                    taskId,
                    spaceId: list.spaceId,
                    targetUserId,
                    taskName: input.name,
                })),
            });
            directAssignees = approvalSplit.directByTask.get(taskId) ?? [];
        }
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
                        startDate: toDateOnly(input.startDate),
                        dueDate: toDateOnly(input.dueDate),
                        completedAt,
                        slaDueAt,
                        recurrencePattern: input.recurrencePattern ?? "none",
                        recurrenceDays: (input.recurrenceDays ??
                            null),
                        recurrenceTime: toClockOnly(input.recurrenceTime),
                        recurrenceEndsAt: toDateOnly(input.recurrenceEndsAt),
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
                        // ASSIGNED_BY_PLAN P2 — who handed this work out.
                        // The actor is the right answer on every path that
                        // reaches here, and there is only one: the API (the
                        // logged-in person), a public form (the form's owner —
                        // never the anonymous submitter), the recurrence job
                        // (the template's owner) and the assistant's
                        // create_task (the person asking). Adding an assignee
                        // later never rewrites this; only an explicit edit
                        // does (P5).
                        assignedBy: input.actorId,
                    };
                    await this.tasks.insert(row, tx);
                    if (input.parentTaskId) {
                        await this.tasks.setParent(taskId, input.parentTaskId, nestingDepth, tx);
                    }
                    if (directAssignees.length > 0) {
                        await this.membership.addAssignees(taskId, directAssignees, input.actorId, tx);
                        await this.membership.addWatchers(taskId, directAssignees, tx);
                    }
                    // P8: the gated assignees become pending requests in the
                    // SAME tx (task row exists now; task-first lock order is
                    // moot here — the row is invisible until commit).
                    if (approvalSplit && approvalSplit.gated.length > 0) {
                        const { deliveries } = await (0, AssignmentRequestsService_1.assignmentGate)().createRequestsInTx(tx, {
                            workspaceId: input.workspaceId,
                            requesterId: input.actorId,
                            split: approvalSplit,
                            now,
                        });
                        requestDeliveries = deliveries;
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
                        ...directAssignees.map((userId) => ({
                            taskId,
                            actorId: input.actorId,
                            action: "assignee_added",
                            context: { user_id: userId },
                        })),
                    ], tx);
                    const recipients = directAssignees.filter((id) => id !== input.actorId);
                    await this.notifications.createMany(recipients.map((userId) => ({
                        userId,
                        type: "assigned",
                        entityType: "task",
                        entityId: taskId,
                        actorId: input.actorId,
                        title: assignedTitle(input.name),
                    })), tx);
                    // F15 (ISS-046): a new child changes the parent's badge.
                    if (input.parentTaskId) {
                        await this.tasks.recomputeSubtaskCounters(input.parentTaskId, tx);
                    }
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
        // 8. Notify the initial assignees (minus the actor) on the out-of-app
        //    channels — email AND Web Push. AFTER the commit, fire-and-forget:
        //    the request never waits on SMTP or a push service, and a delivery
        //    failure never fails the create. Same recipient set as the in-app
        //    `assigned` fanout in step 7 (2026-08-08 notification delivery).
        //    P8: DIRECT assignees only — a gated target gets the
        //    `assignment_request` bell instead, and the assigned email fires
        //    on accept.
        const emailRecipients = directAssignees.filter((id) => id !== input.actorId);
        if (emailRecipients.length > 0) {
            void (0, TaskEmailService_1.taskEmails)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId,
                taskName: input.name,
                recipientIds: emailRecipients,
                actorId: input.actorId,
                dueYmd: input.dueDate ?? null,
            });
            void (0, PushService_1.pushSvc)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId,
                taskName: input.name,
                recipientIds: emailRecipients,
                actorId: input.actorId,
            });
        }
        // P9: "approval needed" to each gated target + their Heads.
        if (requestDeliveries.length > 0) {
            (0, AssignmentRequestsService_1.assignmentGate)().deliverCreated({
                workspaceId: input.workspaceId,
                requesterId: input.actorId,
                deliveries: requestDeliveries,
            });
        }
        // 9. Hydrate + serialize via the read path (identical to a GET).
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
        // F8 (ISS-047): the grant's scope must reach THIS task. This is the
        // issue's exact surface — an `own`-scoped task.edit editing someone
        // else's task inside a visible space.
        await this.assertTaskScope("task.edit", current);
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
        // The EFFECTIVE type of this task after the patch — the incoming one if
        // the patch changes it, else the stored one. Fetched lazily: only a
        // type change or a supplied engineering value needs it (F29 / ISS-039).
        let effectiveType = null;
        if (p.taskTypeId !== undefined) {
            const tt = await this.taskTypes.findByIdInWorkspace(p.taskTypeId, input.workspaceId);
            if (!tt) {
                throw errors_1.AppError.unprocessable("task.invalid_task_type", `${p.taskTypeId} is not a task type in this workspace`, [{ field: "task_type_id", issue: "is not a task type in this workspace" }]);
            }
            typeName = tt.name;
            effectiveType = tt;
        }
        // F29 (ISS-039): a patch that writes engineering values is gated by the
        // type the task will HAVE, so `{task_type_id: <non-dev>, branch_name}`
        // and a plain `{branch_name}` on a non-dev task both refuse — the same
        // rule create() enforces, on the same resolved row.
        const suppliesEngValue = DEV_ONLY_FIELDS.some(([, prop]) => p[prop] !== undefined && p[prop] !== null) ||
            (p.bugSeverity !== undefined && p.bugSeverity !== null);
        if (suppliesEngValue && !effectiveType) {
            effectiveType = await this.taskTypes.findByIdInWorkspace(current.taskTypeId, input.workspaceId);
        }
        if (effectiveType)
            assertEngFieldsAllowed(effectiveType, p);
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
                ? storedDateYmd(current.startDate)
                : null;
        const effDue = p.dueDate !== undefined
            ? p.dueDate
            : current.dueDate
                ? storedDateYmd(current.dueDate)
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
            dbPatch.startDate = toDateOnly(p.startDate);
        if (p.dueDate !== undefined) {
            dbPatch.dueDate = toDateOnly(p.dueDate);
            // A changed deadline re-arms the overdue alert (upgrades/014):
            // the overdue-alert job claims `overdue_notified_at` once per
            // due_date; clearing it here makes the NEW date alert again.
            dbPatch.overdueNotifiedAt = null;
        }
        if (p.recurrencePattern !== undefined)
            dbPatch.recurrencePattern = p.recurrencePattern;
        if (p.recurrenceDays !== undefined)
            dbPatch.recurrenceDays =
                p.recurrenceDays;
        if (p.recurrenceTime !== undefined)
            dbPatch.recurrenceTime = toClockOnly(p.recurrenceTime);
        if (p.recurrenceEndsAt !== undefined)
            dbPatch.recurrenceEndsAt = toDateOnly(p.recurrenceEndsAt);
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
        /**
         * F29 (ISS-039): re-typing a task RESHAPES it. When a patch moves a
         * task onto a non-dev type, the stored git/planning values are cleared
         * in the same write — `schema/tasks.ts` promises those columns are
         * "NULL for non-dev task types", and a Marketing task keeping last
         * month's branch name would be exactly the ghost data this issue is
         * about. Same for a severity stranded on a non-bug type — and its SLA
         * goes with it when the new type has no SLA policy, closing the
         * issue's sharpest wrinkle (a record that looks like an S1 but is
         * invisible to every SLA view, or the inverse: an SLA with no
         * severity). Values the patch itself supplies were already gated above,
         * so only STORED leftovers are cleared here.
         */
        if (p.taskTypeId !== undefined &&
            p.taskTypeId !== current.taskTypeId &&
            effectiveType) {
            if (!effectiveType.isDevType) {
                for (const [, prop] of DEV_ONLY_FIELDS) {
                    if (p[prop] === undefined && current[prop] !== null) {
                        dbPatch[prop] = null;
                    }
                }
            }
            if (!isBugType(effectiveType.name) &&
                p.bugSeverity === undefined &&
                current.bugSeverity !== null) {
                dbPatch.bugSeverity = null;
                if (!hasSlaPolicy(effectiveType.name) &&
                    current.slaDueAt !== null) {
                    dbPatch.slaDueAt = null;
                }
            }
        }
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
            dbPatch.slaDueAt = computeSlaDueAt(resolvedTypeName, p.bugSeverity, now, hasSlaPolicy(resolvedTypeName)
                ? await this.businessCalendar(input.workspaceId)
                : null);
        }
        // F22 (ISS-011): §32 promises `task.cannot_complete_blocked` — a task
        // with an OPEN blocker cannot move into a done/closed status. Without
        // this, a `blocks` dependency was decoration.
        if (p.statusId !== undefined &&
            p.statusId !== current.statusId &&
            DONE_GROUPS.has(listStatuses.find((s) => s.id === p.statusId)?.statusGroup ?? "")) {
            const blockers = await this.tasks.openBlockerCount(current.id);
            if (blockers > 0) {
                throw errors_1.AppError.conflict("task.cannot_complete_blocked", `This task is blocked by ${blockers} open task(s) — complete or unlink them first`);
            }
        }
        // ─── Write (atomic) ──────────────────────────────────────────────────
        try {
            await this.db.transaction(async (tx) => {
                // Gap-scan C5: write against the RESOLVED id — `input.taskId`
                // may be a custom_id (e.g. BUG-12), which `TasksRepo.update`
                // matches against tasks.id only → silent 0-row no-op.
                await this.tasks.update(current.id, dbPatch, tx);
                // F15 (ISS-046): a status change can move this task in or out
                // of its parent's `subtasks_completed`.
                if (current.parentTaskId &&
                    p.statusId !== undefined &&
                    p.statusId !== current.statusId) {
                    await this.tasks.recomputeSubtaskCounters(current.parentTaskId, tx);
                }
                const rows = [];
                if (p.statusId !== undefined &&
                    p.statusId !== current.statusId) {
                    rows.push({
                        taskId: current.id,
                        actorId: input.actorId,
                        action: "status_changed",
                        // Team-access P3: names DENORMALISED into the row —
                        // a rename (or a cross-list move in the history) must
                        // not turn old rows into "(deleted status)". Ids stay
                        // for machines; names are what the audit log shows.
                        context: {
                            from: current.statusId,
                            to: p.statusId,
                            from_name: listStatuses.find((s) => s.id === current.statusId)?.name ?? null,
                            to_name: listStatuses.find((s) => s.id === p.statusId)
                                ?.name ?? null,
                        },
                    });
                    // F19 (D6 / ISS-072): `status_change` finally has a
                    // producer. Recipients: assignees + watchers, minus the
                    // actor (they made the change). Preference suppression
                    // happens inside createMany.
                    const [asgMap, wchMap] = await Promise.all([
                        this.tasks.assigneesByTask([current.id]),
                        this.tasks.watchersByTask([current.id]),
                    ]);
                    const statusName = listStatuses.find((s) => s.id === p.statusId)?.name ??
                        "a new status";
                    const recipients = [
                        ...new Set([
                            ...(asgMap.get(current.id) ?? []),
                            ...(wchMap.get(current.id) ?? []),
                        ]),
                    ].filter((id) => id !== input.actorId);
                    if (recipients.length > 0) {
                        await this.notifications.createMany(recipients.map((userId) => ({
                            userId,
                            type: "status_change",
                            entityType: "task",
                            entityId: current.id,
                            actorId: input.actorId,
                            title: `moved "${current.name}" to ${statusName}`,
                        })), tx);
                    }
                }
                // F21 (ISS-049): record WHAT changed, not just which keys the
                // body named — and write NO row for a no-op. Before this,
                // `PATCH {name: <the value it already has>}` still logged
                // `{"fields":["name"]}`, and a real change recorded no values,
                // so "who set the priority, and from what?" was unanswerable.
                // A status-only PATCH now writes only its `status_changed` row
                // (which always carried {from,to} — it was the model).
                const changes = scalarChanges(current, p);
                if (Object.keys(changes).length > 0) {
                    rows.push({
                        taskId: current.id,
                        actorId: input.actorId,
                        action: "task_updated",
                        context: { fields: Object.keys(changes), changes },
                    });
                }
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
        await this.assertTaskScope("task.archive", task); // F8
        await this.archiveInTx(task.id, input.actorId, task.parentTaskId);
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
        await this.assertTaskScope("task.archive", task); // F8 — same key as archive
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.unarchive(task.id, tx);
            // Team-access P3: mirror of the archive cascade — every descendant
            // the restore flips gets its own row (captured pre-flip).
            const flipped = await this.tasks.descendantIdsByArchivedState(task.id, true, tx);
            await this.tasks.unarchiveDescendants(task.id, tx);
            // F15 (ISS-046): an unarchived child rejoins the parent's count.
            if (task.parentTaskId) {
                await this.tasks.recomputeSubtaskCounters(task.parentTaskId, tx);
            }
            const rows = [];
            if (transitioned) {
                rows.push({
                    taskId: task.id,
                    actorId: input.actorId,
                    action: "task_unarchived",
                });
            }
            for (const id of flipped) {
                rows.push({
                    taskId: id,
                    actorId: input.actorId,
                    action: "task_unarchived",
                    context: { via_parent: task.id },
                });
            }
            if (rows.length > 0) {
                await this.activity.recordMany(rows, tx);
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
        // F7 / D3.1 compose: the legacy admin/owner floor stays, AND the RBAC
        // grant must be held — un-ticking `task.delete_hard` in the roles grid
        // now takes real effect on an admin (ISS-024's inert-toggle special
        // case #1). Granting it to a non-admin role changes nothing (compose
        // cannot widen). `currentActor()` is null only outside an HTTP request,
        // and this path is HTTP-only.
        if (input.hard) {
            // F10 (ISS-021): the live role, not the token's frozen claim — a
            // demotion bites on the next request, not after ≤15 minutes.
            const role = await (0, scopeGuard_1.liveLegacyRole)(input.role);
            const legacyAdmin = role === constants_1.Roles.OWNER || role === constants_1.Roles.ADMIN;
            const granted = legacyAdmin &&
                (0, can_1.holds)(await (0, context_1.currentActor)(), "task.delete_hard");
            if (!granted) {
                throw errors_1.AppError.forbidden("auth.forbidden", "A hard delete requires the admin or owner role");
            }
        }
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        // F8 (ISS-047): both the soft and hard paths are deletes — the grant's
        // scope must reach this task (the hard path keeps its extra gate above).
        await this.assertTaskScope("task.delete", task);
        if (input.hard) {
            await this.db.transaction(async (tx) => {
                // F16: the FK cascade is about to take the whole subtree —
                // capture it first. Two child sets have no FK to follow:
                //   ISS-073  notifications (entity_id is polymorphic) stayed in
                //            every recipient's inbox, navigating to a 404;
                //   ISS-022  the attachments ROWS cascade but their R2 objects
                //            do not — the purge job finds objects via
                //            soft-deleted rows, which have just vanished, so
                //            the bytes stayed in the bucket forever.
                // Same transaction, so either the task goes with its inbox
                // entries removed and its keys queued, or nothing happens.
                const subtree = [
                    task.id,
                    ...(await this.tasks.descendantIds(task.id, tx)),
                ];
                await this.notifications.deleteByEntity("task", subtree, tx);
                const keys = await this.attachmentsRepo.storageKeysByTasks(subtree, tx);
                await this.attachmentsRepo.enqueueR2Purge(keys, tx);
                // Team-access P3: the ONE row that survives. The task's own
                // task_activity trail is about to cascade away with it, so
                // the deletion event — who, what, when — is written to the
                // workspace-level log FIRST, in the same transaction.
                await this.wsActivity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "task",
                    entityId: task.id,
                    action: "task_hard_deleted",
                    context: {
                        name: task.name,
                        custom_id: task.customId ?? null,
                        list_id: task.primaryListId,
                        subtree_count: subtree.length,
                        // upgrades/023: when the delete came through the
                        // approval flow, WHO asked and WHY ride along in
                        // this same row rather than a second one — the
                        // activity feed showed the same deletion twice.
                        ...(input.auditContext ?? {}),
                    },
                }, tx);
                await this.tasks.hardDelete(task.id, tx);
                // F15 (ISS-046): the child is gone from the parent's count.
                if (task.parentTaskId) {
                    await this.tasks.recomputeSubtaskCounters(task.parentTaskId, tx);
                }
            });
            this.logger.info("tasks.hard_deleted", {
                taskId: task.id,
                workspaceId: input.workspaceId,
                actorId: input.actorId,
            });
            return;
        }
        await this.archiveInTx(task.id, input.actorId, task.parentTaskId);
    }
    /**
     * F8 (ISS-047): enforce the actor's grant SCOPE against a resolved task.
     * Team-access P7: delegated to the unified guard (G4), which also carries
     * the space's HEAD — the head-of-owning-space edit allow-path.
     */
    async assertTaskScope(key, task) {
        return (0, scopeGuard_1.assertTaskScoped)(key, task, this.tasks);
    }
    /** Archive `taskId` + descendants + gated `task_archived` rows, atomically. */
    async archiveInTx(taskId, actorId, parentTaskId) {
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.archive(taskId, tx);
            // Team-access P3: the cascade used to flip every descendant with
            // NO trace on the descendants themselves — a subtask's own audit
            // log claimed it was never archived. Capture who is about to be
            // flipped (still live) BEFORE the cascade, then write one row per
            // descendant that actually transitioned.
            const flipped = await this.tasks.descendantIdsByArchivedState(taskId, false, tx);
            await this.tasks.archiveDescendants(taskId, tx);
            const rows = [];
            if (transitioned) {
                rows.push({ taskId, actorId, action: "task_archived" });
            }
            for (const id of flipped) {
                rows.push({
                    taskId: id,
                    actorId,
                    action: "task_archived",
                    context: { via_parent: taskId },
                });
            }
            if (rows.length > 0) {
                await this.activity.recordMany(rows, tx);
            }
            // F15 (ISS-046): an archived child leaves the parent's count.
            if (parentTaskId) {
                await this.tasks.recomputeSubtaskCounters(parentTaskId, tx);
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
        // "Today" is a BUSINESS day, not the box's day: these buckets decide what
        // the workspace calls overdue. F5 (ISS-058): the zone now comes from
        // `workspaces.timezone` — the setting finally does what its UI claims —
        // independent of the deploy box's TZ and of the (UTC) MySQL session.
        // Falls back to the Dhaka calendar for a null/garbage zone.
        const ws = await this.workspaces.findById(input.workspaceId);
        const today = (0, dhakaTime_1.todayInZone)(ws?.timezone ?? "Asia/Dhaka");
        const in7 = (0, dhakaTime_1.addDaysYmd)(today, 7);
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
                const d = storedDateYmd(task.dueDate);
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
        // F8 (ISS-047): the grant's scope must reach EVERY target — fail-atomic
        // like the rest of bulk. One batched context build for all ids; skipped
        // outright for full-reach grants (every seeded role).
        if (!(await (0, scopeGuard_1.hasFullReach)("task.edit"))) {
            const [spaceInfo, assignees] = await Promise.all([
                // P7: the space's HEAD rides along — a department head may
                // bulk-edit their own department's tasks (G4).
                this.tasks.spaceInfoByTask(ids),
                this.tasks.assigneesByTask(ids),
            ]);
            for (const t of found) {
                await (0, scopeGuard_1.assertScoped)("task.edit", {
                    spaceId: spaceInfo.get(t.id)?.spaceId ?? null,
                    spaceHeadUserId: spaceInfo.get(t.id)?.headUserId ?? null,
                    createdBy: t.createdBy,
                    assigneeIds: assignees.get(t.id) ?? [],
                });
            }
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
        // Team-access P3: the landing status's NAME rides into every bulk
        // `status_changed` row (names denormalised — a later rename must not
        // blank the history).
        let newStatusName = null;
        if (p.statusId !== undefined) {
            const st = await this.statuses.findByIdInWorkspace(p.statusId, input.workspaceId);
            if (!st) {
                throw errors_1.AppError.unprocessable("task.invalid_status", `${p.statusId} is not a status in this workspace`, [{ field: "patch.status_id", issue: "is not a status in this workspace" }]);
            }
            newGroup = st.statusGroup;
            newStatusName = st.name;
        }
        // F22 (ISS-011): the same completion guard the single PATCH has —
        // fail-atomic, matching every other bulk validation: one blocked
        // target refuses the whole batch, so a bulk cannot smuggle a blocked
        // task into Done.
        if (newGroup !== undefined && DONE_GROUPS.has(newGroup)) {
            for (const t of found) {
                if (t.statusId === p.statusId)
                    continue; // already there
                const blockers = await this.tasks.openBlockerCount(t.id);
                if (blockers > 0) {
                    throw errors_1.AppError.conflict("task.cannot_complete_blocked", `Task ${t.id} is blocked by ${blockers} open task(s) — complete or unlink them first`);
                }
            }
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
        // 2b. Team-access P8 (Q8/Q11): classify every (task, added-user) pair
        //     — the SAME user can be same-team for one target and cross-team
        //     for another, so the split is per pair, and the response reports
        //     "N assigned, M pending approval" instead of silently succeeding.
        //     Read-only, before the tx; dormant while targets fold to `all`.
        let bulkSplit = null;
        if (assigneeAdd.length > 0) {
            const spaceInfoForGate = await this.tasks.spaceInfoByTask(ids);
            bulkSplit = await (0, AssignmentRequestsService_1.assignmentGate)().splitByApproval({
                workspaceId: input.workspaceId,
                requesterId: input.actorId,
                pairs: found.flatMap((t) => assigneeAdd.map((targetUserId) => ({
                    taskId: t.id,
                    spaceId: spaceInfoForGate.get(t.id)?.spaceId ?? "",
                    targetUserId,
                    taskName: t.name,
                }))),
            });
        }
        // 3. Build the uniform scalar patch (`updated_at` always, so the ETag
        //    bumps even on a membership-only bulk).
        const dbPatch = { updatedAt: now };
        if (p.statusId !== undefined)
            dbPatch.statusId = p.statusId;
        if (p.priority !== undefined)
            dbPatch.priority = p.priority;
        if (p.dueDate !== undefined) {
            dbPatch.dueDate = toDateOnly(p.dueDate);
            // Same re-arm rule as the single-PATCH path (upgrades/014).
            dbPatch.overdueNotifiedAt = null;
        }
        if (p.startDate !== undefined)
            dbPatch.startDate = toDateOnly(p.startDate);
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
        // Team-access P3 (plan G13): the bulk membership writes used to go
        // straight to the repo, so reassigning 50 tasks was INVISIBLE to the
        // audit log. Capture the pre-state (the F21 pattern — same timing as
        // `found`) so each task logs only what actually changed for IT, with
        // the same row shapes the single-target endpoints write.
        const wantsAssigneeAudit = assigneeAdd.length > 0 || assigneeRemove.length > 0;
        const wantsTagAudit = tagAdd.length > 0 || tagRemove.length > 0;
        const preAssignees = wantsAssigneeAudit
            ? await this.tasks.assigneesByTask(ids)
            : new Map();
        const preTags = wantsTagAudit
            ? await this.tasks.tagsByTask(ids)
            : new Map();
        const tagNames = new Map();
        if (wantsTagAudit) {
            for (const t of await this.tags.listByWorkspace(input.workspaceId)) {
                tagNames.set(t.id, t.name);
            }
        }
        // Old-status names for the bulk `status_changed` rows — one query for
        // the distinct set, not one per task.
        const oldStatusNames = p.statusId !== undefined
            ? await this.statuses.namesByIds([
                ...new Set(found.map((t) => t.statusId)),
            ])
            : new Map();
        // 4. Atomic write (batched: bulk operations instead of per-task loop).
        let pendingApproval = 0; // P8/Q8 — requests created instead of assigns
        // P9: post-commit fan-outs collected inside the tx.
        let bulkRequestDeliveries = [];
        const bulkAssignedOutbox = [];
        try {
            await this.db.transaction(async (tx) => {
                await this.tasks.updateMany(ids, dbPatch, tx);
                // F15 (ISS-046): a bulk status change or (un)archive moves the
                // targets in or out of their parents' counts. Recompute each
                // DISTINCT parent once — a bulk of 50 siblings is one call, not
                // fifty.
                if (p.statusId !== undefined ||
                    p.archivedAtProvided === true) {
                    const parents = [
                        ...new Set(found
                            .map((t) => t.parentTaskId)
                            .filter((id) => !!id)),
                    ];
                    for (const parentId of parents) {
                        await this.tasks.recomputeSubtaskCounters(parentId, tx);
                    }
                }
                const bulkRows = [];
                if (assigneeAdd.length > 0 && bulkSplit) {
                    // P8: only the DIRECT pairs are assigned; identical
                    // direct-sets are grouped so a homogeneous bulk stays the
                    // two batched INSERTs it always was.
                    const groups = new Map();
                    for (const t of found) {
                        const userIds = bulkSplit.directByTask.get(t.id) ?? [];
                        if (userIds.length === 0)
                            continue;
                        const key = [...userIds].sort().join(",");
                        const g = groups.get(key) ?? { taskIds: [], userIds };
                        g.taskIds.push(t.id);
                        groups.set(key, g);
                    }
                    for (const g of groups.values()) {
                        await this.membership.addAssigneesBulk(g.taskIds, g.userIds, input.actorId, tx);
                        await this.membership.addWatchersBulk(g.taskIds, g.userIds, tx);
                    }
                    // Team-access P3: same shape as the single-target path —
                    // one row per (task, user) that ACTUALLY gained them.
                    // P9 (G15): bulk assignment used to be completely silent —
                    // the same loop now also fans out the `assigned` bell and
                    // collects the email/push outbox, exactly the single-add
                    // side-effect set.
                    for (const t of found) {
                        const had = new Set(preAssignees.get(t.id) ?? []);
                        const gained = [];
                        for (const userId of bulkSplit.directByTask.get(t.id) ??
                            []) {
                            if (had.has(userId))
                                continue;
                            gained.push(userId);
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "assignee_added",
                                context: { user_id: userId, bulk: true },
                            });
                        }
                        const recipients = gained.filter((id) => id !== input.actorId);
                        if (recipients.length > 0) {
                            await this.notifications.createMany(recipients.map((userId) => ({
                                userId,
                                type: "assigned",
                                entityType: "task",
                                entityId: t.id,
                                actorId: input.actorId,
                                title: assignedTitle(t.name),
                            })), tx);
                            bulkAssignedOutbox.push({
                                taskId: t.id,
                                taskName: t.name,
                                recipientIds: recipients,
                            });
                        }
                    }
                    // P8: the gated pairs become pending requests in the SAME
                    // tx. A target already assigned to that specific task
                    // needs no request; duplicate pendings are skipped by the
                    // unique key. Honest counts ride the response (Q8).
                    const gatedFresh = bulkSplit.gated.filter((pair) => !(preAssignees.get(pair.taskId) ?? []).includes(pair.targetUserId));
                    const { created, deliveries } = await (0, AssignmentRequestsService_1.assignmentGate)()
                        .createRequestsInTx(tx, {
                        workspaceId: input.workspaceId,
                        requesterId: input.actorId,
                        split: { ...bulkSplit, gated: gatedFresh },
                        now,
                    });
                    pendingApproval = created;
                    bulkRequestDeliveries = deliveries;
                }
                if (assigneeRemove.length > 0) {
                    await this.membership.removeAssigneesBulk(ids, assigneeRemove, tx);
                    for (const t of found) {
                        const had = new Set(preAssignees.get(t.id) ?? []);
                        for (const userId of assigneeRemove) {
                            if (!had.has(userId))
                                continue;
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "assignee_removed",
                                context: { user_id: userId, bulk: true },
                            });
                        }
                    }
                }
                if (tagAdd.length > 0) {
                    await this.membership.addTagsBulk(ids, tagAdd, tx);
                    for (const t of found) {
                        const had = new Set(preTags.get(t.id) ?? []);
                        for (const tagId of tagAdd) {
                            if (had.has(tagId))
                                continue;
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "tag_added",
                                context: {
                                    tag_id: tagId,
                                    name: tagNames.get(tagId) ?? null,
                                    bulk: true,
                                },
                            });
                        }
                    }
                }
                if (tagRemove.length > 0) {
                    await this.membership.removeTagsBulk(ids, tagRemove, tx);
                    for (const t of found) {
                        const had = new Set(preTags.get(t.id) ?? []);
                        for (const tagId of tagRemove) {
                            if (!had.has(tagId))
                                continue;
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "tag_removed",
                                context: {
                                    tag_id: tagId,
                                    name: tagNames.get(tagId) ?? null,
                                    bulk: true,
                                },
                            });
                        }
                    }
                }
                // Team-access P3: a bulk (un)archive now writes the SAME
                // semantic rows the single-target endpoints write — only for
                // tasks whose archival state actually flips.
                if (p.archivedAtProvided) {
                    const archiving = !!p.archivedAt;
                    for (const t of found) {
                        if (archiving && t.archivedAt === null) {
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "task_archived",
                                context: { bulk: true },
                            });
                        }
                        else if (!archiving && t.archivedAt !== null) {
                            bulkRows.push({
                                taskId: t.id,
                                actorId: input.actorId,
                                action: "task_unarchived",
                                context: { bulk: true },
                            });
                        }
                    }
                }
                // F21 (ISS-049): a 200-task bulk used to leave 200 rows saying
                // only `{"bulk":true}`. Each row now records the per-task
                // before/after (compared against ITS OWN pre-update values in
                // `found`), and a task the patch did not actually change gets
                // no row at all.
                for (const t of found) {
                    const changes = scalarChanges(t, p);
                    const statusMoved = p.statusId !== undefined && p.statusId !== t.statusId;
                    if (statusMoved) {
                        bulkRows.push({
                            taskId: t.id,
                            actorId: input.actorId,
                            action: "status_changed",
                            // P3: names denormalised, like the single path.
                            context: {
                                from: t.statusId,
                                to: p.statusId,
                                from_name: oldStatusNames.get(t.statusId) ?? null,
                                to_name: newStatusName,
                            },
                        });
                    }
                    if (Object.keys(changes).length > 0) {
                        bulkRows.push({
                            taskId: t.id,
                            actorId: input.actorId,
                            action: "task_updated",
                            context: {
                                bulk: true,
                                fields: Object.keys(changes),
                                changes,
                            },
                        });
                    }
                }
                await this.activity.recordMany(bulkRows, tx);
            });
        }
        catch (err) {
            if (isForeignKeyError(err)) {
                throw errors_1.AppError.unprocessable("task.invalid_reference", "A referenced sprint or status does not exist");
            }
            throw err;
        }
        // 4b. P9 post-commit fan-outs, fire-and-forget: the G15 assigned
        // emails/pushes for the direct adds, and "approval needed" for the
        // gated pairs — the same channels the single-target paths use.
        for (const o of bulkAssignedOutbox) {
            void (0, TaskEmailService_1.taskEmails)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId: o.taskId,
                taskName: o.taskName,
                recipientIds: o.recipientIds,
                actorId: input.actorId,
            });
            void (0, PushService_1.pushSvc)().taskAssigned({
                workspaceId: input.workspaceId,
                taskId: o.taskId,
                taskName: o.taskName,
                recipientIds: o.recipientIds,
                actorId: input.actorId,
            });
        }
        if (bulkRequestDeliveries.length > 0) {
            (0, AssignmentRequestsService_1.assignmentGate)().deliverCreated({
                workspaceId: input.workspaceId,
                requesterId: input.actorId,
                deliveries: bulkRequestDeliveries,
            });
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
        return { updated: ids.length, tasks: wireTasks, pendingApproval };
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
