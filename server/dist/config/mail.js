"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailMode = exports.smtpConfigured = void 0;
const index_1 = require("./index");
/** The three values `MailService` needs before it can build a transport. */
const smtpConfigured = () => Boolean(index_1.Config.SMTP_HOST && index_1.Config.SMTP_USER && index_1.Config.SMTP_PASS);
exports.smtpConfigured = smtpConfigured;
const logOnlyAllowed = () => {
    const override = process.env.MAIL_ALLOW_LOG_ONLY;
    if (override === "0" || override === "false")
        return false;
    if (override === "1" || override === "true")
        return true;
    return !index_1.Config.IS_PROD;
};
/**
 * What the mail transport is doing right now.
 *
 * Note this DESCRIBES the transport; it does not choose it. `MailService`'s
 * constructor still owns that, and it refuses a real transport under
 * `NODE_ENV=test` unconditionally — deliberately not routed through here, so
 * no environment variable a test sets can ever hand the suite a live mailer.
 */
const mailMode = () => {
    if (index_1.Config.NODE_ENV === "test") {
        return logOnlyAllowed() ? "log_only" : "unavailable";
    }
    if ((0, exports.smtpConfigured)())
        return "live";
    return logOnlyAllowed() ? "log_only" : "unavailable";
};
exports.mailMode = mailMode;
