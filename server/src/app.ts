import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { Config } from "./config";
import { requestIdMiddleware } from "./middlewares/requestId";
import { requestLoggerMiddleware } from "./middlewares/requestLogger";
import { apiLimiter } from "./middlewares/rateLimit";
import { notFoundMiddleware } from "./middlewares/notFound";
import { errorHandler } from "./middlewares/errorHandler";
import authRouter from "./routes/auth";

const app = express();

// Trust the proxy in front of us (Vercel, nginx, etc.) so req.ip / Forwarded
// headers resolve to the real client address.
app.set("trust proxy", 1);

// Order matters: request-id MUST come first so every later middleware,
// including the error handler, sees the same id.
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// CORS — allow the frontend(s) defined in .env. `FRONTEND_URL` is the dev
// app; `CORS_ALLOWED_ORIGINS` is a comma-separated production list.
const corsOrigins: string[] = [];
if (Config.FRONTEND_URL) corsOrigins.push(Config.FRONTEND_URL);
if (Config.CORS_ALLOWED_ORIGINS) {
    corsOrigins.push(
        ...Config.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(
            Boolean,
        ),
    );
}
app.use(
    cors({
        origin: corsOrigins.length > 0 ? corsOrigins : true,
        credentials: true,
    }),
);

app.use(express.static("public"));
app.use(cookieParser(Config.COOKIE_SECRET));
app.use(express.json({ limit: "1mb" }));

// Public liveness probe (per API_DESIGN.md §30 — no auth, no DB hit)
app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

// ═════════════════════════════════════════════════════════════════════════════
// API v1 router. Every endpoint defined in API_DESIGN.md mounts here.
//
// Pattern for each feature: create a router under `src/routes/<resource>.ts`,
// import it here, and mount with `v1.use("/<resource>", <resource>Router)`.
// Each router wires up its own controller + service via dependency injection
// (see the existing TokenService / CredentialService for reference) and
// chains validators through the `validate` middleware.
// ═════════════════════════════════════════════════════════════════════════════
const v1 = express.Router();
v1.use(apiLimiter);

v1.use("/auth", authRouter);
// Future feature routers mount the same way:
//   v1.use("/workspaces", workspaceRouter);
//   v1.use("/spaces", spaceRouter);
//   …

app.use("/api/v1", v1);

// 404 (envelope-formatted) + global error handler MUST be the last two.
app.use(notFoundMiddleware);
app.use(errorHandler);

export default app;
