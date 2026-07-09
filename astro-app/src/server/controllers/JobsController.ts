import type { Request, Response } from "express";
import { runJob, type JobName } from "../jobs";

/**
 * §28 Background-jobs HTTP layer. Each `/jobs/*` route binds one job slug via
 * `run(slug)`; the handler reads `?dry_run`, delegates to the `runJob`
 * dispatcher (which owns the try/catch + the `{ ok, dry_run, ... }` envelope),
 * and returns `200` with that envelope — even on a job FAILURE, so cron/k8s
 * reads the body (`{ ok:false, error }`) to decide rather than seeing a 500.
 * Authentication is the `internalAuth` middleware on the route, not here.
 */
export class JobsController {
    /** Bind a §28 job slug to an Express handler. */
    run(name: JobName) {
        return async (req: Request, res: Response): Promise<void> => {
            const dryRun = req.query.dry_run === "true";
            const result = await runJob(name, {
                dryRun,
                requestId: req.requestId,
            });
            res.status(200).json(result);
        };
    }
}
