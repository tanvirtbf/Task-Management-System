import { checkSchema } from "express-validator";
import { weekDays } from "../db/schema/_shared";

/**
 * Validator for `PATCH /api/v1/workspace`. Pair with the `validate` middleware
 * so failures render as 422 `validation.failed`. The body is a partial — every
 * field is `optional`, validated only when present. `default_locale` is
 * rejected outright: it is part of the `Workspace` type but NOT updatable via
 * this endpoint (API_DESIGN.md §3 body list omits it).
 */

const NAME_MAX = 120; // workspaces.name VARCHAR(120)
const URL_MAX = 500; // workspaces.logo_url VARCHAR(500)
const TIMEZONE_MAX = 64; // workspaces.timezone VARCHAR(64)
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/; // "HH:MM:SS"

/**
 * True when `value` is a valid IANA time-zone name. Uses the runtime
 * `Intl.DateTimeFormat` constructor (throws `RangeError` on an unknown zone) —
 * the canonical check, and fully typed (unlike `Intl.supportedValuesOf`).
 */
export const isIanaTimezone = (value: string): boolean => {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
};

export const workspaceUpdateValidator = checkSchema({
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string" },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: NAME_MAX },
            errorMessage: `name must be at most ${NAME_MAX} characters`,
        },
    },
    // `null` clears the logo; any other value must be a bounded http(s) URL.
    // `nullable: true` lets null through to the controller without validation.
    logo_url: {
        in: ["body"],
        optional: { options: { nullable: true } },
        custom: {
            options: (value: unknown): boolean => {
                if (typeof value !== "string") {
                    throw new Error("logo_url must be a string or null");
                }
                if (value.length > URL_MAX) {
                    throw new Error(
                        `logo_url must be at most ${URL_MAX} characters`,
                    );
                }
                if (!/^https?:\/\//i.test(value)) {
                    throw new Error("logo_url must be an http(s) URL");
                }
                return true;
            },
        },
    },
    timezone: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "timezone must be a string" },
        trim: true,
        isLength: {
            options: { min: 1, max: TIMEZONE_MAX },
            errorMessage: `timezone must be 1-${TIMEZONE_MAX} characters`,
        },
        custom: {
            options: (value: string): boolean => {
                if (!isIanaTimezone(value)) {
                    throw new Error("timezone must be a valid IANA name");
                }
                return true;
            },
        },
    },
    week_starts_on: {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 6 },
            errorMessage: "week_starts_on must be an integer 0-6",
        },
        toInt: true,
    },
    working_days: {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "working_days must be an array" },
        custom: {
            options: (value: unknown): boolean => {
                // `isArray` already reports a non-array; skip so we don't
                // double-report the same field.
                if (!Array.isArray(value)) return true;
                const allowed = weekDays as readonly string[];
                for (const day of value) {
                    if (typeof day !== "string" || !allowed.includes(day)) {
                        throw new Error(
                            `working_days members must each be one of: ${weekDays.join(", ")}`,
                        );
                    }
                }
                return true;
            },
        },
    },
    business_hours_start: {
        in: ["body"],
        optional: true,
        matches: {
            options: TIME_RE,
            errorMessage: "business_hours_start must be HH:MM:SS",
        },
    },
    business_hours_end: {
        in: ["body"],
        optional: true,
        matches: {
            options: TIME_RE,
            errorMessage: "business_hours_end must be HH:MM:SS",
        },
    },
    // Not `optional`: the custom validator must run even when the field is
    // absent (returning true), and reject it whenever it is present.
    default_locale: {
        in: ["body"],
        custom: {
            options: (value: unknown): boolean => {
                if (value !== undefined) {
                    throw new Error(
                        "default_locale cannot be updated via this endpoint",
                    );
                }
                return true;
            },
        },
    },
});
