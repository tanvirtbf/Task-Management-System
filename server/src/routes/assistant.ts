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
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { SearchService } from "../services/SearchService";
import { SearchRepo } from "../repositories/SearchRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { UserRolesRepo } from "../repositories/UserRolesRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { AssignmentRequestsRepo } from "../repositories/AssignmentRequestsRepo";
import { DepartmentReportsRepo } from "../repositories/DepartmentReportsRepo";
import { SlaRepo } from "../repositories/SlaRepo";
import { AssignmentRequestsService } from "../services/AssignmentRequestsService";
import { SlaService } from "../services/SlaService";
import { getPolicy } from "../rbac/policy";
import { TasksService } from "../services/TasksService";
import { TaskWriteService } from "../services/TaskWriteService";
import {
    openai,
    ASSISTANT_MODEL,
    ASSISTANT_MAX_OUTPUT_TOKENS,
} from "../services/openaiClient";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { requirePermission } from "../middlewares/requirePermission";
import { assistantLimiter } from "../middlewares/rateLimit";
import { AppError } from "../errors";
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

if (!openai) {
    // No OPENAI_API_KEY configured. `openaiClient` returned null instead of
    // letting the OpenAI SDK constructor throw at import — which would crash the
    // WHOLE server at boot via the app.ts → routes/assistant import chain. The
    // assistant degrades to a clean 503 on every route; set OPENAI_API_KEY to
    // enable it. (authenticate still runs first, so an unauth caller gets 401.)
    logger.warn(
        "AI assistant disabled: OPENAI_API_KEY is not set — /api/v1/assistant/* returns 503",
    );
    router.use(
        authenticate,
        (_req: Request, _res: Response, next: NextFunction) =>
            next(
                new AppError(
                    503,
                    "assistant.not_configured",
                    "The AI assistant is not configured on this server.",
                ),
            ),
    );
} else {
    // ─── DI wiring ───────────────────────────────────────────────────────────
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
    // Data tools (Phase 8): HomeService (KPIs/agenda) + SearchService reads,
    // and — 2026-08-12 — the ONE write, `create_task`, through the full
    // task-write stack (the forms/engineering wiring precedent). It runs
    // inside the authenticated request, so the chatting user's own RBAC
    // reach, the team-access approval gate and the audit trail all apply.
    const tasksRepo = new TasksRepo(db);
    const listsRepo = new ListsRepo(db);
    const usersRepo = new UsersRepo(db);
    const tasksService = new TasksService(listsRepo, tasksRepo);
    const toolServices = {
        home: new HomeService(new HomeRepo(db), tasksRepo, new WorkspaceRepo(db)),
        search: new SearchService(new SearchRepo(db), tasksRepo),
        taskWrite: new TaskWriteService(
            db,
            listsRepo,
            new StatusesRepo(db),
            new TaskTypesRepo(db),
            tasksRepo,
            new TaskMembershipRepo(db),
            usersRepo,
            new TagsRepo(db),
            new TaskActivityRepo(db),
            new NotificationsRepo(db),
            new AttachmentsRepo(db),
            new WorkspaceRepo(db),
            new WorkspaceActivityRepo(db),
            tasksService,
            logger,
        ),
        users: usersRepo,
        tasks: tasksRepo,
        // Deep-plan P4–P6: people/teams, approvals, reports and SLA reads.
        // The requests service is READ-ONLY here (listFor) — no delivery arm.
        spaces: new SpacesRepo(db),
        userRoles: new UserRolesRepo(db),
        requests: new AssignmentRequestsService(
            db,
            new AssignmentRequestsRepo(db),
            tasksRepo,
            new TaskMembershipRepo(db),
            new TaskActivityRepo(db),
            new NotificationsRepo(db),
            usersRepo,
            new UserRolesRepo(db),
            getPolicy(),
            logger,
        ),
        reports: new DepartmentReportsRepo(db),
        sla: new SlaService(
            db,
            new SlaRepo(db),
            tasksRepo,
            usersRepo,
            new TaskActivityRepo(db),
            tasksService,
            logger,
        ),
    };
    // Deep-plan P2 (D11): team NAMES are not on the resolved actor, so the
    // caller block needs the membership rows plus the (already scope-filtered)
    // space list. Two cheap reads per chat request.
    const callerDeps = {
        users: usersRepo,
        spaces: new SpacesRepo(db),
        userRoles: new UserRolesRepo(db),
    };
    const controller = new AssistantController(
        assistantService,
        chatRepo,
        toolServices,
        callerDeps,
        logger,
    );

    // The assistant is a permission now, not a given (RBAC §34). All four
    // seeded roles hold `assistant.use`, so nothing changes today — but an
    // admin who takes it away from a role actually gets what they asked for,
    // instead of a catalog checkbox that gates nothing.
    //
    // Order: the rate limiter stays OUTSIDE the permission check. It is a cheap
    // in-memory counter and the check is a database read; letting a flood past
    // it just to look up permissions would defeat the point of having it.
    const canUseAssistant = requirePermission("assistant.use");

    // ─── POST /api/v1/assistant/chat ───────────────────────────────────────────
    // 🔐 assistant.use. authenticate → assistantLimiter (20/min/user) → permission
    // → validate body.
    // Streams Server-Sent Events when the client sends `Accept: text/event-stream`
    // (the frontend does); otherwise returns the full reply as JSON `{ reply }`.
    router.post(
        "/chat",
        authenticate,
        assistantLimiter,
        canUseAssistant,
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

    // ─── GET /api/v1/assistant/conversations ───────────────────────────────────
    // 🔐 the caller's own conversations (Phase 6 persistence), newest first.
    router.get(
        "/conversations",
        authenticate,
        canUseAssistant,
        (req: Request, res: Response, next: NextFunction) =>
            controller.listConversations(req as AuthRequest, res, next),
    );

    // ─── GET /api/v1/assistant/conversations/:id ────────────────────────────────
    // 🔐 owner only — a foreign / unknown id is 404 conversation.not_found.
    router.get(
        "/conversations/:id",
        authenticate,
        canUseAssistant,
        conversationParamValidator,
        validate,
        (req: Request, res: Response, next: NextFunction) =>
            controller.getConversation(req as AuthRequest, res, next),
    );
}

export default router;
