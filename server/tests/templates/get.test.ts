import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import {
    TEMPLATES,
    seedTemplate,
    setup,
    signAccess,
    validStructure,
    type WireTemplate,
} from "./helpers";

/**
 * Tests for `GET /api/v1/templates/:id` (§23 #2).
 *
 * Returns a single `Template` as a BARE object (not wrapped in `{ data }`),
 * any authenticated role. A missing or cross-workspace id is 404
 * `template.not_found` (no existence oracle).
 */

describe("GET /api/v1/templates/:id", () => {
    describe("Happy path", () => {
        it("returns 200 with the bare Template object", async () => {
            const { ws, actor, client } = await setup();
            const seeded = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Eid Campaign",
                icon: "Sparkles",
                color: "#10B981",
                structure: validStructure({ priority: 2, tags: [] }),
                usageCount: 5,
            });

            const res = await client.get(`${TEMPLATES}/${seeded.id}`);

            expect(res.status).toBe(200);
            const body = res.body as WireTemplate;
            // Bare object — not a list envelope.
            expect(body).not.toHaveProperty("data");
            expect(body.id).toBe(seeded.id);
            expect(body.workspace_id).toBe(ws.id);
            expect(body.name).toBe("Eid Campaign");
            expect(body.usage_count).toBe(5);
            expect(body.created_by).toBe(actor.id);
            expect(body.structure.priority).toBe(2);
            expect(body.structure.checklistItems).toHaveLength(2);
        });

        it("exposes exactly the wire fields", async () => {
            const { ws, actor, client } = await setup();
            const seeded = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });

            const res = await client.get(`${TEMPLATES}/${seeded.id}`);

            expect(Object.keys(res.body).sort()).toEqual([
                "color",
                "created_at",
                "created_by",
                "description",
                "icon",
                "id",
                "name",
                "structure",
                "type",
                "updated_at",
                "usage_count",
                "workspace_id",
            ]);
        });
    });

    describe("Not found", () => {
        it("404 template.not_found for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.get(`${TEMPLATES}/tpl-does-not-exist`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });
    });

    describe("Workspace isolation", () => {
        it("404 for a template that belongs to another workspace", async () => {
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const foreign = await seedTemplate({
                workspaceId: other.id,
                createdBy: otherUser.id,
            });
            const { client } = await setup(); // a different workspace's admin

            const res = await client.get(`${TEMPLATES}/${foreign.id}`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });
    });

    describe("Authentication", () => {
        it("401 auth.missing_token without a token", async () => {
            const { ws, actor } = await setup();
            const seeded = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const http = await oneOff();
            const res = await http.get(`${TEMPLATES}/${seeded.id}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(`${TEMPLATES}/tpl-x`)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (any role may read)", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} (200)`, async () => {
                const ws = await makeWorkspace();
                const actor = await makeUser({ workspaceId: ws.id, role });
                const seeded = await seedTemplate({
                    workspaceId: ws.id,
                    createdBy: actor.id,
                });
                const client = await makeLoggedInClient(actor);

                const res = await client.get(`${TEMPLATES}/${seeded.id}`);

                expect(res.status).toBe(200);
            });
        }
    });

    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { ws, actor, client } = await setup();
            const seeded = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client.get(`${TEMPLATES}/${seeded.id}`);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
