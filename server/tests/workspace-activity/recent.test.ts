import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace, makeLoggedInClient } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";
import {
    BASE,
    seed,
    insertActivity,
    signAccess,
    idsOf,
    USER_KEYS,
} from "./_helpers";

/**
 * Tests for `GET /api/v1/activity/recent` (§26 #1) — the last N workspace events
 * for the home card, newest-first (internal_id DESC), actor hydrated, bare
 * `{ data }` (no pagination). Workspace-scoped via the JWT claim.
 */

const PATH = `${BASE}/recent`;

const ACTIVITY_KEYS = [
    "action",
    "actor",
    "context",
    "created_at",
    "entity_id",
    "entity_type",
    "id",
].sort();

describe("GET /api/v1/activity/recent", () => {
    describe("Happy path", () => {
        it("returns a bare { data } slice, newest-first (200)", async () => {
            const { ws, client } = await seed();
            const a = await insertActivity({ workspaceId: ws.id });
            const b = await insertActivity({ workspaceId: ws.id });
            const c = await insertActivity({ workspaceId: ws.id });

            const res = await client.get(PATH);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toBeUndefined();
            expect(idsOf(res.body)).toEqual([c, b, a]);
        });

        it("each row carries exactly the 7 wire keys (no internal_id/workspace_id/actor_id leak)", async () => {
            const { ws, user, client } = await seed();
            await insertActivity({ workspaceId: ws.id, actorId: user.id });

            const row = (await client.get(PATH)).body.data[0];
            expect(Object.keys(row).sort()).toEqual(ACTIVITY_KEYS);
            const raw = JSON.stringify(row);
            expect(raw).not.toContain("internal_id");
            expect(raw).not.toContain("workspace_id");
            expect(raw).not.toContain("actor_id");
        });

        it("echoes entity_type/entity_id/action/context with an ISO created_at", async () => {
            const { ws, client } = await seed();
            await insertActivity({
                workspaceId: ws.id,
                entityType: "list",
                entityId: "l-fb-orders",
                action: "archived",
                context: { name: "FB Orders" },
            });

            const row = (await client.get(PATH)).body.data[0];
            expect(row.entity_type).toBe("list");
            expect(row.entity_id).toBe("l-fb-orders");
            expect(row.action).toBe("archived");
            expect(row.context).toEqual({ name: "FB Orders" });
            expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });

        it("returns an empty slice (not 404) for a workspace with no activity", async () => {
            const { client } = await seed();
            const res = await client.get(PATH);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });
    });

    describe("Actor hydration", () => {
        it("hydrates the actor to the full wire User", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({
                workspaceId: ws.id,
                firstName: "Rina",
                email: "rina@bb.test",
            });
            const client = await makeLoggedInClient(actor);
            await insertActivity({ workspaceId: ws.id, actorId: actor.id });

            const row = (await client.get(PATH)).body.data[0];
            expect(Object.keys(row.actor).sort()).toEqual(USER_KEYS);
            expect(row.actor.id).toBe(actor.id);
            expect(row.actor.first_name).toBe("Rina");
            expect(row.actor.email).toBe("rina@bb.test");
        });

        it("returns actor: null for a system event (actor_id null)", async () => {
            const { ws, client } = await seed();
            await insertActivity({ workspaceId: ws.id, actorId: null });
            const row = (await client.get(PATH)).body.data[0];
            expect(row.actor).toBeNull();
        });

        it("never hydrates an actor from another workspace (→ null, no leak)", async () => {
            const { ws, client } = await seed();
            const wsB = await makeWorkspace();
            const foreign = await makeUser({
                workspaceId: wsB.id,
                email: "foreign@other.test",
            });
            // A stray row in MY workspace whose actor belongs to another one.
            await insertActivity({ workspaceId: ws.id, actorId: foreign.id });

            const res = await client.get(PATH);
            expect(res.body.data[0].actor).toBeNull();
            expect(JSON.stringify(res.body)).not.toContain("foreign@other.test");
        });
    });

    describe("Limit", () => {
        it("honours ?limit (most recent N)", async () => {
            const { ws, client } = await seed();
            const ids: string[] = [];
            for (let i = 0; i < 5; i++)
                ids.push(await insertActivity({ workspaceId: ws.id }));

            const res = await client.get(`${PATH}?limit=2`);
            expect(idsOf(res.body)).toEqual([ids[4], ids[3]]);
        });

        it("clamps an over-max limit to 50", async () => {
            const { ws, client } = await seed();
            await getDb()
                .insert(workspaceActivity)
                .values(
                    Array.from({ length: 51 }, () => ({
                        id: fakeId("wsa"),
                        workspaceId: ws.id,
                        actorId: null,
                        entityType: "space" as const,
                        entityId: "sp-x",
                        action: "created",
                    })),
                );
            const res = await client.get(`${PATH}?limit=10000`);
            expect(res.body.data).toHaveLength(50);
        });

        it("422 for a non-positive / non-integer limit", async () => {
            const { client } = await seed();
            for (const bad of ["0", "-1", "abc"]) {
                const res = await client.get(`${PATH}?limit=${bad}`);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            }
        });
    });

    describe("Isolation", () => {
        it("returns only the caller's workspace events", async () => {
            const { ws, client } = await seed();
            const wsB = await makeWorkspace();
            const mine = await insertActivity({ workspaceId: ws.id });
            await insertActivity({
                workspaceId: wsB.id,
                action: "secret-other-ws",
            });

            const res = await client.get(PATH);
            expect(idsOf(res.body)).toEqual([mine]);
            expect(JSON.stringify(res.body)).not.toContain("secret-other-ws");
        });
    });

    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const http = await oneOff();
            const res = await http.get(PATH);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Side effects", () => {
        it("a read inserts no rows", async () => {
            const { ws, client } = await seed();
            await insertActivity({ workspaceId: ws.id });
            const count = async () =>
                (await getDb().select().from(workspaceActivity)).length;
            const before = await count();
            await client.get(PATH);
            expect(await count()).toBe(before);
        });
    });
});
