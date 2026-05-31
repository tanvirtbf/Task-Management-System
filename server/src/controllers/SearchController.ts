import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { SearchService } from "../services/SearchService";
import type { AuthRequest } from "../types";

/**
 * §24 Search HTTP layer. Reads `?q=&types=&limit=` from the verified request,
 * delegates to the service, and returns the bare result object (no envelope).
 */
export class SearchController {
    constructor(
        private searchService: SearchService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/search — multi-resource typeahead (🔐 any member). Workspace
     * scoping comes from `req.auth.workspaceId`, never client input.
     */
    async search(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const role = req.auth.role;

            const q = typeof req.query.q === "string" ? req.query.q : "";
            const types =
                typeof req.query.types === "string"
                    ? req.query.types
                    : undefined;
            // `toInt` in the validator turns a present limit into a number.
            const rawLimit = req.query.limit;
            const limit =
                typeof rawLimit === "number"
                    ? rawLimit
                    : typeof rawLimit === "string" && rawLimit.length > 0
                      ? Number(rawLimit)
                      : undefined;

            const result = await this.searchService.search({
                workspaceId,
                role,
                q,
                types,
                limit,
            });

            this.logger.debug("search.ok", {
                requestId: req.requestId,
                workspaceId,
                total: result.total,
            });

            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    }
}
