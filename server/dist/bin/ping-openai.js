"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openaiClient_1 = require("../services/openaiClient");
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Phase 0 smoke check for the AI Help Assistant (see AI_ASSISTANT_PLAN.md).
 *
 * Confirms `OPENAI_API_KEY` is valid and the configured model is reachable:
 *   npx tsx src/bin/ping-openai.ts
 *
 * Logs the model's reply + token usage and exits 0 on success, 1 on failure.
 * Safe to delete once Phase 2 (the real `/assistant/chat` endpoint) lands.
 */
const run = async () => {
    logger_1.default.info("openai.ping.start", { model: openaiClient_1.ASSISTANT_MODEL });
    if (!openaiClient_1.openai) {
        logger_1.default.error("openai.ping.failed", {
            error: "OpenAI client not configured (set OPENAI_API_KEY)",
        });
        process.exit(1);
    }
    try {
        const res = await openaiClient_1.openai.chat.completions.create({
            model: openaiClient_1.ASSISTANT_MODEL,
            messages: [
                {
                    role: "user",
                    content: 'Reply with exactly: "AI Assistant connection OK"',
                },
            ],
            max_tokens: 20,
        });
        const reply = res.choices[0]?.message?.content ?? "(no content)";
        logger_1.default.info("openai.ping.ok", { reply, usage: res.usage });
        process.exit(0);
    }
    catch (err) {
        logger_1.default.error("openai.ping.failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
    }
};
void run();
