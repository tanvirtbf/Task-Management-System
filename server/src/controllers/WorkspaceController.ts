import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { WorkspaceService } from "../services/WorkspaceService";
import type {
    WorkspaceRecord,
    WorkspaceUpdateColumns,
    WeekDay,
} from "../repositories/WorkspaceRepo";
import { weekDays } from "../db/schema/_shared";
import type { AuthRequest } from "../types";
import type {
    WorkspaceUpdateBody,
    WorkspaceUpdateRequest,
} from "../types/workspace";

/**
 * §3 Workspace HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `Workspace` per API_DESIGN.md Appendix A. snake_case fields;
 * `working_days` is an array of day-name literals; business hours are
 * "HH:MM:SS" strings. `created_at` / `updated_at` are intentionally omitted —
 * the contract does not expose them.
 */
interface WireWorkspace {
    id: string;
    name: string;
    logo_url: string | null;
    timezone: string;
    default_locale: string;
    week_starts_on: number;
    working_days: string[];
    business_hours_start: string;
    business_hours_end: string;
}

const toWireWorkspace = (w: WorkspaceRecord): WireWorkspace => ({
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

export class WorkspaceController {
    constructor(
        private workspaceService: WorkspaceService,
        private logger: Logger,
    ) {}

    async get(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { workspaceId } = req.auth;

            this.logger.debug("workspace.get.attempt", {
                requestId: req.requestId,
                userId: req.auth.sub,
            });

            const workspace =
                await this.workspaceService.getWorkspace(workspaceId);

            this.logger.info("workspace.get.ok", {
                requestId: req.requestId,
                workspaceId,
            });

            res.status(200).json(toWireWorkspace(workspace));
        } catch (err) {
            next(err);
        }
    }

    async patch(
        req: WorkspaceUpdateRequest,
        res: Response,
        next: NextFunction,
    ) {
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
        } catch (err) {
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
    private buildPatch(body: WorkspaceUpdateBody): {
        patch: WorkspaceUpdateColumns;
        changedFields: string[];
    } {
        const patch: WorkspaceUpdateColumns = {};
        const changedFields: string[] = [];

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
            const allowed = weekDays as readonly string[];
            patch.workingDays = body.working_days.filter(
                (day): day is WeekDay => allowed.includes(day),
            );
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
