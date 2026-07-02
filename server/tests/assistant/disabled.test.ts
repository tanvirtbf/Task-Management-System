// Simulates a deployment with NO OPENAI_API_KEY: `openaiClient.openai` is null.
// The app must still boot and every /assistant route must degrade to a clean 503
// (never crash, never leak). Separate file so this null mock doesn't collide with
// chat.test.ts's truthy fake (jest gives each test file its own module registry).
jest.mock("../../src/services/openaiClient", () => ({
    openai: null,
    ASSISTANT_MODEL: "test-model",
    ASSISTANT_MAX_OUTPUT_TOKENS: 100,
}));

import { oneOff } from "../test-utils/app";
import { makeUser, makeLoggedInClient } from "../test-utils/factories";

const CHAT = "/api/v1/assistant/chat";

describe("AI Help Assistant — disabled (no OPENAI_API_KEY)", () => {
    it("503 assistant.not_configured for an authenticated chat", async () => {
        const client = await makeLoggedInClient(await makeUser());
        const res = await client.post(CHAT).send({ message: "hi" });
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("assistant.not_configured");
    });

    it("401 (authenticate still runs first) for an unauthenticated chat", async () => {
        const req = await oneOff();
        const res = await req.post(CHAT).send({ message: "hi" });
        expect(res.status).toBe(401);
    });

    it("503 for the conversations list too (whole feature is off)", async () => {
        const client = await makeLoggedInClient(await makeUser());
        const res = await client.get("/api/v1/assistant/conversations");
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("assistant.not_configured");
    });
});
