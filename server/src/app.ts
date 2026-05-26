import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { HttpError } from "http-errors";
import logger from "./config/logger";
import { Config } from "./config";
import authRouter from "./routes/auth";
import taskRouter from "./routes/task";

const app = express();

app.use(
    cors({
        origin: [Config.FRONTEND_URL, "http://localhost:5173"],
        credentials: true,
    }),
);
app.use(cookieParser());
app.use(express.json());

app.get("/", (_req, res) => {
    res.send("Welcome to Task Management System API");
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/tasks", taskRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err.message);
    const statusCode = err.statusCode || err.status || 500;

    if (Array.isArray((err as Record<string, unknown>).errors)) {
        res.status(statusCode).json({
            message: err.message,
            errors: (err as Record<string, unknown>).errors,
        });
        return;
    }

    res.status(statusCode).json({
        errors: [
            {
                type: err.name,
                msg: err.message,
                path: "",
                location: "",
            },
        ],
    });
});

export default app;
