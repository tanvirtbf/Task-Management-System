/**
 * The password rules, mirrored from the server
 * (`server/src/validators/passwordPolicy.ts`).
 *
 * There is exactly ONE reason this file exists: the checklist the person reads
 * while typing has to be the same set of rules the API enforces. Before this,
 * the form showed a strength BAR that turned green on "Strong" while the
 * server applied an invisible common-password blocklist underneath — people
 * saw green, were refused, and were told only "One or more fields failed
 * validation". Anything added here must be added there, and vice versa.
 *
 * Four rules, all mechanically checkable in the browser:
 *   1. at least 8 characters
 *   2. at least one uppercase letter  (A–Z)
 *   3. at least one number            (0–9)
 *   4. at least one special character (anything not a letter or a digit)
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export type PasswordRuleId = "length" | "uppercase" | "number" | "symbol";

export interface PasswordRule {
    id: PasswordRuleId;
    /** Affirmative form, rendered in the checklist. */
    label: string;
    /** Sentence fragment naming what is MISSING, for an inline error. */
    missing: string;
    test: (value: string) => boolean;
}

/** Code points, so an emoji counts once — matches the server's measure. */
const codePointLength = (value: string): number => [...value].length;

export const PASSWORD_RULES: readonly PasswordRule[] = [
    {
        id: "length",
        label: `At least ${PASSWORD_MIN} characters`,
        missing: `be at least ${PASSWORD_MIN} characters long`,
        test: (v) => codePointLength(v) >= PASSWORD_MIN,
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
] as const;

const joinList = (parts: string[]): string => {
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};

/** Every rule this value currently fails, in checklist order. */
export const failedPasswordRules = (value: string): PasswordRule[] =>
    PASSWORD_RULES.filter((rule) => !rule.test(value));

export const isPasswordValid = (value: string): boolean =>
    codePointLength(value) <= PASSWORD_MAX &&
    failedPasswordRules(value).length === 0;

/**
 * The inline message for the field, naming EVERY missing requirement at once —
 * so the password is fixed in one attempt, not one refusal at a time. `null`
 * when the value is acceptable. Wording matches the server's, so an inline
 * error and an API error never contradict each other.
 */
export const passwordError = (value: string): string | null => {
    if (codePointLength(value) > PASSWORD_MAX) {
        // Word-for-word the server's message. It used to open with "Password"
        // while the API answered "New password", so the same over-length value
        // was described two different ways depending on which check caught it
        // first — the exact class of contradiction this file exists to prevent.
        return `New password must be at most ${PASSWORD_MAX} characters`;
    }
    const missing = failedPasswordRules(value);
    if (missing.length === 0) return null;
    return `Password must ${joinList(missing.map((r) => r.missing))}.`;
};
