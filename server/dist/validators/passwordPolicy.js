"use strict";
// =============================================================================
// PASSWORD POLICY (F12 / ISS-083)
//
// Before this, the entire rule for a new password was
// `isLength({ min: 8, max: 200 })` — so `password`, `12345678`, `PASSWORD`,
// `aaaaaaaa` and `alllowercase` were all accepted by every password-setting
// endpoint. For a system holding a company's HR reviews and encrypted customer
// PII, reachable from the public internet, "eight of anything" is not a policy.
//
// ── WHAT THIS CHECKS, AND WHY IT IS SHAPED THIS WAY ─────────────────────────
// NIST SP 800-63B's modern guidance is that a *blocklist* of known-bad choices
// does far more good than composition rules, and that mandating symbols mostly
// produces `Password1!`. So this does both, weighted accordingly:
//
//   1. a blocklist of the most-chosen passwords — checked on a normalised form
//      (lowercased, and again with trailing digits/punctuation stripped) so
//      `Password1!` and `password123` are caught alongside `password`;
//   2. no single repeated character (`aaaaaaaa`);
//   3. no straight run off the keyboard or alphabet (`12345678`, `abcdefgh`);
//   4. at least THREE of {lower, upper, digit, other} — but a passphrase of
//      16+ characters is exempt, because length is the stronger signal and
//      forcing symbols onto a long passphrase is exactly the counterproductive
//      rule the guidance warns about.
//
// The minimum length stays 8. Raising it was considered and rejected: it would
// have been a bigger behaviour change than the defect warrants (the seeded
// accounts and ~24 existing test fixtures sit at 9–10 characters), and rules
// 1–4 already refuse every example ISS-083 recorded. `bcrypt` cost 10 and the
// no-trim rule (whitespace is a legitimate part of a secret) are unchanged —
// P38 verified both as correct.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.newPasswordSchema = exports.passwordPolicyError = exports.PASSWORD_MAX = exports.PASSWORD_MIN = void 0;
/** Bounds shared by every password-setting endpoint. */
exports.PASSWORD_MIN = 8;
exports.PASSWORD_MAX = 200;
/** Length at which a passphrase is exempt from the character-class rule. */
const PASSPHRASE_LENGTH = 16;
/**
 * The most-chosen passwords, plus the ones this product would attract.
 * Lowercase; matched against the normalised candidate, never as a substring
 * (so `passwordA-distinct` is fine — it is not `password`).
 */
const COMMON_PASSWORDS = new Set([
    "password", "passw0rd", "pass", "passwd", "p@ssword", "p@ssw0rd",
    "123456", "1234567", "12345678", "123456789", "1234567890", "12345",
    "111111", "000000", "654321", "123123", "121212", "abc123", "a1b2c3",
    "qwerty", "qwertyui", "qwerty123", "qwe123", "asdfgh", "zxcvbn", "qazwsx",
    "1q2w3e4r", "1qaz2wsx", "iloveyou", "admin", "administrator", "root",
    "letmein", "welcome", "monkey", "dragon", "sunshine", "princess",
    "football", "baseball", "shadow", "master", "superman", "trustno1",
    "michael", "jordan", "harley", "hunter", "ranger", "buster", "batman",
    "login", "guest", "test", "testing", "changeme", "secret", "default",
    "starwars", "whatever", "freedom", "computer", "internet", "samsung",
    "google", "facebook", "photoshop", "office", "company", "corporate",
    // this product / this company
    "beautybooth", "beauty", "taskmanager", "clickup", "bangladesh", "dhaka",
]);
/** Ascending runs a lazy password walks along. Checked in both directions. */
const SEQUENCES = [
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
];
/** Lowercased, with trailing digits/punctuation stripped (`Password1!` → `password`). */
const normalise = (value) => {
    const lower = value.toLowerCase();
    const stripped = lower.replace(/[^a-z]+$/u, "");
    return stripped && stripped !== lower ? [lower, stripped] : [lower];
};
const isSingleRepeatedChar = (value) => value.length > 0 && [...value].every((c) => c === value[0]);
/** True when the whole password is one straight run along a known sequence. */
const isStraightRun = (value) => {
    const lower = value.toLowerCase();
    if (lower.length < 4)
        return false;
    return SEQUENCES.some((seq) => {
        const rev = [...seq].reverse().join("");
        return seq.includes(lower) || rev.includes(lower);
    });
};
const classCount = (value) => [/[a-z]/u, /[A-Z]/u, /\d/u, /[^a-zA-Z0-9]/u].filter((re) => re.test(value))
    .length;
/**
 * Anything outside printable ASCII — Bangla, emoji, accented Latin, CJK.
 *
 * Such a password is exempt from the character-class rule, for the same reason
 * a long passphrase is: the rule exists to stop short, dictionary-ish ASCII
 * choices, and a non-ASCII password is categorically not one — it appears in no
 * common wordlist and on no keyboard walk. Without this the policy would refuse
 * `পাসওয়ার্ড🔥1` (a strong password) while accepting `Abcd123!`, and in a
 * Bangladeshi company that is not a rounding error: it would quietly push
 * people off their own script and onto weaker ASCII. The repo's own
 * reset-password test caught exactly this.
 */
const hasNonAscii = (value) => /[^\x20-\x7E]/u.test(value);
/** Length in CODE POINTS, so an emoji counts once rather than twice. */
const codePointLength = (value) => [...value].length;
/**
 * The single reason this password is refused, or `null` when it is acceptable.
 *
 * Returns a message the person can act on — "must not be a commonly-used
 * password" tells them what to do; "invalid password" does not. It never
 * echoes the candidate back.
 */
const passwordPolicyError = (value) => {
    if (typeof value !== "string")
        return "New password must be a string";
    if (codePointLength(value) < exports.PASSWORD_MIN ||
        codePointLength(value) > exports.PASSWORD_MAX) {
        return `New password must be between ${exports.PASSWORD_MIN} and ${exports.PASSWORD_MAX} characters`;
    }
    if (isSingleRepeatedChar(value)) {
        return "New password must not be the same character repeated";
    }
    if (isStraightRun(value)) {
        return "New password must not be a straight run of letters or digits";
    }
    if (normalise(value).some((n) => COMMON_PASSWORDS.has(n))) {
        return "New password must not be a commonly-used password";
    }
    if (!hasNonAscii(value) &&
        codePointLength(value) < PASSPHRASE_LENGTH &&
        classCount(value) < 3) {
        return ("New password must combine at least three of: lowercase, uppercase, " +
            `digits, symbols — or be at least ${PASSPHRASE_LENGTH} characters long`);
    }
    return null;
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
