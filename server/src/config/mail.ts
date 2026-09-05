import { Config } from "./index";

/**
 * WHETHER MAIL ACTUALLY LEAVES THE BUILDING.
 *
 * The sibling of `storage.ts`, and it exists because KI-19 turned out not to be
 * about R2 at all — it is about a whole family of "null-safe" transports that
 * answer success while doing nothing. `MailService` has the same shape:
 * without SMTP credentials it falls back to a LOG transport, and the log line
 * for a dropped message is at DEBUG, which is off in production. So a password
 * reset or a workspace invitation can be accepted, answered 200, and silently
 * never sent, with no trace above debug anywhere.
 *
 * P8 does NOT change that control flow — an invitation that fails loudly is a
 * product decision, not a test-phase one (it is written up as a gate item).
 * What it changes is that the drop becomes VISIBLE: `mailMode()` tells
 * `/health/ready` what the transport is, and tells `MailService` whether a
 * dropped message is a normal dev no-op (debug) or a production incident
 * (error, with the recipient and subject).
 *
 * `MAIL_ALLOW_LOG_ONLY` mirrors `STORAGE_ALLOW_STUB` and `CORS_ALLOW_LAN`: it
 * asks the production question without setting `NODE_ENV=prod`, which would
 * swap the transport onto a REAL SMTP host that delivers to real people
 * (§A rule 4 — the trap this project has paid for more than once).
 */

export type MailMode =
    /** SMTP is configured — messages are handed to a real server. */
    | "live"
    /** Deliberate no-network transport. Correct in dev and test. */
    | "log_only"
    /** No SMTP where a silent drop is NOT acceptable — every drop is an error. */
    | "unavailable";

/** The three values `MailService` needs before it can build a transport. */
export const smtpConfigured = (): boolean =>
    Boolean(Config.SMTP_HOST && Config.SMTP_USER && Config.SMTP_PASS);

const logOnlyAllowed = (): boolean => {
    const override = process.env.MAIL_ALLOW_LOG_ONLY;
    if (override === "0" || override === "false") return false;
    if (override === "1" || override === "true") return true;
    return !Config.IS_PROD;
};

/**
 * What the mail transport is doing right now.
 *
 * Note this DESCRIBES the transport; it does not choose it. `MailService`'s
 * constructor still owns that, and it refuses a real transport under
 * `NODE_ENV=test` unconditionally — deliberately not routed through here, so
 * no environment variable a test sets can ever hand the suite a live mailer.
 */
export const mailMode = (): MailMode => {
    if (Config.NODE_ENV === "test") {
        return logOnlyAllowed() ? "log_only" : "unavailable";
    }
    if (smtpConfigured()) return "live";
    return logOnlyAllowed() ? "log_only" : "unavailable";
};
