import type { Logger } from "winston";

/**
 * Outbound email.
 *
 * V1 ships a **log transport**: no SMTP is wired up yet (`Config.SMTP_*` is
 * unset in dev/test), so we render the message and log it rather than sending.
 * A real `nodemailer` SMTP transport can be dropped in behind these same
 * methods later — callers and tests depend only on the method contract, not on
 * how the message leaves the process.
 *
 * Security: a password-reset URL carries a single-use secret token, so it is
 * logged at DEBUG only (off in prod/test) and never at info/error.
 */
export class MailService {
    constructor(private logger: Logger) {}

    /**
     * Deliver a password-reset link to `to`. Resolves once the message is
     * handed to the transport. The caller has already decided to send, so this
     * does not validate the recipient.
     */
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
        // Log transport (V1). The URL embeds the raw reset token, so it stays
        // at debug level — visible to a developer running LOG_LEVEL=debug, never
        // emitted in prod/test. Subject/HTML rendering + the SMTP send land with
        // the real transport.
        this.logger.debug("mail.password_reset.sent", { to, resetUrl });
    }

    /**
     * Deliver a workspace-invitation link to `to`. Resolves once the message is
     * handed to the transport. The caller has already decided to send, so this
     * does not validate the recipient.
     */
    async sendInvitation(to: string, acceptUrl: string): Promise<void> {
        // Log transport (V1). `acceptUrl` embeds the raw single-use invite
        // token, so — exactly like the reset link — it is logged at debug only,
        // never at info/error and never in prod/test. The real SMTP transport
        // (subject/HTML render + send) drops in behind this same method.
        this.logger.debug("mail.invitation.sent", { to, acceptUrl });
    }
}
