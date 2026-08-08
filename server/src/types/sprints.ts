import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for §20 Sprints. Identity (`actor`) and
 * workspace come from `req.auth`, never the body/query; the validators have
 * already coerced and bounded every field referenced here.
 *
 * `GET /sprints` (the `?status=` filter), `GET /sprints/active`,
 * `GET /sprints/:id`, `POST /:id/start`, `POST /:id/close` and
 * `DELETE /sprints/:id/tasks/:taskId` read only path params / query + `req.auth`,
 * so they alias `AuthRequest`.
 */
export type ListSprintsRequest = AuthRequest;
export type GetActiveSprintRequest = AuthRequest;
export type GetSprintRequest = AuthRequest;
export type StartSprintRequest = AuthRequest;
export type CloseSprintRequest = AuthRequest;
/** F28 (ISS-013, D12.6) — DELETE /sprints/:id. Params only, like start/close. */
export type DeleteSprintRequest = AuthRequest;
export type RemoveSprintTaskRequest = AuthRequest;

/**
 * Body for `POST /sprints`. `goal` is optional/nullable; `committed_points`
 * defaults to 0 when omitted; the new sprint always starts `status: "planned"`.
 */
export interface CreateSprintBody {
    name: string;
    goal?: string | null;
    start_date: string; // YYYY-MM-DD
    end_date: string; // YYYY-MM-DD
    committed_points?: number;
}
export interface CreateSprintRequest extends AuthRequest {
    body: CreateSprintBody;
}

/**
 * Body for `PATCH /sprints/:id` — every field optional (partial update). `status`
 * is NOT patchable here; transitions go through `/start` and `/close`.
 */
export interface UpdateSprintBody {
    name?: string;
    goal?: string | null;
    start_date?: string;
    end_date?: string;
    committed_points?: number;
}
export interface UpdateSprintRequest extends AuthRequest {
    body: UpdateSprintBody;
}

/** Body for `POST /sprints/:id/tasks` — bulk attach by id. */
export interface AddSprintTasksBody {
    task_ids: string[];
}
export interface AddSprintTasksRequest extends AuthRequest {
    body: AddSprintTasksBody;
}
