"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeController = void 0;
/**
 * §25 Home HTTP layer.
 *
 * `kpis` returns the bare camelCase `HomeKpiSet` (deliberate per-endpoint
 * exception to snake_case — matches the frontend `HomeKpiSet`). `agenda`
 * returns a bare snake_case `Task[]`. Neither uses the `{data,pagination}`
 * envelope. Workspace + user come from `req.auth`, never client input.
 */
class HomeController {
    homeService;
    logger;
    constructor(homeService, logger) {
        this.homeService = homeService;
        this.logger = logger;
    }
    /** GET /api/v1/home/kpis — the 6 KPI tiles for the caller (🔐 any member). */
    async kpis(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const userId = req.auth.sub;
            const set = await this.homeService.kpis(workspaceId, userId);
            this.logger.debug("home.kpis.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
            });
            res.status(200).json(set);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/home/agenda?date=YYYY-MM-DD — the caller's open tasks due on
     * the date (default today), as a bare `Task[]` (🔐 any member).
     */
    async agenda(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const userId = req.auth.sub;
            const role = req.auth.role;
            const date = typeof req.query.date === "string" ? req.query.date : undefined;
            const items = await this.homeService.agenda(workspaceId, userId, role, date);
            this.logger.debug("home.agenda.ok", {
                requestId: req.requestId,
                workspaceId,
                userId,
                count: items.length,
            });
            res.status(200).json(items);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.HomeController = HomeController;
