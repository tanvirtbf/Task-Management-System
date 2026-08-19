"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskEmails = exports.taskUrlOf = exports.TaskEmailService = void 0;
const config_1 = require("../config");
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const UsersRepo_1 = require("../repositories/UsersRepo");
const MailService_1 = require("./MailService");
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
const taskUrlOf = (taskId) => `${config_1.Config.FRONTEND_URL ?? ""}/t/${taskId}`;
exports.taskUrlOf = taskUrlOf;
/**
 * The inbox — where the Requests tab lives (team-access P9). Receiver-facing
 * assignment mails link HERE, not the task: until they accept, the task
 * answers 404 for them (B5 — the boundary is the point).
 */
const inboxUrlOf = () => `${config_1.Config.FRONTEND_URL ?? ""}/inbox`;
class TaskEmailService {
    users;
    mail;
    log;
    constructor(users, mail, log) {
        this.users = users;
        this.mail = mail;
        this.log = log;
    }
    /** Email each newly-assigned user. Never throws; per-recipient isolation. */
    async taskAssigned(input) {
        try {
            if (input.recipientIds.length === 0)
                return;
            const ids = [...new Set([...input.recipientIds, input.actorId])];
            const rows = await this.users.findManyByIdsInWorkspace(ids, input.workspaceId);
            const byId = new Map(rows.map((r) => [r.id, r]));
            const actor = byId.get(input.actorId);
            const assignerName = actor
                ? `${actor.firstName} ${actor.lastName}`.trim() || "A teammate"
                : "A teammate";
            for (const id of input.recipientIds) {
                const u = byId.get(id);
                // Assignment already required active membership; this re-check
                // only guards the race where the user was deactivated since.
                if (!u || u.status !== "active" || !u.email)
                    continue;
                try {
                    await this.mail.sendTaskAssignedEmail(u.email, {
                        taskName: input.taskName,
                        taskUrl: taskUrlOf(input.taskId),
                        assignerName,
                        dueYmd: input.dueYmd ?? null,
                    });
                }
                catch (err) {
                    this.log.warn("mail.task_assigned.fail", {
                        taskId: input.taskId,
                        userId: id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
        catch (err) {
            this.log.warn("mail.task_assigned.fail", {
                taskId: input.taskId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Email each user @mentioned in a comment (2026-08-19). Same rules as
     * `taskAssigned`: fire-and-forget post-commit, recipients re-resolved at
     * send time, per-recipient isolation, never throws. Recipients are exactly
     * the visibility-filtered set the in-app `mentioned` notification reached.
     */
    async commentMention(input) {
        try {
            if (input.recipientIds.length === 0)
                return;
            const ids = [...new Set([...input.recipientIds, input.actorId])];
            const rows = await this.users.findManyByIdsInWorkspace(ids, input.workspaceId);
            const byId = new Map(rows.map((r) => [r.id, r]));
            const actor = byId.get(input.actorId);
            const actorName = actor
                ? `${actor.firstName} ${actor.lastName}`.trim() || "A teammate"
                : "A teammate";
            for (const id of input.recipientIds) {
                const u = byId.get(id);
                if (!u || u.status !== "active" || !u.email)
                    continue;
                try {
                    await this.mail.sendMentionEmail(u.email, {
                        actorName,
                        taskName: input.taskName,
                        taskUrl: taskUrlOf(input.taskId),
                        excerpt: input.excerpt,
                    });
                }
                catch (err) {
                    this.log.warn("mail.mention.fail", {
                        taskId: input.taskId,
                        userId: id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
        catch (err) {
            this.log.warn("mail.mention.fail", {
                taskId: input.taskId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Team-access P9 (R1.6): one of the five assignment-approval moments, to
     * exactly the recipients the in-app bell reached. Same rules as
     * `taskAssigned`: fire-and-forget post-commit, re-resolve recipients at
     * send time, per-recipient isolation, never throws. Receiver-facing kinds
     * (`received`, `answer`) link the INBOX; requester-facing kinds link the
     * task.
     */
    async assignmentRequest(input) {
        try {
            if (input.recipientIds.length === 0)
                return;
            const ids = [...new Set([...input.recipientIds, input.actorId])];
            const rows = await this.users.findManyByIdsInWorkspace(ids, input.workspaceId);
            const byId = new Map(rows.map((r) => [r.id, r]));
            const actor = byId.get(input.actorId);
            const actorName = actor
                ? `${actor.firstName} ${actor.lastName}`.trim() || "A teammate"
                : "A teammate";
            const url = input.kind === "received" || input.kind === "answer"
                ? inboxUrlOf()
                : taskUrlOf(input.taskId);
            for (const id of input.recipientIds) {
                const u = byId.get(id);
                if (!u || u.status !== "active" || !u.email)
                    continue;
                try {
                    await this.mail.sendAssignmentRequestEmail(u.email, {
                        kind: input.kind,
                        taskName: input.taskName,
                        url,
                        actorName,
                        note: input.note ?? null,
                        proposedYmd: input.proposedYmd ?? null,
                    });
                }
                catch (err) {
                    this.log.warn("mail.assignment_request.fail", {
                        taskId: input.taskId,
                        kind: input.kind,
                        userId: id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
        catch (err) {
            this.log.warn("mail.assignment_request.fail", {
                taskId: input.taskId,
                kind: input.kind,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
exports.TaskEmailService = TaskEmailService;
let instance = null;
/** The process-wide TaskEmailService (built on first use, after initDb). */
const taskEmails = () => {
    if (!instance) {
        instance = new TaskEmailService(new UsersRepo_1.UsersRepo((0, client_1.getDb)()), new MailService_1.MailService(logger_1.default), logger_1.default);
    }
    return instance;
};
exports.taskEmails = taskEmails;
