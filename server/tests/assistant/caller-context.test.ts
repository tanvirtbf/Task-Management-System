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

import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { CALLER_BLOCK_MAX } from "../../src/assistant/callerContext";
import type { LoggedInClient } from "../test-utils/app";
import {
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "../rbac/helpers";

/**
 * THE CALLER BLOCK (AI_ASSISTANT_DEEP_PLAN.md P2).
 *
 * The bot now receives one sentence describing WHO is asking. These tests read
 * the SYSTEM MESSAGE the model was actually handed — the boundary — rather than
 * the reply, for the same reason the scoping suite does: asserting on the answer
 * would test the model's discretion, asserting on the message tests our code.
 *
 * What must hold, and why each one matters:
 *  · it describes the CALLER of this request (a stale or shared block would
 *    hand one person another person's access as advice);
 *  · reach words come from the caller's real grants, so "own only" vs
 *    "everywhere" cannot drift from what the service will actually allow;
 *  · it carries NO email and NO ids — this is a description, not a directory;
 *  · it stays inside its size ceiling, because it ships on every request.
 */

const CHAT = "/api/v1/assistant/chat";

const db = () => getDb();

beforeAll(() => {
    resetPolicy();
});

/** Capture the system message of the next chat call; the model just says "ok". */
const captureSystem = (): { value: string } => {
    const box = { value: "" };
    mockCreate.mockReset();
    mockCreate.mockImplementation(
        (params: { messages?: { role: string; content?: string }[] }) => {
            const sys = (params.messages ?? []).find((m) => m.role === "system");
            box.value = String(sys?.content ?? "");
            return Promise.resolve(
                (async function* () {
                    yield { choices: [{ delta: { content: "ok" } }] };
                })(),
            );
        },
    );
    return box;
};

/** Ask something trivial and return ONLY the caller line from the prompt. */
const callerLineFor = async (client: LoggedInClient): Promise<string> => {
    const box = captureSystem();
    const res = await client
        .post(CHAT)
        .set("Accept", "text/event-stream")
        .send({ message: "hi" });
    expect(res.status).toBe(200);
    const line = box.value
        .split("\n")
        .find((l) => l.startsWith("You are talking to"));
    return line ?? "";
};

const nameOf = async (userId: string): Promise<string> => {
    const [u] = await db()
        .select({ first: schema.users.firstName, last: schema.users.lastName })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
    return `${u.first} ${u.last}`.trim();
};

describe("caller context — the bot knows who is asking", () => {
    it("names the member, their team, and their REAL reach", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const member = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                ["task.create", "space"],
                ["task.edit", "own"],
                "member.view",
                "assistant.use",
            ],
            { spaceId: marketing },
        );

        const line = await callerLineFor(member.client);

        expect(line).toContain(await nameOf(member.id));
        expect(line).toContain("Member");
        expect(line).toContain("teams: Marketing");
        // reach words must mirror the grants above, not a guess
        expect(line).toContain("see tasks (their teams)");
        expect(line).toContain("create tasks (their teams)");
        expect(line).toContain("edit tasks (own only)");
        expect(line).toContain("see the member list");
        // and the things they cannot do are named, so the bot can redirect them
        expect(line).toMatch(/They CANNOT:.*read weekly reports/);
        // ...but the list is capped, so the block cannot grow without bound:
        // the four most day-to-day gaps are shown and the rest are dropped.
        const cannot = /They CANNOT: ([^.]+)\./.exec(line)?.[1] ?? "";
        expect(cannot.split(", ")).toHaveLength(4);
        expect(line).not.toContain("edit roles and permissions");
    });

    it("states which permanent-delete button THIS person has (the answer, not the rule)", async () => {
        // upgrades/023. Four rounds of live probing proved the model cannot be
        // told to branch on a permission: it refused a Member outright, then
        // sent an ADMIN to go ask another admin, then hedged both ways in one
        // reply. Computing the verdict here made it right first try, and these
        // two assertions are what stops anyone "simplifying" it back.
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const member = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                ["task.delete", "own"],
                "assistant.use",
            ],
            { spaceId: marketing },
        );

        const theirs = await callerLineFor(member.client);
        expect(theirs).toContain("Request permanent delete");
        expect(theirs).toContain("Never tell them they cannot");

        const ownerLine = await callerLineFor(owner.client);
        expect(ownerLine).toContain("THEY can do it themselves");
        expect(ownerLine).not.toContain("Request permanent delete");
    });

    it("an owner is described as reaching everywhere (the anti-lockout floor shows up here too)", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");

        const line = await callerLineFor(owner.client);

        expect(line).toContain("Owner");
        expect(line).toContain("see tasks (everywhere)");
        expect(line).toContain("edit tasks (everywhere)");
        // holding everything means there is nothing to warn them about
        expect(line).not.toContain("They CANNOT:");
    });

    it("marks a department Head, because a Head can do things a member cannot", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const cs = await makeRbacSpace(ws.id, owner.id, "Customer Service");
        const head = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: cs },
        );
        await db()
            .update(schema.spaces)
            .set({ headUserId: head.id })
            .where(eq(schema.spaces.id, cs));

        const line = await callerLineFor(head.client);

        expect(line).toContain("Customer Service (Head)");
    });

    it("says 'none yet' for someone on no team — the answer to 'why do I see nothing?'", async () => {
        const ws = await rbacWorkspace();
        const nomad = await userWithPermissions(ws, [
            ["task.view", "own"],
            "assistant.use",
        ]);

        const line = await callerLineFor(nomad.client);

        expect(line).toContain("teams: none yet");
        expect(line).toContain("see tasks (own only)");
    });

    it("leaks no email and no internal id — a description, not a directory", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const member = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                "assistant.use",
            ],
            { spaceId: marketing },
        );

        const line = await callerLineFor(member.client);

        expect(line).not.toContain("@");
        expect(line).not.toContain(member.id);
        expect(line).not.toContain(ws.id);
        expect(line).not.toContain(marketing);
    });

    it("stays inside the size ceiling it promises", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        // A rich actor: many teams AND a long name pressure the ceiling.
        const spaces: string[] = [];
        for (const n of ["Marketing", "Customer Service", "Orders", "Product", "Engineering"]) {
            spaces.push(await makeRbacSpace(ws.id, owner.id, n));
        }
        const busy = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
                ["task.create", "space"],
                ["task.edit", "space"],
                ["task.assign", "space"],
                "member.view",
                "review.read",
                "report.view",
                "assistant.use",
            ],
            { spaceId: spaces[0] },
        );

        const line = await callerLineFor(busy.client);

        expect(line.length).toBeLessThanOrEqual(CALLER_BLOCK_MAX);
    });

    it("describes THIS caller on every request — two people in sequence do not blur", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const marketing = await makeRbacSpace(ws.id, owner.id, "Marketing");
        const support = await makeRbacSpace(ws.id, owner.id, "Support");
        const a = await userWithPermissions(
            ws,
            [["space.view", "space"], ["task.view", "space"], "assistant.use"],
            { spaceId: marketing },
        );
        const b = await userWithPermissions(
            ws,
            [["space.view", "space"], ["task.view", "space"], "assistant.use"],
            { spaceId: support },
        );

        const lineA = await callerLineFor(a.client);
        const lineB = await callerLineFor(b.client);

        expect(lineA).toContain("teams: Marketing");
        expect(lineA).toContain(await nameOf(a.id));
        // If the block were cached or shared, B would inherit A's team here.
        expect(lineB).toContain("teams: Support");
        expect(lineB).toContain(await nameOf(b.id));
        expect(lineB).not.toContain("Marketing");
    });
});
