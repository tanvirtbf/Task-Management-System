"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportStatsService = void 0;
const userSerializer_1 = require("../serializers/userSerializer");
const dhakaTime_1 = require("../utils/dhakaTime");
const freshAcc = () => ({
    assignedOpen: 0,
    overdueNow: 0,
    completed: 0,
    completedLate: 0,
    approvedTasks: new Set(),
    flaggedTasks: new Set(),
    flags: [],
});
const UNASSIGNED = "__unassigned__";
class ReportStatsService {
    reviews;
    tasks;
    users;
    logger;
    constructor(reviews, tasks, users, logger) {
        this.reviews = reviews;
        this.tasks = tasks;
        this.users = users;
        this.logger = logger;
    }
    async computeWeek(input) {
        const { fromUtc, toUtcExclusive } = (0, dhakaTime_1.weekBoundsUtc)(input.weekStart);
        const [pointInTime, totalsNow, completionsBy, completionsTot, actions] = await Promise.all([
            this.reviews.memberSummary(input.spaceId, input.today),
            this.reviews.summaryTotals(input.spaceId, input.today),
            this.reviews.completionsByAssignee(input.spaceId, fromUtc, toUtcExclusive),
            this.reviews.completionsTotals(input.spaceId, fromUtc, toUtcExclusive),
            this.reviews.reviewActionsInWindow(input.spaceId, fromUtc, toUtcExclusive),
        ]);
        // Assignees of every reviewed task (attribution + self_reviewed).
        const reviewedTaskIds = [...new Set(actions.map((a) => a.taskId))];
        const assigneesByTask = await this.tasks.assigneesByTask(reviewedTaskIds);
        // ── Accumulate per member ────────────────────────────────────────────
        const acc = new Map();
        const bucketOf = (userId) => {
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
            ? await this.users.findManyByIdsInWorkspace(reviewerIds, input.workspaceId)
            : [];
        const reviewerById = new Map(reviewers.map((u) => [u.id, u]));
        // Parent breadcrumbs for flagged subtasks.
        const parentIds = [
            ...new Set(actions.flatMap((a) => a.status === "flagged" && a.parentTaskId
                ? [a.parentTaskId]
                : [])),
        ];
        const parents = parentIds.length
            ? await this.tasks.findManyByIdsInWorkspace(parentIds, input.workspaceId)
            : [];
        const parentName = new Map(parents.map((p) => [p.id, p.name]));
        const approvedTasksGlobal = new Set();
        const flaggedTasksGlobal = new Set();
        let selfReviewed = 0;
        for (const action of actions) {
            const taskAssignees = assigneesByTask.get(action.taskId) ?? [];
            if (taskAssignees.includes(action.reviewerId))
                selfReviewed += 1;
            const owners = taskAssignees.length > 0 ? taskAssignees : [null];
            if (action.status === "approved") {
                approvedTasksGlobal.add(action.taskId);
                for (const uid of owners)
                    bucketOf(uid).approvedTasks.add(action.taskId);
            }
            else {
                flaggedTasksGlobal.add(action.taskId);
                const reviewer = reviewerById.get(action.reviewerId) ?? null;
                const entry = {
                    task_id: action.taskId,
                    custom_id: action.customId,
                    task_name: action.taskName,
                    note: action.note,
                    reviewed_at: action.createdAt.toISOString(),
                    reviewer: reviewer ? (0, userSerializer_1.toWireUser)(reviewer) : null,
                    parent_task: action.parentTaskId
                        ? {
                            id: action.parentTaskId,
                            name: parentName.get(action.parentTaskId) ?? "",
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
            ? await this.users.findManyByIdsInWorkspace(memberIds, input.workspaceId)
            : [];
        const memberById = new Map(memberUsers.map((u) => [u.id, u]));
        const rowOf = (key, a) => {
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
        const isAllZero = (r) => r.assigned_open === 0 &&
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
            .sort((x, y) => `${x.user?.first_name} ${x.user?.last_name}`.localeCompare(`${y.user?.first_name} ${y.user?.last_name}`));
        const unassignedAcc = acc.get(UNASSIGNED);
        const unassignedRow = unassignedAcc
            ? rowOf(UNASSIGNED, unassignedAcc)
            : null;
        const members = unassignedRow && !isAllZero(unassignedRow)
            ? [...named, unassignedRow]
            : named;
        const payload = {
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
            weekEnd: (0, dhakaTime_1.addDaysYmd)(input.weekStart, 6),
            members: members.length,
            reviews: actions.length,
        });
        return payload;
    }
}
exports.ReportStatsService = ReportStatsService;
