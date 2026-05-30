import { checkSchema } from "express-validator";
import { formFieldKinds } from "../db/schema/_shared";

/**
 * Validators for the §18 Forms family. Pair each `checkSchema(...)` with the
 * `validate` middleware so a failure becomes the spec envelope (422
 * `validation.failed`). Deeper, cross-row rules (slug uniqueness, field_key →
 * task attr / custom field resolution, per-type value shapes) live in the
 * service — these only assert the request is well-formed.
 */

const MAX_ID_LENGTH = 64;
const MAX_FIELD_KEY = 120; // form_fields.field_key VARCHAR(120) — holds a custom_fields.id
const MAX_TITLE = 200;
const MAX_LABEL = 200;
const MAX_TEXT = 2000; // forms.description VARCHAR(2000)
const MAX_HELP = 500; // form_fields.help_text VARCHAR(500)
const MAX_SLUG = 80;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isPlainObject = (value: unknown): boolean =>
    value !== null && typeof value === "object" && !Array.isArray(value);

/** `GET /api/v1/lists/:listId/forms` (#2). */
export const listByListFormsValidator = checkSchema({
    listId: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
});

/** Shared `:id` path-param check for the form-addressed endpoints (#3/#5/#6/#7/#10/#11). */
export const formIdParamValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
});

/** Shared `:id` path-param check for the field-addressed endpoints (#8/#9). */
export const fieldIdParamValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
});

/** `POST /api/v1/forms` (#4). */
export const createFormValidator = checkSchema({
    list_id: {
        in: ["body"],
        isString: { errorMessage: "list_id is required" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    title: {
        in: ["body"],
        isString: { errorMessage: "title is required" },
        trim: true,
        isLength: {
            options: { min: 1, max: MAX_TITLE },
            errorMessage: `title must be 1–${MAX_TITLE} characters`,
        },
    },
    description: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_TEXT } },
    },
    is_public: {
        in: ["body"],
        optional: true,
        isBoolean: { errorMessage: "is_public must be a boolean" },
        toBoolean: true,
    },
    public_slug: {
        in: ["body"],
        optional: true,
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_SLUG } },
        matches: {
            options: SLUG_RE,
            errorMessage:
                "public_slug must be lowercase alphanumeric words joined by hyphens",
        },
    },
    settings: {
        in: ["body"],
        optional: true,
        custom: {
            options: (v: unknown) => {
                if (!isPlainObject(v)) throw new Error("settings must be an object");
                return true;
            },
        },
    },
    branding: {
        in: ["body"],
        optional: true,
        custom: {
            options: (v: unknown) => {
                if (!isPlainObject(v)) throw new Error("branding must be an object");
                return true;
            },
        },
    },
});

/** `PATCH /api/v1/forms/:id` (#5). At-least-one-field is enforced in the controller. */
export const updateFormValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    title: {
        in: ["body"],
        optional: true,
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_TITLE } },
    },
    description: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_TEXT } },
    },
    is_public: {
        in: ["body"],
        optional: true,
        isBoolean: { errorMessage: "is_public must be a boolean" },
        toBoolean: true,
    },
    public_slug: {
        in: ["body"],
        optional: true,
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_SLUG } },
        matches: {
            options: SLUG_RE,
            errorMessage:
                "public_slug must be lowercase alphanumeric words joined by hyphens",
        },
    },
    settings: {
        in: ["body"],
        optional: true,
        custom: {
            options: (v: unknown) => {
                if (!isPlainObject(v)) throw new Error("settings must be an object");
                return true;
            },
        },
    },
    branding: {
        in: ["body"],
        optional: true,
        custom: {
            options: (v: unknown) => {
                if (!isPlainObject(v)) throw new Error("branding must be an object");
                return true;
            },
        },
    },
});

/** `POST /api/v1/forms/:id/fields` (#7). */
export const addFieldValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    field_kind: {
        in: ["body"],
        isIn: {
            options: [formFieldKinds],
            errorMessage: `field_kind must be one of: ${formFieldKinds.join(", ")}`,
        },
    },
    field_key: {
        in: ["body"],
        isString: { errorMessage: "field_key is required" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_FIELD_KEY } },
    },
    label: {
        in: ["body"],
        isString: { errorMessage: "label is required" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_LABEL } },
    },
    is_required: {
        in: ["body"],
        optional: true,
        isBoolean: true,
        toBoolean: true,
    },
    is_hidden: {
        in: ["body"],
        optional: true,
        isBoolean: true,
        toBoolean: true,
    },
    position: {
        in: ["body"],
        optional: true,
        isInt: { options: { min: 0 }, errorMessage: "position must be ≥ 0" },
        toInt: true,
    },
    placeholder: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_LABEL } },
    },
    help_text: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_HELP } },
    },
    // default_value is an opaque JSON value — accepted as-is (any type).
    default_value: { in: ["body"], optional: { options: { nullable: true } } },
});

/** `PATCH /api/v1/form-fields/:id` (#8). At-least-one enforced in the controller. */
export const updateFieldValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    label: {
        in: ["body"],
        optional: true,
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_LABEL } },
    },
    is_required: {
        in: ["body"],
        optional: true,
        isBoolean: true,
        toBoolean: true,
    },
    is_hidden: {
        in: ["body"],
        optional: true,
        isBoolean: true,
        toBoolean: true,
    },
    placeholder: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_LABEL } },
    },
    help_text: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        isLength: { options: { max: MAX_HELP } },
    },
    default_value: { in: ["body"], optional: { options: { nullable: true } } },
});

/** `PATCH /api/v1/forms/:id/fields/reorder` (#10). */
export const reorderFieldsValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    items: {
        in: ["body"],
        isArray: {
            options: { min: 1 },
            errorMessage: "items must be a non-empty array",
        },
    },
    "items.*.id": {
        in: ["body"],
        isString: { errorMessage: "each item needs a field id" },
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    "items.*.position": {
        in: ["body"],
        isInt: { options: { min: 0 }, errorMessage: "position must be ≥ 0" },
        toInt: true,
    },
});

/** `GET /api/v1/forms/:id/submissions` (#11). */
export const listSubmissionsValidator = checkSchema({
    id: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_ID_LENGTH } },
    },
    cursor: {
        in: ["query"],
        optional: true,
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: 256 } },
    },
    limit: {
        in: ["query"],
        optional: true,
        isInt: {
            options: { min: 1, max: 100 },
            errorMessage: "limit must be between 1 and 100",
        },
        toInt: true,
    },
});

/** `POST /api/v1/public/forms/:slug/submit` (🔓). */
export const submitFormValidator = checkSchema({
    slug: {
        in: ["params"],
        isString: true,
        trim: true,
        isLength: { options: { min: 1, max: MAX_SLUG } },
    },
    data: {
        in: ["body"],
        custom: {
            options: (v: unknown) => {
                if (!isPlainObject(v)) throw new Error("data must be an object");
                return true;
            },
        },
    },
});
