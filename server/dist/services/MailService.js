"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
/**
 * Outbound email — password-reset + workspace-invitation links.
 *
 * Builds a real nodemailer SMTP transport from the mailer config (`Config.SMTP_*`
 * + `EMAIL_FROM*`, which read the `MAIL_*` env vars first). When SMTP is not
 * configured — or under `NODE_ENV=test` — it falls back to a LOG transport: it
 * makes ZERO network calls and just records that a message would have been sent.
 * So dev-without-creds and the whole test suite behave exactly as the old V1
 * stub did; callers/tests depend only on the method contract.
 *
 * Security: reset/invite URLs embed a single-use secret token, so the URL is
 * logged at DEBUG only (off in prod/test); info/error logs carry just the
 * recipient + subject, never the token.
 */
class MailService {
    logger;
    transporter;
    from;
    constructor(logger) {
        this.logger = logger;
        const host = config_1.Config.SMTP_HOST;
        const port = config_1.Config.SMTP_PORT ? Number(config_1.Config.SMTP_PORT) : 587;
        const user = config_1.Config.SMTP_USER;
        const pass = config_1.Config.SMTP_PASS;
        const fromAddress = config_1.Config.EMAIL_FROM || user || "no-reply@localhost";
        const fromName = config_1.Config.EMAIL_FROM_NAME || "BeautyBooth";
        this.from = `${fromName} <${fromAddress}>`;
        // Real SMTP only when fully configured and NOT under test. Otherwise a
        // log transport (no network) — preserves the prior dev/test behaviour.
        const usable = config_1.Config.NODE_ENV !== "test" && Boolean(host && user && pass);
        this.transporter = usable
            ? nodemailer_1.default.createTransport({
                host,
                port,
                // 465 = implicit TLS; 587 / 2525 = STARTTLS upgrade.
                secure: port === 465,
                auth: { user: user, pass: pass },
            })
            : null;
        if (!this.transporter) {
            this.logger.warn("mail.transport.log_only", {
                reason: config_1.Config.NODE_ENV === "test"
                    ? "test env"
                    : "SMTP not configured (set MAIL_* in .env)",
            });
        }
    }
    /** Deliver a password-reset link to `to`. */
    async sendPasswordResetEmail(to, resetUrl) {
        this.logger.debug("mail.password_reset.sending", { to, resetUrl });
        await this.send({
            to,
            subject: "Reset your BeautyBooth password",
            html: resetHtml(resetUrl),
            text: `We received a request to reset your password. Use this single-use link (it expires soon):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
        });
    }
    /** Deliver a workspace-invitation link to `to`. */
    async sendInvitation(to, acceptUrl) {
        this.logger.debug("mail.invitation.sending", { to, acceptUrl });
        await this.send({
            to,
            subject: "You're invited to BeautyBooth",
            html: inviteHtml(acceptUrl),
            text: `You've been invited to join your team's workspace on BeautyBooth. Accept your invitation:\n\n${acceptUrl}`,
        });
    }
    /**
     * Tell `to` they were just assigned a task (2026-08-08 feature). Fired by
     * `TaskEmailService` post-commit for exactly the recipients the in-app
     * `assigned` notification reached — never awaited by a request handler.
     */
    async sendTaskAssignedEmail(to, p) {
        this.logger.debug("mail.task_assigned.sending", {
            to,
            taskUrl: p.taskUrl,
        });
        const dueLine = p.dueYmd ? ` Due date: ${p.dueYmd}.` : "";
        await this.send({
            to,
            subject: `New task assigned: ${subjectName(p.taskName)}`,
            html: taskAssignedHtml(p),
            text: `${p.assignerName} assigned you a task on BeautyBooth Tasks: "${p.taskName}".${dueLine}\n` +
                `আপনাকে একটি নতুন কাজ দেওয়া হয়েছে — দয়া করে দেখে নিন।\n\n${p.taskUrl}`,
        });
    }
    /**
     * Tell `to` their task is past its due date (overdue-alert job). Sent at
     * most once per task per deadline — the job's `overdue_notified_at` claim
     * guarantees it, so this method never needs its own dedupe.
     */
    async sendTaskOverdueEmail(to, p) {
        this.logger.debug("mail.task_overdue.sending", {
            to,
            taskUrl: p.taskUrl,
        });
        await this.send({
            to,
            subject: `Overdue: ${subjectName(p.taskName)}`,
            html: taskOverdueHtml(p),
            text: `Your task "${p.taskName}" passed its due date (${p.dueYmd}) and is still open.\n` +
                `আপনার কাজের নির্ধারিত সময় পার হয়ে গেছে — দয়া করে যত দ্রুত সম্ভব কাজটি শেষ করুন।\n\n${p.taskUrl}`,
        });
    }
    async send(msg) {
        if (!this.transporter) {
            // Log transport — no SMTP configured / test env. No network call.
            this.logger.debug("mail.logged_not_sent", {
                to: msg.to,
                subject: msg.subject,
            });
            return;
        }
        const info = await this.transporter.sendMail({
            from: this.from,
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
        });
        this.logger.info("mail.sent", {
            to: msg.to,
            subject: msg.subject,
            messageId: info.messageId,
        });
    }
}
exports.MailService = MailService;
// ─── HTML templates ───────────────────────────────────────────────────────────
// Inline-styled, table-based layout for broad email-client compatibility.
const shell = (heading, body, cta) => `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
          <tr><td style="height:4px;background:#7c3aed;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#16181d;">${heading}</h1>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#51555c;">${body}</p>
            <a href="${cta.url}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${cta.label}</a>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#8a9099;word-break:break-all;">Or paste this link into your browser:<br>${cta.url}</p>
          </td></tr>
          <tr><td style="padding:16px 32px;border-top:1px solid #eef0f2;font-size:12px;color:#8a9099;">Beauty Booth Bangladesh</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
const resetHtml = (url) => shell("Reset your password", "We received a request to reset your password. Click the button below to choose a new one. This link is single-use and expires soon. If you didn't request it, you can safely ignore this email.", { url, label: "Reset password" });
const inviteHtml = (url) => shell("You're invited", "You've been invited to join your team's workspace on BeautyBooth. Click below to accept the invitation and set up your account.", { url, label: "Accept invitation" });
// Task names (and assigner names) are USER input interpolated into HTML —
// escape them. The reset/invite templates above interpolate only our own URLs.
const escapeHtml = (s) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
/** Subject-line variant of the task name: single line, bounded length. */
const subjectName = (name) => {
    const flat = name.replace(/\s+/g, " ").trim();
    return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};
const taskAssignedHtml = (p) => shell("You have a new task", `<strong>${escapeHtml(p.assignerName)}</strong> assigned you a task on BeautyBooth Tasks:<br>` +
    `<strong>"${escapeHtml(p.taskName)}"</strong>${p.dueYmd ? `<br>Due date: <strong>${escapeHtml(p.dueYmd)}</strong>` : ""}<br><br>` +
    "আপনাকে একটি নতুন কাজ দেওয়া হয়েছে — দয়া করে দেখে নিন।", { url: p.taskUrl, label: "Open task" });
const taskOverdueHtml = (p) => shell("Your task is overdue", `Your task <strong>"${escapeHtml(p.taskName)}"</strong> passed its due date ` +
    `(<strong>${escapeHtml(p.dueYmd)}</strong>) and is still open.<br><br>` +
    "আপনার কাজের নির্ধারিত সময় পার হয়ে গেছে — দয়া করে যত দ্রুত সম্ভব কাজটি শেষ করুন।", { url: p.taskUrl, label: "Open task" });
