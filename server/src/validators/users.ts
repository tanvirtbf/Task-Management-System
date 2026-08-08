import { checkSchema, type Meta } from "express-validator";
// F12 (ISS-031): the one IANA check, shared — not a second copy. The workspace
// validator has always had it; the user profile had only `isString`.
import { isIanaTimezone } from "./workspace";
import {
    EMAIL_LENGTH,
    ID_LENGTH,
    SHORT_NAME_LENGTH,
    TIMEZONE_LENGTH,
    URL_LENGTH,
    invitationRoles,
    userRoles,
    userStatuses,
} from "../db/schema/_shared";

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
const notRepeated = (field: string) => ({
    options: (_value: unknown, { req }: Meta): boolean => {
        if (Array.isArray(req.query?.[field])) {
            throw new Error(`${field} must not be repeated`);
        }
        return true;
    },
});

export const listUsersValidator = checkSchema({
    status: {
        in: ["query"],
        optional: true,
        custom: notRepeated("status"),
        isIn: {
            options: [[...userStatuses]],
            errorMessage: `status must be one of: ${userStatuses.join(", ")}`,
        },
    },
    role: {
        in: ["query"],
        optional: true,
        custom: notRepeated("role"),
        isIn: {
            options: [[...userRoles]],
            errorMessage: `role must be one of: ${userRoles.join(", ")}`,
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
export const getUserValidator = checkSchema({
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
export const inviteUserValidator = checkSchema({
    first_name: {
        in: ["body"],
        isString: { errorMessage: "first_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "first_name is required" },
        isLength: {
            options: { max: SHORT_NAME_LENGTH },
            errorMessage: `first_name must be at most ${SHORT_NAME_LENGTH} characters`,
        },
    },
    last_name: {
        in: ["body"],
        isString: { errorMessage: "last_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "last_name is required" },
        isLength: {
            options: { max: SHORT_NAME_LENGTH },
            errorMessage: `last_name must be at most ${SHORT_NAME_LENGTH} characters`,
        },
    },
    email: {
        in: ["body"],
        trim: true,
        notEmpty: { errorMessage: "email is required" },
        isEmail: { errorMessage: "Must be a valid email address" },
        isLength: {
            options: { max: EMAIL_LENGTH },
            errorMessage: `email is too long (max ${EMAIL_LENGTH} chars)`,
        },
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.toLowerCase() : value,
        },
    },
    role: {
        in: ["body"],
        isString: { errorMessage: "role must be a string", bail: true },
        isIn: {
            options: [[...invitationRoles]],
            errorMessage: `role must be one of: ${invitationRoles.join(", ")}`,
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
export const patchUserValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    first_name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "first_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "first_name must not be empty" },
        isLength: {
            options: { max: SHORT_NAME_LENGTH },
            errorMessage: `first_name must be at most ${SHORT_NAME_LENGTH} characters`,
        },
    },
    last_name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "last_name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "last_name must not be empty" },
        isLength: {
            options: { max: SHORT_NAME_LENGTH },
            errorMessage: `last_name must be at most ${SHORT_NAME_LENGTH} characters`,
        },
    },
    email: {
        in: ["body"],
        optional: true,
        trim: true,
        notEmpty: { errorMessage: "email must not be empty" },
        isEmail: { errorMessage: "Must be a valid email address" },
        isLength: {
            options: { max: EMAIL_LENGTH },
            errorMessage: `email is too long (max ${EMAIL_LENGTH} chars)`,
        },
        customSanitizer: {
            options: (value: unknown) =>
                typeof value === "string" ? value.toLowerCase() : value,
        },
    },
    timezone: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "timezone must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "timezone must not be empty" },
        isLength: {
            options: { max: TIMEZONE_LENGTH },
            errorMessage: `timezone must be at most ${TIMEZONE_LENGTH} characters`,
        },
        // F12 (ISS-031): the SAME IANA check `PATCH /workspace` has always had.
        // Without it a profile could hold a zone no date library can resolve,
        // and `users.timezone` is on the wire in `GET /users` and `/auth/me` —
        // so any client doing `Intl.DateTimeFormat(…, {timeZone})` threw a
        // RangeError on that row.
        custom: {
            options: (value: unknown): boolean =>
                typeof value === "string" && isIanaTimezone(value),
            errorMessage: "timezone must be a valid IANA zone (e.g. Asia/Dhaka)",
        },
    },
    avatar_url: {
        in: ["body"],
        // `optional: true` skips only `undefined`; an explicit `null` flows into
        // the custom validator below (and is allowed, to clear the avatar).
        optional: true,
        custom: {
            options: (value: unknown): boolean => {
                if (value === null) return true;
                if (typeof value !== "string") {
                    throw new Error("avatar_url must be a string or null");
                }
                if (value.length > URL_LENGTH) {
                    throw new Error(
                        `avatar_url must be at most ${URL_LENGTH} characters`,
                    );
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
export const changeRoleValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    role: {
        in: ["body"],
        isString: { errorMessage: "role must be a string", bail: true },
        isIn: {
            options: [[...invitationRoles]],
            errorMessage: `role must be one of: ${invitationRoles.join(", ")}`,
        },
    },
});
