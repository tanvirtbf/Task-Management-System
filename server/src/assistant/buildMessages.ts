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

/** A calendar day and the zone it was computed in, so the two cannot drift. */
export interface WorkspaceDay {
    /** `YYYY-MM-DD` in `zone`. */
    date: string;
    /** IANA name, e.g. `Asia/Dhaka` — printed to the model verbatim. */
    zone: string;
}

/**
 * `callerBlock` (deep-plan P2) is the one-sentence description of WHO is
 * asking — built by the controller, which is the only layer holding the
 * request (D9). Empty string when it could not be built; the prompt then
 * reads exactly as it did before.
 */
/**
 * KI-20: the date line is the model's ONLY anchor for relative dates — "kal",
 * "next week", "last 7 days" are all resolved against it, and `get_my_agenda`
 * is documented as expecting the model to work the day out from "today's date
 * at the top of the prompt". So it has to be the WORKSPACE's day, not the
 * company's.
 *
 * It used `dhakaToday()` and said "(Asia/Dhaka)" — honest about its frame of
 * reference, and still the wrong day for a workspace in another zone, which
 * would have the bot confidently answering yesterday's question. The zone name
 * travels with the date so the label can never drift from the value.
 */
const systemContent = (callerBlock?: string, today?: WorkspaceDay): string => {
    const day = today ?? { date: dhakaToday(), zone: "Asia/Dhaka" };
    const date = `Today is ${day.date} (${day.zone}).`;
    const who = callerBlock ? `\n${callerBlock}` : "";
    return `${date}${who}\n\n${STATIC_CONTENT}`;
};

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
    callerBlock?: string,
    today?: WorkspaceDay,
): ChatMessage[] => {
    const recent = history.slice(-MAX_HISTORY_TURNS);
    return [
        { role: "system", content: systemContent(callerBlock, today) },
        ...recent.map(
            (t): ChatMessage => ({ role: t.role, content: t.content }),
        ),
        { role: "user", content: userMessage },
    ];
};
