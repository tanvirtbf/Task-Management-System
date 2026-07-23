import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { DONE_STATUS_GROUPS } from "../db/schema/_shared";
import { AppError } from "../errors";
import type { SpaceRecord, SpacesRepo } from "../repositories/SpacesRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type {
    MemberSummaryRow,
    QueueBucket,
    ReviewsRepo,
    SummaryTotals,
    TaskReviewRecord,
} from "../repositories/ReviewsRepo";
import { toWireTask } from "../serializers/taskSerializer";
import {
    type WireQueueRow,
    type WireReviewSummary,
} from "../serializers/reviewSerializer";
import { toWireUser } from "../serializers/userSerializer";
import { dhakaToday } from "../utils/dhakaTime";
import type { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import type { NotificationsRepo } from "../repositories/NotificationsRepo";
import type { UserListRow, UsersRepo } from "../repositories/UsersRepo";
import { Roles, type Role } from "../constants";

/**
 * Dept Review V1 — review-domain business logic (DEPARTMENT_REVIEW_PLAN.md).
 *
 * P6 ships the shared authorization guard; P8/P10/P11 grow the service with
 * the review write/read paths on top of it.
 *
 * Guard style is deliberately SERVICE-LEVEL, not middleware: this repo resolves
 * resources and enforces row-level rules inside services (the
 * `ChecklistsService.requireChecklist` / `FormsService.requireForm` pattern).
 * No middleware in the codebase touches the DB, and this feature keeps that
 * invariant.
 */

/** The `req.auth`-derived identity a guard call needs. */
export interface SpaceGuardInput {
    spaceId: string;
    workspaceId: string;
    /** Caller's user id (`req.auth.sub`). */
    userId: string;
    /** Caller's workspace role (`req.auth.role`). */
    role: Role;
}

/**
 * True when `userId` is the department head of the (already-resolved) space.
 * Pure + narrow on purpose so later phases (queue scoping, report recipients)
 * can reuse it without a service instance.
 */
export const isHeadOfSpace = (
    userId: string,
    space: Pick<SpaceRecord, "headUserId">,
): boolean => space.headUserId !== null && space.headUserId === userId;

/** Input for `POST /api/v1/tasks/:id/review` (A-4). */
export interface ReviewTaskInput {
    /** Task id OR custom_id from the path (resolved once; the resolved
     *  `task.id` is used for every subsequent write — the C5 lesson). */
    taskIdOrKey: string;
    workspaceId: string;
    actorId: string;
    role: Role;
    status: "approved" | "flagged";
    note: string | null;
}

/** A-3 queue paging (mirrors the TasksService constants + codec — the plan's
 *  documented "3rd private cursor codec"; lift to a shared util only when a
 *  4th appears). */
const QUEUE_DEFAULT_LIMIT = 50;
const QUEUE_MAX_LIMIT = 200;

const clampQueueLimit = (raw?: number): number => {
    if (raw === undefined || !Number.isFinite(raw)) return QUEUE_DEFAULT_LIMIT;
    return Math.min(Math.max(Math.trunc(raw), 1), QUEUE_MAX_LIMIT);
};

const encodeQueueCursor = (internalId: bigint): string =>
    Buffer.from(internalId.toString(), "utf8").toString("base64url");

const decodeQueueCursor = (cursor: string): bigint => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "Malformed pagination cursor",
        );
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "Malformed pagination cursor",
        );
    }
    return BigInt(decoded);
};

/** Notification title, capped well under the 300-char column. */
const reviewTitle = (
    status: "approved" | "flagged",
    taskName: string,
): string =>
    `${status === "approved" ? "Task approved" : "Task flagged"}: ${taskName}`.slice(
        0,
        300,
    );

export class ReviewsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private spaces: SpacesRepo,
        private tasks: TasksRepo,
        private reviews: ReviewsRepo,
        private activity: TaskActivityRepo,
        private notifications: NotificationsRepo,
        private users: UsersRepo,
        private logger: Logger,
    ) {}

    /**
     * Resolve a space and authorize a review-domain action on it. Check order
     * (per plan §3, mirroring the spec's status precedence):
     *
     *   1. space resolved within the CALLER'S workspace — absent or foreign id
     *      → `404 space.not_found` (no cross-tenant existence oracle);
     *   2. archived space → `409 space.archived` (review actions target live
     *      departments; this outranks the role check so even an admin gets the
     *      truthful "archived" answer);
     *   3. owner/admin pass; otherwise the caller must be the space's head →
     *      else `403 review.not_head`.
     *
     * Returns the resolved `SpaceRecord` so callers never re-fetch it.
     */
    async requireHeadOrAdmin(input: SpaceGuardInput): Promise<SpaceRecord> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (space.archivedAt) {
            throw AppError.conflict(
                "space.archived",
                "This space is archived; review actions need a live department",
            );
        }
        if (input.role === Roles.OWNER || input.role === Roles.ADMIN) {
            return space;
        }
        if (isHeadOfSpace(input.userId, space)) {
            return space;
        }
        this.logger.debug("review.guard.denied", {
            spaceId: input.spaceId,
            userId: input.userId,
            role: input.role,
        });
        throw AppError.forbidden(
            "review.not_head",
            "Only the department head (or an owner/admin) may do this",
        );
    }

    /**
     * Review a completed task — approve ✓ or flag ⚑ (A-4).
     *
     * Flow: resolve the task (id OR custom_id; every write uses the RESOLVED
     * id — the C5 lesson) → derive its space LIVE via `primary_list_id →
     * lists.space_id` (never the snapshot columns) → `requireHeadOrAdmin`
     * (404/409 space.archived/403) → fast done pre-check → transaction:
     * `lockById` + RE-CHECK archived/done under the lock (a concurrent
     * status write either committed before the lock — we see it — or blocks
     * on the task row), then atomically: append the ledger row (app-UTC
     * `created_at`) + update the task's denorm trio + `task_reviewed`
     * activity + notifications to the task's assignees (reviewer excluded —
     * no self-notification; guest assignees included, consistent with the
     * existing fanouts).
     *
     * Repeat reviews are ALLOWED and are the undo story: the denorm reflects
     * the LATEST verdict, history keeps every row. The denorm update also
     * bumps `tasks.updated_at` (ETag) — by design.
     */
    async reviewTask(input: ReviewTaskInput): Promise<TaskReviewRecord> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskIdOrKey,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskIdOrKey} does not exist`,
            );
        }
        if (task.archivedAt) {
            throw AppError.conflict(
                "task.archived",
                "An archived task cannot be reviewed",
            );
        }

        const listSpace = await this.reviews.getListSpace(task.primaryListId);
        if (!listSpace) {
            // Unreachable: primary_list_id is a NOT-NULL RESTRICT FK.
            throw AppError.internal();
        }
        const space = await this.requireHeadOrAdmin({
            spaceId: listSpace.spaceId,
            workspaceId: input.workspaceId,
            userId: input.actorId,
            role: input.role,
        });

        // Fast pre-check outside the tx (cheap 409 before taking the lock).
        const pre = await this.reviews.taskStateForReview(task.id);
        if (!pre || !DONE_STATUS_GROUPS.has(pre.statusGroup)) {
            throw AppError.conflict(
                "review.not_completed",
                "Only a task in a done status can be reviewed",
            );
        }

        const now = new Date();
        const review = await this.db.transaction(async (tx) => {
            await this.tasks.lockById(task.id, tx);
            const state = await this.reviews.taskStateForReview(task.id, tx);
            if (!state) {
                throw AppError.notFound(
                    "task.not_found",
                    `Task ${input.taskIdOrKey} does not exist`,
                );
            }
            if (state.archivedAt) {
                throw AppError.conflict(
                    "task.archived",
                    "An archived task cannot be reviewed",
                );
            }
            if (!DONE_STATUS_GROUPS.has(state.statusGroup)) {
                throw AppError.conflict(
                    "review.not_completed",
                    "Only a task in a done status can be reviewed",
                );
            }

            const created = await this.reviews.insert(
                {
                    workspaceId: input.workspaceId,
                    spaceId: space.id,
                    taskId: task.id,
                    reviewerId: input.actorId,
                    status: input.status,
                    note: input.note,
                    createdAt: now,
                },
                tx,
            );
            await this.tasks.update(
                task.id,
                {
                    reviewStatus: input.status,
                    reviewedAt: now,
                    reviewedBy: input.actorId,
                },
                tx,
            );
            await this.activity.recordMany(
                [
                    {
                        taskId: task.id,
                        actorId: input.actorId,
                        action: "task_reviewed",
                        context: {
                            review_id: created.id,
                            status: input.status,
                            space_id: space.id,
                            ...(input.note ? { note: input.note } : {}),
                        },
                    },
                ],
                tx,
            );
            // Assignee set is stable here: every membership writer takes the
            // same task row lock first.
            const assignees =
                (await this.tasks.assigneesByTask([task.id])).get(task.id) ??
                [];
            const recipients = assignees.filter((id) => id !== input.actorId);
            await this.notifications.createMany(
                recipients.map((userId) => ({
                    userId,
                    type: "task_reviewed" as const,
                    entityType: "task" as const,
                    entityId: task.id,
                    actorId: input.actorId,
                    title: reviewTitle(input.status, task.name),
                    body: input.note,
                })),
                tx,
            );
            return created;
        });

        this.logger.info("review.created", {
            reviewId: review.id,
            taskId: task.id,
            spaceId: space.id,
            status: input.status,
            reviewerId: input.actorId,
        });
        return review;
    }

    /**
     * Review history of a task (A-5), newest-first with hydrated reviewers.
     *
     * Readable by owner/admin, the department head of the task's space, and
     * the task's ASSIGNEES (D-5 transparency — a flagged assignee reads the
     * note). Everyone else → 403 `review.forbidden`. Archived tasks stay
     * readable — history is history; the space-archived 409 applies to WRITE
     * actions only.
     */
    async listTaskReviews(input: {
        taskIdOrKey: string;
        workspaceId: string;
        userId: string;
        role: Role;
    }): Promise<Array<TaskReviewRecord & { reviewer: UserListRow | null }>> {
        const task = await this.tasks.findByIdOrCustomIdInWorkspace(
            input.taskIdOrKey,
            input.workspaceId,
        );
        if (!task) {
            throw AppError.notFound(
                "task.not_found",
                `Task ${input.taskIdOrKey} does not exist`,
            );
        }

        const isAdmin =
            input.role === Roles.OWNER || input.role === Roles.ADMIN;
        if (!isAdmin) {
            const assignees =
                (await this.tasks.assigneesByTask([task.id])).get(task.id) ??
                [];
            let allowed = assignees.includes(input.userId);
            if (!allowed) {
                const listSpace = await this.reviews.getListSpace(
                    task.primaryListId,
                );
                if (listSpace) {
                    const space = await this.spaces.findByIdInWorkspace(
                        listSpace.spaceId,
                        input.workspaceId,
                    );
                    allowed = !!space && isHeadOfSpace(input.userId, space);
                }
            }
            if (!allowed) {
                throw AppError.forbidden(
                    "review.forbidden",
                    "Only the department head, an owner/admin, or a task assignee may view its reviews",
                );
            }
        }

        const rows = await this.reviews.listByTask(task.id);
        const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))];
        const reviewers = reviewerIds.length
            ? await this.users.findManyByIdsInWorkspace(
                  reviewerIds,
                  input.workspaceId,
              )
            : [];
        const byId = new Map(reviewers.map((u) => [u.id, u]));
        return rows.map((r) => ({
            ...r,
            reviewer: byId.get(r.reviewerId) ?? null,
        }));
    }

    /**
     * A-2 — per-member department rollup + task-level totals for `/dept`.
     *
     * Member rows are PER-ASSIGNEE (a 2-assignee task counts in both rows);
     * `totals` is an independent task-level query — the UI must never sum the
     * member rows (H-3). The NULL-assignee group becomes the synthetic
     * "Unassigned" row, sorted last (H-4). Deactivated members surface via
     * `user.status`. `last_activity` = the member's latest task_activity in
     * this space — DB-clock domain, display-only (H-7e).
     */
    async reviewSummary(input: SpaceGuardInput): Promise<WireReviewSummary> {
        const space = await this.requireHeadOrAdmin(input);
        const today = dhakaToday();

        const [memberRows, totals]: [MemberSummaryRow[], SummaryTotals] =
            await Promise.all([
                this.reviews.memberSummary(space.id, today),
                this.reviews.summaryTotals(space.id, today),
            ]);

        const memberIds = memberRows.flatMap((r) =>
            r.userId ? [r.userId] : [],
        );
        const [usersById, lastActivity] = await Promise.all([
            memberIds.length
                ? this.users
                      .findManyByIdsInWorkspace(memberIds, input.workspaceId)
                      .then(
                          (us) => new Map(us.map((u) => [u.id, u] as const)),
                      )
                : Promise.resolve(new Map<string, UserListRow>()),
            this.reviews.lastActivityByActors(space.id, memberIds),
        ]);

        const decorated = memberRows.map((r) => ({
            row: r,
            user: r.userId ? (usersById.get(r.userId) ?? null) : null,
        }));
        decorated.sort((a, b) => {
            if (!a.user && !b.user) return 0;
            if (!a.user) return 1; // Unassigned last
            if (!b.user) return -1;
            return `${a.user.firstName} ${a.user.lastName}`.localeCompare(
                `${b.user.firstName} ${b.user.lastName}`,
            );
        });

        return {
            space_id: space.id,
            members: decorated.map(({ row, user }) => ({
                user: user ? toWireUser(user) : null,
                open: row.open,
                due_today: row.dueToday,
                overdue: row.overdue,
                done_unreviewed: row.doneUnreviewed,
                flagged: row.flagged,
                last_activity:
                    row.userId && lastActivity.get(row.userId)
                        ? lastActivity.get(row.userId)!.toISOString()
                        : null,
            })),
            totals: {
                open: totals.open,
                due_today: totals.dueToday,
                overdue: totals.overdue,
                done_unreviewed: totals.doneUnreviewed,
                flagged: totals.flagged,
            },
        };
    }

    /**
     * A-3 — one keyset page of a review-queue bucket. Rows are the standard
     * wire `Task` (same 4-batch hydration as `TasksService.listByList` — the
     * guard admits only head/owner/admin, so guest redaction never applies)
     * plus the current review and a parent breadcrumb for subtasks.
     */
    async reviewQueue(input: {
        spaceId: string;
        workspaceId: string;
        userId: string;
        role: Role;
        bucket: QueueBucket;
        memberId?: string;
        cursor?: string;
        limit?: number;
    }): Promise<{
        data: WireQueueRow[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
    }> {
        const space = await this.requireHeadOrAdmin(input);
        const limit = clampQueueLimit(input.limit);
        const today = dhakaToday();
        const afterInternalId = input.cursor
            ? decodeQueueCursor(input.cursor)
            : undefined;

        const [rows, total] = await Promise.all([
            this.reviews.queuePage({
                spaceId: space.id,
                bucket: input.bucket,
                today,
                memberId: input.memberId,
                afterInternalId,
                limit: limit + 1,
            }),
            this.reviews.queueCount({
                spaceId: space.id,
                bucket: input.bucket,
                today,
                memberId: input.memberId,
            }),
        ]);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const taskIds = page.map((t) => t.id);

        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasks.assigneesByTask(taskIds),
                this.tasks.watchersByTask(taskIds),
                this.tasks.tagsByTask(taskIds),
                this.tasks.customFieldValuesByTask(taskIds, false),
            ]);

        const parentIds = [
            ...new Set(page.flatMap((t) => (t.parentTaskId ? [t.parentTaskId] : []))),
        ];
        const parents = parentIds.length
            ? await this.tasks.findManyByIdsInWorkspace(
                  parentIds,
                  input.workspaceId,
              )
            : [];
        const parentName = new Map(parents.map((p) => [p.id, p.name]));

        const data: WireQueueRow[] = page.map((t) => ({
            ...toWireTask(t, {
                assignees: assignees.get(t.id) ?? [],
                watchers: watchers.get(t.id) ?? [],
                tags: tags.get(t.id) ?? [],
                customFieldValues: customFieldValues.get(t.id) ?? {},
            }),
            review: t.reviewStatus
                ? {
                      status: t.reviewStatus,
                      reviewed_at: t.reviewedAt
                          ? t.reviewedAt.toISOString()
                          : null,
                      reviewed_by: t.reviewedBy,
                  }
                : null,
            parent_task: t.parentTaskId
                ? {
                      id: t.parentTaskId,
                      name: parentName.get(t.parentTaskId) ?? "",
                  }
                : null,
        }));

        const last = page[page.length - 1];
        const nextCursor =
            hasMore && last ? encodeQueueCursor(last.internalId) : null;
        return { data, nextCursor, hasMore, total };
    }
}
