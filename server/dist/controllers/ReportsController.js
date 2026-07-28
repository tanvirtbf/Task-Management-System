"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsController = void 0;
/**
 * Dept Review V1 — reports HTTP layer (A-6/A-7; P21 adds generate/note/ack).
 * Controllers translate request → service input; authorization is
 * service-level.
 */
class ReportsController {
    reportsService;
    logger;
    constructor(reportsService, logger) {
        this.reportsService = reportsService;
        this.logger = logger;
    }
    /** GET /api/v1/reports — list, newest week first (A-6). */
    async list(req, res, next) {
        try {
            const { sub: userId, role, workspaceId } = req.auth;
            const result = await this.reportsService.list({
                workspaceId,
                userId,
                role,
                spaceId: req.query.space_id ?? undefined,
                cursor: req.query.cursor ?? undefined,
                limit: req.query.limit !== undefined
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
        }
        catch (err) {
            next(err);
        }
    }
    /** GET /api/v1/reports/:id — full payload (A-7). */
    async getById(req, res, next) {
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
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/reports/generate — on-demand (re)generate (A-8). */
    async generate(req, res, next) {
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
        }
        catch (err) {
            next(err);
        }
    }
    /** PATCH /api/v1/reports/:id — the snapshot head's note (A-9). */
    async setNote(req, res, next) {
        try {
            const { sub: userId, workspaceId } = req.auth;
            const headNote = typeof req.body.head_note === "string" &&
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
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/reports/:id/ack — HR "Mark seen" (A-10, idempotent). */
    async ack(req, res, next) {
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
        }
        catch (err) {
            next(err);
        }
    }
}
exports.ReportsController = ReportsController;
