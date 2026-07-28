"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const buildMessages_1 = require("../assistant/buildMessages");
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Phase 1 check for the AI Help Assistant (see AI_ASSISTANT_PLAN.md).
 *
 * Verifies that `buildMessages` assembles the system prompt + knowledge base +
 * capped history correctly. No OpenAI call, no DB. Run:
 *   npx tsx src/bin/check-assistant.ts
 * Exits 0 if all checks pass, 1 otherwise. Safe to delete after Phase 2.
 */
const fakeHistory = Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `old message ${i}`,
}));
const messages = (0, buildMessages_1.buildMessages)(fakeHistory, "আমি কীভাবে task বানাবো?");
const system = messages[0];
const last = messages[messages.length - 1];
const systemContent = system?.content ?? "";
const checks = {
    firstIsSystem: system?.role === "system",
    systemHasPrompt: systemContent.includes("সহায়ক"),
    systemHasKnowledgeBaseHeader: systemContent.includes("# KNOWLEDGE BASE"),
    kbDescribesHierarchy: systemContent.includes("Workspace → Space → List → Task"),
    // 15 history turns must be capped to MAX_HISTORY_TURNS, plus system + user.
    historyCapped: messages.length === buildMessages_1.MAX_HISTORY_TURNS + 2,
    lastIsUserMessage: last?.role === "user" && last.content.includes("task"),
};
const allPass = Object.values(checks).every(Boolean);
logger_1.default.info("assistant.check", {
    totalMessages: messages.length,
    systemContentChars: systemContent.length,
    approxSystemTokens: Math.round(systemContent.length / 4),
    ...checks,
});
logger_1.default.info(allPass ? "assistant.check.PASS" : "assistant.check.FAIL", allPass ? {} : { failed: Object.keys(checks).filter((k) => !checks[k]) });
process.exit(allPass ? 0 : 1);
