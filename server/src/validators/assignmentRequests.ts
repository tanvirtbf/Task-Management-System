import { checkSchema } from "express-validator";

/**
 * Validators for the assignment-approval endpoints (team-access P8). Pair each
 * with the `validate` middleware so failures become the spec envelope
 * (422 / `validation.failed`). Notes share the 500-char column width.
 */

const NOTE_MAX = 500;

/** `GET /api/v1/assignment-requests` — box + status filters. */
export const listAssignmentRequestsValidator = checkSchema({
    box: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["received", "sent", "team"]],
            errorMessage: "box must be one of: received, sent, team",
        },
    },
    status: {
        in: ["query"],
        optional: true,
        isIn: {
            options: [["pending", "all"]],
            errorMessage: "status must be one of: pending, all",
        },
    },
});

/** POST accept/decline — an optional note. */
export const decideAssignmentRequestValidator = checkSchema({
    note: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: { errorMessage: "note must be a string" },
        isLength: {
            options: { max: NOTE_MAX },
            errorMessage: `note must be at most ${NOTE_MAX} characters`,
        },
    },
});

/** POST query — the receiver's ask: a note (required) + optional date. */
export const queryAssignmentRequestValidator = checkSchema({
    note: {
        in: ["body"],
        exists: { errorMessage: "note is required" },
        isString: { errorMessage: "note must be a string" },
        trim: true,
        isLength: {
            options: { min: 1, max: NOTE_MAX },
            errorMessage: `note must be 1-${NOTE_MAX} characters`,
        },
    },
    proposed_due_date: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "proposed_due_date must be a YYYY-MM-DD date",
        },
    },
});

/**
 * POST answer — the requester's reply: a note and/or a real due-date change.
 * At least one of the two must be present, or there is nothing to answer with.
 */
export const answerAssignmentRequestValidator = checkSchema({
    note: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: { errorMessage: "note must be a string" },
        trim: true,
        isLength: {
            options: { max: NOTE_MAX },
            errorMessage: `note must be at most ${NOTE_MAX} characters`,
        },
    },
    due_date: {
        in: ["body"],
        optional: true,
        isDate: {
            options: { format: "YYYY-MM-DD", strictMode: true },
            errorMessage: "due_date must be a YYYY-MM-DD date",
        },
    },
    _answer_has_content: {
        in: ["body"],
        custom: {
            options: (_value, { req }): boolean => {
                const body = (req.body ?? {}) as {
                    note?: unknown;
                    due_date?: unknown;
                };
                const hasNote =
                    typeof body.note === "string" && body.note.trim() !== "";
                if (!hasNote && body.due_date === undefined) {
                    throw new Error(
                        "provide a note, a due_date, or both",
                    );
                }
                return true;
            },
        },
    },
});
