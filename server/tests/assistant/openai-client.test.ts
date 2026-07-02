import OpenAI from "openai";
import { createOpenAIClient } from "../../src/services/openaiClient";

/**
 * The OpenAI SDK constructor THROWS on an empty/missing key. Because
 * `openaiClient` is imported transitively by `app.ts`, an unconditional
 * construction would crash the whole server at boot without an `OPENAI_API_KEY`.
 * `createOpenAIClient` must return `null` (not throw) for an absent key.
 */
describe("openaiClient.createOpenAIClient — boot-safe construction", () => {
    it("returns null for an empty key (no throw — the app boots without OPENAI_API_KEY)", () => {
        expect(createOpenAIClient("")).toBeNull();
    });

    it("returns null for an undefined key", () => {
        expect(createOpenAIClient(undefined)).toBeNull();
    });

    it("returns a real OpenAI client when a key is present", () => {
        const client = createOpenAIClient("sk-test-not-a-real-key");
        expect(client).toBeInstanceOf(OpenAI);
    });
});
