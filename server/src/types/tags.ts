import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the Tags resource family (§9).
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

/**
 * Body for `POST /api/v1/tags`. `color` is optional — the controller applies
 * the schema default (`#94A3B8`) when it is omitted. The validator has already
 * trimmed both fields and enforced the hex-colour format.
 */
export interface CreateTagBody {
    name: string;
    color?: string;
}

export interface CreateTagRequest extends AuthRequest {
    body: CreateTagBody;
}

/**
 * Body for `PATCH /api/v1/tags/:id`. Both fields are optional (partial update),
 * but the validator guarantees at least one is present; when present they are
 * trimmed and (for `color`) hex-validated. `name`/`color` are the only writable
 * fields — the tag id comes from the path, the workspace from the access token.
 */
export interface UpdateTagBody {
    name?: string;
    color?: string;
}

export interface UpdateTagRequest extends AuthRequest {
    body: UpdateTagBody;
}
