import { checkSchema } from "express-validator";
import { ID_LENGTH } from "../db/schema/_shared";

/**
 * Team-membership validators (team-access P1). Shape only — the semantic rules
 * (who may manage a roster, head-locked removal, archived teams) live in
 * `TeamMembershipService`.
 */

/** `POST /api/v1/spaces/:id/members` — body `{ user_id }`. */
export const addTeamMemberValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    user_id: {
        in: ["body"],
        isString: { errorMessage: "user_id must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "user_id is required" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `user_id must be at most ${ID_LENGTH} characters`,
        },
    },
});

/** `DELETE /api/v1/spaces/:id/members/:userId`. */
export const removeTeamMemberValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    userId: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "userId must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `userId must be at most ${ID_LENGTH} characters`,
        },
    },
});

/**
 * `PATCH /api/v1/users/:id/team` — body `{ space_id }`, where `null` clears
 * the home team. The key must be PRESENT: an empty body silently clearing
 * someone's team would be a footgun, so absence is a 422, not a default.
 */
export const setHomeTeamValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id must not be empty" },
        isLength: {
            options: { max: ID_LENGTH },
            errorMessage: `id must be at most ${ID_LENGTH} characters`,
        },
    },
    space_id: {
        in: ["body"],
        custom: {
            options: (value: unknown): boolean => {
                if (value === null) return true; // explicit clear
                if (value === undefined) {
                    throw new Error(
                        "space_id is required (null clears the home team)",
                    );
                }
                if (typeof value !== "string" || value.trim() === "") {
                    throw new Error(
                        "space_id must be a non-empty string or null",
                    );
                }
                if (value.length > ID_LENGTH) {
                    throw new Error(
                        `space_id must be at most ${ID_LENGTH} characters`,
                    );
                }
                return true;
            },
        },
    },
});
