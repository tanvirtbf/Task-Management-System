import type { AuthRequest } from "./index";

/**
 * Endpoint-specific request shapes for the Dept Review V1 reports surface
 * (per the project convention these live alongside the feature).
 */

/** `GET /api/v1/reports` (A-6) — query validated by `listReportsValidator`. */
export type ListReportsRequest = AuthRequest;

/** `GET /api/v1/reports/:id` (A-7). */
export type GetReportRequest = AuthRequest;

/** Body for `POST /api/v1/reports/generate` (A-8). */
export interface GenerateReportBody {
    space_id: string;
    /** Optional past Dhaka Monday; defaults to the last completed week. */
    week_start?: string;
}

export interface GenerateReportRequest extends AuthRequest {
    body: GenerateReportBody;
}

/** Body for `PATCH /api/v1/reports/:id` (A-9). */
export interface HeadNoteBody {
    head_note?: string | null;
}

export interface HeadNoteRequest extends AuthRequest {
    body: HeadNoteBody;
}

/** `POST /api/v1/reports/:id/ack` (A-10). Param-only. */
export type AckReportRequest = AuthRequest;
