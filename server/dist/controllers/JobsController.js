"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsController = void 0;
const jobs_1 = require("../jobs");
/**
 * §28 Background-jobs HTTP layer. Each `/jobs/*` route binds one job slug via
 * `run(slug)`; the handler reads `?dry_run`, delegates to the `runJob`
 * dispatcher (which owns the try/catch + the `{ ok, dry_run, ... }` envelope),
 * and returns `200` with that envelope — even on a job FAILURE, so cron/k8s
 * reads the body (`{ ok:false, error }`) to decide rather than seeing a 500.
 * Authentication is the `internalAuth` middleware on the route, not here.
 */
class JobsController {
    /** Bind a §28 job slug to an Express handler. */
    run(name) {
        return async (req, res) => {
            const dryRun = req.query.dry_run === "true";
            const result = await (0, jobs_1.runJob)(name, {
                dryRun,
                requestId: req.requestId,
            });
            res.status(200).json(result);
        };
    }
}
exports.JobsController = JobsController;
