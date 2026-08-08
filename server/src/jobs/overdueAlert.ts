import logger from "../config/logger";
import { getDb } from "../db/client";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { MailService } from "../services/MailService";
import { taskUrlOf } from "../services/TaskEmailService";
import { todayInZone } from "../utils/dhakaTime";
import type { JobContext, JobOutcome } from "./types";

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
 *   - Emails go out AFTER the claim commits, best-effort, one failure never
 *     blocks the rest (`emailErrors` counts them). In-app rows are the source
 *     of truth; `createMany` also applies per-user type preferences.
 */

/** Per-workspace per-run cap — bounds one tick's mail burst (SMTP quota). */
const OVERDUE_BATCH_LIMIT = 200;

const OVERDUE_TITLE_PREFIX = "Overdue: ";
const NOTIFICATION_TITLE_MAX = 300; // notifications.title VARCHAR(300)
const overdueTitle = (taskName: string): string => {
    const room = NOTIFICATION_TITLE_MAX - OVERDUE_TITLE_PREFIX.length;
    const name =
        taskName.length > room ? `${taskName.slice(0, room - 1)}…` : taskName;
    return `${OVERDUE_TITLE_PREFIX}${name}`;
};

/** The YYYY-MM-DD a DATE column round-trips to under the +00:00 driver. */
const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

export const overdueAlert = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const db = getDb();
    const workspaces = new WorkspaceRepo(db);
    const tasksRepo = new TasksRepo(db);
    const usersRepo = new UsersRepo(db);
    const notifications = new NotificationsRepo(db);
    const mail = new MailService(logger);

    let processed = 0;
    let notified = 0;
    let emailsSent = 0;
    let emailErrors = 0;
    let truncated = 0;

    for (const ws of await workspaces.listAll()) {
        const today = todayInZone(ws.timezone);
        const due = await tasksRepo.findOverdueUnnotified(
            ws.id,
            today,
            OVERDUE_BATCH_LIMIT,
        );
        processed += due.length;
        if (due.length === OVERDUE_BATCH_LIMIT) truncated += 1;
        if (due.length === 0 || dryRun) continue;

        const assigneeMap = await tasksRepo.assigneesByTask(
            due.map((t) => t.id),
        );
        const allUserIds = [
            ...new Set(due.flatMap((t) => assigneeMap.get(t.id) ?? [])),
        ];
        const users = await usersRepo.findManyByIdsInWorkspace(
            allUserIds,
            ws.id,
        );
        const byId = new Map(users.map((u) => [u.id, u]));

        // Collect the emails while claiming, send after the claims commit.
        const outbox: Array<{
            to: string;
            taskName: string;
            taskId: string;
            dueYmd: string;
        }> = [];

        for (const task of due) {
            const recipients = (assigneeMap.get(task.id) ?? [])
                .map((id) => byId.get(id))
                .filter(
                    (u): u is NonNullable<typeof u> =>
                        !!u && u.status === "active" && !!u.email,
                );
            // Every current assignee row was inactive/gone — leave the task
            // unclaimed (same rationale as the no-assignee case above).
            if (recipients.length === 0) continue;

            // The atomic claim: notification rows + the marker, one tx.
            await db.transaction(async (tx) => {
                await notifications.createMany(
                    recipients.map((u) => ({
                        userId: u.id,
                        type: "overdue" as const,
                        entityType: "task" as const,
                        entityId: task.id,
                        actorId: null, // system-generated, no human actor
                        title: overdueTitle(task.name),
                    })),
                    tx,
                );
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
        }

        for (const m of outbox) {
            try {
                await mail.sendTaskOverdueEmail(m.to, {
                    taskName: m.taskName,
                    taskUrl: taskUrlOf(m.taskId),
                    dueYmd: m.dueYmd,
                });
                emailsSent += 1;
            } catch (err) {
                emailErrors += 1;
                logger.warn("mail.task_overdue.fail", {
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
