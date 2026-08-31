import {
    PASSWORD_MAX as SERVER_MAX,
    PASSWORD_MIN as SERVER_MIN,
    PASSWORD_RULES as SERVER_RULES,
    passwordPolicyError,
    passwordRuleFailures,
} from "../../src/validators/passwordPolicy";
import {
    PASSWORD_MAX as CLIENT_MAX,
    PASSWORD_MIN as CLIENT_MIN,
    PASSWORD_RULES as CLIENT_RULES,
    failedPasswordRules,
    isPasswordValid,
    passwordError,
} from "../../../client/src/lib/passwordPolicy";

/**
 * THE PASSWORD POLICY, ON BOTH SIDES OF THE WIRE.
 *
 * `server/src/validators/passwordPolicy.ts` decides whether a password is
 * accepted. `client/src/lib/passwordPolicy.ts` decides what the person sees
 * while they type it: a live checklist beside the field, and an inline error.
 * They are two copies of one rule set, kept in step by nothing but a comment in
 * each file asking the next reader to remember.
 *
 * That arrangement has already failed here once, expensively. The server used
 * to apply a hidden common-password blocklist against a NORMALISED form of the
 * candidate — lowercased, trailing digits and punctuation stripped — so
 * `Dhaka@1234`, `Welcome@123`, `Admin@123` and `Password1!` all collapsed onto
 * a blocklisted word and were refused. The client meanwhile showed a strength
 * BAR reading "Strong" in green, and the API answered with the generic envelope
 * "One or more fields failed validation". People saw green, were refused, and
 * were told nothing; some simply could not finish accepting their invitation.
 *
 * The fix was to make the rules exactly four, visible, and mechanically
 * checkable in a browser — so "all four ticks" and "the server accepts it"
 * became the same statement. This test is what keeps that true. It is the same
 * shape of guard as the schema-parity suite P1 added for Drizzle vs
 * `information_schema`: two descriptions of one thing, and a test that fails
 * the moment they stop agreeing.
 *
 * The client module has no runtime imports at all, which is why a server test
 * can load it directly and compare the real implementations rather than a
 * transcription of them.
 */

/**
 * Candidates chosen to exercise every rule alone and in combination, the
 * boundaries, and the shapes that broke the old policy.
 */
const CORPUS: string[] = [
    // ── acceptable ──────────────────────────────────────────────────────────
    "Str0ng#Pass",
    "Aa1!aaaa", // exactly 8, one of each
    "Zz9$" + "x".repeat(196), // exactly 200
    "  Aa1! pad  ", // leading/trailing space is part of the secret
    "Ãá1!émoji", // accented Latin still has A–Z
    "Aa1!🙂🙂🙂🙂", // emoji count once (code points)

    // ── the four the old hidden blocklist refused ───────────────────────────
    "Password1!",
    "Dhaka@1234",
    "Welcome@123",
    "Admin@123",

    // ── each rule failing on its own ────────────────────────────────────────
    "Aa1!aa", // too short
    "aa1!aaaa", // no uppercase
    "Aa!!aaaa", // no number
    "Aa11aaaa", // no symbol

    // ── combinations ────────────────────────────────────────────────────────
    "aaaaaaaa", // no upper, no number, no symbol
    "aa1aaaaa", // no upper, no symbol
    "AA1AAAAA", // no symbol only
    "aaa", // short + upper + number + symbol (all four)
    "", // empty
    "        ", // whitespace only
    "১২৩৪৫৬৭৮", // Bangla digits: no A–Z, and not /\d/ either
    "パスワード1!", // CJK + number + symbol, no A–Z
    "A".repeat(201), // over the ceiling, and missing rules too
    "Aa1!" + "b".repeat(197), // exactly 201 — over by one, rules all met
];

describe("Password policy — server and client must agree", () => {
    it("declares the same bounds", () => {
        expect(CLIENT_MIN).toBe(SERVER_MIN);
        expect(CLIENT_MAX).toBe(SERVER_MAX);
        expect(SERVER_MIN).toBe(8);
        expect(SERVER_MAX).toBe(200);
    });

    it("declares the same four rules, in the same order", () => {
        // Four is not an arbitrary number here — it is the whole decision. A
        // fifth rule that the checklist cannot show is the bug this file was
        // written to prevent coming back.
        expect(SERVER_RULES).toHaveLength(4);
        expect(SERVER_RULES.map((r) => r.id)).toEqual([
            "length",
            "uppercase",
            "number",
            "symbol",
        ]);
        expect(CLIENT_RULES.map((r) => r.id)).toEqual(
            SERVER_RULES.map((r) => r.id),
        );
    });

    it("uses identical wording for every rule, both the label and the fragment", () => {
        // The label is what the checklist shows; the fragment is what the API
        // error says. If they drift, the person is told to do two different
        // things by two parts of the same product.
        const wording = (rules: readonly { label: string; missing: string }[]) =>
            rules.map((r) => [r.label, r.missing]);
        expect(wording(CLIENT_RULES)).toEqual(wording(SERVER_RULES));
    });

    /**
     * The three corpus sweeps below are aggregates rather than `it.each`.
     *
     * Two reasons, and the second is the better one. This suite touches no
     * database, yet every test still pays `setup-each-auth.ts`'s nine-table
     * reset — so 23 candidates × 3 properties would spend 69 of those proving
     * something about two pure functions. And when they DO disagree, naming
     * every divergent candidate
     * at once is more useful than failing on the first: fixing a mirrored
     * file one refusal at a time is the exact shape of the problem the
     * password policy itself was rewritten to remove.
     */
    it("agrees rule-by-rule across the whole corpus", () => {
        const disagreements = CORPUS.filter(
            (c) =>
                failedPasswordRules(c)
                    .map((r) => r.id)
                    .join(",") !== passwordRuleFailures(c).join(","),
        );
        expect(disagreements).toEqual([]);
    });

    it("produces an identical message for every candidate", () => {
        // Not merely "both reject it" — the same SENTENCE. An inline error and
        // an API error that describe one refusal differently is how a person
        // ends up believing they fixed something they did not.
        const divergent = CORPUS.filter(
            (c) => passwordError(c) !== passwordPolicyError(c),
        ).map((c) => ({
            candidate: c,
            client: passwordError(c),
            server: passwordPolicyError(c),
        }));
        expect(divergent).toEqual([]);
    });

    it("agrees on the accept/reject verdict for every candidate", () => {
        const disagreements = CORPUS.filter(
            (c) => isPasswordValid(c) !== (passwordPolicyError(c) === null),
        );
        expect(disagreements).toEqual([]);
    });

    it("accepts the four passwords the old hidden blocklist refused", () => {
        // These are the first things a new colleague in Dhaka types. Their
        // acceptance is a recorded decision, not an oversight: a blocklist a
        // person cannot see is what broke invitation-accept in the first place.
        for (const pw of ["Password1!", "Dhaka@1234", "Welcome@123", "Admin@123"]) {
            expect(passwordPolicyError(pw)).toBeNull();
            expect(isPasswordValid(pw)).toBe(true);
        }
    });

    it("names EVERY missing rule at once, on both sides", () => {
        // One refusal should be enough to fix the password. Discovering the
        // rules one rejection at a time is the behaviour this replaced.
        const message = passwordPolicyError("aaa");
        expect(message).toBe(
            "Password must be at least 8 characters long, contain an uppercase letter (A–Z), contain a number (0–9), and contain a special character (e.g. ! @ # $).",
        );
        expect(passwordError("aaa")).toBe(message);
    });

    it("keeps the server's non-string branch, which the client cannot reach", () => {
        // The one asymmetry, and it is a typing difference rather than a policy
        // difference: the client's input is a bound form field and is always a
        // string, while the server must survive `{"new_password": 12345}`.
        expect(passwordPolicyError(12345)).toBe("New password must be a string");
        expect(passwordPolicyError(null)).toBe("New password must be a string");
        expect(passwordPolicyError(undefined)).toBe(
            "New password must be a string",
        );
    });

    it("measures length in code points on both sides, so an emoji counts once", () => {
        // "🙂".length === 2 in UTF-16. A rule written with `.length` would make
        // a four-emoji password look eight characters long on one side and
        // four on the other — the two sides disagreeing about the SAME string.
        const fourEmoji = "🙂🙂🙂🙂"; // 4 code points, 8 UTF-16 units
        expect(passwordRuleFailures(fourEmoji)).toContain("length");
        expect(failedPasswordRules(fourEmoji).map((r) => r.id)).toContain(
            "length",
        );
    });
});
