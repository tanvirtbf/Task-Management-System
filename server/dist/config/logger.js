"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const _1 = require(".");
const level = _1.Config.LOG_LEVEL || "info";
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
            silent: _1.Config.NODE_ENV === "test",
        }),
        new winston_1.default.transports.File({
            dirname: "logs",
            filename: "error.log",
            level: "error",
            silent: _1.Config.NODE_ENV === "test",
        }),
        new winston_1.default.transports.Console({
            level,
            silent: _1.Config.NODE_ENV === "test",
            format: winston_1.default.format.combine(winston_1.default.format.colorize({ level: true }), winston_1.default.format.timestamp({ format: "HH:mm:ss" }), winston_1.default.format.printf(({ timestamp, level, message, requestId, ...rest }) => {
                const reqPart = requestId ? ` [${requestId}]` : "";
                const restKeys = Object.keys(rest).filter((k) => k !== "serviceName" && k !== "stack");
                const meta = restKeys.length > 0
                    ? ` ${JSON.stringify(Object.fromEntries(restKeys.map((k) => [k, rest[k]])))}`
                    : "";
                return `${timestamp} ${level}${reqPart} ${message}${meta}`;
            })),
        }),
    ],
});
exports.default = logger;
