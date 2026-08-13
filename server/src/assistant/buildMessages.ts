import { SYSTEM_PROMPT } from "./systemPrompt";
import { KNOWLEDGE_BASE } from "./knowledgeBase";
import { dhakaToday } from "../utils/dhakaTime";

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
 * The full system message = today's date (create_task needs it to resolve
 * "kal/tomorrow" into YYYY-MM-DD — the office's calendar is Asia/Dhaka) +
 * behaviour rules (SYSTEM_PROMPT) + the knowledge base. The static halves are
 * joined once at module load; the date line is prepended per call.
 */
const STATIC_CONTENT = `${SYSTEM_PROMPT}\n\n# KNOWLEDGE BASE\n${KNOWLEDGE_BASE}`;

const systemContent = (): string =>
    `Today is ${dhakaToday()} (Asia/Dhaka).\n\n${STATIC_CONTENT}`;

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
        { role: "system", content: systemContent() },
        ...recent.map(
            (t): ChatMessage => ({ role: t.role, content: t.content }),
        ),
        { role: "user", content: userMessage },
    ];
};
