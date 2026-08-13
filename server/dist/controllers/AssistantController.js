"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantController = void 0;
const errors_1 = require("../errors");
const tools_1 = require("../assistant/tools");
const callerContext_1 = require("../assistant/callerContext");
/** Derive a short conversation title from the first question. */
const titleFromMessage = (msg) => {
    const t = msg.trim().replace(/\s+/g, " ");
    if (!t)
        return "New chat";
    return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};
/**
 * AI Help Assistant HTTP layer. Returns the reply (JSON or SSE stream) and
 * persists the conversation (Phase 6). Persistence is BEST-EFFORT — a DB hiccup
 * is logged but never blocks the chat. 🔐 any member; reads are user-scoped.
 */
class AssistantController {
    assistantService;
    chatRepo;
    toolServices;
    callerDeps;
    logger;
    constructor(assistantService, chatRepo, toolServices, 
    /** Deep-plan P2 (D9): only this layer holds the request, so only it
     *  can describe the caller. Built once per request, never persisted. */
    callerDeps, logger) {
        this.assistantService = assistantService;
        this.chatRepo = chatRepo;
        this.toolServices = toolServices;
        this.callerDeps = callerDeps;
        this.logger = logger;
    }
    // ─── persistence helpers (best-effort) ──────────────────────────────────
    async resolveConversation(userId, workspaceId, conversationId, firstMessage) {
        try {
            if (conversationId) {
                const existing = await this.chatRepo.findConversation(conversationId, userId);
                if (existing)
                    return existing.id;
                // Unknown / foreign id → start a fresh thread (never append to
                // another user's conversation).
            }
            return await this.chatRepo.createConversation(workspaceId, userId, titleFromMessage(firstMessage));
        }
        catch (err) {
            this.logger.error("assistant.persist.conversation_failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }
    async saveMessage(convId, role, content) {
        if (!convId || !content)
            return;
        try {
            await this.chatRepo.addMessage(convId, role, content);
            if (role === "assistant")
                await this.chatRepo.touchConversation(convId);
        }
        catch (err) {
            this.logger.error("assistant.persist.message_failed", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // ─── POST /api/v1/assistant/chat (non-streaming) ────────────────────────
    async chat(req, res, next) {
        try {
            const { message, history, conversationId } = req.body;
            const { sub: userId, workspaceId } = req.auth;
            const toolCtx = { userId, workspaceId, role: req.auth.role };
            const convId = await this.resolveConversation(userId, workspaceId, conversationId, message);
            await this.saveMessage(convId, "user", message);
            // Same tools as the SSE path (P9 / decision D-9): a contract that
            // answers "how many tasks do I have" over one transport and not the
            // other is a bug waiting for its first non-browser client.
            // The executor is built per REQUEST: it carries the double-create
            // guard (a duplicated create_task call in one message returns the
            // first result instead of writing twice).
            const callerBlock = await (0, callerContext_1.buildCallerBlock)(this.callerDeps, {
                userId,
                workspaceId,
            });
            const reply = await this.assistantService.ask(history ?? [], message, {
                callerBlock,
                tools: {
                    definitions: tools_1.ASSISTANT_TOOL_DEFS,
                    execute: (0, tools_1.makeAssistantToolExecutor)(toolCtx, this.toolServices),
                },
            });
            await this.saveMessage(convId, "assistant", reply);
            this.logger.debug("assistant.chat.ok", {
                requestId: req.requestId,
                userId,
                conversationId: convId,
            });
            res.status(200).json({ reply, conversationId: convId });
        }
        catch (err) {
            next(err);
        }
    }
    // ─── POST /api/v1/assistant/chat with Accept: text/event-stream ─────────
    async chatStream(req, res, next) {
        const { message, history, conversationId } = req.body;
        const { sub: userId, workspaceId } = req.auth;
        const toolCtx = { userId, workspaceId, role: req.auth.role };
        const convId = await this.resolveConversation(userId, workspaceId, conversationId, message);
        await this.saveMessage(convId, "user", message);
        const ac = new AbortController();
        res.on("close", () => ac.abort());
        let started = false;
        let full = "";
        const startSse = () => {
            started = true;
            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Conversation-Id": convId ?? "",
            });
            res.flushHeaders();
        };
        const sendDelta = (delta) => {
            full += delta;
            if (!started)
                startSse();
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        };
        try {
            const callerBlock = await (0, callerContext_1.buildCallerBlock)(this.callerDeps, {
                userId,
                workspaceId,
            });
            await this.assistantService.streamReply(history ?? [], message, {
                onDelta: sendDelta,
                signal: ac.signal,
                callerBlock,
                tools: {
                    definitions: tools_1.ASSISTANT_TOOL_DEFS,
                    execute: (0, tools_1.makeAssistantToolExecutor)(toolCtx, this.toolServices),
                },
            });
            if (ac.signal.aborted) {
                await this.saveMessage(convId, "assistant", full); // keep partial
                if (!res.writableEnded)
                    res.end();
                return;
            }
            if (!started)
                startSse();
            res.write("data: [DONE]\n\n");
            res.end();
            await this.saveMessage(convId, "assistant", full);
            this.logger.debug("assistant.chat.stream_ok", {
                requestId: req.requestId,
                userId,
                conversationId: convId,
            });
        }
        catch (err) {
            if (ac.signal.aborted) {
                await this.saveMessage(convId, "assistant", full);
                if (!res.writableEnded)
                    res.end();
                return;
            }
            // Error before any byte → normal HTTP error envelope.
            if (!started) {
                next(err);
                return;
            }
            // Error mid-stream → SSE error event (headers already sent).
            const code = err instanceof errors_1.AppError ? err.code : "assistant.upstream_error";
            const friendly = err instanceof errors_1.AppError
                ? err.message
                : "The assistant is temporarily unavailable.";
            this.logger.error("assistant.chat.stream_error", {
                requestId: req.requestId,
                code,
            });
            res.write(`data: ${JSON.stringify({ error: code, message: friendly })}\n\n`);
            res.end();
            await this.saveMessage(convId, "assistant", full); // keep partial
        }
    }
    // ─── GET /api/v1/assistant/conversations ────────────────────────────────
    async listConversations(req, res, next) {
        try {
            const conversations = await this.chatRepo.listConversationsByUser(req.auth.sub);
            res.status(200).json({ conversations });
        }
        catch (err) {
            next(err);
        }
    }
    // ─── GET /api/v1/assistant/conversations/:id ────────────────────────────
    async getConversation(req, res, next) {
        try {
            const id = req.params.id;
            const conv = await this.chatRepo.findConversation(id, req.auth.sub);
            if (!conv) {
                throw errors_1.AppError.notFound("conversation.not_found", "Conversation not found");
            }
            const messages = await this.chatRepo.getMessages(conv.id);
            res.status(200).json({
                id: conv.id,
                title: conv.title,
                createdAt: conv.createdAt,
                updatedAt: conv.updatedAt,
                messages,
            });
        }
        catch (err) {
            next(err);
        }
    }
}
exports.AssistantController = AssistantController;
