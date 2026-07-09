/**
 * Runtime environment source. On Cloudflare Workers the per-request env
 * (vars + secrets + .dev.vars in local dev) is injected by the Astro
 * middleware before any backend code runs; in plain Node (scripts, tests)
 * it falls back to process.env.
 */
let runtimeEnv: Record<string, unknown> | null = null;

export const setRuntimeEnv = (env: Record<string, unknown>): void => {
    runtimeEnv = env;
    // Also mirror string values into process.env (available under
    // nodejs_compat) — a handful of copied files read process.env directly
    // (NODE_ENV checks, SSE cadence knobs) rather than going through Config.
    if (typeof process !== "undefined" && process.env) {
        for (const [k, v] of Object.entries(env)) {
            if (typeof v === "string") process.env[k] = v;
        }
    }
};

export const readEnv = (key: string): string | undefined => {
    const fromRuntime = runtimeEnv?.[key];
    if (typeof fromRuntime === "string") return fromRuntime;
    if (typeof process !== "undefined" && process.env) {
        return process.env[key];
    }
    return undefined;
};
