import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { Config } from "./config";
import { requestIdMiddleware } from "./middlewares/requestId";
import { securityHeaders } from "./middlewares/securityHeaders";
import { requestLoggerMiddleware } from "./middlewares/requestLogger";
import { apiLimiter } from "./middlewares/rateLimit";
import { notFoundMiddleware } from "./middlewares/notFound";
import { errorHandler } from "./middlewares/errorHandler";
import authRouter from "./routes/auth";
import meRouter from "./routes/me";
import rolesRouter from "./routes/roles";
import { rbacContext } from "./middlewares/requirePermission";
import usersRouter from "./routes/users";
import workspaceRouter from "./routes/workspace";
import spacesRouter from "./routes/spaces";
import taskTypesRouter from "./routes/taskTypes";
import statusesRouter from "./routes/statuses";
import tagsRouter from "./routes/tags";
import listsRouter from "./routes/lists";
import tasksRouter from "./routes/tasks";
import taskDependenciesRouter from "./routes/taskDependencies";
import customFieldsRouter from "./routes/customFields";
import formsRouter from "./routes/forms";
import attachmentsRouter from "./routes/attachments";
import commentsRouter from "./routes/comments";
import checklistsRouter from "./routes/checklists";
import sprintsRouter from "./routes/sprints";
import templatesRouter from "./routes/templates";
import onCallRouter from "./routes/onCall";
import reportsRouter from "./routes/reports";
import notificationsRouter from "./routes/notifications";
import engineeringRouter from "./routes/engineering";
import searchRouter from "./routes/search";
import workspaceActivityRouter from "./routes/workspaceActivity";
import homeRouter from "./routes/home";
import sseRouter from "./routes/sse";
import jobsRouter from "./routes/jobs";
import slaRouter from "./routes/sla";
import healthRouter from "./routes/health";
import assistantRouter from "./routes/assistant";
import { metricsMiddleware } from "./observability/metrics";

const app = express();

// Trust the proxy in front of us (Vercel, nginx, etc.) so req.ip / Forwarded
// headers resolve to the real client address.
app.set("trust proxy", 1);

// Order matters: request-id MUST come first so every later middleware,
// including the error handler, sees the same id.
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Security headers on EVERY response, error paths included (gap-scan M3).
app.use(securityHeaders);

// §30 metrics — count + time every request (shares the request-id/logger
// correlation; sits before routing so it measures the whole handler). Feeds
// `GET /metrics`.
app.use(metricsMiddleware);

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
// Allow the configured origins PLUS any localhost / private-LAN origin on any
// port, so another device on the same Wi-Fi (e.g. http://192.168.1.50:5173) can
// use the app without per-IP config. Only loopback + RFC-1918 private ranges are
// reflected — never an arbitrary public site.
const LAN_ORIGIN =
    /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i;
app.use(
    cors({
        origin: (origin, cb) => {
            // No Origin header → same-origin / curl / server-to-server.
            if (!origin) return cb(null, true);
            if (corsOrigins.includes(origin) || LAN_ORIGIN.test(origin)) {
                return cb(null, true);
            }
            cb(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true,
        // Custom response headers JS must read cross-origin. The assistant
        // streaming client reads `X-Conversation-Id` to keep multi-turn chats on
        // one server-side conversation; without exposing it, the browser hides
        // the header (5173→5501 is cross-origin) and every message forks a new
        // conversation.
        exposedHeaders: ["X-Conversation-Id"],
    }),
);

app.use(express.static("public"));
app.use(cookieParser(Config.COOKIE_SECRET));
app.use(express.json({ limit: "1mb" }));

// Public liveness probe (per API_DESIGN.md §30 — no auth, no DB hit)
app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

// §30 readiness / version / metrics — also at the app root (outside the v1
// `apiLimiter`), unauthenticated. Liveness `/health` stays inline above.
app.use(healthRouter);

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
// §34 RBAC — establish the per-request authorization context for EVERY v1
// route, ahead of any of them, so no endpoint can run without it. Resolution is
// lazy (it reads `req.auth` only when a permission or a row filter is first
// asked for), so an unauthenticated public route costs nothing.
v1.use(rbacContext);

v1.use("/auth", authRouter);
// §34 RBAC — `GET /me/permissions`. Declares its own full path, so it mounts at
// the v1 root; `/me` overlaps no other router.
v1.use(meRouter);
// §34 RBAC — roles CRUD + assignments. Declares full paths spanning `/roles`,
// `/users/:id/roles` and `/spaces/:id/members`, so it mounts at the v1 root
// BEFORE `/users` and `/spaces` (its 3-segment routes must resolve ahead of
// their `/:id` routes).
v1.use(rolesRouter);
v1.use("/workspace", workspaceRouter);
v1.use("/users", usersRouter);
v1.use("/spaces", spacesRouter);
v1.use("/task-types", taskTypesRouter);
v1.use("/tags", tagsRouter);
// §7 Statuses — the router declares full paths (`/lists/:listId/statuses`, and
// later `/statuses/:id`) because its routes span the `/lists` and `/statuses`
// prefixes, so it mounts at the v1 root rather than under a single prefix.
v1.use(statusesRouter);
// §6 Lists — like §7, this router declares full paths and mounts at the v1
// root: its endpoints span the `/spaces/:spaceId/lists` and (later) `/lists`
// prefixes.
v1.use(listsRouter);
// §12 Task dependencies — declares full paths (`/tasks/:id/dependencies`,
// `/task-dependencies`, `/task-dependencies/:id`) spanning the `/tasks` and
// `/task-dependencies` prefixes, so it mounts at the v1 root. Registered BEFORE
// the `/tasks` mount so its 2-segment `GET /tasks/:id/dependencies` resolves
// ahead of the tasks router's `/:id` routes.
v1.use(taskDependenciesRouter);
// §17 Custom fields — declares full paths spanning `/custom-fields`,
// `/lists/:listId/custom-fields`, and `/tasks/:id/custom-fields/:fieldId`, so it
// mounts at the v1 root BEFORE `/tasks` (its multi-segment task value routes
// resolve ahead of the tasks router's `/:id` routes).
v1.use(customFieldsRouter);
// §18 Forms — declares full paths spanning `/forms`, `/lists/:listId/forms`,
// `/form-fields/:id`, and the public `/public/forms/:slug/submit`, so it mounts
// at the v1 root BEFORE `/tasks` (its multi-segment `/forms/:id/...` and
// `/lists/:listId/forms` routes resolve ahead of any `/:id` catch-alls).
v1.use(formsRouter);
// §16 Attachments — declares full paths spanning `/uploads/sign`,
// `/attachments/:id/*`, and `/tasks/:id/attachments`, so it mounts at the v1
// root BEFORE `/tasks` (its 2-segment `GET /tasks/:id/attachments` resolves
// ahead of the tasks router's `/:id` routes).
v1.use(attachmentsRouter);
// §20 Sprints — declares full paths spanning `/sprints`, `/sprints/active`,
// `/sprints/:id`, `/sprints/:id/start|close|tasks`, and
// `/sprints/:id/tasks/:taskId`, so it mounts at the v1 root (Engineering-only;
// same pattern as taskDependenciesRouter / customFieldsRouter).
v1.use(sprintsRouter);
// §22 Engineering specials — declares full `/eng/*` paths (`/eng/report-bug`,
// and later `/eng/home`, `/eng/incidents/:id/postmortem`), so it mounts at the
// v1 root. No `/eng` prefix overlaps the other routers, so placement is free;
// grouped here with the other root-mounted full-path routers.
v1.use(engineeringRouter);
// §29 SLA management — declares full paths spanning `/sla/breached` and
// `/tasks/:id/sla`, so it mounts at the v1 root BEFORE `/tasks` (its 2-segment
// PATCH /tasks/:id/sla resolves ahead of the tasks router's /:id routes).
v1.use(slaRouter);
// §14 Comments — full paths spanning `/tasks/:id/comments` + `/comments/:id`, so
// it mounts at the v1 root BEFORE `/tasks` (the 3-segment comments path resolves
// ahead of the tasks router's `/:id` routes).
v1.use(commentsRouter);
// §15 Checklists — full paths spanning `/tasks/:id/checklists`, `/checklists/:id`,
// and `/checklist-items/:id`, so it mounts at the v1 root BEFORE `/tasks` (the
// 3-segment `/tasks/:id/checklists` resolves ahead of the tasks router's /:id).
v1.use(checklistsRouter);
// §11 Task membership — assignees / watchers / tags under the `/tasks` prefix.
v1.use("/tasks", tasksRouter);
// §23 Templates — clean `/templates` prefix (no shared path segments with
// `/tasks`, so mount order relative to it is irrelevant).
v1.use("/templates", templatesRouter);
// §21 On-call — weekly engineering rotation; all routes under the single
// `/on-call` prefix (no shared path segments), so mount order is irrelevant.
v1.use("/on-call", onCallRouter);

// Dept Review V1 — weekly department reports (A-6…A-10).
v1.use("/reports", reportsRouter);
// §19 Notifications — per-user inbox (read + state-management). Clean
// `/notifications` prefix (no shared path segments), so mount order is
// irrelevant. All routes are authenticated and user-scoped.
v1.use("/notifications", notificationsRouter);
// §24 Search — clean `/search` prefix (no shared path segments); order irrelevant.
v1.use("/search", searchRouter);
// §26 Workspace activity — read-only audit feed under the clean `/activity`
// prefix (`/activity/recent` + `/activity`); no shared segments, order
// irrelevant. Authenticated, workspace-scoped.
v1.use("/activity", workspaceActivityRouter);
// §25 Home / KPIs — clean `/home` prefix (`/home/kpis`, `/home/agenda`); no
// shared path segments, so mount order is irrelevant.
v1.use("/home", homeRouter);
// AI Help Assistant — clean `/assistant` prefix (POST /assistant/chat); no
// shared path segments, so mount order is irrelevant. Authenticated; has its
// own rate-limit bucket (assistantLimiter, 20/min/user) applied in the route.
v1.use("/assistant", assistantRouter);
// §27 SSE — long-lived `text/event-stream` of the caller's notifications under
// the clean `/stream` prefix (GET /stream/inbox); no shared path segments, so
// mount order is irrelevant. Cookie-authenticated, user-scoped.
v1.use("/stream", sseRouter);
// §28 Background jobs — internal cron-triggered endpoints under the clean
// `/jobs` prefix, guarded per-route by the `internalAuth` (X-Internal-Token)
// middleware rather than the user JWT. Mount order irrelevant.
v1.use("/jobs", jobsRouter);
// Future feature routers mount the same way:
//   v1.use("/lists", listRouter);
//   …

app.use("/api/v1", v1);

// 404 (envelope-formatted) + global error handler MUST be the last two.
app.use(notFoundMiddleware);
app.use(errorHandler);

export default app;
