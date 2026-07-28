"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSISTANT_MAX_OUTPUT_TOKENS = exports.ASSISTANT_MODEL = exports.assistantEnabled = exports.openai = exports.createOpenAIClient = void 0;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
/**
 * Singleton OpenAI client for the in-app AI Help Assistant
 * (see AI_ASSISTANT_PLAN.md, Phase 0).
 *
 * The API key is a SERVER-ONLY secret — loaded from `OPENAI_API_KEY` in `.env`
 * (which is gitignored) and never exposed to the frontend. Every assistant call
 * goes through this module so the key, model, and limits live in one place.
 */
/**
 * Build an OpenAI client, or `null` when no API key is configured.
 *
 * The OpenAI SDK constructor THROWS on an empty/missing key. Since this module
 * is imported transitively by `app.ts` (via `routes/assistant`), constructing it
 * unconditionally would crash the WHOLE server at boot on any deployment without
 * an `OPENAI_API_KEY` (fresh clone / LAN / AI-disabled). Returning `null` lets
 * the app boot; `routes/assistant` then serves a clean 503 for the assistant.
 *
 * Resilience guards: a chat reply should never hang the request for long, and one
 * transient retry is enough (the route maps failures to AppError).
 */
const createOpenAIClient = (apiKey) => apiKey ? new openai_1.default({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;
exports.createOpenAIClient = createOpenAIClient;
/** Singleton OpenAI client — `null` when the assistant is not configured. */
exports.openai = (0, exports.createOpenAIClient)(config_1.Config.OPENAI_API_KEY);
/** True when the assistant is configured (an API key is present). */
exports.assistantEnabled = exports.openai !== null;
/** Chat model; configurable via `OPENAI_MODEL` (default: `gpt-4o-mini`). */
exports.ASSISTANT_MODEL = config_1.Config.OPENAI_MODEL ?? "gpt-4o-mini";
/** Max tokens the assistant may generate per reply — a cost guard. */
exports.ASSISTANT_MAX_OUTPUT_TOKENS = Number(config_1.Config.OPENAI_MAX_OUTPUT_TOKENS) || 800;
