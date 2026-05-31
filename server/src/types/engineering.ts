import type { AuthRequest } from "./index";

/**
 * §22 Engineering specials — endpoint request shapes.
 *
 * Wire bodies are snake_case (the API_DESIGN.md §22 contract); the controller
 * maps them to the service's camelCase inputs. Routes that read only `req.auth`
 * (+ a path param) alias `AuthRequest`.
 */

/**
 * Body for `POST /api/v1/eng/report-bug`. Free-text intake any team can submit;
 * the server composes the Bug task (title/description/list/type/assignee) from
 * it. `steps` + `happened` + `reporter_team` are required; the rest optional.
 * `severity` defaults to S2 at task-create time when omitted.
 */
export interface ReportBugBody {
    steps: string;
    happened: string;
    expected?: string;
    severity?: string;
    reporter_team: string;
    url?: string;
    screenshots?: string[];
}

export interface ReportBugRequest extends AuthRequest {
    body: ReportBugBody;
}

/** `GET /api/v1/eng/home` reads only identity from `req.auth` (no body/params). */
export type GetEngHomeRequest = AuthRequest;

/**
 * Body for `POST /api/v1/eng/incidents/:id/postmortem`. The canonical
 * API_DESIGN.md shape (and the frontend's `PostmortemChecklist`): a map of
 * checklist label → checked. The validator guarantees every value is a boolean.
 */
export interface CreatePostmortemBody {
    items: Record<string, boolean>;
}

export interface CreatePostmortemRequest extends AuthRequest {
    body: CreatePostmortemBody;
}
