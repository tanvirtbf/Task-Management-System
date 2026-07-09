import type { Logger } from "winston";
import { Config } from "./index";

/**
 * Console-backed logger with the winston call shape the codebase uses
 * (`logger.info("msg", { meta })`, `logger.child({...})`). Winston itself
 * needs Node streams/fs, so on Cloudflare Workers we log straight to the
 * console — Workers Logs / `wrangler tail` pick these up as structured
 * events. Typed AS winston's Logger so the ~60 `import type { Logger }`
 * consumers compile unchanged.
 */
const LEVELS: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,
};

const enabled = (level: string): boolean => {
    const configured = (Config.LOG_LEVEL ?? "info").toLowerCase();
    return (LEVELS[level] ?? 2) <= (LEVELS[configured] ?? 2);
};

/* eslint-disable no-console */
const makeLogger = (defaultMeta: Record<string, unknown> = {}): Logger => {
    const emit =
        (level: string) =>
        (message: unknown, ...meta: unknown[]) => {
            if (!enabled(level)) return obj;
            const fn =
                level === "error"
                    ? console.error
                    : level === "warn"
                      ? console.warn
                      : console.log;
            const extras = meta.length
                ? [{ ...defaultMeta, ...(meta[0] as object) }, ...meta.slice(1)]
                : Object.keys(defaultMeta).length
                  ? [defaultMeta]
                  : [];
            fn(`[${level}] ${String(message)}`, ...extras);
            return obj;
        };

    const obj = {
        error: emit("error"),
        warn: emit("warn"),
        info: emit("info"),
        http: emit("http"),
        verbose: emit("verbose"),
        debug: emit("debug"),
        silly: emit("silly"),
        log: (level: string, message: unknown, ...meta: unknown[]) =>
            emit(level)(message, ...meta),
        child: (childMeta: Record<string, unknown>) =>
            makeLogger({ ...defaultMeta, ...childMeta }),
        level: "info",
        isLevelEnabled: (level: string) => enabled(level),
    } as unknown as Logger;

    return obj;
};

const logger = makeLogger();

export default logger;
