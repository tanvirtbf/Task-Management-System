import winston from "winston";
import { Config } from ".";

const level = Config.LOG_LEVEL || "info";

const logger = winston.createLogger({
    level,
    defaultMeta: {
        serviceName: "task-management-server",
    },
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
    ),
    transports: [
        new winston.transports.File({
            dirname: "logs",
            filename: "combined.log",
            level,
            silent: Config.NODE_ENV === "test",
        }),
        new winston.transports.File({
            dirname: "logs",
            filename: "error.log",
            level: "error",
            silent: Config.NODE_ENV === "test",
        }),
        new winston.transports.Console({
            level,
            silent: Config.NODE_ENV === "test",
            format: winston.format.combine(
                winston.format.colorize({ level: true }),
                winston.format.timestamp({ format: "HH:mm:ss" }),
                winston.format.printf(
                    ({ timestamp, level, message, requestId, ...rest }) => {
                        const reqPart = requestId ? ` [${requestId}]` : "";
                        const restKeys = Object.keys(rest).filter(
                            (k) => k !== "serviceName" && k !== "stack",
                        );
                        const meta =
                            restKeys.length > 0
                                ? ` ${JSON.stringify(
                                      Object.fromEntries(
                                          restKeys.map((k) => [k, rest[k]]),
                                      ),
                                  )}`
                                : "";
                        return `${timestamp} ${level}${reqPart} ${message}${meta}`;
                    },
                ),
            ),
        }),
    ],
});

export default logger;
