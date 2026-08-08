"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsController = void 0;
const errors_1 = require("../errors");
const jobs_1 = require("../jobs");
/**
 * §28 Background-jobs HTTP layer. Each `/jobs/*` route binds one job slug via
 * `run(slug)`; the handler reads `?dry_run`, delegates to the `runJob`
 * dispatcher (which owns the try/catch + the `{ ok, dry_run, ... }` envelope),
 * and returns `200` with that envelope — even on a job FAILURE, so cron/k8s
 * reads the body (`{ ok:false, error }`) to decide rather than seeing a 500.
 * Authentication is the `internalAuth` middleware on the route, not here.
 */
/**
 * F14 (ISS-079): parse `?dry_run` the way a person means it.
 *
 * It used to be `req.query.dry_run === "true"`, so `?dry_run=1`, `?dry_run=yes`,
 * `?dry_run=TRUE` and a bare `?dry_run` all evaluated to **false** and RAN the
 * job for real. Three of the six jobs delete rows — and this was found the
 * expensive way, by a tester typing `?dry_run=1` and destroying a row while
 * believing they had asked for a preview.
 *
 * A safety control must never disengage silently, so this is deliberately
 * asymmetric: the truthy set is generous, a bare `?dry_run` counts as ON (you
 * typed the word — you meant the preview), and anything unrecognised is a 422
 * rather than a guess. The one thing it will not do is quietly decide you meant
 * "delete".
 */
const TRUTHY = new Set(["true", "1", "yes", "y", "on"]);
const FALSY = new Set(["false", "0", "no", "n", "off"]);
const parseDryRun = (raw) => {
    if (raw === undefined)
        return false; // not asked for
    if (raw === "")
        return true; // bare `?dry_run` — the word alone means yes
    if (typeof raw !== "string") {
        throw errors_1.AppError.validationFailed([
            { field: "dry_run", issue: "must be a single boolean value" },
        ]);
    }
    const v = raw.trim().toLowerCase();
    if (TRUTHY.has(v))
        return true;
    if (FALSY.has(v))
        return false;
    throw errors_1.AppError.validationFailed([
        {
            field: "dry_run",
            issue: `unrecognised value "${raw}" — use true/false (or 1/0, yes/no, on/off)`,
        },
    ]);
};
class JobsController {
    /** Bind a §28 job slug to an Express handler. */
    run(name) {
        return async (req, res, next) => {
            let dryRun;
            try {
                dryRun = parseDryRun(req.query.dry_run);
            }
            catch (err) {
                // Hand the 422 to the error handler for the standard envelope.
                // Express 4 does not catch an async throw, so this cannot be
                // left to bubble — an unparseable `dry_run` must be a clean
                // refusal, never a crash and never a silent real run.
                next(err);
                return;
            }
            const result = await (0, jobs_1.runJob)(name, {
                dryRun,
                requestId: req.requestId,
            });
            res.status(200).json(result);
        };
    }
}
exports.JobsController = JobsController;
