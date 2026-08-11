"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeRoleValidator = exports.patchUserValidator = exports.inviteUserValidator = exports.getUserValidator = exports.listUsersValidator = void 0;
const express_validator_1 = require("express-validator");
// F12 (ISS-031): the one IANA check, shared — not a second copy. The workspace
// validator has always had it; the user profile had only `isString`.
const workspace_1 = require("./workspace");
const _shared_1 = require("../db/schema/_shared");
/**
 * Query validators for `GET /api/v1/users`. Pair each `checkSchema(...)` with
 * the `validate` middleware so failures render as 422 `validation.failed`.
 *
 * `role` accepts the full role set (incl. `owner`) — a superset of the spec's
 * `admin|member|guest` filter; filtering for the workspace owner is useful and
 * harmless. `limit` is coerced to an int here and clamped to ≤200 in the
 * service.
 */
/**
 * Reject a repeated query param. A duplicated key (`?limit=1&limit=2`) arrives
 * as an array, which express-validator otherwise validates element-by-element
 * (so it passes) and then flows into a scalar filter — producing a `NaN` limit
 * or a 500 from the query builder. We check the raw `req.query` value because
 * the per-element `value` hides the array.
 */
const notRepeated = (field) => ({
    options: (_value, { req }) => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});
exports.listUsersValidator = (0, express_validator_1.checkSchema)({
    status: {
        in: ["query"],
        optional: true,
        custom: notRepeated("status"),
        isIn: {
            options: [[..._shared_1.userStatuses]],
            errorMessage: `status must be one of: ${_shared_1.userStatuses.join(", ")}`,
        },
    },
    role: {
        in: ["query"],
        optional: true,
        custom: notRepeated("role"),
        isIn: {
            options: [[..._shared_1.userRoles]],
            errorMessage: `role must be one of: ${_shared_1.userRoles.join(", ")}`,
        },
    },
    q: {
        in: ["query"],
        optional: true,
        custom: notRepeated("q"),
        trim: true,
        isLength: {
            options: { max: 100 },
            errorMessage: "q must be at most 100 characters",
        },
    },
    cursor: {
        in: ["query"],
        optional: true,
        custom: notRepeated("cursor"),
        isString: {
            errorMessage: "cursor must be a string",
        },
        notEmpty: {
            errorMessage: "cursor must not be empty",
        },
    },
    limit: {
        in: ["query"],
        optional: true,
        custom: notRepeated("limit"),
        isInt: {
            options: { min: 1 },
            errorMessage: "limit must be a positive integer",
        },
        toInt: true,
    },
});
/**
 * Path-param validator for `GET /api/v1/users/:id`. The id is client input here
 * (unlike `/auth/me`, where it comes from the token), so trim it, reject an
 * empty value, and cap it at the `users.id` column width (VARCHAR(64)) — an
 * over-long id can never match a row, so failing it as a clean 422 beats a
 * pointless query. The lookup itself is workspace-scoped in the service.
 */
exports.getUserValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: {
            errorMessage: "id must not be empty",
        },
        isLength: {
            options: { max: 64 },
            errorMessage: "id must be at most 64 characters",
        },
    },
});
/**
 * Body validator for `POST /api/v1/users/invite` (👑 admin/owner).
 *
 * Names are required, trimmed in place, and capped at the `users` column width
 * (VARCHAR(80)). `email` mirrors `loginValidator`: trimmed, format-checked,
 * length-capped, and lowercased via a custom sanitizer (NOT `normalizeEmail`,
 * which would mangle `+` aliases / gmail dots and change the dedupe key).
 * `role` is the invitation set only — `owner` is rejected here, so the invite
 * path can never mint a second workspace owner.
 */
exports.inviteUserValidator = (0, express_validator_1.checkSchema)({
    first_name: {
        in: ["body"],
        isString: { errorMessage: "first_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "first_name is required" },
        isLength: {
            options: { max: _shared_1.SHORT_NAME_LENGTH },
            errorMessage: `first_name must be at most ${_shared_1.SHORT_NAME_LENGTH} characters`,
        },
    },
    last_name: {
        in: ["body"],
        isString: { errorMessage: "last_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "last_name is required" },
        isLength: {
            options: { max: _shared_1.SHORT_NAME_LENGTH },
            errorMessage: `last_name must be at most ${_shared_1.SHORT_NAME_LENGTH} characters`,
        },
    },
    email: {
        in: ["body"],
        trim: true,
        notEmpty: { errorMessage: "email is required" },
        isEmail: { errorMessage: "Must be a valid email address" },
        isLength: {
            options: { max: _shared_1.EMAIL_LENGTH },
            errorMessage: `email is too long (max ${_shared_1.EMAIL_LENGTH} chars)`,
        },
        customSanitizer: {
            options: (value) => typeof value === "string" ? value.toLowerCase() : value,
        },
    },
    role: {
        in: ["body"],
        isString: { errorMessage: "role must be a string", bail: true },
        isIn: {
            options: [[..._shared_1.invitationRoles]],
            errorMessage: `role must be one of: ${_shared_1.invitationRoles.join(", ")}`,
        },
    },
    // Team-access P1 (B3): the team the person is invited into. Optional on
    // the wire (the client form requires it); `null` explicitly allowed —
    // same optional-null treatment as `avatar_url` below. Existence /
    // archived-ness is the service's 422.
    space_id: {
        in: ["body"],
        optional: true,
        custom: {
            options: (value) => {
                if (value === null)
                    return true;
                if (typeof value !== "string" || value.trim() === "") {
                    throw new Error("space_id must be a non-empty string or null");
                }
                if (value.length > _shared_1.ID_LENGTH) {
                    throw new Error(`space_id must be at most ${_shared_1.ID_LENGTH} characters`);
                }
                return true;
            },
        },
    },
});
/**
 * Body + param validator for `PATCH /api/v1/users/:id` (🔐 self / 👑 admin).
 *
 * Every body field is OPTIONAL (a partial update) but, when present, must be
 * valid. `role` and `status` are deliberately NOT in the schema — a profile
 * edit can never change privilege or lifecycle (those are §4 #5 / #6 / #7), so
 * a stray `role`/`status` is dropped by `matchedData`, not persisted.
 * `avatar_url` accepts an http(s) URL or an explicit `null` (to clear it). The
 * "at least one field" requirement is enforced in the controller —
 * express-validator has no first-class cross-field "require one of" rule.
 */
exports.patchUserValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: _shared_1.ID_LENGTH },
            errorMessage: `id must be at most ${_shared_1.ID_LENGTH} characters`,
        },
    },
    first_name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "first_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "first_name must not be empty" },
        isLength: {
            options: { max: _shared_1.SHORT_NAME_LENGTH },
            errorMessage: `first_name must be at most ${_shared_1.SHORT_NAME_LENGTH} characters`,
        },
    },
    last_name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "last_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "last_name must not be empty" },
        isLength: {
            options: { max: _shared_1.SHORT_NAME_LENGTH },
            errorMessage: `last_name must be at most ${_shared_1.SHORT_NAME_LENGTH} characters`,
        },
    },
    email: {
        in: ["body"],
        optional: true,
        trim: true,
        notEmpty: { errorMessage: "email must not be empty" },
        isEmail: { errorMessage: "Must be a valid email address" },
        isLength: {
            options: { max: _shared_1.EMAIL_LENGTH },
            errorMessage: `email is too long (max ${_shared_1.EMAIL_LENGTH} chars)`,
        },
        customSanitizer: {
            options: (value) => typeof value === "string" ? value.toLowerCase() : value,
        },
    },
    timezone: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "timezone must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "timezone must not be empty" },
        isLength: {
            options: { max: _shared_1.TIMEZONE_LENGTH },
            errorMessage: `timezone must be at most ${_shared_1.TIMEZONE_LENGTH} characters`,
        },
        // F12 (ISS-031): the SAME IANA check `PATCH /workspace` has always had.
        // Without it a profile could hold a zone no date library can resolve,
        // and `users.timezone` is on the wire in `GET /users` and `/auth/me` —
        // so any client doing `Intl.DateTimeFormat(…, {timeZone})` threw a
        // RangeError on that row.
        custom: {
            options: (value) => typeof value === "string" && (0, workspace_1.isIanaTimezone)(value),
            errorMessage: "timezone must be a valid IANA zone (e.g. Asia/Dhaka)",
        },
    },
    avatar_url: {
        in: ["body"],
        // `optional: true` skips only `undefined`; an explicit `null` flows into
        // the custom validator below (and is allowed, to clear the avatar).
        optional: true,
        custom: {
            options: (value) => {
                if (value === null)
                    return true;
                if (typeof value !== "string") {
                    throw new Error("avatar_url must be a string or null");
                }
                if (value.length > _shared_1.URL_LENGTH) {
                    throw new Error(`avatar_url must be at most ${_shared_1.URL_LENGTH} characters`);
                }
                if (!/^https?:\/\/.+/i.test(value)) {
                    throw new Error("avatar_url must be an http(s) URL");
                }
                return true;
            },
        },
    },
});
/**
 * Body + param validator for `PATCH /api/v1/users/:id/role` (👑 admin/owner).
 *
 * `role` is required and constrained to the invitation set (`admin|member|guest`)
 * — `owner` is rejected here (422), so a role change can never create a second
 * workspace owner. The row-level rules ("owner's role is immutable here",
 * "cannot change your own role") are enforced in the service, not the validator.
 */
exports.changeRoleValidator = (0, express_validator_1.checkSchema)({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: _shared_1.ID_LENGTH },
            errorMessage: `id must be at most ${_shared_1.ID_LENGTH} characters`,
        },
    },
    role: {
        in: ["body"],
        isString: { errorMessage: "role must be a string", bail: true },
        isIn: {
            options: [[..._shared_1.invitationRoles]],
            errorMessage: `role must be one of: ${_shared_1.invitationRoles.join(", ")}`,
        },
    },
});
