import { checkSchema } from "express-validator";

/**
 * Validator for §24 `GET /api/v1/search`. Shape-only and lenient by design:
 *   - `q` is optional here — a missing/blank query yields an empty 200 result
 *     in the service (mock-faithful), not a 422.
 *   - `types` is a free CSV string; the service intersects it with the valid
 *     kinds and IGNORES unknown tokens (so the frontend's stale `note` kind
 *     does not 422).
 *   - `limit` must be a positive int when present; the service clamps it to
 *     the §24 max of 50 (default 20).
 */
export const searchValidator = checkSchema({
    q: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "q must be a string" },
        trim: true,
        // F20 (ISS-076): a minimum for a REAL query. One keystroke used to run
        // five un-indexable `LIKE '%x%'` scans across the whole workspace. A
        // blank/whitespace-only q stays a friendly 200-empty (it runs no scan
        // at all — the long-standing contract the suite pins), so the rule is
        // "empty OR 2-200", not a bare minimum.
        custom: {
            options: (value: unknown): boolean => {
                if (typeof value !== "string") return false;
                if (value.length === 0) return true; // blank -> 200 empty
                return value.length >= 2 && value.length <= 200;
            },
            errorMessage:
                "q must be 2-200 characters (a blank q returns empty results)",
        },
    },
    types: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "types must be a comma-separated string" },
        trim: true,
        isLength: {
            options: { max: 200 },
            errorMessage: "types is too long (max 200 chars)",
        },
    },
    limit: {
        in: ["query"],
        optional: true,
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});
