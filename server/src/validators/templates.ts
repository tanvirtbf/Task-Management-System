import { checkSchema, type Schema } from "express-validator";
import { templateTypes } from "../db/schema/_shared";

/**
 * Validators for §23 Templates. Pair each `checkSchema(...)` with the `validate`
 * middleware so failures render the spec envelope (422 / `validation.failed`).
 *
 * Shape-only here: the cross-resource rules (`structure.taskTypeId` / `tags[]`
 * must exist in the workspace) and the "checklist must be non-empty" rule live
 * in the service, so they can emit the dedicated `template.*` error codes
 * (`template.invalid_task_type`, `template.empty_structure`) instead of a
 * generic `validation.failed`.
 */

const MAX_ID_LENGTH = 64; // VARCHAR(64) primary keys
const MAX_NAME_LENGTH = 120; // templates.name VARCHAR(120)
const MAX_ICON_LENGTH = 60; // templates.icon VARCHAR(60)
const MAX_DESCRIPTION_LENGTH = 5000; // templates.description TEXT (defensive cap)
const MAX_CHECKLIST_NAME_LENGTH = 200; // checklists.name VARCHAR(200)
const MAX_CHECKLIST_ITEM_TEXT_LENGTH = 500; // checklist_items.text VARCHAR(500)
const MAX_STRUCTURE_DESCRIPTION_LENGTH = 20000; // Tiptap JSON can be large
const MAX_QUERY_LENGTH = 120;

// templates.color is CHAR(7); enforce the `#RRGGBB` format here (no DB CHECK).
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/** `GET /api/v1/templates` — optional `?type=` and `?q=` filters. */
export const listTemplatesValidator = checkSchema({
    type: {
        in: ["query"],
        optional: true,
        trim: true,
        isIn: {
            options: [templateTypes],
            errorMessage: "type must be one of task, list, space",
        },
    },
    q: {
        in: ["query"],
        optional: true,
        isString: { errorMessage: "q must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_QUERY_LENGTH },
            errorMessage: "q is too long (max 120 chars)",
        },
    },
});

/** `:id` path-param-only validator, shared by GET-one / DELETE / apply. */
export const templateIdParamValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
});

// Nested `structure.*` rules — reused by create (structure required) and update
// (structure optional). The wildcard paths simply match nothing when
// `structure` is absent, so they are inert on an update that omits it.
const structureFieldRules: Schema = {
    "structure.taskTypeId": {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "structure.taskTypeId must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "structure.taskTypeId is too long (max 64 chars)",
        },
    },
    "structure.priority": {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 4 },
            errorMessage: "structure.priority must be an integer between 0 and 4",
        },
    },
    "structure.tags": {
        in: ["body"],
        optional: true,
        isArray: { errorMessage: "structure.tags must be an array" },
    },
    "structure.tags.*": {
        in: ["body"],
        isString: { errorMessage: "each tag id must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "tag id is too long (max 64 chars)",
        },
    },
    "structure.checklistName": {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "structure.checklistName must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_CHECKLIST_NAME_LENGTH },
            errorMessage: "structure.checklistName is too long (max 200 chars)",
        },
    },
    "structure.checklistItems": {
        in: ["body"],
        optional: true,
        // F29 (ISS-068): the SECOND entry point to the same unbounded surface —
        // a template carrying 2,000 items was accepted (201) and applying it
        // would materialise all of them in one transaction. Bounded together
        // with `bulkAddItemsValidator`, at the same 200.
        isArray: {
            options: { max: 200 },
            errorMessage:
                "structure.checklistItems must be an array of at most 200 items",
        },
    },
    "structure.checklistItems.*.text": {
        in: ["body"],
        isString: { errorMessage: "each checklist item text must be a string" },
        trim: true,
        notEmpty: { errorMessage: "each checklist item must have non-empty text" },
        isLength: {
            options: { max: MAX_CHECKLIST_ITEM_TEXT_LENGTH },
            errorMessage: "checklist item text is too long (max 500 chars)",
        },
    },
    "structure.checklistItems.*.dueOffsetDays": {
        in: ["body"],
        optional: true,
        isInt: {
            options: { min: 0, max: 3650 },
            errorMessage: "dueOffsetDays must be a non-negative integer",
        },
    },
    "structure.description": {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "structure.description must be a string" },
        isLength: {
            options: { max: MAX_STRUCTURE_DESCRIPTION_LENGTH },
            errorMessage: "structure.description is too long",
        },
    },
};

/** `POST /api/v1/templates`. */
export const createTemplateValidator = checkSchema({
    type: {
        in: ["body"],
        isString: { errorMessage: "type must be a string" },
        trim: true,
        notEmpty: { errorMessage: "type is required" },
        isIn: {
            options: [templateTypes],
            errorMessage: "type must be one of task, list, space",
        },
    },
    name: {
        in: ["body"],
        isString: { errorMessage: "name must be a string" },
        trim: true,
        notEmpty: { errorMessage: "name is required" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 120 chars)",
        },
    },
    description: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "description must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_DESCRIPTION_LENGTH },
            errorMessage: "description is too long (max 5000 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "icon must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_ICON_LENGTH },
            errorMessage: "icon is too long (max 60 chars)",
        },
    },
    color: {
        in: ["body"],
        optional: { options: { values: "null" } },
        trim: true,
        matches: {
            options: HEX_COLOR_RE,
            errorMessage: "color must be a hex value like #10B981",
        },
    },
    // Required object. `isObject({strict})` on an absent value fails, which is
    // how "structure is required" is enforced without a separate notEmpty (that
    // would stringify the object and misfire).
    structure: {
        in: ["body"],
        isObject: {
            options: { strict: true },
            errorMessage: "structure is required and must be an object",
        },
    },
    ...structureFieldRules,
});

/** `PATCH /api/v1/templates/:id`. */
export const updateTemplateValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    name: {
        in: ["body"],
        optional: true,
        isString: { errorMessage: "name must be a string" },
        trim: true,
        notEmpty: { errorMessage: "name must not be empty" },
        isLength: {
            options: { max: MAX_NAME_LENGTH },
            errorMessage: "name is too long (max 120 chars)",
        },
    },
    description: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "description must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_DESCRIPTION_LENGTH },
            errorMessage: "description is too long (max 5000 chars)",
        },
    },
    icon: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "icon must be a string" },
        trim: true,
        isLength: {
            options: { max: MAX_ICON_LENGTH },
            errorMessage: "icon is too long (max 60 chars)",
        },
    },
    color: {
        in: ["body"],
        optional: { options: { values: "null" } },
        trim: true,
        matches: {
            options: HEX_COLOR_RE,
            errorMessage: "color must be a hex value like #10B981",
        },
    },
    // Optional on update; when present it is a full replacement and must be an
    // object. The shared `structureFieldRules` validate its contents.
    structure: {
        in: ["body"],
        optional: true,
        isObject: {
            options: { strict: true },
            errorMessage: "structure must be an object",
        },
    },
    ...structureFieldRules,
});

/** `POST /api/v1/templates/:id/apply`. */
export const applyTemplateValidator = checkSchema({
    id: {
        in: ["params"],
        trim: true,
        notEmpty: { errorMessage: "id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "id is too long (max 64 chars)",
        },
    },
    list_id: {
        in: ["body"],
        isString: { errorMessage: "list_id must be a string" },
        trim: true,
        notEmpty: { errorMessage: "list_id is required" },
        isLength: {
            options: { max: MAX_ID_LENGTH },
            errorMessage: "list_id is too long (max 64 chars)",
        },
    },
    task_name: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isString: { errorMessage: "task_name must be a string" },
        trim: true,
        isLength: {
            options: { max: 500 },
            errorMessage: "task_name is too long (max 500 chars)",
        },
    },
    anchor_date: {
        in: ["body"],
        optional: { options: { values: "null" } },
        isISO8601: {
            options: { strict: true },
            errorMessage: "anchor_date must be an ISO date (YYYY-MM-DD)",
        },
    },
});
