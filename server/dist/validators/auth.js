"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitationTokenValidator = exports.acceptInvitationValidator = exports.forgotPasswordValidator = exports.changePasswordValidator = exports.resetPasswordValidator = exports.loginValidator = void 0;
const express_validator_1 = require("express-validator");
const passwordPolicy_1 = require("./passwordPolicy");
/**
 * Validators for §2 Authentication endpoints. Pair each `checkSchema(...)`
 * with the `validate` middleware so failures are translated into the spec
 * envelope (422 / `validation.failed`).
 */
exports.loginValidator = (0, express_validator_1.checkSchema)({
    email: {
        in: ["body"],
        // Reject non-string types (array / number / object) BEFORE the `trim`
        // sanitizer can coerce them into a string that would slip past isEmail
        // — e.g. `["a@b.com"].toString() === "a@b.com"`. Declared first so it
        // sees the raw value.
        isString: {
            errorMessage: "Email must be a string",
        },
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
            options: (value) => typeof value === "string" ? value.toLowerCase() : value,
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
/**
 * `POST /api/v1/auth/reset-password`. The raw `token` is bounded (it is hashed
 * server-side; an over-long value can never match a stored 64-char hash, but we
 * cap the input defensively). `new_password` is NOT trimmed — leading/trailing
 * whitespace is a legitimate part of a secret and must be preserved verbatim.
 */
exports.resetPasswordValidator = (0, express_validator_1.checkSchema)({
    token: {
        in: ["body"],
        notEmpty: {
            errorMessage: "Reset token is required",
        },
        isString: {
            errorMessage: "Reset token must be a string",
        },
        isLength: {
            options: { max: 512 },
            errorMessage: "Reset token is too long (max 512 chars)",
        },
    },
    // F12 (ISS-083): the shared policy — complexity + a common-password
    // denylist. See validators/passwordPolicy.ts for the reasoning.
    new_password: passwordPolicy_1.newPasswordSchema,
});
/**
 * `POST /api/v1/auth/change-password` (authenticated). The caller proves
 * possession of the CURRENT password before it can be rotated. `new_password`
 * is NOT trimmed (whitespace can legitimately be part of a secret); 8–200 chars
 * mirrors the reset-password rule.
 */
exports.changePasswordValidator = (0, express_validator_1.checkSchema)({
    current_password: {
        in: ["body"],
        notEmpty: { errorMessage: "Current password is required" },
        isString: { errorMessage: "Current password must be a string" },
        isLength: {
            options: { min: 1, max: 200 },
            errorMessage: "Current password must be between 1 and 200 characters",
        },
    },
    // F12 (ISS-083): the shared policy.
    new_password: passwordPolicy_1.newPasswordSchema,
});
/**
 * `POST /api/v1/auth/forgot-password`. Email-only — mirrors `loginValidator`'s
 * email rules (trim → notEmpty → isEmail → max 255 → lowercase, never
 * `normalizeEmail`) so the lookup key matches login exactly.
 */
exports.forgotPasswordValidator = (0, express_validator_1.checkSchema)({
    email: {
        in: ["body"],
        // Reject non-string types (array / number / object) BEFORE the `trim`
        // sanitizer can coerce them into a string that would slip past isEmail
        // — e.g. `["a@b.com"].toString() === "a@b.com"`. Declared first so it
        // sees the raw value.
        isString: {
            errorMessage: "Email must be a string",
        },
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
        customSanitizer: {
            options: (value) => typeof value === "string" ? value.toLowerCase() : value,
        },
    },
});
/**
 * `POST /api/v1/auth/accept-invitation`. The emailed invitation token is the
 * capability; `password` is the new account's first password — NOT trimmed
 * (whitespace can be part of a secret), 8–200 chars mirroring reset-password.
 */
exports.acceptInvitationValidator = (0, express_validator_1.checkSchema)({
    token: {
        in: ["body"],
        notEmpty: { errorMessage: "Invitation token is required" },
        isString: { errorMessage: "Invitation token must be a string" },
        isLength: {
            options: { max: 512 },
            errorMessage: "Invitation token is too long (max 512 chars)",
        },
    },
    // F12 (ISS-083): the same policy the reset/change paths use.
    password: passwordPolicy_1.newPasswordSchema,
});
/**
 * `GET /api/v1/auth/invitation/:token`. Bounds the path token defensively (it is
 * hashed before lookup; an over-long value can never match a stored 64-char
 * hash, but cap it so the route never builds a needless query).
 */
exports.invitationTokenValidator = (0, express_validator_1.checkSchema)({
    token: {
        in: ["params"],
        notEmpty: { errorMessage: "Invitation token is required" },
        isString: { errorMessage: "Invitation token must be a string" },
        isLength: {
            options: { max: 512 },
            errorMessage: "Invitation token is too long (max 512 chars)",
        },
    },
});
