import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import type { ReportsService } from "../services/ReportsService";
import type {
    AckReportRequest,
    GenerateReportRequest,
    GetReportRequest,
    HeadNoteRequest,
    ListReportsRequest,
} from "../types/reports";

/**
 * Dept Review V1 — reports HTTP layer (A-6/A-7; P21 adds generate/note/ack).
 * Controllers translate request → service input; authorization is
 * service-level.
 */
export class ReportsController {
    constructor(
        private reportsService: ReportsService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/reports — list, newest week first (A-6). */
    async list(req: ListReportsRequest, res: Response, next: NextFunction) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const result = await this.reportsService.list({
                workspaceId,
                userId,
                role,
                spaceId:
                    (req.query.space_id as string | undefined) ?? undefined,
                cursor: (req.query.cursor as string | undefined) ?? undefined,
                limit:
                    req.query.limit !== undefined
                        ? Number(req.query.limit)
                        : undefined,
            });

            this.logger.debug("reports.list.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                count: result.data.length,
            });

            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/reports/:id — full payload (A-7). */
    async getById(req: GetReportRequest, res: Response, next: NextFunction) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const report = await this.reportsService.getById({
                id: req.params.id,
                workspaceId,
                userId,
                role,
            });

            this.logger.debug("reports.get.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                reportId: report.id,
            });

            res.status(200).json(report);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/reports/generate — on-demand (re)generate (A-8). */
    async generate(
        req: GenerateReportRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const report = await this.reportsService.generateOnDemand({
                spaceId: req.body.space_id,
                workspaceId,
                userId,
                role,
                weekStart: req.body.week_start,
            });

            this.logger.info("reports.generate.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                reportId: report.id,
                weekStart: report.week_start,
            });

            res.status(200).json(report);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/reports/:id — the snapshot head's note (A-9). */
    async setNote(req: HeadNoteRequest, res: Response, next: NextFunction) {
        try {
            const { sub: userId, workspaceId } = req.auth;
            const headNote =
                typeof req.body.head_note === "string" &&
                req.body.head_note.trim().length > 0
                    ? req.body.head_note.trim()
                    : null;
            const report = await this.reportsService.setHeadNote({
                id: req.params.id,
                workspaceId,
                userId,
                headNote,
            });

            this.logger.info("reports.note.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                reportId: report.id,
                cleared: headNote === null,
            });

            res.status(200).json(report);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/reports/:id/ack — HR "Mark seen" (A-10, idempotent). */
    async ack(req: AckReportRequest, res: Response, next: NextFunction) {
        try {
            const { sub: userId, workspaceId } = req.auth;
            const report = await this.reportsService.acknowledge({
                id: req.params.id,
                workspaceId,
                userId,
            });

            this.logger.info("reports.ack.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                reportId: report.id,
            });

            res.status(200).json(report);
        } catch (err) {
            next(err);
        }
    }
}
