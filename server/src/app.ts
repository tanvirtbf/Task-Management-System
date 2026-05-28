import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { HttpError } from "http-errors";

import logger from "./config/logger";
import { Config } from "./config";

import authRouter from "./routes/auth";
import workspaceRouter from "./routes/workspace";
import userRouter from "./routes/user";

const app = express();

app.use(
    cors({
        origin: [Config.CLIENT_URL || "http://localhost:5173"],
        credentials: true,
    }),
);
app.use(express.static("public"));
app.use(cookieParser());
app.use(express.json());

app.get("/", async (_req, res) => {
    res.send("Welcome to Task Management Server");
});

app.use("/auth", authRouter);
app.use("/workspaces", workspaceRouter);
app.use("/users", userRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: HttpError, req: Request, res: Response, _next: NextFunction) => {
    logger.error(err.message);
    const statusCode = err.statusCode || err.status || 500;
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
