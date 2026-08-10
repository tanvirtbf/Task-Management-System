"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.overdueAlert = void 0;
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const MailService_1 = require("../services/MailService");
const PushService_1 = require("../services/PushService");
const TaskEmailService_1 = require("../services/TaskEmailService");
const dhakaTime_1 = require("../utils/dhakaTime");
/**
 * §28 overdue-alert (every 10 min): the moment a task's `due_date` has passed
 * on its workspace's OWN calendar, tell every assignee — an in-app `overdue`
 * notification + an email ("your task is past due, please finish it").
 *
 * Semantics:
 *   - "Overdue" = `due_date < today`, where today comes from
 *     `todayInZone(workspaces.timezone)` (the F5 rule — a DATE column holds a
 *     calendar day, and the workspace's zone decides when that day ends). A
 *     task due on the 3rd starts alerting on the first run after midnight of
 *     the 4th, workspace time — with the every-10-min cron that is within
 *     minutes of the deadline passing.
 *   - EXACTLY ONCE per task per deadline: `tasks.overdue_notified_at` is the
 *     claim. It is set in the SAME transaction as the notification insert
 *     (the department_reports.notified_at shape), and `TaskWriteService`
 *     resets it to NULL whenever `due_date` changes — a moved deadline
 *     re-arms the alert; a re-run flips 0 rows (§28 no-double-deliver).
 *   - Only OPEN work alerts: completed / archived tasks are excluded, and so
 *     are tasks with NO assignees — but those stay UNCLAIMED on purpose, so a
 *     task assigned while already overdue alerts on the next tick.
 *   - Emails AND Web Push go out AFTER the claim commits, best-effort, one
 *     failure never blocks the rest (`emailErrors` counts the mail ones;
 *     `PushService` swallows and logs its own). In-app rows are the source of
 *     truth; `createMany` also applies per-user type preferences.
 */
/** Per-workspace per-run cap — bounds one tick's mail burst (SMTP quota). */
const OVERDUE_BATCH_LIMIT = 200;
const OVERDUE_TITLE_PREFIX = "Overdue: ";
const NOTIFICATION_TITLE_MAX = 300; // notifications.title VARCHAR(300)
const overdueTitle = (taskName) => {
    const room = NOTIFICATION_TITLE_MAX - OVERDUE_TITLE_PREFIX.length;
    const name = taskName.length > room ? `${taskName.slice(0, room - 1)}…` : taskName;
    return `${OVERDUE_TITLE_PREFIX}${name}`;
};
/** The YYYY-MM-DD a DATE column round-trips to under the +00:00 driver. */
const ymdOf = (d) => d.toISOString().slice(0, 10);
const overdueAlert = async ({ dryRun, }) => {
    const db = (0, client_1.getDb)();
    const workspaces = new WorkspaceRepo_1.WorkspaceRepo(db);
    const tasksRepo = new TasksRepo_1.TasksRepo(db);
    const usersRepo = new UsersRepo_1.UsersRepo(db);
    const notifications = new NotificationsRepo_1.NotificationsRepo(db);
    const mail = new MailService_1.MailService(logger_1.default);
    let processed = 0;
    let notified = 0;
    let emailsSent = 0;
    let emailErrors = 0;
    let truncated = 0;
    for (const ws of await workspaces.listAll()) {
        const today = (0, dhakaTime_1.todayInZone)(ws.timezone);
        const due = await tasksRepo.findOverdueUnnotified(ws.id, today, OVERDUE_BATCH_LIMIT);
        processed += due.length;
        if (due.length === OVERDUE_BATCH_LIMIT)
            truncated += 1;
        if (due.length === 0 || dryRun)
            continue;
        const assigneeMap = await tasksRepo.assigneesByTask(due.map((t) => t.id));
        const allUserIds = [
            ...new Set(due.flatMap((t) => assigneeMap.get(t.id) ?? [])),
        ];
        const users = await usersRepo.findManyByIdsInWorkspace(allUserIds, ws.id);
        const byId = new Map(users.map((u) => [u.id, u]));
        // Collect the emails while claiming, send after the claims commit.
        const outbox = [];
        for (const task of due) {
            const recipients = (assigneeMap.get(task.id) ?? [])
                .map((id) => byId.get(id))
                .filter((u) => !!u && u.status === "active" && !!u.email);
            // Every current assignee row was inactive/gone — leave the task
            // unclaimed (same rationale as the no-assignee case above).
            if (recipients.length === 0)
                continue;
            // The atomic claim: notification rows + the marker, one tx.
            await db.transaction(async (tx) => {
                await notifications.createMany(recipients.map((u) => ({
                    userId: u.id,
                    type: "overdue",
                    entityType: "task",
                    entityId: task.id,
                    actorId: null, // system-generated, no human actor
                    title: overdueTitle(task.name),
                })), tx);
                await tasksRepo.markOverdueNotified([task.id], tx);
            });
            notified += 1;
            const dueYmd = task.dueDate ? ymdOf(task.dueDate) : today;
            for (const u of recipients) {
                outbox.push({
                    to: u.email,
                    taskName: task.name,
                    taskId: task.id,
                    dueYmd,
                });
            }
            // Web Push to the same recipients' devices (§29c). A no-op when
            // push is unconfigured, and it never throws — a push failure must
            // not abort the run or unwind the claim above.
            await (0, PushService_1.pushSvc)().taskOverdue({
                taskId: task.id,
                taskName: task.name,
                dueYmd,
                recipientIds: recipients.map((u) => u.id),
            });
        }
        for (const m of outbox) {
            try {
                await mail.sendTaskOverdueEmail(m.to, {
                    taskName: m.taskName,
                    taskUrl: (0, TaskEmailService_1.taskUrlOf)(m.taskId),
                    dueYmd: m.dueYmd,
                });
                emailsSent += 1;
            }
            catch (err) {
                emailErrors += 1;
                logger_1.default.warn("mail.task_overdue.fail", {
                    taskId: m.taskId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
    return dryRun
        ? { processed, wouldNotify: processed, truncated }
        : { processed, notified, emailsSent, emailErrors, truncated };
};
exports.overdueAlert = overdueAlert;
