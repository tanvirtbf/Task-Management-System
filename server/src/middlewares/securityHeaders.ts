import type { NextFunction, Request, Response } from "express";
import { Config } from "../config";

/**
 * Minimal security headers (gap-scan M3) — hand-rolled instead of pulling in
 * helmet, matching the dependency-free `/metrics` precedent (§30). This is a
 * JSON API on its own origin, so a CSP would guard nothing here; the four
 * headers below are the ones that matter for an API surface.
 *
 * HSTS is emitted only when the deployment is effectively HTTPS (prod or
 * FORCE_SECURE) — advertising it from plain-HTTP local dev would poison the
 * browser's HSTS cache for localhost.
 */
export const securityHeaders = (
    _req: Request,
    res: Response,
    next: NextFunction,
): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (Config.IS_PROD || process.env.FORCE_SECURE === "true") {
        res.setHeader(
            "Strict-Transport-Security",
            "max-age=15552000; includeSubDomains",
        );
    }
    next();
};

export default securityHeaders;
