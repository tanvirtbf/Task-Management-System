import { defineMiddleware } from "astro:middleware";
import { setRuntimeEnv } from "./server/shim/env";
import { handleBackendRequest, isBackendPath } from "./server/entry";

/**
 * Routes every /api/*, /health*, /metrics request into the converted Express
 * backend; everything else falls through to Astro (the React SPA shell).
 * Runs first on every SSR request, so it also injects the Workers runtime
 * env (secrets/vars/.dev.vars) into the backend's lazy Config.
 */
export const onRequest = defineMiddleware(async (context, next) => {
    const runtime = (context.locals as { runtime?: { env?: Record<string, unknown> } })
        .runtime;
    if (runtime?.env) setRuntimeEnv(runtime.env);

    const { pathname } = new URL(context.request.url);
    const raw = isBackendPath(pathname)
        ? await handleBackendRequest(context.request)
        : await next();

    // Security response headers on every response (API + SPA). Re-wrap so we can
    // set headers even when the backend Response is otherwise immutable. CSP is
    // intentionally omitted for now — it needs per-app tuning against the SPA's
    // inline styles (P39-3); nosniff / clickjacking / referrer / HSTS are safe.
    const res = new Response(raw.body, raw);
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "SAMEORIGIN");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set(
        "Strict-Transport-Security",
        "max-age=15552000; includeSubDomains",
    );
    return res;
});
