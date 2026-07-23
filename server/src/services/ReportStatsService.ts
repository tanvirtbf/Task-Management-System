import type { Logger } from "winston";
import type { ReviewsRepo } from "../repositories/ReviewsRepo";
import type { TasksRepo } from "../repositories/TasksRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import { toWireUser, type WireUser } from "../serializers/userSerializer";
import { addDaysYmd, weekBoundsUtc } from "../utils/dhakaTime";

/**
 * Dept Review V1 — P18: the weekly report payload computer.
 *
 * `computeWeek` produces the §3-locked `department_reports.payload` snapshot
 * for one (space, Dhaka-week). Deterministic given the DB state: all
 * WEEK-WINDOW stats filter app-UTC instants against the fixed-offset Dhaka
 * bounds; POINT-IN-TIME stats (`assigned_open`, `overdue_now`,
 * `done_unreviewed`) are at-GENERATION snapshots (the report page shows
 * `generated_at` beside them). Set-based repo aggregates only — O(constant
 * queries per space), never per-member loops (§5 rule 12).
 *
 * Semantics (locked in the plan, enforced by the P18 unit matrix):
 * - member rows are PER-ASSIGNEE; `totals` are task-level DEDUPED (never the
 *   sum of member rows); the NULL-assignee bucket is the synthetic
 *   "Unassigned" row (omitted when all-zero);
 * - `approved`/`flagged` count DISTINCT tasks that received that verdict in
 *   the window; `flags[]` lists every flag ACTION (the systematic record);
 * - `reviews_done` is DEPARTMENT-level (any reviewer); `self_reviewed` =
 *   actions whose reviewer is currently an assignee of the reviewed task;
 * - `completed_late` = the completion's Dhaka calendar day fell after
 *   `due_date`;
 * - `prev_week` is COPIED from the previous week's stored row (null-safe) —
 *   never recomputed.
 */

// ─── Payload wire shapes (snake_case — stored as-is in the JSON column) ──────

export interface ReportUserRef {
    id: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    /** false = deactivated (history, not an actionable member — H-10). */
    is_active: boolean;
}

export interface ReportFlagEntry {
    task_id: string;
    custom_id: string | null;
    task_name: string;
    note: string | null;
    reviewed_at: string;
    reviewer: WireUser | null;
    parent_task: { id: string; name: string } | null;
}

export interface ReportMemberRow {
    /** null = the synthetic "Unassigned" row. */
    user: ReportUserRef | null;
    assigned_open: number;
    completed: number;
    completed_late: number;
    overdue_now: number;
    approved: number;
    flagged: number;
    flags: ReportFlagEntry[];
}

export interface ReportTotals {
    completed: number;
    completed_late: number;
    overdue_now: number;
    approved: number;
    flagged: number;
    done_unreviewed: number;
}

export interface DeptReportPayload {
    members: ReportMemberRow[];
    totals: ReportTotals;
    head_accountability: {
        reviews_done: number;
        self_reviewed: number;
        done_unreviewed_at_generation: number;
    };
    prev_week: { completed: number; overdue_now: number } | null;
    [key: string]: unknown; // JSON-column compatibility
}

export interface ComputeWeekInput {
    spaceId: string;
    workspaceId: string;
    /** Dhaka Monday (`YYYY-MM-DD`) — the caller validates Monday-ness. */
    weekStart: string;
    /** Point-in-time "today" (Dhaka `YYYY-MM-DD`), injected for determinism. */
    today: string;
    /** Totals copied from the PREVIOUS week's stored row; null when absent. */
    prevTotals: { completed: number; overdue_now: number } | null;
}

interface MemberAccumulator {
    assignedOpen: number;
    overdueNow: number;
    completed: number;
    completedLate: number;
    approvedTasks: Set<string>;
    flaggedTasks: Set<string>;
    flags: ReportFlagEntry[];
}

const freshAcc = (): MemberAccumulator => ({
    assignedOpen: 0,
    overdueNow: 0,
    completed: 0,
    completedLate: 0,
    approvedTasks: new Set(),
    flaggedTasks: new Set(),
    flags: [],
});

const UNASSIGNED = "__unassigned__";

export class ReportStatsService {
    constructor(
        private reviews: ReviewsRepo,
        private tasks: TasksRepo,
        private users: UsersRepo,
        private logger: Logger,
    ) {}

    async computeWeek(input: ComputeWeekInput): Promise<DeptReportPayload> {
        const { fromUtc, toUtcExclusive } = weekBoundsUtc(input.weekStart);

        const [pointInTime, totalsNow, completionsBy, completionsTot, actions] =
            await Promise.all([
                this.reviews.memberSummary(input.spaceId, input.today),
                this.reviews.summaryTotals(input.spaceId, input.today),
                this.reviews.completionsByAssignee(
                    input.spaceId,
                    fromUtc,
                    toUtcExclusive,
                ),
                this.reviews.completionsTotals(
                    input.spaceId,
                    fromUtc,
                    toUtcExclusive,
                ),
                this.reviews.reviewActionsInWindow(
                    input.spaceId,
                    fromUtc,
                    toUtcExclusive,
                ),
            ]);

        // Assignees of every reviewed task (attribution + self_reviewed).
        const reviewedTaskIds = [...new Set(actions.map((a) => a.taskId))];
        const assigneesByTask = await this.tasks.assigneesByTask(
            reviewedTaskIds,
        );

        // ── Accumulate per member ────────────────────────────────────────────
        const acc = new Map<string, MemberAccumulator>();
        const bucketOf = (userId: string | null): MemberAccumulator => {
            const key = userId ?? UNASSIGNED;
            let a = acc.get(key);
            if (!a) {
                a = freshAcc();
                acc.set(key, a);
            }
            return a;
        };

        for (const row of pointInTime) {
            const a = bucketOf(row.userId);
            a.assignedOpen = row.open;
            a.overdueNow = row.overdue;
        }
        for (const row of completionsBy) {
            const a = bucketOf(row.userId);
            a.completed = row.completed;
            a.completedLate = row.completedLate;
        }

        // Reviewer hydration for flags[] (batched, no N+1).
        const reviewerIds = [...new Set(actions.map((a) => a.reviewerId))];
        const reviewers = reviewerIds.length
            ? await this.users.findManyByIdsInWorkspace(
                  reviewerIds,
                  input.workspaceId,
              )
            : [];
        const reviewerById = new Map(reviewers.map((u) => [u.id, u]));

        // Parent breadcrumbs for flagged subtasks.
        const parentIds = [
            ...new Set(
                actions.flatMap((a) =>
                    a.status === "flagged" && a.parentTaskId
                        ? [a.parentTaskId]
                        : [],
                ),
            ),
        ];
        const parents = parentIds.length
            ? await this.tasks.findManyByIdsInWorkspace(
                  parentIds,
                  input.workspaceId,
              )
            : [];
        const parentName = new Map(parents.map((p) => [p.id, p.name]));

        const approvedTasksGlobal = new Set<string>();
        const flaggedTasksGlobal = new Set<string>();
        let selfReviewed = 0;

        for (const action of actions) {
            const taskAssignees = assigneesByTask.get(action.taskId) ?? [];
            if (taskAssignees.includes(action.reviewerId)) selfReviewed += 1;

            const owners: Array<string | null> =
                taskAssignees.length > 0 ? taskAssignees : [null];

            if (action.status === "approved") {
                approvedTasksGlobal.add(action.taskId);
                for (const uid of owners)
                    bucketOf(uid).approvedTasks.add(action.taskId);
            } else {
                flaggedTasksGlobal.add(action.taskId);
                const reviewer = reviewerById.get(action.reviewerId) ?? null;
                const entry: ReportFlagEntry = {
                    task_id: action.taskId,
                    custom_id: action.customId,
                    task_name: action.taskName,
                    note: action.note,
                    reviewed_at: action.createdAt.toISOString(),
                    reviewer: reviewer ? toWireUser(reviewer) : null,
                    parent_task: action.parentTaskId
                        ? {
                              id: action.parentTaskId,
                              name:
                                  parentName.get(action.parentTaskId) ?? "",
                          }
                        : null,
                };
                for (const uid of owners) {
                    const a = bucketOf(uid);
                    a.flaggedTasks.add(action.taskId);
                    a.flags.push(entry);
                }
            }
        }

        // ── Hydrate + assemble member rows ───────────────────────────────────
        const memberIds = [...acc.keys()].filter((k) => k !== UNASSIGNED);
        const memberUsers = memberIds.length
            ? await this.users.findManyByIdsInWorkspace(
                  memberIds,
                  input.workspaceId,
              )
            : [];
        const memberById = new Map(memberUsers.map((u) => [u.id, u]));

        const rowOf = (
            key: string,
            a: MemberAccumulator,
        ): ReportMemberRow => {
            const u = key === UNASSIGNED ? null : memberById.get(key);
            return {
                user: u
                    ? {
                          id: u.id,
                          first_name: u.firstName,
                          last_name: u.lastName,
                          avatar_url: u.avatarUrl,
                          is_active: u.status === "active",
                      }
                    : null,
                assigned_open: a.assignedOpen,
                completed: a.completed,
                completed_late: a.completedLate,
                overdue_now: a.overdueNow,
                approved: a.approvedTasks.size,
                flagged: a.flaggedTasks.size,
                flags: a.flags,
            };
        };

        const isAllZero = (r: ReportMemberRow): boolean =>
            r.assigned_open === 0 &&
            r.completed === 0 &&
            r.completed_late === 0 &&
            r.overdue_now === 0 &&
            r.approved === 0 &&
            r.flagged === 0 &&
            r.flags.length === 0;

        const named = [...acc.entries()]
            .filter(([k]) => k !== UNASSIGNED)
            .map(([k, a]) => rowOf(k, a))
            .filter((r) => !isAllZero(r))
            .sort((x, y) =>
                `${x.user?.first_name} ${x.user?.last_name}`.localeCompare(
                    `${y.user?.first_name} ${y.user?.last_name}`,
                ),
            );
        const unassignedAcc = acc.get(UNASSIGNED);
        const unassignedRow = unassignedAcc
            ? rowOf(UNASSIGNED, unassignedAcc)
            : null;
        const members =
            unassignedRow && !isAllZero(unassignedRow)
                ? [...named, unassignedRow]
                : named;

        const payload: DeptReportPayload = {
            members,
            totals: {
                completed: completionsTot.completed,
                completed_late: completionsTot.completedLate,
                overdue_now: totalsNow.overdue,
                approved: approvedTasksGlobal.size,
                flagged: flaggedTasksGlobal.size,
                done_unreviewed: totalsNow.doneUnreviewed,
            },
            head_accountability: {
                reviews_done: actions.length,
                self_reviewed: selfReviewed,
                done_unreviewed_at_generation: totalsNow.doneUnreviewed,
            },
            prev_week: input.prevTotals,
        };

        this.logger.debug("report.compute.ok", {
            spaceId: input.spaceId,
            weekStart: input.weekStart,
            weekEnd: addDaysYmd(input.weekStart, 6),
            members: members.length,
            reviews: actions.length,
        });
        return payload;
    }
}