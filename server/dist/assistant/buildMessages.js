"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMessages = exports.MAX_HISTORY_TURNS = void 0;
const systemPrompt_1 = require("./systemPrompt");
const knowledgeBase_1 = require("./knowledgeBase");
/**
 * The full system message = behaviour rules (SYSTEM_PROMPT) + the knowledge
 * base. Assembled once at module load (both are static module constants).
 */
const SYSTEM_CONTENT = `${systemPrompt_1.SYSTEM_PROMPT}\n\n# KNOWLEDGE BASE\n${knowledgeBase_1.KNOWLEDGE_BASE}`;
/**
 * Keep only the most recent turns — a cost guard (caps tokens per call) and a
 * focus guard (old context rarely matters for a help bot).
 */
exports.MAX_HISTORY_TURNS = 12;
/**
 * Build the message array for an OpenAI chat completion:
 *   [ system(prompt + knowledge base), ...recent history, user(message) ]
 */
const buildMessages = (history, userMessage) => {
    const recent = history.slice(-exports.MAX_HISTORY_TURNS);
    return [
        { role: "system", content: SYSTEM_CONTENT },
        ...recent.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: userMessage },
    ];
};
exports.buildMessages = buildMessages;
