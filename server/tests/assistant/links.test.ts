import { LinkSafeStream, relativizeAppLinks } from "../../src/assistant/links";

/**
 * LINK SAFETY (AI_ASSISTANT_DEEP_PLAN.md P3).
 *
 * The model invents a domain in front of our own paths — "https://beautybooth
 * .com/t/abc" — which points at a site that does not exist. It was told not to
 * in two places in the system prompt and kept doing it in live probes, so the
 * fix is deterministic rather than instructional: strip the origin on the way
 * out, for any path this app actually serves.
 *
 * Pure unit tests — no DB, no OpenAI.
 */

describe("relativizeAppLinks", () => {
    it("strips an invented domain from a task link", () => {
        expect(
            relativizeAppLinks(
                "[Banner](https://beautybooth.com/t/t-Abc_123) dekhun",
            ),
        ).toBe("[Banner](/t/t-Abc_123) dekhun");
    });

    it("handles every page address the app serves, http or https or //", () => {
        for (const [input, want] of [
            ["[a](https://x.com/inbox)", "[a](/inbox)"],
            ["[a](http://x.com/settings/teams)", "[a](/settings/teams)"],
            ["[a](//tasks.beautybooth.com.bd/dept)", "[a](/dept)"],
            ["[a](https://x.com/eng/sprint)", "[a](/eng/sprint)"],
            ["[a](https://x.com/s/sp-1)", "[a](/s/sp-1)"],
        ] as const) {
            expect(relativizeAppLinks(input)).toBe(want);
        }
    });

    it("rewrites EVERY link in one answer, not just the first", () => {
        const out = relativizeAppLinks(
            "1. [A](https://b.com/t/t-1)\n2. [B](https://b.com/t/t-2)",
        );
        expect(out).toBe("1. [A](/t/t-1)\n2. [B](/t/t-2)");
    });

    it("repairs EVERY mangled task link, however the model mangled it", () => {
        // All three shapes were observed live on the same question, in roughly
        // one answer out of three. The rule keys on the only part that is ever
        // right — the id — instead of on the garbage around it.
        const id = "t-YVHky3KYncnwg307rzRGoA";
        for (const target of [
            `https://beautybooth.com/t/${id}`, // domain in front of the path
            `https://${id}`, // id pasted where a host goes
            `https://t/${id}`, // "t" as the host, id as the path
            `${id}`, // no scheme at all
            `/t/${id}`, // …and one that was already correct
        ]) {
            expect(relativizeAppLinks(`[SMS blast](${target})`)).toBe(
                `[SMS blast](/t/${id})`,
            );
        }
    });

    it("does NOT eat /forgot-password — a page whose NAME contains 't-'", () => {
        // Found by the eval on 2026-08-16: the password question, the one a
        // locked-out person asks, was answering with /t/t-password. "forgo(t-
        // password)" satisfied a rule that looked for a task id ANYWHERE in
        // the target, so the repair itself broke the link it was repairing.
        for (const page of [
            "/forgot-password",
            "/reset-password/abc123def456",
            "/settings/notifications",
        ]) {
            expect(relativizeAppLinks(`[click](${page})`)).toBe(
                `[click](${page})`,
            );
        }
        // …and the absolute form of it still loses only its invented domain.
        expect(
            relativizeAppLinks("[reset](https://beautybooth.com/forgot-password)"),
        ).toBe("[reset](/forgot-password)");
    });

    it("leaves relative links and genuinely external ones alone", () => {
        const already = "[Inbox](/inbox) ar [Home](/)";
        expect(relativizeAppLinks(already)).toBe(already);
        const outside = "[docs](https://example.com/help/article)";
        expect(relativizeAppLinks(outside)).toBe(outside);
    });
});

describe("LinkSafeStream — the same fix, arriving token by token", () => {
    /** Feed `chunks` through the buffer and return what the user would see. */
    const stream = (chunks: string[]): string => {
        const s = new LinkSafeStream();
        return chunks.map((c) => s.push(c)).join("") + s.flush();
    };

    it("repairs a link split across many deltas", () => {
        expect(
            stream([
                "টাস্ক: [Banner](htt",
                "ps://beauty",
                "booth.com/t/t-Ab",
                "c_123) — In Progress",
            ]),
        ).toBe("টাস্ক: [Banner](/t/t-Abc_123) — In Progress");
    });

    it("passes plain prose straight through, so streaming still feels live", () => {
        const s = new LinkSafeStream();
        expect(s.push("আপনার ৩টি কাজ ")).toBe("আপনার ৩টি কাজ ");
        expect(s.push("বাকি আছে।")).toBe("বাকি আছে।");
        expect(s.flush()).toBe("");
    });

    it("holds back only a trailing ']' — the one character that could start a link", () => {
        const s = new LinkSafeStream();
        expect(s.push("ekta [naam]")).toBe("ekta [naam");
        expect(s.push("(https://x.com/inbox) dekhun")).toBe("](/inbox) dekhun");
    });

    it("never loses text when the stream ends mid-link", () => {
        const s = new LinkSafeStream();
        const seen = s.push("[Banner](https://x.com/t/t-1") + s.flush();
        expect(seen).toBe("[Banner](https://x.com/t/t-1");
    });

    it("emits the same characters as the one-shot rewrite, chunked or not", () => {
        const text =
            "1. [A](https://b.com/t/t-1) — To Do\n2. [B](/inbox) — dekhun\n3. [C](https://b.com/settings/teams)";
        const chunked = stream(text.match(/.{1,3}/gs) ?? []);
        expect(chunked).toBe(relativizeAppLinks(text));
    });
});
