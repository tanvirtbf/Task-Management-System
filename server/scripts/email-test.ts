/* eslint-disable no-console */
/**
 * One-off mailer smoke test — does this box's SMTP config actually deliver?
 *
 *   MAIL_TEST_TO=someone@example.com npx tsx scripts/email-test.ts
 *
 * ⚠️ THIS SENDS A REAL EMAIL. Dev points at `live.smtp.mailtrap.io`, which is a
 * real relay, not a catcher — the message lands in a real inbox.
 *
 * It used to live at the package root as `email_test.ts` with the recipient
 * defaulted to a hardcoded personal gmail address, so running it with no
 * argument mailed a fake "reset your password" to a real person who had not
 * asked for one. The recipient is now REQUIRED and comes from the environment:
 * there is no default to fall through to, and no address baked into the repo.
 *
 * Deliberately under `scripts/` rather than `src/`: it is a tool, not part of
 * the build, and the root was also outside tsconfig's include — which is why it
 * showed up as a parse error in the lint baseline rather than being checked.
 */
import logger from "../src/config/logger";
import { Config } from "../src/config";
import { MailService } from "../src/services/MailService";

const to = process.env.MAIL_TEST_TO?.trim();

if (!to) {
    console.error(
        [
            "MAIL_TEST_TO is required — this script sends a REAL email and will not",
            "guess a recipient.",
            "",
            "  MAIL_TEST_TO=you@example.com npx tsx scripts/email-test.ts",
            "",
            "Do not point it at an @beautybooth.com.bd address: dev mail is a live",
            "relay, and a test password-reset landing in a colleague's inbox is not a",
            "test, it is an incident.",
        ].join("\n"),
    );
    process.exit(1);
}

void (async () => {
    console.log("Mailer config:");
    console.log("  host:", Config.SMTP_HOST);
    console.log("  port:", Config.SMTP_PORT);
    console.log("  user:", Config.SMTP_USER);
    console.log("  from:", Config.EMAIL_FROM, "name:", Config.EMAIL_FROM_NAME);
    console.log("  NODE_ENV:", Config.NODE_ENV);
    console.log(`\nSending a test password-reset email to: ${to} ...`);

    const mail = new MailService(logger);
    try {
        await mail.sendPasswordResetEmail(
            to,
            "http://localhost:5173/reset-password/THIS-IS-A-TEST-TOKEN",
        );
        console.log(
            `\n✓ SMTP accepted the message → check the inbox (and spam) of ${to}`,
        );
        process.exit(0);
    } catch (e) {
        console.error("\n✗ Email send FAILED:");
        console.error(e);
        process.exit(1);
    }
})();
