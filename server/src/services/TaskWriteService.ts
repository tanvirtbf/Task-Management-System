import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import type { NewTask } from "../db/schema";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { Roles, type Role } from "../constants";
import type { ListsRepo } from "../repositories/ListsRepo";
import type { StatusesRepo } from "../repositories/StatusesRepo";
import type { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { TagsRepo } from "../repositories/TagsRepo";
import type { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import type { NotificationsRepo } from "../repositories/NotificationsRepo";
import type { TasksService } from "./TasksService";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";

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
const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};

/** mysql2 surfaces a missing-FK-target as `ER_NO_REFERENCED_ROW(_2)` / 1452. */
const isForeignKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return (
        e?.code === "ER_NO_REFERENCED_ROW_2" ||
        e?.code === "ER_NO_REFERENCED_ROW" ||
        e?.errno === 1452
    );
};

/**
 * §29 implicit SLA policy, relative to create time. Keyed on the task-type NAME
 * (case-insensitive "bug"/"complaint") + `bug_severity` — the only signals the
 * spec names. Returns `null` (no SLA) for every other type and for Bug S3.
 */
const computeSlaDueAt = (
    typeName: string,
    severity: string | null,
    now: Date,
): Date | null => {
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
    if (t === "complaint") return new Date(now.getTime() + 24 * HOUR_MS);
    return null;
};

/**
 * Parse a `YYYY-MM-DD` wire date into a LOCAL-midnight `Date` for a MySQL DATE
 * column (Drizzle `date()` is in `mode: "date"`). Local midnight round-trips
 * cleanly through the serializer's local-component formatting (`toWireDate`),
 * avoiding the UTC-boundary shift a `new Date("YYYY-MM-DD")` (UTC midnight)
 * would cause.
 */
const toLocalDate = (value: string | null | undefined): Date | null => {
    if (value === null || value === undefined) return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
};

/** Local `YYYY-MM-DD` for a Date (matches the serializer's date formatting). */
const ymd = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

export type MyWorkBucket =
    | "today"
    | "overdue"
    | "next"
    | "unscheduled"
    | "done";

export interface MyWorkInput {
    workspaceId: string;
    userId: string;
    role: Role;
    /** When set, only that bucket is returned; otherwise all five. */
    bucket?: MyWorkBucket;
}

/** The patch a `POST /api/v1/tasks/bulk` applies uniformly to every target. */
export interface BulkPatch {
    statusId?: string;
    priority?: number;
    dueDate?: string | null;
    startDate?: string | null;
    sprintId?: string | null;
    /** Whether `archived_at` was in the body (distinguishes null-clear from absent). */
    archivedAtProvided?: boolean;
    archivedAt?: string | null;
    assigneeAdd?: string[];
    assigneeRemove?: string[];
    tagAdd?: string[];
    tagRemove?: string[];
}

export interface BulkInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    ids: string[];
    patch: BulkPatch;
}

export interface BulkResult {
    updated: number;
    tasks: WireTask[];
}

type RecurrencePattern = (typeof schema.tasks.$inferInsert)["recurrencePattern"];

export interface CreateTaskInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    primaryListId: string;
    name: string;
    description?: string | null;
    statusId?: string;
    taskTypeId?: string;
    parentTaskId?: string | null;
    priority?: number;
    isMilestone?: boolean;
    customId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    recurrencePattern?: RecurrencePattern;
    recurrenceDays?: string[] | null;
    recurrenceEndsAt?: string | null;
    timeEstimateSeconds?: number | null;
    assignees?: string[];
    tags?: string[];
    sprintId?: string | null;
    storyPoints?: number | null;
    reviewerId?: string | null;
    branchName?: string | null;
    prUrl?: string | null;
    prStatus?: string | null;
    bugSeverity?: string | null;
    bugReproducibility?: string | null;
    bugEnvironment?: string | null;
    bugBrowser?: string | null;
    reporterTeam?: string | null;
    deployedAt?: string | null;
    rollbackReason?: string | null;
}

const DONE_GROUPS = new Set(["done", "closed"]);

/** The scalar columns `PATCH /api/v1/tasks/:id` may change (no membership/parent). */
export interface TaskScalarPatch {
    name?: string;
    description?: string | null;
    statusId?: string;
    priority?: number;
    taskTypeId?: string;
    isMilestone?: boolean;
    customId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    recurrencePattern?: RecurrencePattern;
    recurrenceDays?: string[] | null;
    recurrenceEndsAt?: string | null;
    timeEstimateSeconds?: number | null;
    sprintId?: string | null;
    storyPoints?: number | null;
    reviewerId?: string | null;
    branchName?: string | null;
    prUrl?: string | null;
    prStatus?: string | null;
    bugSeverity?: string | null;
    bugReproducibility?: string | null;
    bugEnvironment?: string | null;
    bugBrowser?: string | null;
    reporterTeam?: string | null;
    deployedAt?: string | null;
    rollbackReason?: string | null;
}

export interface UpdateTaskInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    /** Internal id or custom_id from the path. */
    taskId: string;
    /** The `If-Match` header value, if the client sent one (optimistic lock). */
    ifMatch?: string;
    /** Wire field names present in the body — recorded in the activity context. */
    fields: string[];
    patch: TaskScalarPatch;
}

/** A no-body task action addressed by id/custom_id (#6 archive, #7 unarchive). */
export interface TargetedTaskInput {
    workspaceId: string;
    actorId: string;
    taskId: string;
}

/** `DELETE /api/v1/tasks/:id` (#8 soft / #9 hard). */
export interface DeleteTaskInput {
    workspaceId: string;
    actorId: string;
    role: Role;
    taskId: string;
    /** `?hard=true` → permanent delete (👑 admin/owner); else soft (archive). */
    hard: boolean;
}

export class TaskWriteService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private lists: ListsRepo,
        private statuses: StatusesRepo,
        private taskTypes: TaskTypesRepo,
        private tasks: TasksRepo,
        private membership: TaskMembershipRepo,
        private users: UsersRepo,
        private tags: TagsRepo,
        private activity: TaskActivityRepo,
        private notifications: NotificationsRepo,
        private reads: TasksService,
        private logger: Logger,
    ) {}

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
    async create(input: CreateTaskInput): Promise<WireTask> {
        const now = new Date();

        // 1. List must exist in the workspace and not be archived.
        const list = await this.lists.findRecordByIdInWorkspace(
            input.primaryListId,
            input.workspaceId,
        );
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.primaryListId} does not exist`,
            );
        }
        if (list.archivedAt) {
            throw AppError.conflict(
                "list.archived",
                "Cannot create a task in an archived list",
            );
        }

        // 2. Resolve the task type: explicit body value → the list's default →
        //    fall back to ANY task type in the workspace. The fallback keeps
        //    creation from dead-ending when a list has no default (e.g. public
        //    form submits, quick-adds); only a workspace with ZERO task types 422s.
        let taskTypeId = input.taskTypeId ?? list.defaultTaskTypeId ?? undefined;
        if (!taskTypeId) {
            const [fallback] = await this.taskTypes.listByWorkspace(
                input.workspaceId,
            );
            taskTypeId = fallback?.id;
        }
        if (!taskTypeId) {
            throw AppError.unprocessable(
                "task.invalid_task_type",
                "This workspace has no task types; create one before adding tasks",
                [{ field: "task_type_id", issue: "no task type available" }],
            );
        }
        const taskType = await this.taskTypes.findByIdInWorkspace(
            taskTypeId,
            input.workspaceId,
        );
        if (!taskType) {
            throw AppError.unprocessable(
                "task.invalid_task_type",
                `${taskTypeId} is not a task type in this workspace`,
                [{ field: "task_type_id", issue: "is not a task type in this workspace" }],
            );
        }

        // 3. Resolve + validate the status (body, else the list's first status).
        const listStatuses = await this.statuses.listByList(input.primaryListId);
        if (listStatuses.length === 0) {
            throw AppError.internal(
                "List has no statuses configured; cannot place a task",
            );
        }
        let status;
        if (input.statusId !== undefined) {
            status = listStatuses.find((s) => s.id === input.statusId);
            if (!status) {
                throw AppError.unprocessable(
                    "task.invalid_status",
                    `${input.statusId} is not a status of this list`,
                    [{ field: "status_id", issue: "is not a status of this list" }],
                );
            }
        } else {
            status = listStatuses.reduce((lo, s) =>
                s.position < lo.position ? s : lo,
            );
        }

        // 4. Parent nesting: parent must be in-workspace; child depth ≤ 2.
        let nestingDepth = 0;
        if (input.parentTaskId) {
            const parent = await this.tasks.findByIdOrCustomIdInWorkspace(
                input.parentTaskId,
                input.workspaceId,
            );
            if (!parent) {
                throw AppError.unprocessable(
                    "task.invalid_parent",
                    `${input.parentTaskId} is not a task in this workspace`,
                    [{ field: "parent_task_id", issue: "is not a task in this workspace" }],
                );
            }
            nestingDepth = parent.nestingDepth + 1;
            if (nestingDepth > 2) {
                throw AppError.unprocessable(
                    "task.nesting_too_deep",
                    "Subtasks may nest at most 2 levels deep",
                    [{ field: "parent_task_id", issue: "nesting would exceed 2 levels" }],
                );
            }
            // Re-point parentTaskId at the parent's internal id (the body may
            // have referenced it by custom_id).
            input.parentTaskId = parent.id;
        }

        // 5. Validate initial assignees + tags (no partial writes).
        const assignees = dedupe(input.assignees);
        if (assignees.length > 0) {
            const valid = await this.users.findActiveIdsInWorkspace(
                assignees,
                input.workspaceId,
            );
            const invalid = assignees.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw AppError.unprocessable(
                    "task.invalid_assignee",
                    "One or more assignees are not active members of this workspace",
                    invalid.map((id) => ({
                        field: "assignees",
                        issue: `${id} is not an active member of this workspace`,
                    })),
                );
            }
        }
        const tagIds = dedupe(input.tags);
        if (tagIds.length > 0) {
            const valid = await this.tags.findIdsInWorkspace(
                tagIds,
                input.workspaceId,
            );
            const invalid = tagIds.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw AppError.unprocessable(
                    "task.invalid_tag",
                    "One or more tags do not exist in this workspace",
                    invalid.map((id) => ({
                        field: "tags",
                        issue: `${id} is not a tag in this workspace`,
                    })),
                );
            }
        }

        // 5b. Custom-id (if supplied) is unique per workspace — friendly 409
        //     pre-check; the `uq_tasks_custom_id` index is the race backstop.
        if (input.customId) {
            const clash = await this.tasks.findByIdOrCustomIdInWorkspace(
                input.customId,
                input.workspaceId,
            );
            if (clash) {
                throw AppError.conflict(
                    "task.duplicate_custom_id",
                    `A task with custom_id ${input.customId} already exists`,
                );
            }
        }

        // 6. Bug severity default + SLA + completed_at.
        const isBug = taskType.name.trim().toLowerCase() === "bug";
        const bugSeverity =
            isBug && (input.bugSeverity ?? null) === null
                ? "S2"
                : (input.bugSeverity ?? null);
        const slaDueAt = computeSlaDueAt(taskType.name, bugSeverity, now);
        const completedAt = DONE_GROUPS.has(status.statusGroup) ? now : null;

        const taskId = fakeId("t");

        // 7. Atomic create, retrying only on a per-list task_number collision.
        for (let attempt = 1; ; attempt += 1) {
            const taskNumber = await this.tasks.nextTaskNumber(
                input.primaryListId,
            );
            try {
                await this.db.transaction(async (tx) => {
                    const row: NewTask = {
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
                            null) as NewTask["recurrenceDays"],
                        recurrenceEndsAt: toLocalDate(input.recurrenceEndsAt),
                        timeEstimateSeconds: input.timeEstimateSeconds ?? null,
                        sprintId: input.sprintId ?? null,
                        storyPoints: input.storyPoints ?? null,
                        reviewerId: input.reviewerId ?? null,
                        branchName: input.branchName ?? null,
                        prUrl: input.prUrl ?? null,
                        prStatus: (input.prStatus ?? null) as NewTask["prStatus"],
                        bugSeverity: bugSeverity as NewTask["bugSeverity"],
                        bugReproducibility:
                            (input.bugReproducibility ?? null) as NewTask["bugReproducibility"],
                        bugEnvironment:
                            (input.bugEnvironment ?? null) as NewTask["bugEnvironment"],
                        bugBrowser: input.bugBrowser ?? null,
                        reporterTeam:
                            (input.reporterTeam ?? null) as NewTask["reporterTeam"],
                        deployedAt: input.deployedAt
                            ? new Date(input.deployedAt)
                            : null,
                        rollbackReason: input.rollbackReason ?? null,
                        createdBy: input.actorId,
                    };
                    await this.tasks.insert(row, tx);

                    if (input.parentTaskId) {
                        await this.tasks.setParent(
                            taskId,
                            input.parentTaskId,
                            nestingDepth,
                            tx,
                        );
                    }

                    if (assignees.length > 0) {
                        await this.membership.addAssignees(
                            taskId,
                            assignees,
                            input.actorId,
                            tx,
                        );
                        await this.membership.addWatchers(taskId, assignees, tx);
                    }
                    if (tagIds.length > 0) {
                        await this.membership.addTags(taskId, tagIds, tx);
                    }

                    await this.activity.recordMany(
                        [
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
                        ],
                        tx,
                    );

                    const recipients = assignees.filter(
                        (id) => id !== input.actorId,
                    );
                    await this.notifications.createMany(
                        recipients.map((userId) => ({
                            userId,
                            type: "assigned" as const,
                            entityType: "task" as const,
                            entityId: taskId,
                            actorId: input.actorId,
                            title: assignedTitle(input.name),
                        })),
                        tx,
                    );
                });
                break; // committed
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    const msg =
                        (err as { sqlMessage?: string }).sqlMessage ?? "";
                    // A racing custom_id (both passed the pre-check) — a 409, not
                    // something a fresh task_number can fix.
                    if (msg.includes("uq_tasks_custom_id")) {
                        throw AppError.conflict(
                            "task.duplicate_custom_id",
                            `A task with custom_id ${input.customId} already exists`,
                        );
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
    async update(input: UpdateTaskInput): Promise<WireTask> {
        const now = new Date();
        const p = input.patch;

        const current = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!current) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        if (
            input.ifMatch !== undefined &&
            input.ifMatch !== current.updatedAt.toISOString()
        ) {
            throw AppError.conflict(
                "task.conflict",
                "The task was modified since you last read it (ETag mismatch)",
            );
        }
        if (current.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "Cannot update an archived task; unarchive it first",
            );
        }

        // ─── Reference validation ────────────────────────────────────────────
        const listStatuses = await this.statuses.listByList(
            current.primaryListId,
        );
        let newStatusGroup: string | undefined;
        if (p.statusId !== undefined && p.statusId !== current.statusId) {
            const status = listStatuses.find((s) => s.id === p.statusId);
            if (!status) {
                throw AppError.unprocessable(
                    "task.invalid_status",
                    `${p.statusId} is not a status of this list`,
                    [{ field: "status_id", issue: "is not a status of this list" }],
                );
            }
            newStatusGroup = status.statusGroup;
        }

        let typeName = "";
        if (p.taskTypeId !== undefined) {
            const tt = await this.taskTypes.findByIdInWorkspace(
                p.taskTypeId,
                input.workspaceId,
            );
            if (!tt) {
                throw AppError.unprocessable(
                    "task.invalid_task_type",
                    `${p.taskTypeId} is not a task type in this workspace`,
                    [{ field: "task_type_id", issue: "is not a task type in this workspace" }],
                );
            }
            typeName = tt.name;
        }

        if (p.reviewerId !== undefined && p.reviewerId !== null) {
            const valid = await this.users.findActiveIdsInWorkspace(
                [p.reviewerId],
                input.workspaceId,
            );
            if (!valid.has(p.reviewerId)) {
                throw AppError.unprocessable(
                    "task.invalid_reviewer",
                    `${p.reviewerId} is not an active member of this workspace`,
                    [{ field: "reviewer_id", issue: "is not an active member of this workspace" }],
                );
            }
        }

        if (
            p.customId !== undefined &&
            p.customId !== null &&
            p.customId !== current.customId
        ) {
            const clash = await this.tasks.findByIdOrCustomIdInWorkspace(
                p.customId,
                input.workspaceId,
            );
            if (clash && clash.id !== current.id) {
                throw AppError.conflict(
                    "task.duplicate_custom_id",
                    `A task with custom_id ${p.customId} already exists`,
                );
            }
        }

        // ─── Build the column patch ──────────────────────────────────────────
        const dbPatch: Partial<NewTask> = {};
        if (p.name !== undefined) dbPatch.name = p.name;
        if (p.description !== undefined) dbPatch.description = p.description;
        if (p.statusId !== undefined) dbPatch.statusId = p.statusId;
        if (p.priority !== undefined) dbPatch.priority = p.priority;
        if (p.taskTypeId !== undefined) dbPatch.taskTypeId = p.taskTypeId;
        if (p.isMilestone !== undefined) dbPatch.isMilestone = p.isMilestone;
        if (p.customId !== undefined) dbPatch.customId = p.customId;
        if (p.startDate !== undefined)
            dbPatch.startDate = toLocalDate(p.startDate);
        if (p.dueDate !== undefined) dbPatch.dueDate = toLocalDate(p.dueDate);
        if (p.recurrencePattern !== undefined)
            dbPatch.recurrencePattern = p.recurrencePattern;
        if (p.recurrenceDays !== undefined)
            dbPatch.recurrenceDays =
                p.recurrenceDays as NewTask["recurrenceDays"];
        if (p.recurrenceEndsAt !== undefined)
            dbPatch.recurrenceEndsAt = toLocalDate(p.recurrenceEndsAt);
        if (p.timeEstimateSeconds !== undefined)
            dbPatch.timeEstimateSeconds = p.timeEstimateSeconds;
        if (p.sprintId !== undefined) dbPatch.sprintId = p.sprintId;
        if (p.storyPoints !== undefined) dbPatch.storyPoints = p.storyPoints;
        if (p.reviewerId !== undefined) dbPatch.reviewerId = p.reviewerId;
        if (p.branchName !== undefined) dbPatch.branchName = p.branchName;
        if (p.prUrl !== undefined) dbPatch.prUrl = p.prUrl;
        if (p.prStatus !== undefined)
            dbPatch.prStatus = p.prStatus as NewTask["prStatus"];
        if (p.bugSeverity !== undefined)
            dbPatch.bugSeverity = p.bugSeverity as NewTask["bugSeverity"];
        if (p.bugReproducibility !== undefined)
            dbPatch.bugReproducibility =
                p.bugReproducibility as NewTask["bugReproducibility"];
        if (p.bugEnvironment !== undefined)
            dbPatch.bugEnvironment =
                p.bugEnvironment as NewTask["bugEnvironment"];
        if (p.bugBrowser !== undefined) dbPatch.bugBrowser = p.bugBrowser;
        if (p.reporterTeam !== undefined)
            dbPatch.reporterTeam = p.reporterTeam as NewTask["reporterTeam"];
        if (p.deployedAt !== undefined)
            dbPatch.deployedAt = p.deployedAt ? new Date(p.deployedAt) : null;
        if (p.rollbackReason !== undefined)
            dbPatch.rollbackReason = p.rollbackReason;

        // completed_at follows the landing status group on a status change.
        if (newStatusGroup !== undefined) {
            dbPatch.completedAt = DONE_GROUPS.has(newStatusGroup)
                ? (current.completedAt ?? now)
                : null;
        }

        // §29: a bug_severity change recomputes sla_due_at (unless overridden —
        // sla_due_at is not a PATCH field, it has its own §29 endpoint).
        if (p.bugSeverity !== undefined) {
            const resolvedTypeName =
                typeName ||
                (
                    await this.taskTypes.findByIdInWorkspace(
                        current.taskTypeId,
                        input.workspaceId,
                    )
                )?.name ||
                "";
            dbPatch.slaDueAt = computeSlaDueAt(
                resolvedTypeName,
                p.bugSeverity,
                now,
            );
        }

        // ─── Write (atomic) ──────────────────────────────────────────────────
        try {
            await this.db.transaction(async (tx) => {
                await this.tasks.update(input.taskId, dbPatch, tx);
                const rows = [];
                if (
                    p.statusId !== undefined &&
                    p.statusId !== current.statusId
                ) {
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
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "task.duplicate_custom_id",
                    "A task with that custom_id already exists",
                );
            }
            if (isForeignKeyError(err)) {
                throw AppError.unprocessable(
                    "task.invalid_reference",
                    "A referenced sprint, reviewer, status, or task type does not exist",
                );
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
    async archive(input: TargetedTaskInput): Promise<void> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        await this.archiveInTx(task.id, input.actorId);
    }

    /**
     * Unarchive a task (`POST /api/v1/tasks/:id/unarchive`, 🔐). Clears
     * `archived_at` on the task and its descendants. Idempotent; 204.
     */
    async unarchive(input: TargetedTaskInput): Promise<void> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
        }
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.unarchive(task.id, tx);
            await this.tasks.unarchiveDescendants(task.id, tx);
            if (transitioned) {
                await this.activity.recordMany(
                    [
                        {
                            taskId: task.id,
                            actorId: input.actorId,
                            action: "task_unarchived",
                        },
                    ],
                    tx,
                );
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
    async del(input: DeleteTaskInput): Promise<void> {
        if (
            input.hard &&
            input.role !== Roles.OWNER &&
            input.role !== Roles.ADMIN
        ) {
            throw AppError.forbidden(
                "auth.forbidden",
                "A hard delete requires the admin or owner role",
            );
        }

        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskId,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskId} does not exist`,
            );
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
    private async archiveInTx(taskId: string, actorId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const transitioned = await this.tasks.archive(taskId, tx);
            await this.tasks.archiveDescendants(taskId, tx);
            if (transitioned) {
                await this.activity.recordMany(
                    [{ taskId, actorId, action: "task_archived" }],
                    tx,
                );
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
    async myWork(
        input: MyWorkInput,
    ): Promise<Partial<Record<MyWorkBucket, WireTask[]>>> {
        const rows = await this.tasks.myWorkRows(
            input.userId,
            input.workspaceId,
        );
        const ids = rows.map((r) => r.task.id);
        const redactGuest = input.role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasks.assigneesByTask(ids),
                this.tasks.watchersByTask(ids),
                this.tasks.tagsByTask(ids),
                this.tasks.customFieldValuesByTask(ids, redactGuest),
            ]);
        const wire = (t: (typeof rows)[number]["task"]): WireTask =>
            toWireTask(t, {
                assignees: assignees.get(t.id) ?? [],
                watchers: watchers.get(t.id) ?? [],
                tags: tags.get(t.id) ?? [],
                customFieldValues: customFieldValues.get(t.id) ?? {},
            });

        const today = ymd(new Date());
        const in7 = ymd(new Date(Date.now() + 7 * DAY_MS));
        const buckets: Record<MyWorkBucket, WireTask[]> = {
            today: [],
            overdue: [],
            next: [],
            unscheduled: [],
            done: [],
        };
        for (const { task, statusGroup } of rows) {
            let bucket: MyWorkBucket | null;
            if (DONE_GROUPS.has(statusGroup)) {
                bucket = "done";
            } else if (task.dueDate === null) {
                bucket = "unscheduled";
            } else {
                const d = ymd(task.dueDate);
                if (d < today) bucket = "overdue";
                else if (d === today) bucket = "today";
                else if (d <= in7) bucket = "next";
                else bucket = null; // due > 7d out, not done → not "work for now"
            }
            if (bucket) buckets[bucket].push(wire(task));
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
    async bulk(input: BulkInput): Promise<BulkResult> {
        const now = new Date();
        const ids = dedupe(input.ids);
        if (ids.length === 0) {
            throw AppError.validationFailed([
                { field: "ids", issue: "at least one task id is required" },
            ]);
        }

        // 1. Every id must resolve in the workspace (fail-atomic — no partial).
        const found = await this.tasks.findManyByIdsInWorkspace(
            ids,
            input.workspaceId,
        );
        const foundIds = new Set(found.map((t) => t.id));
        const missing = ids.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
            throw AppError.notFound(
                "task.not_found",
                "One or more tasks do not exist in this workspace",
            );
        }

        const p = input.patch;

        // 2. Validate references in the patch.
        let newGroup: string | undefined;
        if (p.statusId !== undefined) {
            const st = await this.statuses.findByIdInWorkspace(
                p.statusId,
                input.workspaceId,
            );
            if (!st) {
                throw AppError.unprocessable(
                    "task.invalid_status",
                    `${p.statusId} is not a status in this workspace`,
                    [{ field: "patch.status_id", issue: "is not a status in this workspace" }],
                );
            }
            newGroup = st.statusGroup;
        }
        const assigneeAdd = dedupe(p.assigneeAdd);
        if (assigneeAdd.length > 0) {
            const valid = await this.users.findActiveIdsInWorkspace(
                assigneeAdd,
                input.workspaceId,
            );
            const invalid = assigneeAdd.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw AppError.unprocessable(
                    "task.invalid_assignee",
                    "One or more assignees are not active members of this workspace",
                    invalid.map((id) => ({ field: "patch.assignee_add", issue: `${id} is not an active member` })),
                );
            }
        }
        const tagAdd = dedupe(p.tagAdd);
        if (tagAdd.length > 0) {
            const valid = await this.tags.findIdsInWorkspace(
                tagAdd,
                input.workspaceId,
            );
            const invalid = tagAdd.filter((id) => !valid.has(id));
            if (invalid.length > 0) {
                throw AppError.unprocessable(
                    "task.invalid_tag",
                    "One or more tags do not exist in this workspace",
                    invalid.map((id) => ({ field: "patch.tag_add", issue: `${id} is not a tag in this workspace` })),
                );
            }
        }
        const assigneeRemove = dedupe(p.assigneeRemove);
        const tagRemove = dedupe(p.tagRemove);

        // 3. Build the uniform scalar patch (`updated_at` always, so the ETag
        //    bumps even on a membership-only bulk).
        const dbPatch: Partial<NewTask> = { updatedAt: now };
        if (p.statusId !== undefined) dbPatch.statusId = p.statusId;
        if (p.priority !== undefined) dbPatch.priority = p.priority;
        if (p.dueDate !== undefined) dbPatch.dueDate = toLocalDate(p.dueDate);
        if (p.startDate !== undefined)
            dbPatch.startDate = toLocalDate(p.startDate);
        if (p.sprintId !== undefined) dbPatch.sprintId = p.sprintId;
        if (p.archivedAtProvided) {
            dbPatch.archivedAt = p.archivedAt ? new Date(p.archivedAt) : null;
        }
        if (newGroup !== undefined) {
            dbPatch.completedAt = DONE_GROUPS.has(newGroup) ? now : null;
        }

        // 4. Atomic write.
        try {
            await this.db.transaction(async (tx) => {
                await this.tasks.updateMany(ids, dbPatch, tx);
                for (const id of ids) {
                    if (assigneeAdd.length > 0) {
                        await this.membership.addAssignees(
                            id,
                            assigneeAdd,
                            input.actorId,
                            tx,
                        );
                        await this.membership.addWatchers(id, assigneeAdd, tx);
                    }
                    if (assigneeRemove.length > 0)
                        await this.membership.removeAssignees(
                            id,
                            assigneeRemove,
                            tx,
                        );
                    if (tagAdd.length > 0)
                        await this.membership.addTags(id, tagAdd, tx);
                    if (tagRemove.length > 0)
                        await this.membership.removeTags(id, tagRemove, tx);
                }
                await this.activity.recordMany(
                    ids.map((id) => ({
                        taskId: id,
                        actorId: input.actorId,
                        action: "task_updated",
                        context: { bulk: true },
                    })),
                    tx,
                );
            });
        } catch (err) {
            if (isForeignKeyError(err)) {
                throw AppError.unprocessable(
                    "task.invalid_reference",
                    "A referenced sprint or status does not exist",
                );
            }
            throw err;
        }

        // 5. Re-read + batch-hydrate the affected tasks.
        const rows = await this.tasks.findManyByIdsInWorkspace(
            ids,
            input.workspaceId,
        );
        const redactGuest = input.role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasks.assigneesByTask(ids),
                this.tasks.watchersByTask(ids),
                this.tasks.tagsByTask(ids),
                this.tasks.customFieldValuesByTask(ids, redactGuest),
            ]);
        const wireTasks = rows.map((t) =>
            toWireTask(t, {
                assignees: assignees.get(t.id) ?? [],
                watchers: watchers.get(t.id) ?? [],
                tags: tags.get(t.id) ?? [],
                customFieldValues: customFieldValues.get(t.id) ?? {},
            }),
        );

        return { updated: ids.length, tasks: wireTasks };
    }
}

/** Drop nullish + duplicate ids, preserving first-seen order. */
const dedupe = (ids?: string[]): string[] => {
    if (!ids || ids.length === 0) return [];
    return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
};

const NOTIFICATION_TITLE_MAX = 300;
const ASSIGNED_TITLE_PREFIX = "You were assigned to ";
const assignedTitle = (taskName: string): string => {
    const room = NOTIFICATION_TITLE_MAX - ASSIGNED_TITLE_PREFIX.length;
    const name =
        taskName.length > room ? `${taskName.slice(0, room - 1)}…` : taskName;
    return `${ASSIGNED_TITLE_PREFIX}${name}`;
};
