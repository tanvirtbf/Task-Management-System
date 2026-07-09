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
    if (isBackendPath(pathname)) {
        return handleBackendRequest(context.request);
    }
    return next();
});
