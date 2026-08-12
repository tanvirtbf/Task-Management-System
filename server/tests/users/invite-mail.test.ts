import logger from "../../src/config/logger";
import { MailService } from "../../src/services/MailService";

/**
 * The invite email's SHAPE (2026-08-12).
 *
 * The office found this one message under Gmail's **Promotions** tab while
 * every other mail landed in Primary. The fix is that the invite now looks
 * like what it actually is — one colleague writing to another — so these
 * assertions pin the signals that carry that: a personal subject, the
 * "<Inviter> via BeautyBooth Tasks" From, a Reply-To that reaches the
 * inviter, transactional headers with NO bulk/marketing ones, and a plain
 * letter body instead of the campaign shell.
 *
 * The private `send` is spied rather than SMTP: under NODE_ENV=test
 * MailService holds a log transport, so composing the message IS the
 * observable behaviour.
 */

type SentMessage = {
    to: string;
    subject: string;
    html: string;
    text: string;
    from?: { name: string; address: string };
    replyTo?: string;
    headers?: Record<string, string>;
};

const captureSend = () => {
    const sent: SentMessage[] = [];
    const spy = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(MailService.prototype as any, "send")
        .mockImplementation(async (...args: unknown[]) => {
            sent.push(args[0] as SentMessage);
        });
    return { sent, spy };
};

afterEach(() => jest.restoreAllMocks());

const URL = "https://tasks.beautybooth.com.bd/invitation/tok_abc123";

describe("invitation email — inbox-placement shape", () => {
    it("is sent AS the inviter: personal subject, 'via' From, Reply-To their mailbox", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL, {
            inviterName: "Farhana Akter",
            inviterEmail: "farhana@beautybooth.com.bd",
            inviteeFirstName: "Rahim",
            refId: "inv-123",
        });

        expect(sent).toHaveLength(1);
        const m = sent[0];
        expect(m.subject).toBe("Farhana Akter added you to BeautyBooth Tasks");
        expect(m.from?.name).toBe("Farhana Akter via BeautyBooth Tasks");
        expect(m.from?.address).toContain("@");
        expect(m.replyTo).toBe("farhana@beautybooth.com.bd");
        // Addressed to a person, in plain letter form.
        expect(m.html).toContain("Hi Rahim,");
        expect(m.html).toContain(URL);
        expect(m.text).toContain("Hi Rahim,");
        expect(m.text).toContain(URL);
    });

    it("carries transactional headers and NOTHING that marks it as bulk marketing", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL, {
            inviterName: "Farhana Akter",
            inviterEmail: "farhana@beautybooth.com.bd",
            refId: "inv-123",
        });

        const h = sent[0].headers ?? {};
        expect(h["Auto-Submitted"]).toBe("auto-generated");
        expect(h["X-Auto-Response-Suppress"]).toBe("All");
        expect(h["X-Entity-Ref-ID"]).toBe("inv-123");
        // A List-Unsubscribe / bulk precedence would tell Gmail "campaign".
        expect(Object.keys(h)).not.toContain("List-Unsubscribe");
        expect(Object.keys(h)).not.toContain("Precedence");
        // The single-use token must never ride a header.
        expect(JSON.stringify(h)).not.toContain("tok_abc123");
    });

    it("drops the old campaign wording and the marketing shell", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL, {
            inviterName: "Farhana Akter",
            inviterEmail: "farhana@beautybooth.com.bd",
            inviteeFirstName: "Rahim",
        });

        const m = sent[0];
        for (const promo of [
            "You're invited",
            "Accept invitation",
            "join your team's workspace",
        ]) {
            expect(m.subject).not.toContain(promo);
            expect(m.html).not.toContain(promo);
            expect(m.text).not.toContain(promo);
        }
        // no brand bar / CTA-button markup from the campaign shell
        expect(m.html).not.toContain("#7c3aed");
        expect(m.html).not.toContain("border-radius:12px");
    });

    it("still works with no inviter known (falls back, no broken headers)", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL);

        const m = sent[0];
        expect(m.subject).toBe(
            "Your BeautyBooth Tasks account — set your password",
        );
        expect(m.from).toBeUndefined(); // the workspace default From
        expect(m.replyTo).toBeUndefined();
        expect(m.html).toContain(URL);
        expect(m.html).not.toContain("Hi ,");
    });

    it("cannot be header-injected through a crafted inviter name", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL, {
            inviterName: "Evil\r\nBcc: victim@x.test",
            inviterEmail: "evil@x.test",
            inviteeFirstName: "Rahim",
        });

        const m = sent[0];
        expect(m.subject).not.toMatch(/[\r\n]/);
        expect(m.from?.name).not.toMatch(/[\r\n]/);
        expect(m.from?.name).toBe(
            "Evil Bcc: victim@x.test via BeautyBooth Tasks",
        );
    });

    it("escapes HTML in the names it prints", async () => {
        const { sent } = captureSend();

        await new MailService(logger).sendInvitation("newhire@x.test", URL, {
            inviterName: "<script>alert(1)</script>",
            inviteeFirstName: "<b>Rahim</b>",
        });

        expect(sent[0].html).not.toContain("<script>");
        expect(sent[0].html).toContain("&lt;script&gt;");
        expect(sent[0].html).toContain("&lt;b&gt;Rahim&lt;/b&gt;");
    });
});
