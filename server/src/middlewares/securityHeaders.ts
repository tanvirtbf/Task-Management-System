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
    // F13 (ISS-086): a CSP for a JSON API. This origin serves no HTML, no
    // scripts and no styles, so the honest policy is "nothing is allowed to
    // load from here" — `default-src 'none'` plus `frame-ancestors 'none'`
    // (the modern replacement for X-Frame-Options, which stays for older
    // browsers). If an XSS ever lands in a JSON error string, there is nothing
    // for it to reach. The SPA origin is a SEPARATE server (nginx) and needs
    // its own, much looser policy — that is not this middleware's job, and the
    // issue says the same.
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if (Config.IS_PROD || process.env.FORCE_SECURE === "true") {
        res.setHeader(
            "Strict-Transport-Security",
            "max-age=15552000; includeSubDomains",
        );
    }
    next();
};

export default securityHeaders;
