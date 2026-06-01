import {
    buildMessages,
    MAX_HISTORY_TURNS,
    type ChatTurn,
} from "../assistant/buildMessages";
import logger from "../config/logger";

/**
 * Phase 1 check for the AI Help Assistant (see AI_ASSISTANT_PLAN.md).
 *
 * Verifies that `buildMessages` assembles the system prompt + knowledge base +
 * capped history correctly. No OpenAI call, no DB. Run:
 *   npx tsx src/bin/check-assistant.ts
 * Exits 0 if all checks pass, 1 otherwise. Safe to delete after Phase 2.
 */
const fakeHistory: ChatTurn[] = Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `old message ${i}`,
}));

const messages = buildMessages(fakeHistory, "আমি কীভাবে task বানাবো?");
const system = messages[0];
const last = messages[messages.length - 1];
const systemContent = system?.content ?? "";

const checks: Record<string, boolean> = {
    firstIsSystem: system?.role === "system",
    systemHasPrompt: systemContent.includes("সহায়ক"),
    systemHasKnowledgeBaseHeader: systemContent.includes("# KNOWLEDGE BASE"),
    kbDescribesHierarchy: systemContent.includes(
        "Workspace → Space → List → Task",
    ),
    // 15 history turns must be capped to MAX_HISTORY_TURNS, plus system + user.
    historyCapped: messages.length === MAX_HISTORY_TURNS + 2,
    lastIsUserMessage: last?.role === "user" && last.content.includes("task"),
};

const allPass = Object.values(checks).every(Boolean);

logger.info("assistant.check", {
    totalMessages: messages.length,
    systemContentChars: systemContent.length,
    approxSystemTokens: Math.round(systemContent.length / 4),
    ...checks,
});
logger.info(
    allPass ? "assistant.check.PASS" : "assistant.check.FAIL",
    allPass ? {} : { failed: Object.keys(checks).filter((k) => !checks[k]) },
);

process.exit(allPass ? 0 : 1);
