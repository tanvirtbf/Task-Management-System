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
export const openai = new OpenAI({
    apiKey: Config.OPENAI_API_KEY,
    // Resilience guards: a chat reply should never hang the request for long,
    // and one transient retry is enough (the route maps failures to AppError).
    timeout: 30_000,
    maxRetries: 1,
});

/** Chat model; configurable via `OPENAI_MODEL` (default: `gpt-4o-mini`). */
export const ASSISTANT_MODEL: string = Config.OPENAI_MODEL ?? "gpt-4o-mini";

/** Max tokens the assistant may generate per reply — a cost guard. */
export const ASSISTANT_MAX_OUTPUT_TOKENS: number =
    Number(Config.OPENAI_MAX_OUTPUT_TOKENS) || 800;
