import type { Logger } from "winston";
import { Config } from "../config";

/**
 * Outbound email — password-reset + workspace-invitation links.
 *
 * Delivers through the Mailtrap REST API (`POST /api/send`) via plain `fetch`
 * — the Workers-compatible replacement for the old nodemailer SMTP transport.
 * The API token is `Config.SMTP_PASS` (which reads the `MAIL_PASSWORD` env var
 * first), and the sender comes from `EMAIL_FROM*` (`MAIL_FROM_*` env vars).
 * When the token is not configured — or under `NODE_ENV=test` — it falls back
 * to a LOG transport: it makes ZERO network calls and just records that a
 * message would have been sent. So dev-without-creds and the whole test suite
 * behave exactly as the old V1 stub did; callers/tests depend only on the
 * method contract.
 *
 * Security: reset/invite URLs embed a single-use secret token, so the URL is
 * logged at DEBUG only (off in prod/test); info/error logs carry just the
 * recipient + subject, never the token.
 */

const MAILTRAP_SEND_URL = "https://send.api.mailtrap.io/api/send";

export class MailService {
    /** `null` ⇒ log-only transport (no creds / test env — no network calls). */
    private readonly apiToken: string | null;
    private readonly fromAddress: string;
    private readonly fromName: string;

    constructor(private logger: Logger) {
        const user = Config.SMTP_USER;
        const pass = Config.SMTP_PASS;
        this.fromAddress = Config.EMAIL_FROM || user || "no-reply@localhost";
        this.fromName = Config.EMAIL_FROM_NAME || "BeautyBooth";

        // Real delivery only when the API token is configured and NOT under
        // test. Otherwise a log transport (no network) — preserves the prior
        // dev/test behaviour.
        const usable = Config.NODE_ENV !== "test" && Boolean(pass);
        this.apiToken = usable ? (pass as string) : null;

        if (!this.apiToken) {
            this.logger.warn("mail.transport.log_only", {
                reason:
                    Config.NODE_ENV === "test"
                        ? "test env"
                        : "SMTP not configured (set MAIL_* in .env)",
            });
        }
    }

    /** Deliver a password-reset link to `to`. */
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
        this.logger.debug("mail.password_reset.sending", { to, resetUrl });
        await this.send({
            to,
            subject: "Reset your BeautyBooth password",
            html: resetHtml(resetUrl),
            text: `We received a request to reset your password. Use this single-use link (it expires soon):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
        });
    }

    /** Deliver a workspace-invitation link to `to`. */
    async sendInvitation(to: string, acceptUrl: string): Promise<void> {
        this.logger.debug("mail.invitation.sending", { to, acceptUrl });
        await this.send({
            to,
            subject: "You're invited to BeautyBooth",
            html: inviteHtml(acceptUrl),
            text: `You've been invited to join your team's workspace on BeautyBooth. Accept your invitation:\n\n${acceptUrl}`,
        });
    }

    private async send(msg: {
        to: string;
        subject: string;
        html: string;
        text: string;
    }): Promise<void> {
        if (!this.apiToken) {
            // Log transport — no API token configured / test env. No network call.
            this.logger.debug("mail.logged_not_sent", {
                to: msg.to,
                subject: msg.subject,
            });
            return;
        }
        const res = await fetch(MAILTRAP_SEND_URL, {
            method: "POST",
            headers: {
                "Api-Token": this.apiToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: { email: this.fromAddress, name: this.fromName },
                to: [{ email: msg.to }],
                subject: msg.subject,
                html: msg.html,
                text: msg.text,
            }),
        });
        if (!res.ok) {
            // Same failure path as an SMTP transport error: throw so the
            // caller's existing error handling / logging takes over.
            const detail = await res.text().catch(() => "");
            throw new Error(
                `Mailtrap send failed (HTTP ${res.status})${
                    detail ? `: ${detail.slice(0, 300)}` : ""
                }`,
            );
        }
        const info = (await res.json().catch(() => ({}))) as {
            message_ids?: string[];
        };
        this.logger.info("mail.sent", {
            to: msg.to,
            subject: msg.subject,
            messageId: info.message_ids?.[0] ?? null,
        });
    }
}

// ─── HTML templates ───────────────────────────────────────────────────────────
// Inline-styled, table-based layout for broad email-client compatibility.
const shell = (
    heading: string,
    body: string,
    cta: { url: string; label: string },
): string => `<!doctype html>
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

const resetHtml = (url: string): string =>
    shell(
        "Reset your password",
        "We received a request to reset your password. Click the button below to choose a new one. This link is single-use and expires soon. If you didn't request it, you can safely ignore this email.",
        { url, label: "Reset password" },
    );

const inviteHtml = (url: string): string =>
    shell(
        "You're invited",
        "You've been invited to join your team's workspace on BeautyBooth. Click below to accept the invitation and set up your account.",
        { url, label: "Accept invitation" },
    );
