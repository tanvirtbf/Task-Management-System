"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const config_1 = require("./config");
const requestId_1 = require("./middlewares/requestId");
const securityHeaders_1 = require("./middlewares/securityHeaders");
const requestLogger_1 = require("./middlewares/requestLogger");
const rateLimit_1 = require("./middlewares/rateLimit");
const notFound_1 = require("./middlewares/notFound");
const errorHandler_1 = require("./middlewares/errorHandler");
const auth_1 = __importDefault(require("./routes/auth"));
const me_1 = __importDefault(require("./routes/me"));
const roles_1 = __importDefault(require("./routes/roles"));
const requirePermission_1 = require("./middlewares/requirePermission");
const users_1 = __importDefault(require("./routes/users"));
const workspace_1 = __importDefault(require("./routes/workspace"));
const spaces_1 = __importDefault(require("./routes/spaces"));
const taskTypes_1 = __importDefault(require("./routes/taskTypes"));
const statuses_1 = __importDefault(require("./routes/statuses"));
const tags_1 = __importDefault(require("./routes/tags"));
const lists_1 = __importDefault(require("./routes/lists"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const taskDependencies_1 = __importDefault(require("./routes/taskDependencies"));
const customFields_1 = __importDefault(require("./routes/customFields"));
const forms_1 = __importDefault(require("./routes/forms"));
const attachments_1 = __importDefault(require("./routes/attachments"));
const comments_1 = __importDefault(require("./routes/comments"));
const checklists_1 = __importDefault(require("./routes/checklists"));
const sprints_1 = __importDefault(require("./routes/sprints"));
const templates_1 = __importDefault(require("./routes/templates"));
const onCall_1 = __importDefault(require("./routes/onCall"));
const reports_1 = __importDefault(require("./routes/reports"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const engineering_1 = __importDefault(require("./routes/engineering"));
const search_1 = __importDefault(require("./routes/search"));
const workspaceActivity_1 = __importDefault(require("./routes/workspaceActivity"));
const home_1 = __importDefault(require("./routes/home"));
const sse_1 = __importDefault(require("./routes/sse"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const sla_1 = __importDefault(require("./routes/sla"));
const health_1 = __importDefault(require("./routes/health"));
const assistant_1 = __importDefault(require("./routes/assistant"));
const metrics_1 = require("./observability/metrics");
const app = (0, express_1.default)();
// F13 (ISS-086): stop advertising the framework. Free fingerprinting that
// tells an attacker which CVE list to try first.
app.disable("x-powered-by");
// Trust the proxy in front of us (Vercel, nginx, etc.) so req.ip / Forwarded
// headers resolve to the real client address.
app.set("trust proxy", 1);
// Order matters: request-id MUST come first so every later middleware,
// including the error handler, sees the same id.
app.use(requestId_1.requestIdMiddleware);
app.use(requestLogger_1.requestLoggerMiddleware);
// Security headers on EVERY response, error paths included (gap-scan M3).
app.use(securityHeaders_1.securityHeaders);
// §30 metrics — count + time every request (shares the request-id/logger
// correlation; sits before routing so it measures the whole handler). Feeds
// `GET /metrics`.
app.use(metrics_1.metricsMiddleware);
// CORS — allow the frontend(s) defined in .env. `FRONTEND_URL` is the dev
// app; `CORS_ALLOWED_ORIGINS` is a comma-separated production list.
const corsOrigins = [];
if (config_1.Config.FRONTEND_URL)
    corsOrigins.push(config_1.Config.FRONTEND_URL);
if (config_1.Config.CORS_ALLOWED_ORIGINS) {
    corsOrigins.push(...config_1.Config.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean));
}
// Allow the configured origins PLUS any localhost / private-LAN origin on any
// port, so another device on the same Wi-Fi (e.g. http://192.168.1.50:5173) can
// use the app without per-IP config. Only loopback + RFC-1918 private ranges are
// reflected — never an arbitrary public site.
const LAN_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i;
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        // No Origin header → same-origin / curl / server-to-server.
        if (!origin)
            return cb(null, true);
        if (corsOrigins.includes(origin) || LAN_ORIGIN.test(origin)) {
            return cb(null, true);
        }
        // F13 (ISS-085 / ISS-009): reject by SAYING NO, not by throwing.
        // `cb(new Error(...))` made the cors middleware throw, which
        // reached the global handler as an unknown error — every rejected
        // origin produced a 500 and an `Unhandled error` log line. A
        // rejection is a client-side condition: `cb(null, false)` omits the
        // `Access-Control-Allow-Origin` header and the browser blocks the
        // read, which is exactly the intended outcome. The POLICY itself
        // was already correct (P2 verified all 10 origin cases, including
        // the prefix and fragment tricks) — only the reporting was wrong.
        cb(null, false);
    },
    credentials: true,
    // Custom response headers JS must read cross-origin. The assistant
    // streaming client reads `X-Conversation-Id` to keep multi-turn chats on
    // one server-side conversation; without exposing it, the browser hides
    // the header (5173→5501 is cross-origin) and every message forks a new
    // conversation.
    exposedHeaders: ["X-Conversation-Id"],
}));
app.use(express_1.default.static("public"));
// F14 (ISS-004): no secret — nothing in this app signs a cookie.
// `bb_refresh` is a plain httpOnly cookie carrying a self-signed JWT, so
// COOKIE_SECRET was inert config that looked mandatory. Removed.
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json({ limit: "1mb" }));
// Public liveness probe (per API_DESIGN.md §30 — no auth, no DB hit)
app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});
// §30 readiness / version / metrics — also at the app root (outside the v1
// `apiLimiter`), unauthenticated. Liveness `/health` stays inline above.
app.use(health_1.default);
// ═════════════════════════════════════════════════════════════════════════════
// API v1 router. Every endpoint defined in API_DESIGN.md mounts here.
//
// Pattern for each feature: create a router under `src/routes/<resource>.ts`,
// import it here, and mount with `v1.use("/<resource>", <resource>Router)`.
// Each router wires up its own controller + service via dependency injection
// (see the existing TokenService / CredentialService for reference) and
// chains validators through the `validate` middleware.
// ═════════════════════════════════════════════════════════════════════════════
const v1 = express_1.default.Router();
v1.use(rateLimit_1.apiLimiter);
// §34 RBAC — establish the per-request authorization context for EVERY v1
// route, ahead of any of them, so no endpoint can run without it. Resolution is
// lazy (it reads `req.auth` only when a permission or a row filter is first
// asked for), so an unauthenticated public route costs nothing.
v1.use(requirePermission_1.rbacContext);
v1.use("/auth", auth_1.default);
// §34 RBAC — `GET /me/permissions`. Declares its own full path, so it mounts at
// the v1 root; `/me` overlaps no other router.
v1.use(me_1.default);
// §34 RBAC — roles CRUD + assignments. Declares full paths spanning `/roles`,
// `/users/:id/roles` and `/spaces/:id/members`, so it mounts at the v1 root
// BEFORE `/users` and `/spaces` (its 3-segment routes must resolve ahead of
// their `/:id` routes).
v1.use(roles_1.default);
v1.use("/workspace", workspace_1.default);
v1.use("/users", users_1.default);
v1.use("/spaces", spaces_1.default);
v1.use("/task-types", taskTypes_1.default);
v1.use("/tags", tags_1.default);
// §7 Statuses — the router declares full paths (`/lists/:listId/statuses`, and
// later `/statuses/:id`) because its routes span the `/lists` and `/statuses`
// prefixes, so it mounts at the v1 root rather than under a single prefix.
v1.use(statuses_1.default);
// §6 Lists — like §7, this router declares full paths and mounts at the v1
// root: its endpoints span the `/spaces/:spaceId/lists` and (later) `/lists`
// prefixes.
v1.use(lists_1.default);
// §12 Task dependencies — declares full paths (`/tasks/:id/dependencies`,
// `/task-dependencies`, `/task-dependencies/:id`) spanning the `/tasks` and
// `/task-dependencies` prefixes, so it mounts at the v1 root. Registered BEFORE
// the `/tasks` mount so its 2-segment `GET /tasks/:id/dependencies` resolves
// ahead of the tasks router's `/:id` routes.
v1.use(taskDependencies_1.default);
// §17 Custom fields — declares full paths spanning `/custom-fields`,
// `/lists/:listId/custom-fields`, and `/tasks/:id/custom-fields/:fieldId`, so it
// mounts at the v1 root BEFORE `/tasks` (its multi-segment task value routes
// resolve ahead of the tasks router's `/:id` routes).
v1.use(customFields_1.default);
// §18 Forms — declares full paths spanning `/forms`, `/lists/:listId/forms`,
// `/form-fields/:id`, and the public `/public/forms/:slug/submit`, so it mounts
// at the v1 root BEFORE `/tasks` (its multi-segment `/forms/:id/...` and
// `/lists/:listId/forms` routes resolve ahead of any `/:id` catch-alls).
v1.use(forms_1.default);
// §16 Attachments — declares full paths spanning `/uploads/sign`,
// `/attachments/:id/*`, and `/tasks/:id/attachments`, so it mounts at the v1
// root BEFORE `/tasks` (its 2-segment `GET /tasks/:id/attachments` resolves
// ahead of the tasks router's `/:id` routes).
v1.use(attachments_1.default);
// §20 Sprints — declares full paths spanning `/sprints`, `/sprints/active`,
// `/sprints/:id`, `/sprints/:id/start|close|tasks`, and
// `/sprints/:id/tasks/:taskId`, so it mounts at the v1 root (Engineering-only;
// same pattern as taskDependenciesRouter / customFieldsRouter).
v1.use(sprints_1.default);
// §22 Engineering specials — declares full `/eng/*` paths (`/eng/report-bug`,
// and later `/eng/home`, `/eng/incidents/:id/postmortem`), so it mounts at the
// v1 root. No `/eng` prefix overlaps the other routers, so placement is free;
// grouped here with the other root-mounted full-path routers.
v1.use(engineering_1.default);
// §29 SLA management — declares full paths spanning `/sla/breached` and
// `/tasks/:id/sla`, so it mounts at the v1 root BEFORE `/tasks` (its 2-segment
// PATCH /tasks/:id/sla resolves ahead of the tasks router's /:id routes).
v1.use(sla_1.default);
// §14 Comments — full paths spanning `/tasks/:id/comments` + `/comments/:id`, so
// it mounts at the v1 root BEFORE `/tasks` (the 3-segment comments path resolves
// ahead of the tasks router's `/:id` routes).
v1.use(comments_1.default);
// §15 Checklists — full paths spanning `/tasks/:id/checklists`, `/checklists/:id`,
// and `/checklist-items/:id`, so it mounts at the v1 root BEFORE `/tasks` (the
// 3-segment `/tasks/:id/checklists` resolves ahead of the tasks router's /:id).
v1.use(checklists_1.default);
// §11 Task membership — assignees / watchers / tags under the `/tasks` prefix.
v1.use("/tasks", tasks_1.default);
// §23 Templates — clean `/templates` prefix (no shared path segments with
// `/tasks`, so mount order relative to it is irrelevant).
v1.use("/templates", templates_1.default);
// §21 On-call — weekly engineering rotation; all routes under the single
// `/on-call` prefix (no shared path segments), so mount order is irrelevant.
v1.use("/on-call", onCall_1.default);
// Dept Review V1 — weekly department reports (A-6…A-10).
v1.use("/reports", reports_1.default);
// §19 Notifications — per-user inbox (read + state-management). Clean
// `/notifications` prefix (no shared path segments), so mount order is
// irrelevant. All routes are authenticated and user-scoped.
v1.use("/notifications", notifications_1.default);
// §24 Search — clean `/search` prefix (no shared path segments); order irrelevant.
v1.use("/search", search_1.default);
// §26 Workspace activity — read-only audit feed under the clean `/activity`
// prefix (`/activity/recent` + `/activity`); no shared segments, order
// irrelevant. Authenticated, workspace-scoped.
v1.use("/activity", workspaceActivity_1.default);
// §25 Home / KPIs — clean `/home` prefix (`/home/kpis`, `/home/agenda`); no
// shared path segments, so mount order is irrelevant.
v1.use("/home", home_1.default);
// AI Help Assistant — clean `/assistant` prefix (POST /assistant/chat); no
// shared path segments, so mount order is irrelevant. Authenticated; has its
// own rate-limit bucket (assistantLimiter, 20/min/user) applied in the route.
v1.use("/assistant", assistant_1.default);
// §27 SSE — long-lived `text/event-stream` of the caller's notifications under
// the clean `/stream` prefix (GET /stream/inbox); no shared path segments, so
// mount order is irrelevant. Cookie-authenticated, user-scoped.
v1.use("/stream", sse_1.default);
// §28 Background jobs — internal cron-triggered endpoints under the clean
// `/jobs` prefix, guarded per-route by the `internalAuth` (X-Internal-Token)
// middleware rather than the user JWT. Mount order irrelevant.
v1.use("/jobs", jobs_1.default);
// Future feature routers mount the same way:
//   v1.use("/lists", listRouter);
//   …
app.use("/api/v1", v1);
// 404 (envelope-formatted) + global error handler MUST be the last two.
app.use(notFound_1.notFoundMiddleware);
app.use(errorHandler_1.errorHandler);
exports.default = app;
