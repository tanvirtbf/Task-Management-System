// The OpenAI client is mocked so this suite never makes a real API call.
const mockCreate = jest.fn();
jest.mock("../../src/services/openaiClient", () => ({
    openai: {
        chat: {
            completions: {
                create: (...args: unknown[]) => mockCreate(...args),
            },
        },
    },
    ASSISTANT_MODEL: "gpt-4o-mini",
    ASSISTANT_MAX_OUTPUT_TOKENS: 800,
    createOpenAIClient: () => null,
}));

import { resetPolicy } from "../../src/rbac/policy";
import { UserRolesRepo } from "../../src/repositories/UserRolesRepo";
import { RolesRepo } from "../../src/repositories/RolesRepo";
import { getDb } from "../../src/db/client";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import type { LoggedInClient } from "../test-utils/app";

/**
 * P6 — `assistant.use` is a real permission now.
 *
 * The key was in the catalog and granted to all four seeded roles, but no route
 * checked it: an admin who unticked "Use the AI help assistant" got nothing.
 * That breaks the catalog's own rule that every key maps to a real enforcement
 * point — a checkbox that does nothing is a lie to whoever ticks it.
 *
 * Nothing changes for anyone today, which is the point: these tests prove the
 * seeded roles are unaffected AND that the switch now actually works.
 */

const CHAT = "/api/v1/assistant/chat";
const CONVERSATIONS = "/api/v1/assistant/conversations";

beforeAll(() => resetPolicy());

beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation(() =>
        Promise.resolve({
            choices: [{ message: { content: "উত্তর" } }],
        }),
    );
});

/** A user holding every seeded permission EXCEPT `assistant.use`. */
const userWithoutAssistant = async (): Promise<{
    client: LoggedInClient;
}> => {
    const db = getDb();
    const roles = new RolesRepo(db);
    const grants = new UserRolesRepo(db);
    const user = await makeUser({ role: "member" });

    // Drop the seeded assignment, then give them a bespoke role that grants a
    // few ordinary things but NOT the assistant.
    await grants.revokeAllForUser(user.id, user.workspaceId);
    const roleId = await roles.create(user.workspaceId, {
        roleKey: "no-assistant",
        name: "No assistant",
        rankOrder: 60,
    });
    await roles.replacePermissions(roleId, [
        { permissionKey: "space.view", scope: "all" },
        { permissionKey: "task.view", scope: "all" },
        { permissionKey: "task.edit", scope: "all" },
    ]);
    await grants.assign({
        workspaceId: user.workspaceId,
        userId: user.id,
        roleId,
        scopeType: "workspace",
        scopeId: null,
    });
    return { client: await makeLoggedInClient(user) };
};

describe("assistant.use — the seeded roles are unaffected", () => {
    it.each(["owner", "admin", "member", "guest"] as const)(
        "a %s can still chat",
        async (role) => {
            const user = await makeUser({ role });
            const client = await makeLoggedInClient(user);

            const res = await client.post(CHAT).send({ message: "hi" });

            expect(res.status).toBe(200);
        },
    );

    it("a member can still list their conversations", async () => {
        const user = await makeUser({ role: "member" });
        const client = await makeLoggedInClient(user);

        expect((await client.get(CONVERSATIONS)).status).toBe(200);
    });
});

describe("assistant.use — the switch actually works now", () => {
    it("403s a user whose role does not grant it", async () => {
        const { client } = await userWithoutAssistant();

        const res = await client.post(CHAT).send({ message: "hi" });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("auth.forbidden");
        // The taxonomy detail says WHICH permission was missing, so a support
        // question ("why can't I use the bot?") has a one-word answer.
        expect(res.body.error.details).toEqual(
            expect.arrayContaining([
                { field: "permission", issue: "assistant.use" },
            ]),
        );
    });

    it("403s the conversation endpoints too, not just chat", async () => {
        const { client } = await userWithoutAssistant();

        expect((await client.get(CONVERSATIONS)).status).toBe(403);
        expect((await client.get(`${CONVERSATIONS}/conv-x`)).status).toBe(403);
    });

    it("never reaches OpenAI when the permission is missing", async () => {
        const { client } = await userWithoutAssistant();

        await client.post(CHAT).send({ message: "hi" });

        // The gate runs before the controller, so no upstream call and no
        // token spend on a request that was always going to be refused.
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("401 still beats 403 — an anonymous caller learns nothing about permissions", async () => {
        const res = await (await oneOff())
            .post(CHAT)
            .send({ message: "hi" });

        expect(res.status).toBe(401);
        // No permission key leaks to someone who has not even signed in.
        expect(JSON.stringify(res.body)).not.toContain("assistant.use");
    });
});
