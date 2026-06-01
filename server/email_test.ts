// One-off mailer smoke test. Run: npx tsx email_test.ts [recipient]
// Sends a REAL password-reset email via the live MailService + .env creds.
import logger from "./src/config/logger";
import { Config } from "./src/config";
import { MailService } from "./src/services/MailService";

(async () => {
    console.log("Mailer config:");
    console.log("  host:", Config.SMTP_HOST);
    console.log("  port:", Config.SMTP_PORT);
    console.log("  user:", Config.SMTP_USER);
    console.log("  from:", Config.EMAIL_FROM, "name:", Config.EMAIL_FROM_NAME);
    console.log("  NODE_ENV:", Config.NODE_ENV);

    const to = process.argv[2] || "beautyboothai@gmail.com";
    console.log(`\nSending test password-reset email to: ${to} ...`);

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
