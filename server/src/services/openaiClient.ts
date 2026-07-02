import OpenAI from "openai";
import { Config } from "../config";

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
export const createOpenAIClient = (
    apiKey: string | undefined,
): OpenAI | null =>
    apiKey ? new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;

/** Singleton OpenAI client — `null` when the assistant is not configured. */
export const openai: OpenAI | null = createOpenAIClient(Config.OPENAI_API_KEY);

/** True when the assistant is configured (an API key is present). */
export const assistantEnabled: boolean = openai !== null;

/** Chat model; configurable via `OPENAI_MODEL` (default: `gpt-4o-mini`). */
export const ASSISTANT_MODEL: string = Config.OPENAI_MODEL ?? "gpt-4o-mini";

/** Max tokens the assistant may generate per reply — a cost guard. */
export const ASSISTANT_MAX_OUTPUT_TOKENS: number =
    Number(Config.OPENAI_MAX_OUTPUT_TOKENS) || 800;
