"use strict";
// =============================================================================
// PASSWORD POLICY
//
// FOUR rules, and nothing else:
//   1. at least 8 characters
//   2. at least one uppercase letter  (A–Z)
//   3. at least one number            (0–9)
//   4. at least one special character (anything not a letter or a digit)
//
// ── WHY IT LOOKS LIKE THIS (rewritten 2026-08-10) ───────────────────────────
// F12 (ISS-083) replaced a length-only rule with a NIST-flavoured policy: a
// common-password blocklist, a no-repeated-character rule, a no-keyboard-run
// rule, and "at least three of {lower, upper, digit, symbol}" with exemptions
// for long passphrases and for non-ASCII scripts. Each part was defensible on
// its own. Together they were unpredictable, and the UI never showed them.
//
// The failure people actually hit: the blocklist matched a NORMALISED form of
// the candidate — lowercased, then with trailing digits and punctuation
// stripped — so `Dhaka@1234`, `Welcome@123`, `Admin@123` and `Password1!` all
// collapsed onto a blocklisted word and were refused. Those are the first
// things a new colleague in Dhaka types on an invitation page. The client
// meanwhile showed a strength BAR reading "Strong" in green, and the API
// answered with the generic envelope message "One or more fields failed
// validation" — so the person saw green, got refused, and was told nothing.
// The result was people who simply could not finish accepting an invitation.
//
// So the policy is now exactly the four rules above: composition rules only,
// no dictionary, no hidden normalisation, no exemptions. Every one of them is
// mechanically checkable in the browser, which is the point — the same four
// rules render as a live checklist next to the field
// (`client/src/lib/passwordPolicy.ts` mirrors this file), so "all ticks" and
// "the server accepts it" are now the same statement.
//
// What this trades away, deliberately and with the decision recorded here:
// `Password1!` and `Dhaka@1234` are now ACCEPTED. A blocklist would refuse
// them, but a blocklist a user cannot see is exactly what broke this feature.
// If the blocklist is ever wanted back, it has to come back VISIBLY — shown in
// the checklist and explained in the error — not as a silent extra gate.
//
// Consequence worth knowing: rule 2 asks for `A–Z`, which scripts without
// letter case (Bangla, CJK) cannot satisfy, so a purely Bangla password is no
// longer accepted. That is the honest reading of the rule as specified; the
// previous non-ASCII exemption was invisible to the user in the same way the
// blocklist was.
//
// Unchanged: the 200-character ceiling, and the no-trim rule (leading and
// trailing whitespace is a legitimate part of a secret). `bcrypt` cost 10 is
// unrelated and untouched.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.newPasswordSchema = exports.passwordPolicyError = exports.passwordRuleFailures = exports.PASSWORD_RULES = exports.PASSWORD_MAX = exports.PASSWORD_MIN = void 0;
/** Bounds shared by every password-setting endpoint. */
exports.PASSWORD_MIN = 8;
exports.PASSWORD_MAX = 200;
/** Length in CODE POINTS, so an emoji counts once rather than twice. */
const codePointLength = (value) => [...value].length;
exports.PASSWORD_RULES = [
    {
        id: "length",
        label: `At least ${exports.PASSWORD_MIN} characters`,
        missing: `be at least ${exports.PASSWORD_MIN} characters long`,
        test: (v) => codePointLength(v) >= exports.PASSWORD_MIN,
    },
    {
        id: "uppercase",
        label: "At least one uppercase letter (A–Z)",
        missing: "contain an uppercase letter (A–Z)",
        test: (v) => /[A-Z]/.test(v),
    },
    {
        id: "number",
        label: "At least one number (0–9)",
        missing: "contain a number (0–9)",
        test: (v) => /\d/.test(v),
    },
    {
        id: "symbol",
        label: "At least one special character (e.g. ! @ # $)",
        missing: "contain a special character (e.g. ! @ # $)",
        test: (v) => /[^A-Za-z0-9]/.test(v),
    },
];
/** Join fragments as "a, b, and c" — the error has to read like a sentence. */
const joinList = (parts) => {
    if (parts.length === 1)
        return parts[0];
    if (parts.length === 2)
        return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};
/** The ids of every rule this value fails, in checklist order. */
const passwordRuleFailures = (value) => exports.PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.id);
exports.passwordRuleFailures = passwordRuleFailures;
/**
 * Why this password is refused, or `null` when it is acceptable.
 *
 * Names EVERY missing requirement in one sentence, so a person fixes the
 * password in one attempt instead of discovering the rules one refusal at a
 * time. It never echoes the candidate back.
 */
const passwordPolicyError = (value) => {
    if (typeof value !== "string")
        return "New password must be a string";
    if (codePointLength(value) > exports.PASSWORD_MAX) {
        return `New password must be at most ${exports.PASSWORD_MAX} characters`;
    }
    const missing = exports.PASSWORD_RULES.filter((rule) => !rule.test(value));
    if (missing.length === 0)
        return null;
    return `Password must ${joinList(missing.map((rule) => rule.missing))}.`;
};
exports.passwordPolicyError = passwordPolicyError;
/**
 * The `checkSchema` fragment every password-setting endpoint shares — reset,
 * change, and accept-invitation. Keeping it in one place is the point: the
 * three used to carry three copies of the same length-only rule, which is how
 * a policy drifts.
 *
 * NOT trimmed: leading/trailing whitespace is a legitimate part of a secret.
 */
exports.newPasswordSchema = {
    in: ["body"],
    notEmpty: { errorMessage: "New password is required" },
    isString: { errorMessage: "New password must be a string", bail: true },
    custom: {
        options: (value) => (0, exports.passwordPolicyError)(value) === null,
        errorMessage: (value) => (0, exports.passwordPolicyError)(value) ?? "New password is not acceptable",
    },
};
