import type { AuthRequest } from "./index";
import type { ChatTurn } from "../assistant/buildMessages";

/**
 * Types for the AI Help Assistant HTTP layer (see AI_ASSISTANT_PLAN.md, Phase 2).
 */

/** Body of `POST /api/v1/assistant/chat`. */
export interface AssistantChatBody {
    /** The user's new question. */
    message: string;
    /** Prior turns of the conversation (capped + validated). Optional. */
    history?: ChatTurn[];
    /**
     * Existing conversation to append to (Phase 6 persistence). Omitted on the
     * first message — the server creates a new conversation and returns its id.
     */
    conversationId?: string;
}

/** Authenticated request for the assistant chat endpoint. */
export interface AssistantChatRequest extends AuthRequest {
    body: AssistantChatBody;
}
