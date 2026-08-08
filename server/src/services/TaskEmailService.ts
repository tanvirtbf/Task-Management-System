import type { Logger } from "winston";
import { Config } from "../config";
import logger from "../config/logger";
import { getDb } from "../db/client";
import { UsersRepo } from "../repositories/UsersRepo";
import { MailService } from "./MailService";

/**
 * Email fan-out for task events — the delivery layer BEHIND the in-app
 * notifications, never a replacement for them.
 *
 * Design rules:
 *   - Callers fire-and-forget (`void taskEmails().taskAssigned(...)`) AFTER
 *     their transaction commits: an SMTP round-trip must never sit inside a DB
 *     transaction, and a mail failure must never fail the API request that
 *     triggered it. Every public method catches everything and only logs.
 *   - Recipients are re-resolved from the DB at send time and filtered to
 *     ACTIVE users with an email — a deactivated assignee gets nothing.
 *   - The recipient set mirrors the in-app `assigned` notification exactly
 *     (new assignees minus the actor), so inbox and mailbox always agree.
 *
 * Lazy module singleton (same pattern as `rbac/policy.ts`): routes/services
 * call `taskEmails()` without threading a 15th constructor arg through the
 * three `TaskWriteService` wiring sites. Tests intercept via
 * `jest.spyOn(MailService.prototype, "sendTaskAssignedEmail")` — the
 * established MailService test seam.
 */

/** `/t/:taskKey` resolves by task id (TaskRedirect) — never link custom_id. */
const taskUrlOf = (taskId: string): string =>
    `${Config.FRONTEND_URL ?? ""}/t/${taskId}`;

export interface TaskAssignedEmailInput {
    workspaceId: string;
    taskId: string;
    taskName: string;
    /** Already minus the actor — the same set the in-app fanout notified. */
    recipientIds: string[];
    actorId: string;
    /** Canonical YYYY-MM-DD when the task has a due date (create path). */
    dueYmd?: string | null;
}

export class TaskEmailService {
    constructor(
        private users: UsersRepo,
        private mail: MailService,
        private log: Logger,
    ) {}

    /** Email each newly-assigned user. Never throws; per-recipient isolation. */
    async taskAssigned(input: TaskAssignedEmailInput): Promise<void> {
        try {
            if (input.recipientIds.length === 0) return;
            const ids = [...new Set([...input.recipientIds, input.actorId])];
            const rows = await this.users.findManyByIdsInWorkspace(
                ids,
                input.workspaceId,
            );
            const byId = new Map(rows.map((r) => [r.id, r]));
            const actor = byId.get(input.actorId);
            const assignerName = actor
                ? `${actor.firstName} ${actor.lastName}`.trim() || "A teammate"
                : "A teammate";

            for (const id of input.recipientIds) {
                const u = byId.get(id);
                // Assignment already required active membership; this re-check
                // only guards the race where the user was deactivated since.
                if (!u || u.status !== "active" || !u.email) continue;
                try {
                    await this.mail.sendTaskAssignedEmail(u.email, {
                        taskName: input.taskName,
                        taskUrl: taskUrlOf(input.taskId),
                        assignerName,
                        dueYmd: input.dueYmd ?? null,
                    });
                } catch (err) {
                    this.log.warn("mail.task_assigned.fail", {
                        taskId: input.taskId,
                        userId: id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        } catch (err) {
            this.log.warn("mail.task_assigned.fail", {
                taskId: input.taskId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

export { taskUrlOf };

let instance: TaskEmailService | null = null;

/** The process-wide TaskEmailService (built on first use, after initDb). */
export const taskEmails = (): TaskEmailService => {
    if (!instance) {
        instance = new TaskEmailService(
            new UsersRepo(getDb()),
            new MailService(logger),
            logger,
        );
    }
    return instance;
};
