"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const AssistantController_1 = require("../controllers/AssistantController");
const AssistantService_1 = require("../services/AssistantService");
const ChatRepo_1 = require("../repositories/ChatRepo");
const HomeService_1 = require("../services/HomeService");
const HomeRepo_1 = require("../repositories/HomeRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const SearchService_1 = require("../services/SearchService");
const SearchRepo_1 = require("../repositories/SearchRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const TasksService_1 = require("../services/TasksService");
const TaskWriteService_1 = require("../services/TaskWriteService");
const openaiClient_1 = require("../services/openaiClient");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const requirePermission_1 = require("../middlewares/requirePermission");
const rateLimit_1 = require("../middlewares/rateLimit");
const errors_1 = require("../errors");
const assistant_1 = require("../validators/assistant");
/**
 * AI Help Assistant. Clean `/assistant` prefix (no shared path segments), so it
 * mounts at `v1.use("/assistant", assistantRouter)` and mount order is
 * irrelevant. See AI_ASSISTANT_PLAN.md.
 */
const router = express_1.default.Router();
if (!openaiClient_1.openai) {
    // No OPENAI_API_KEY configured. `openaiClient` returned null instead of
    // letting the OpenAI SDK constructor throw at import — which would crash the
    // WHOLE server at boot via the app.ts → routes/assistant import chain. The
    // assistant degrades to a clean 503 on every route; set OPENAI_API_KEY to
    // enable it. (authenticate still runs first, so an unauth caller gets 401.)
    logger_1.default.warn("AI assistant disabled: OPENAI_API_KEY is not set — /api/v1/assistant/* returns 503");
    router.use(authenticate_1.default, (_req, _res, next) => next(new errors_1.AppError(503, "assistant.not_configured", "The AI assistant is not configured on this server.")));
}
else {
    // ─── DI wiring ───────────────────────────────────────────────────────────
    // The OpenAI client + model + token cap are injected (so tests can fake them).
    // `getDb()` resolves because server.ts calls initDb() before app.ts is imported.
    const db = (0, client_1.getDb)();
    const assistantService = new AssistantService_1.AssistantService(openaiClient_1.openai, openaiClient_1.ASSISTANT_MODEL, openaiClient_1.ASSISTANT_MAX_OUTPUT_TOKENS, logger_1.default);
    const chatRepo = new ChatRepo_1.ChatRepo(db);
    // Data tools (Phase 8): HomeService (KPIs/agenda) + SearchService reads,
    // and — 2026-08-12 — the ONE write, `create_task`, through the full
    // task-write stack (the forms/engineering wiring precedent). It runs
    // inside the authenticated request, so the chatting user's own RBAC
    // reach, the team-access approval gate and the audit trail all apply.
    const tasksRepo = new TasksRepo_1.TasksRepo(db);
    const listsRepo = new ListsRepo_1.ListsRepo(db);
    const usersRepo = new UsersRepo_1.UsersRepo(db);
    const tasksService = new TasksService_1.TasksService(listsRepo, tasksRepo);
    const toolServices = {
        home: new HomeService_1.HomeService(new HomeRepo_1.HomeRepo(db), tasksRepo, new WorkspaceRepo_1.WorkspaceRepo(db)),
        search: new SearchService_1.SearchService(new SearchRepo_1.SearchRepo(db), tasksRepo),
        taskWrite: new TaskWriteService_1.TaskWriteService(db, listsRepo, new StatusesRepo_1.StatusesRepo(db), new TaskTypesRepo_1.TaskTypesRepo(db), tasksRepo, new TaskMembershipRepo_1.TaskMembershipRepo(db), usersRepo, new TagsRepo_1.TagsRepo(db), new TaskActivityRepo_1.TaskActivityRepo(db), new NotificationsRepo_1.NotificationsRepo(db), new AttachmentsRepo_1.AttachmentsRepo(db), new WorkspaceRepo_1.WorkspaceRepo(db), new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), tasksService, logger_1.default),
        users: usersRepo,
    };
    const controller = new AssistantController_1.AssistantController(assistantService, chatRepo, toolServices, logger_1.default);
    // The assistant is a permission now, not a given (RBAC §34). All four
    // seeded roles hold `assistant.use`, so nothing changes today — but an
    // admin who takes it away from a role actually gets what they asked for,
    // instead of a catalog checkbox that gates nothing.
    //
    // Order: the rate limiter stays OUTSIDE the permission check. It is a cheap
    // in-memory counter and the check is a database read; letting a flood past
    // it just to look up permissions would defeat the point of having it.
    const canUseAssistant = (0, requirePermission_1.requirePermission)("assistant.use");
    // ─── POST /api/v1/assistant/chat ───────────────────────────────────────────
    // 🔐 assistant.use. authenticate → assistantLimiter (20/min/user) → permission
    // → validate body.
    // Streams Server-Sent Events when the client sends `Accept: text/event-stream`
    // (the frontend does); otherwise returns the full reply as JSON `{ reply }`.
    router.post("/chat", authenticate_1.default, rateLimit_1.assistantLimiter, canUseAssistant, assistant_1.chatValidator, validate_1.validate, (req, res, next) => {
        const r = req;
        const wantsStream = (req.headers.accept ?? "").includes("text/event-stream");
        return wantsStream
            ? controller.chatStream(r, res, next)
            : controller.chat(r, res, next);
    });
    // ─── GET /api/v1/assistant/conversations ───────────────────────────────────
    // 🔐 the caller's own conversations (Phase 6 persistence), newest first.
    router.get("/conversations", authenticate_1.default, canUseAssistant, (req, res, next) => controller.listConversations(req, res, next));
    // ─── GET /api/v1/assistant/conversations/:id ────────────────────────────────
    // 🔐 owner only — a foreign / unknown id is 404 conversation.not_found.
    router.get("/conversations/:id", authenticate_1.default, canUseAssistant, assistant_1.conversationParamValidator, validate_1.validate, (req, res, next) => controller.getConversation(req, res, next));
}
exports.default = router;
