import { checkSchema } from "express-validator";

/**
 * Validators for §21 On-call. Pair each `checkSchema(...)` with the `validate`
 * middleware so failures become the spec envelope (422 / `validation.failed`).
 */

// `week_start` / `from` / `to` are DATE values keyed as `YYYY-MM-DD`. The regex
// enforces the SHAPE only — semantic validity (real month/day, Monday-ness) is
// checked where it matters: for the schedule FILTER an impossible-but-shaped
// date simply yields no rows (harmless), while the PUT path stores the value and
// so re-validates it (Monday + real date) in the service with a domain code.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /api/v1/on-call/schedule`. Optional `from` / `to` query bounds. Each, if
 * present, must be a single `YYYY-MM-DD` string — a non-string (e.g. a repeated
 * `?from=a&from=b` array) fails `isString` and a malformed value fails the shape
 * regex, both → 422. Absent bounds are allowed (return the whole schedule).
 */
export const scheduleQueryValidator = checkSchema({
    from: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "from must be a string", bail: true },
        trim: true,
        matches: {
            options: ISO_DATE,
            errorMessage: "from must be an ISO date (YYYY-MM-DD)",
        },
    },
    to: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "to must be a string", bail: true },
        trim: true,
        matches: {
            options: ISO_DATE,
            errorMessage: "to must be an ISO date (YYYY-MM-DD)",
        },
    },
});

/**
 * True when `value` is a real calendar date in `YYYY-MM-DD` form AND a Monday.
 * The round-trip check rejects shaped-but-impossible dates (e.g. `2026-13-99`),
 * which JS `Date` would otherwise silently roll over to a valid date.
 */
const isMondayIsoDate = (value: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const dt = new Date(year, month - 1, day);
    if (
        dt.getFullYear() !== year ||
        dt.getMonth() !== month - 1 ||
        dt.getDate() !== day
    ) {
        return false; // shaped but not a real date
    }
    return dt.getDay() === 1; // 1 = Monday (local)
};

/**
 * `PUT /api/v1/on-call/:weekStart`. The `:weekStart` path param must be a real
 * Monday in `YYYY-MM-DD`; `engineer_id` is a required id string (whether the
 * engineer is an active workspace member is checked in the service, so a
 * non-member returns a domain code rather than `validation.failed`). Both
 * failures surface as 422.
 */
export const setOnCallValidator = checkSchema({
    weekStart: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "weekStart is required", bail: true },
        custom: {
            options: (value: string) => {
                if (!isMondayIsoDate(value)) {
                    throw new Error(
                        "weekStart must be a Monday in YYYY-MM-DD format",
                    );
                }
                return true;
            },
        },
    },
    engineer_id: {
        in: ["body"],
        isString: { errorMessage: "engineer_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "engineer_id is required" },
        isLength: {
            options: { max: 64 },
            errorMessage: "engineer_id is too long (max 64 chars)",
        },
    },
});

/**
 * `DELETE /api/v1/on-call/:weekStart`. Only the `:weekStart` path param — the
 * same real-Monday rule as the PUT — so the two `:weekStart` verbs reject the
 * same malformed weeks identically. A missing shift for a valid week is a 404
 * (decided in the service), not a validation error.
 */
export const weekStartParamValidator = checkSchema({
    weekStart: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "weekStart is required", bail: true },
        custom: {
            options: (value: string) => {
                if (!isMondayIsoDate(value)) {
                    throw new Error(
                        "weekStart must be a Monday in YYYY-MM-DD format",
                    );
                }
                return true;
            },
        },
    },
});
