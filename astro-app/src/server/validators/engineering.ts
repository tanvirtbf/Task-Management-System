import { checkSchema } from "express-validator";
import { bugSeverities, reporterTeams } from "../db/schema/_shared";

/**
 * Validators for §22 Engineering specials. Pair each `checkSchema(...)` with the
 * `validate` middleware so failures surface as the spec envelope (422 /
 * `validation.failed`). The `severity` / `reporter_team` enum checks live here
 * (generic 422) — §22 defines no bespoke codes for them.
 */

const TEXT_MAX = 5000; // free-text intake fields, folded into the task description
const URL_MAX = 2000;
const ID_MAX = 64; // attachment id strings (VARCHAR(64))
const SCREENSHOTS_MAX = 20;

/**
 * `POST /api/v1/eng/report-bug`. `steps` + `happened` + `reporter_team` are
 * required; `expected` / `url` / `screenshots` optional; `severity` an optional
 * bug-severity enum.
 */
export const reportBugValidator = checkSchema({
    steps: {
        in: ["body"],
        isString: { errorMessage: "steps must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "steps is required" },
        isLength: {
            options: { max: TEXT_MAX },
            errorMessage: `steps is too long (max ${TEXT_MAX} chars)`,
        },
    },
    happened: {
        in: ["body"],
        isString: { errorMessage: "happened must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "happened is required" },
        isLength: {
            options: { max: TEXT_MAX },
            errorMessage: `happened is too long (max ${TEXT_MAX} chars)`,
        },
    },
    expected: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "expected must be a string", bail: true },
        trim: true,
        isLength: {
            options: { max: TEXT_MAX },
            errorMessage: `expected is too long (max ${TEXT_MAX} chars)`,
        },
    },
    severity: {
        in: ["body"],
        optional: true,
        isIn: {
            options: [[...bugSeverities]],
            errorMessage: `severity must be one of: ${bugSeverities.join(", ")}`,
        },
    },
    reporter_team: {
        in: ["body"],
        isString: {
            errorMessage: "reporter_team must be a string",
            bail: true,
        },
        trim: true,
        notEmpty: { errorMessage: "reporter_team is required" },
        isIn: {
            options: [[...reporterTeams]],
            errorMessage: `reporter_team must be one of: ${reporterTeams.join(", ")}`,
        },
    },
    url: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "url must be a string", bail: true },
        trim: true,
        isLength: {
            options: { max: URL_MAX },
            errorMessage: `url is too long (max ${URL_MAX} chars)`,
        },
    },
    screenshots: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { max: SCREENSHOTS_MAX },
            errorMessage: `screenshots must be an array (max ${SCREENSHOTS_MAX})`,
        },
    },
    "screenshots.*": {
        isString: {
            errorMessage: "each screenshot must be an attachment id string",
            bail: true,
        },
        trim: true,
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `screenshot id is too long (max ${ID_MAX} chars)`,
        },
    },
});

const POSTMORTEM_ITEMS_MAX = 50;
const ITEM_LABEL_MAX = 200;

/**
 * `POST /api/v1/eng/incidents/:id/postmortem`. `:id` is the incident task id;
 * `items` is a checklist `label → boolean` map — every value must be a boolean
 * (the canonical API_DESIGN.md shape, matching the frontend component).
 */
export const createPostmortemValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: ID_MAX },
            errorMessage: `id is too long (max ${ID_MAX} chars)`,
        },
    },
    items: {
        in: ["body"],
        custom: {
            options: (value: unknown) => {
                if (
                    typeof value !== "object" ||
                    value === null ||
                    Array.isArray(value)
                ) {
                    throw new Error(
                        "items must be an object of checklist label → boolean",
                    );
                }
                const entries = Object.entries(
                    value as Record<string, unknown>,
                );
                if (entries.length > POSTMORTEM_ITEMS_MAX) {
                    throw new Error(
                        `items has too many entries (max ${POSTMORTEM_ITEMS_MAX})`,
                    );
                }
                for (const [label, checked] of entries) {
                    if (label.length === 0 || label.length > ITEM_LABEL_MAX) {
                        throw new Error(
                            `each item label must be 1-${ITEM_LABEL_MAX} characters`,
                        );
                    }
                    if (typeof checked !== "boolean") {
                        throw new Error("each item value must be a boolean");
                    }
                }
                return true;
            },
        },
    },
});
