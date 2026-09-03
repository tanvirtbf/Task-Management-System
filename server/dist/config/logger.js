"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const _1 = require(".");
const level = _1.Config.LOG_LEVEL || "info";
const isTest = _1.Config.NODE_ENV === "test";
/**
 * Let ERRORS through under jest, on request.
 *
 * Every transport is silent in test mode, which is right for the ordinary
 * chatter of 5,400 tests — and wrong for the one case that matters. When a
 * request 500s, the client body is deliberately opaque
 * (`{error:{code:"internal"}}`, real message withheld) and the actual cause —
 * name, message, stack — is handed to `logger.error` in `errorHandler`. Under
 * test that goes nowhere at all, so a failing assertion reads
 * "Expected 401, Received 500" and there is no way, anywhere, to learn why.
 *
 * P2 hit exactly that: a concurrent `/auth/refresh` returned 500 once during a
 * full-module run and could not be reproduced in 350 hammered requests
 * afterwards. The evidence had already been thrown away.
 *
 * Off by default, so no suite's output changes. `TEST_LOG_ERRORS=1` prints
 * error-level lines only — nothing else — which is what you want when chasing
 * a rare 5xx through a long run.
 */
const testErrorsVisible = isTest && process.env.TEST_LOG_ERRORS === "1";
const logger = winston_1.default.createLogger({
    level,
    defaultMeta: {
        serviceName: "task-management-server",
    },
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.File({
            dirname: "logs",
            filename: "combined.log",
            level,
            silent: isTest,
        }),
        new winston_1.default.transports.File({
            dirname: "logs",
            filename: "error.log",
            level: "error",
            silent: isTest,
        }),
        new winston_1.default.transports.Console({
            // Under TEST_LOG_ERRORS the console carries errors and nothing
            // else — the point is a readable signal, not a second log file.
            level: testErrorsVisible ? "error" : level,
            silent: isTest && !testErrorsVisible,
            format: winston_1.default.format.combine(winston_1.default.format.colorize({ level: true }), winston_1.default.format.timestamp({ format: "HH:mm:ss" }), winston_1.default.format.printf(({ timestamp, level, message, requestId, ...rest }) => {
                // winston types these as `unknown`/`{}` because a
                // transport may be handed anything; at runtime they
                // are the strings we put there. Saying so explicitly
                // beats a template literal quietly rendering
                // "[object Object]" the one time it is not.
                const reqPart = requestId
                    ? ` [${String(requestId)}]`
                    : "";
                const restKeys = Object.keys(rest).filter((k) => k !== "serviceName" && k !== "stack");
                const meta = restKeys.length > 0
                    ? ` ${JSON.stringify(Object.fromEntries(restKeys.map((k) => [k, rest[k]])))}`
                    : "";
                return `${String(timestamp)} ${level}${reqPart} ${String(message)}${meta}`;
            })),
        }),
    ],
});
exports.default = logger;
