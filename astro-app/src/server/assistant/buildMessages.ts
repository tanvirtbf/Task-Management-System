import { SYSTEM_PROMPT } from "./systemPrompt";
import { KNOWLEDGE_BASE } from "./knowledgeBase";

/** A turn in the conversation, as sent by the client / stored in history. */
export type ChatRole = "user" | "assistant";

export interface ChatTurn {
    role: ChatRole;
    content: string;
}

/** A message in the OpenAI chat-completions format. */
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * The full system message = behaviour rules (SYSTEM_PROMPT) + the knowledge
 * base. Assembled once at module load (both are static module constants).
 */
const SYSTEM_CONTENT = `${SYSTEM_PROMPT}\n\n# KNOWLEDGE BASE\n${KNOWLEDGE_BASE}`;

/**
 * Keep only the most recent turns — a cost guard (caps tokens per call) and a
 * focus guard (old context rarely matters for a help bot).
 */
export const MAX_HISTORY_TURNS = 12;

/**
 * Build the message array for an OpenAI chat completion:
 *   [ system(prompt + knowledge base), ...recent history, user(message) ]
 */
export const buildMessages = (
    history: ChatTurn[],
    userMessage: string,
): ChatMessage[] => {
    const recent = history.slice(-MAX_HISTORY_TURNS);
    return [
        { role: "system", content: SYSTEM_CONTENT },
        ...recent.map(
            (t): ChatMessage => ({ role: t.role, content: t.content }),
        ),
        { role: "user", content: userMessage },
    ];
};
