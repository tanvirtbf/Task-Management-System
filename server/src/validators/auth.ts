import { checkSchema } from "express-validator";

/**
 * Validators for §2 Authentication endpoints. Pair each `checkSchema(...)`
 * with the `validate` middleware so failures are translated into the spec
 * envelope (422 / `validation.failed`).
 */

export const loginValidator = checkSchema({
    email: {
        in: ["body"],
        trim: true,
        notEmpty: {
            errorMessage: "Email is required",
        },
        isEmail: {
            errorMessage: "Must be a valid email address",
        },
        isLength: {
            options: { max: 255 },
            errorMessage: "Email is too long (max 255 chars)",
        },
        // Lowercase only — we deliberately avoid express-validator's
        // `normalizeEmail` because its defaults strip `+` aliases and dots for
        // gmail addresses, which would silently change the lookup key.
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.toLowerCase() : value,
        },
    },
    password: {
        in: ["body"],
        notEmpty: {
            errorMessage: "Password is required",
        },
        isString: {
            errorMessage: "Password must be a string",
        },
        isLength: {
            options: { min: 1, max: 200 },
            errorMessage: "Password must be between 1 and 200 characters",
        },
    },
});
