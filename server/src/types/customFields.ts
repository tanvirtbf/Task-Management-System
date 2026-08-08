import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §17 Custom Fields. Per the project
 * convention these live alongside the feature, not in `types/index.ts`.
 */

/** A dropdown option as supplied in the create body. */
export interface CustomFieldOptionInput {
    label: string;
    color?: string;
    position?: number;
}

/**
 * Body for `POST /api/v1/custom-fields`. `type` is validated against the 6
 * supported values in the SERVICE (→ 422 `custom_field.unsupported_type`), not
 * the validator, so the spec's marquee error code is emitted. `scope_id` is
 * required when `scope_type` ≠ 'workspace' (checked in the service).
 */
export interface CreateCustomFieldBody {
    scope_type: string;
    scope_id?: string | null;
    name: string;
    type: string;
    config?: Record<string, unknown>;
    is_required?: boolean;
    /** F26 (ISS-042): hide this field's values from guests. */
    hidden_from_guests?: boolean;
    default_value?: unknown;
    position?: number;
    options?: CustomFieldOptionInput[] | null;
}

/**
 * Body for `PATCH /api/v1/custom-fields/:id`. Only name/config/is_required/
 * position are updatable; `type` and `scope` are immutable (the validator
 * rejects them → 422).
 */
export interface UpdateCustomFieldBody {
    name?: string;
    config?: Record<string, unknown>;
    is_required?: boolean;
    hidden_from_guests?: boolean;
    position?: number;
}

/** `GET /api/v1/custom-fields` — optional `?scope_type` / `?scope_id` filter. */
export type ListCustomFieldsRequest = AuthRequest;

/** `GET /api/v1/lists/:listId/custom-fields`. */
export type ListForListCustomFieldsRequest = AuthRequest;

export interface CreateCustomFieldRequest extends AuthRequest {
    body: CreateCustomFieldBody;
}

export interface UpdateCustomFieldRequest extends AuthRequest {
    body: UpdateCustomFieldBody;
}

/** `DELETE /api/v1/custom-fields/:id` — `:id` path param only. */
export type CustomFieldIdRequest = AuthRequest;

/**
 * `PUT /api/v1/tasks/:id/custom-fields/:fieldId`. The body IS the type-specific
 * value envelope (e.g. `{text}` / `{amount,currency}` / `{option_id}` / …);
 * its shape is validated against the field's type in the service.
 */
export interface SetFieldValueRequest extends AuthRequest {
    body: Record<string, unknown>;
}

/** `DELETE /api/v1/tasks/:id/custom-fields/:fieldId` — path params only. */
export type ClearFieldValueRequest = AuthRequest;
