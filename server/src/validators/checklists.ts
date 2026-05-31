import { checkSchema, type ParamSchema } from "express-validator";

/**
 * Validators for §15 Checklists. Pair each `checkSchema(...)` with the `validate`
 * middleware so a failure renders the spec envelope (422 / `validation.failed`).
 * Shape-only here — ownership + workspace scope are row-dependent and live in the
 * service.
 */

const MAX_ID = 64;
const MAX_NAME = 200; // checklists.name varchar(200)
const MAX_TEXT = 500; // checklist_items.text varchar(500)

const idParam = (): ParamSchema => ({
    in: ["params"],
    trim: true,
    notEmpty: { errorMessage: "id is required" },
    isLength: {
        options: { max: MAX_ID },
        errorMessage: `id is too long (max ${MAX_ID} chars)`,
    },
});

/** Optional, nullable id-shaped body field (assignee_id / parent_item_id). */
const optionalId = (field: string): ParamSchema => ({
    in: ["body"],
    optional: { options: { nullable: true } },
    isString: { errorMessage: `${field} must be a string or null` },
    trim: true,
    isLength: {
        options: { max: MAX_ID },
        errorMessage: `${field} is too long (max ${MAX_ID} chars)`,
    },
});

const optionalPosition: ParamSchema = {
    in: ["body"],
    optional: true,
    isInt: {
        options: { min: 0 },
        errorMessage: "position must be a non-negative integer",
    },
    toInt: true,
};

/** `GET /tasks/:id/checklists`. */
export const listChecklistsValidator = checkSchema({ id: idParam() });

/** `POST /tasks/:id/checklists`. */
export const createChecklistValidator = checkSchema({
    id: idParam(),
    name: {
        in: ["body"],
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: MAX_NAME },
            errorMessage: `name is too long (max ${MAX_NAME} chars)`,
        },
    },
});

/** `PATCH /checklists/:id`. */
export const updateChecklistValidator = checkSchema({
    id: idParam(),
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "name cannot be empty" },
        isLength: {
            options: { max: MAX_NAME },
            errorMessage: `name is too long (max ${MAX_NAME} chars)`,
        },
    },
    position: optionalPosition,
});

/** `DELETE /checklists/:id` & `POST /checklists/:id/items*` (param shared). */
export const checklistIdParamValidator = checkSchema({ id: idParam() });

/** `POST /checklists/:id/items`. */
export const addItemValidator = checkSchema({
    id: idParam(),
    text: {
        in: ["body"],
        isString: { errorMessage: "text must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "text is required" },
        isLength: {
            options: { max: MAX_TEXT },
            errorMessage: `text is too long (max ${MAX_TEXT} chars)`,
        },
    },
    assignee_id: optionalId("assignee_id"),
    parent_item_id: optionalId("parent_item_id"),
    position: optionalPosition,
});

/** `POST /checklists/:id/items/bulk` — `{ texts: string[] }` (template apply). */
export const bulkAddItemsValidator = checkSchema({
    id: idParam(),
    texts: {
        in: ["body"],
        isArray: {
            options: { min: 1 },
            errorMessage: "texts must be a non-empty array",
        },
    },
    "texts.*": {
        in: ["body"],
        isString: { errorMessage: "each text must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "text cannot be empty" },
        isLength: {
            options: { max: MAX_TEXT },
            errorMessage: `text is too long (max ${MAX_TEXT} chars)`,
        },
    },
});

/** `PATCH /checklist-items/:id`. */
export const updateItemValidator = checkSchema({
    id: idParam(),
    text: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "text must be a string", bail: true },
        trim: true,
        notEmpty: { errorMessage: "text cannot be empty" },
        isLength: {
            options: { max: MAX_TEXT },
            errorMessage: `text is too long (max ${MAX_TEXT} chars)`,
        },
    },
    assignee_id: optionalId("assignee_id"),
    position: optionalPosition,
});

/** `POST /checklist-items/:id/toggle` & `DELETE /checklist-items/:id`. */
export const itemIdParamValidator = checkSchema({ id: idParam() });
