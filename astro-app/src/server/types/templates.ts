import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §23 Templates.
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`).
 */

/** §23 template type. V1 ships only `task`; `list`/`space` are reserved for V2. */
export type TemplateType = "task" | "list" | "space";

/**
 * One checklist step inside a template's `structure`. `dueOffsetDays` is the
 * offset (in days) from the `anchor_date` supplied at apply time; absent means
 * the materialised item carries no due date.
 */
export interface TemplateChecklistItemInput {
    text: string;
    dueOffsetDays?: number;
}

/**
 * The JSON `structure` payload stored on a template. Keys are **camelCase** to
 * match the wire examples in API_DESIGN.md §23 and `client/src/types/template.ts`
 * (the inline snake_case interface block in API_DESIGN.md Appendix A is the
 * outlier — see the build notes). `checklistItems` must be present and
 * non-empty on create; that rule is enforced in the service as
 * `template.empty_structure` (not the validator) so it emits the spec error
 * code rather than a generic `validation.failed`.
 */
export interface TemplateStructure {
    /** Default task type applied when the template is used; must exist in the workspace. */
    taskTypeId?: string;
    /** Default priority 0-4. */
    priority?: number;
    /** Default tag ids; each must exist in the workspace. */
    tags?: string[];
    /** Checklist label shown on the materialised task. */
    checklistName?: string;
    checklistItems?: TemplateChecklistItemInput[];
    /** Pre-filled description (plain text for ops, Tiptap JSON for dev). */
    description?: string;
}

/**
 * Validated body of `POST /api/v1/templates`. `type`/`name`/`structure` are
 * required; `description`/`icon`/`color` are optional. `id`, `workspace_id`,
 * `usage_count`, and `created_by` are server-owned and are deliberately NOT
 * read off the body (mass-assignment guard).
 */
export interface CreateTemplateBody {
    type: TemplateType;
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure: TemplateStructure;
}

/**
 * `POST /api/v1/templates`. The workspace to create in and the acting user both
 * come from `req.auth` (set by `authenticate`); the payload is `req.body`.
 */
export interface CreateTemplateRequest extends AuthRequest {
    body: CreateTemplateBody;
}

/**
 * Validated body of `PATCH /api/v1/templates/:id`. Every field is optional —
 * the controller builds a patch from only the keys actually present. `type` is
 * immutable and `usage_count` is read-only, so neither is accepted here; both
 * are ignored if sent. `structure`, when supplied, is a **full replacement** of
 * the stored structure (not a deep merge).
 */
export interface UpdateTemplateBody {
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure?: TemplateStructure;
}

/**
 * `PATCH /api/v1/templates/:id`. Workspace + actor come from `req.auth`; the
 * target id is `req.params.id` and the payload is `req.body`.
 */
export interface UpdateTemplateRequest extends AuthRequest {
    body: UpdateTemplateBody;
}

/**
 * Validated body of `POST /api/v1/templates/:id/apply`. `list_id` is required
 * (the target list); `task_name` defaults to the template's name; `anchor_date`
 * is accepted + format-validated but not materialised (no per-item due-date
 * column — see `TemplateApplyService`).
 */
export interface ApplyTemplateBody {
    list_id: string;
    task_name?: string;
    anchor_date?: string | null;
}

/**
 * `POST /api/v1/templates/:id/apply`. Workspace + actor come from `req.auth`;
 * the template id is `req.params.id` and the payload is `req.body`.
 */
export interface ApplyTemplateRequest extends AuthRequest {
    body: ApplyTemplateBody;
}
