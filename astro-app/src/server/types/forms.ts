import type { Request } from "express";
import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the §18 Forms family. Per the project
 * convention these live alongside the feature, not in `types/index.ts`.
 *
 * All admin endpoints are authenticated (`AuthRequest`); the public submit is
 * the lone unauthenticated route, so it is a bare express `Request`.
 */

/** Validated body for `POST /api/v1/forms` (#4). */
export interface CreateFormBody {
    list_id: string;
    title: string;
    description?: string | null;
    is_public?: boolean;
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    public_slug?: string;
}

/** Validated body for `PATCH /api/v1/forms/:id` (#5). */
export interface UpdateFormBody {
    title?: string;
    description?: string | null;
    is_public?: boolean;
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    public_slug?: string;
}

/** Validated body for `POST /api/v1/forms/:id/fields` (#7). */
export interface AddFieldBody {
    field_kind: "task_attr" | "custom_field";
    field_key: string;
    label: string;
    is_required?: boolean;
    is_hidden?: boolean;
    position?: number;
    placeholder?: string | null;
    help_text?: string | null;
    default_value?: unknown;
}

/** Validated body for `PATCH /api/v1/form-fields/:id` (#8). */
export interface UpdateFieldBody {
    label?: string;
    is_required?: boolean;
    is_hidden?: boolean;
    placeholder?: string | null;
    help_text?: string | null;
    default_value?: unknown;
}

export type ListFormsRequest = AuthRequest;
export type ListByListFormsRequest = AuthRequest;
export type GetFormRequest = AuthRequest;
export type CreateFormRequest = AuthRequest;
export type UpdateFormRequest = AuthRequest;
export type DeleteFormRequest = AuthRequest;
export type AddFieldRequest = AuthRequest;
export type UpdateFieldRequest = AuthRequest;
export type DeleteFieldRequest = AuthRequest;
export type ReorderFieldsRequest = AuthRequest;
export type ListSubmissionsRequest = AuthRequest;

/** Public, unauthenticated `POST /api/v1/public/forms/:slug/submit`. */
export type SubmitFormRequest = Request;
