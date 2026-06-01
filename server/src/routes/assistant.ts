import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { AssistantController } from "../controllers/AssistantController";
import { AssistantService } from "../services/AssistantService";
import { ChatRepo } from "../repositories/ChatRepo";
import { HomeService } from "../services/HomeService";
import { HomeRepo } from "../repositories/HomeRepo";
import { SearchService } from "../services/SearchService";
import { SearchRepo } from "../repositories/SearchRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import {
    openai,
    ASSISTANT_MODEL,
    ASSISTANT_MAX_OUTPUT_TOKENS,
} from "../services/openaiClient";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { assistantLimiter } from "../middlewares/rateLimit";
import {
    chatValidator,
    conversationParamValidator,
} from "../validators/assistant";
import type { AssistantChatRequest } from "../types/assistant";
import type { AuthRequest } from "../types";

/**
 * AI Help Assistant. Clean `/assistant` prefix (no shared path segments), so it
 * mounts at `v1.use("/assistant", assistantRouter)` and mount order is
 * irrelevant. See AI_ASSISTANT_PLAN.md.
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// The OpenAI client + model + token cap are injected (so tests can fake them).
// `getDb()` resolves because server.ts calls initDb() before app.ts is imported.
const db = getDb();
const assistantService = new AssistantService(
    openai,
    ASSISTANT_MODEL,
    ASSISTANT_MAX_OUTPUT_TOKENS,
    logger,
);
const chatRepo = new ChatRepo(db);
// Read-only data tools (Phase 8): reuse HomeService (KPIs/agenda) + SearchService.
const tasksRepo = new TasksRepo(db);
const toolServices = {
    home: new HomeService(new HomeRepo(db), tasksRepo),
    search: new SearchService(new SearchRepo(db), tasksRepo),
};
const controller = new AssistantController(
    assistantService,
    chatRepo,
    toolServices,
    logger,
);

// ─── POST /api/v1/assistant/chat ───────────────────────────────────────────────
// 🔐 any member. authenticate → assistantLimiter (20/min/user) → validate body.
// Streams Server-Sent Events when the client sends `Accept: text/event-stream`
// (the frontend does); otherwise returns the full reply as JSON `{ reply }`.
router.post(
    "/chat",
    authenticate,
    assistantLimiter,
    chatValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) => {
        const r = req as AssistantChatRequest;
        const wantsStream = (req.headers.accept ?? "").includes(
            "text/event-stream",
        );
        return wantsStream
            ? controller.chatStream(r, res, next)
            : controller.chat(r, res, next);
    },
);

// ─── GET /api/v1/assistant/conversations ───────────────────────────────────────
// 🔐 the caller's own conversations (Phase 6 persistence), newest first.
router.get(
    "/conversations",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listConversations(req as AuthRequest, res, next),
);

// ─── GET /api/v1/assistant/conversations/:id ────────────────────────────────────
// 🔐 owner only — a foreign / unknown id is 404 conversation.not_found.
router.get(
    "/conversations/:id",
    authenticate,
    conversationParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getConversation(req as AuthRequest, res, next),
);

export default router;
