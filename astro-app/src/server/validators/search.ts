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
        isLength: {
            options: { max: 200 },
            errorMessage: "q is too long (max 200 chars)",
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
