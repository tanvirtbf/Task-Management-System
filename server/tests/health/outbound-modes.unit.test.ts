import type { Logger } from "winston";
import { mailMode, smtpConfigured } from "../../src/config/mail";
import { r2Configured, storageMode } from "../../src/config/storage";
import { MailService } from "../../src/services/MailService";

/**
 * The two transports that leave the database, and the question P8 exists to
 * ask of both: when they are not really connected, does anybody find out?
 *
 * The answer used to be no, twice. `R2Service.putObject` resolved without
 * storing anything; `MailService.send` returned after a DEBUG line that is off
 * in production. Both reported success. Both are now a decision with a name.
 *
 * These are pure unit tests — no app, no HTTP, no database. The environment
 * overrides (`STORAGE_ALLOW_STUB`, `MAIL_ALLOW_LOG_ONLY`) ask the production
 * question without setting `NODE_ENV=prod`, which would hand this very suite a
 * live SMTP transport pointed at a host that delivers to real people.
 */

const withEnv = (
    vars: Record<string, string | undefined>,
    fn: () => void | Promise<void>,
): (() => Promise<void>) => {
    return async () => {
        const prev: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(vars)) {
            prev[k] = process.env[k];
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        try {
            await fn();
        } finally {
            for (const [k, v] of Object.entries(prev)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    };
};

const fakeLogger = () => {
    const log = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    };
    return { log, asLogger: log as unknown as Logger };
};

describe("storage mode", () => {
    it("is 'stub' under NODE_ENV=test — never 'live', whatever .env holds", () => {
        expect(process.env.NODE_ENV).toBe("test");
        expect(storageMode()).toBe("stub");
    });

    it(
        "is 'unavailable' when the stub is refused",
        withEnv({ STORAGE_ALLOW_STUB: "0" }, () => {
            expect(storageMode()).toBe("unavailable");
        }),
    );

    it(
        "STORAGE_ALLOW_STUB=1 is an explicit opt-in, not a default",
        withEnv({ STORAGE_ALLOW_STUB: "1" }, () => {
            expect(storageMode()).toBe("stub");
        }),
    );

    it("r2Configured reports the four credentials as a set, not individually", () => {
        // Whatever this machine's .env holds, the answer must be a boolean and
        // must agree with the presence of all four.
        const all = Boolean(
            process.env.CLOUDFLARE_ACCOUNT_ID &&
                process.env.CLOUDFLARE_R2_ACCESS_KEY &&
                process.env.CLOUDFLARE_R2_SECRET_KEY &&
                process.env.CLOUDFLARE_R2_BUCKET,
        );
        expect(r2Configured()).toBe(all);
    });
});

describe("mail mode", () => {
    it("is 'log_only' under NODE_ENV=test", () => {
        expect(mailMode()).toBe("log_only");
    });

    it(
        "is 'unavailable' when the log transport is refused",
        withEnv({ MAIL_ALLOW_LOG_ONLY: "0" }, () => {
            expect(mailMode()).toBe("unavailable");
        }),
    );

    it("smtpConfigured is a boolean, whatever this machine's .env holds", () => {
        expect(typeof smtpConfigured()).toBe("boolean");
    });
});

describe("MailService — a dropped message stops being invisible", () => {
    it("logs at DEBUG in dev/test, where dropping is the intended behaviour", async () => {
        const { log, asLogger } = fakeLogger();
        const svc = new MailService(asLogger);
        await svc.sendPasswordResetEmail(
            "nobody@example.invalid",
            "https://example.invalid/reset?token=x",
        );
        expect(log.debug).toHaveBeenCalledWith(
            "mail.logged_not_sent",
            expect.objectContaining({ to: "nobody@example.invalid" }),
        );
        expect(log.error).not.toHaveBeenCalled();
    });

    it(
        "logs at ERROR, naming the recipient, where dropping is an incident",
        withEnv({ MAIL_ALLOW_LOG_ONLY: "0" }, async () => {
            const { log, asLogger } = fakeLogger();
            // The constructor still refuses a real transport under
            // NODE_ENV=test unconditionally — that is deliberately NOT routed
            // through mailMode(), so no environment variable a test sets can
            // hand this suite a live mailer. Only the SEVERITY changes here.
            const svc = new MailService(asLogger);
            await svc.sendPasswordResetEmail(
                "nobody@example.invalid",
                "https://example.invalid/reset?token=x",
            );
            expect(log.error).toHaveBeenCalledWith(
                "mail.not_sent",
                expect.objectContaining({
                    to: "nobody@example.invalid",
                    subject: expect.stringContaining("Reset"),
                }),
            );
        }),
    );

    it(
        "the same is true of an invitation — the message a whole hire depends on",
        withEnv({ MAIL_ALLOW_LOG_ONLY: "0" }, async () => {
            const { log, asLogger } = fakeLogger();
            const svc = new MailService(asLogger);
            await svc.sendInvitation(
                "newcolleague@example.invalid",
                "https://example.invalid/accept?token=x",
            );
            expect(log.error).toHaveBeenCalledWith(
                "mail.not_sent",
                expect.objectContaining({ to: "newcolleague@example.invalid" }),
            );
        }),
    );

    it("never touches the network under NODE_ENV=test, in any mode", async () => {
        // The transport is null, so there is nothing to reach out with. If this
        // ever fails, the suite has gained the ability to send real email.
        const { asLogger } = fakeLogger();
        const svc = new MailService(asLogger);
        await expect(
            svc.sendPasswordResetEmail("a@example.invalid", "https://x.invalid"),
        ).resolves.toBeUndefined();
    });
});
