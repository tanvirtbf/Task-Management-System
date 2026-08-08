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
    // Read-only data tools (Phase 8): reuse HomeService (KPIs/agenda) + SearchService.
    const tasksRepo = new TasksRepo_1.TasksRepo(db);
    const toolServices = {
        home: new HomeService_1.HomeService(new HomeRepo_1.HomeRepo(db), tasksRepo, new WorkspaceRepo_1.WorkspaceRepo(db)),
        search: new SearchService_1.SearchService(new SearchRepo_1.SearchRepo(db), tasksRepo),
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
