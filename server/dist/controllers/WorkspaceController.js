"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceController = void 0;
const _shared_1 = require("../db/schema/_shared");
const toWireWorkspace = (w) => ({
    id: w.id,
    name: w.name,
    logo_url: w.logoUrl,
    timezone: w.timezone,
    default_locale: w.defaultLocale,
    week_starts_on: w.weekStartsOn,
    working_days: w.workingDays,
    business_hours_start: w.businessHoursStart,
    business_hours_end: w.businessHoursEnd,
});
class WorkspaceController {
    workspaceService;
    logger;
    constructor(workspaceService, logger) {
        this.workspaceService = workspaceService;
        this.logger = logger;
    }
    async get(req, res, next) {
        try {
            const { workspaceId } = req.auth;
            this.logger.debug("workspace.get.attempt", {
                requestId: req.requestId,
                userId: req.auth.sub,
            });
            const workspace = await this.workspaceService.getWorkspace(workspaceId);
            this.logger.info("workspace.get.ok", {
                requestId: req.requestId,
                workspaceId,
            });
            res.status(200).json(toWireWorkspace(workspace));
        }
        catch (err) {
            next(err);
        }
    }
    async patch(req, res, next) {
        try {
            const { workspaceId, sub: actorId } = req.auth;
            const { patch, changedFields } = this.buildPatch(req.body);
            this.logger.debug("workspace.update.attempt", {
                requestId: req.requestId,
                userId: actorId,
                changedFields,
            });
            const workspace = await this.workspaceService.updateWorkspace({
                workspaceId,
                actorId,
                patch,
                changedFields,
            });
            this.logger.info("workspace.update.ok", {
                requestId: req.requestId,
                workspaceId,
                changedFields,
            });
            res.status(200).json(toWireWorkspace(workspace));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * Map the validated snake_case body to the whitelisted camelCase column
     * patch, recording which fields were supplied (for the audit log). Only the
     * eight documented fields are copied — anything else in the body (including
     * `default_locale`, already rejected by the validator) can never be
     * written. A field present with `undefined` is treated as absent; only
     * `logo_url` may be explicitly `null` (to clear the logo).
     */
    buildPatch(body) {
        const patch = {};
        const changedFields = [];
        if (body.name !== undefined) {
            patch.name = body.name;
            changedFields.push("name");
        }
        if (body.logo_url !== undefined) {
            patch.logoUrl = body.logo_url;
            changedFields.push("logo_url");
        }
        if (body.timezone !== undefined) {
            patch.timezone = body.timezone;
            changedFields.push("timezone");
        }
        if (body.week_starts_on !== undefined) {
            patch.weekStartsOn = body.week_starts_on;
            changedFields.push("week_starts_on");
        }
        if (body.working_days !== undefined) {
            // The validator guarantees every member is a weekday; this filter
            // narrows string[] → WeekDay[] without an unsafe cast.
            const allowed = _shared_1.weekDays;
            patch.workingDays = body.working_days.filter((day) => allowed.includes(day));
            changedFields.push("working_days");
        }
        if (body.business_hours_start !== undefined) {
            patch.businessHoursStart = body.business_hours_start;
            changedFields.push("business_hours_start");
        }
        if (body.business_hours_end !== undefined) {
            patch.businessHoursEnd = body.business_hours_end;
            changedFields.push("business_hours_end");
        }
        return { patch, changedFields };
    }
}
exports.WorkspaceController = WorkspaceController;
