import { checkSchema } from "express-validator";

/**
 * Validator for `POST /api/v1/assistant/chat`.
 *
 * - `message` is required, 1–2000 chars. NOTE: `isString` is placed BEFORE
 *   `trim` on purpose — the `trim` sanitizer stringifies its input, so a
 *   leading `trim` would let a non-string (e.g. a number) slip through.
 * - `history` is an optional array of at most 20 prior turns; each turn must
 *   have a `role` of "user" or "assistant" and string `content` (≤4000 chars).
 *   The service caps history again (MAX_HISTORY_TURNS) as a second guard.
 */
export const chatValidator = checkSchema({
    message: {
        in: ["body"],
        exists: { errorMessage: "message is required" },
        isString: { errorMessage: "message must be a string" },
        trim: true,
        isLength: {
            options: { min: 1, max: 2000 },
            errorMessage: "message must be between 1 and 2000 characters",
        },
    },
    history: {
        in: ["body"],
        optional: true,
        isArray: {
            options: { max: 20 },
            errorMessage: "history must be an array of at most 20 messages",
        },
    },
    "history.*.role": {
        in: ["body"],
        isIn: {
            options: [["user", "assistant"]],
            errorMessage: "history role must be 'user' or 'assistant'",
        },
    },
    "history.*.content": {
        in: ["body"],
        isString: { errorMessage: "history content must be a string" },
        isLength: {
            options: { max: 4000 },
            errorMessage: "history content is too long (max 4000 chars)",
        },
    },
    conversationId: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "conversationId must be a string" },
        isLength: {
            options: { max: 64 },
            errorMessage: "conversationId is too long",
        },
    },
});

/** Validates the `:id` param on GET /api/v1/assistant/conversations/:id. */
export const conversationParamValidator = checkSchema({
    id: {
        in: ["params"],
        isString: { errorMessage: "id must be a string" },
        notEmpty: { errorMessage: "id is required" },
        isLength: { options: { max: 64 }, errorMessage: "id is too long" },
    },
});
