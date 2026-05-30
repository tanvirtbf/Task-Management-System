import type { AuthRequest } from "./index";

/**
 * `PATCH /api/v1/workspace` request body — a partial `Workspace`
 * (API_DESIGN.md §3). snake_case to match the wire contract; every field is
 * optional. `workspaceUpdateValidator` validates each supplied field and
 * rejects `default_locale` (not updatable via this endpoint). The integer
 * fields arrive coerced to numbers by the validator's `toInt`.
 */
export interface WorkspaceUpdateBody {
    name?: string;
    logo_url?: string | null;
    timezone?: string;
    week_starts_on?: number;
    working_days?: string[];
    business_hours_start?: string;
    business_hours_end?: string;
    fiscal_year_start_month?: number;
}

/** Decorated request after `authenticate` + `workspaceUpdateValidator`. */
export interface WorkspaceUpdateRequest extends AuthRequest {
    body: WorkspaceUpdateBody;
}
