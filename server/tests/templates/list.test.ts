import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { templates } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import {
    TEMPLATES,
    dataOf,
    namesOf,
    seedTemplate,
    setup,
    signAccess,
    validStructure,
} from "./helpers";

/**
 * Tests for `GET /api/v1/templates` (§23 #1).
 *
 * A bounded, workspace-wide collection returned as a single complete page
 * (`next_cursor: null`, `has_more: false`), newest-first with an `id`
 * tie-break. Optional `?type=` (exact enum) and `?q=` (case-insensitive name
 * LIKE, wildcards escaped) filters. Any authenticated role may read.
 */

const countInWorkspace = async (workspaceId: string): Promise<number> =>
    (
        await getDb()
            .select({ id: templates.id })
            .from(templates)
            .where(eq(templates.workspaceId, workspaceId))
    ).length;

describe("GET /api/v1/templates", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({ workspaceId: ws.id, createdBy: actor.id });

            const res = await client.get(TEMPLATES);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("shapes each row with snake_case top-level keys and a verbatim camelCase structure", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Eid Campaign",
                type: "task",
                description: "Festival playbook",
                icon: "Sparkles",
                color: "#10B981",
                structure: validStructure({
                    taskTypeId: "tt-x",
                    priority: 2,
                    tags: ["tag-eid"],
                }),
                usageCount: 8,
            });

            const [t] = dataOf((await client.get(TEMPLATES)).body);

            expect(Object.keys(t).sort()).toEqual([
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
            expect(t.id).toMatch(/^tpl-/);
            expect(t.workspace_id).toBe(ws.id);
            expect(t.type).toBe("task");
            expect(t.name).toBe("Eid Campaign");
            expect(t.description).toBe("Festival playbook");
            expect(t.icon).toBe("Sparkles");
            expect(t.color).toBe("#10B981");
            expect(t.usage_count).toBe(8);
            expect(t.created_by).toBe(actor.id);
            // structure passes through with camelCase keys untouched
            expect(t.structure.taskTypeId).toBe("tt-x");
            expect(t.structure.priority).toBe(2);
            expect(t.structure.tags).toEqual(["tag-eid"]);
            expect(t.structure.checklistItems?.[1]).toEqual({
                text: "Second step",
                dueOffsetDays: 2,
            });
        });

        it("serializes created_at/updated_at as ISO-8601 UTC strings", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({ workspaceId: ws.id, createdBy: actor.id });

            const [t] = dataOf((await client.get(TEMPLATES)).body);

            expect(t.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
            );
            expect(t.updated_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
            );
        });

        it("returns an empty list (not 404) for a workspace with no templates", async () => {
            const { client } = await setup();

            const res = await client.get(TEMPLATES);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
        });
    });

    // ─── Ordering (created_at desc, id asc tie-break) ─────────────────────────
    describe("Ordering", () => {
        it("returns newest first by created_at", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Oldest",
                createdAt: new Date("2026-01-01T00:00:00Z"),
            });
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Newest",
                createdAt: new Date("2026-05-01T00:00:00Z"),
            });
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Middle",
                createdAt: new Date("2026-03-01T00:00:00Z"),
            });

            expect(namesOf((await client.get(TEMPLATES)).body)).toEqual([
                "Newest",
                "Middle",
                "Oldest",
            ]);
        });
    });

    // ─── Filters (?type=, ?q=) ────────────────────────────────────────────────
    describe("Filters", () => {
        it("?type= returns only templates of that type", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "A task tpl",
                type: "task",
            });
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "A list tpl",
                type: "list",
            });

            const res = await client.get(`${TEMPLATES}?type=task`);

            expect(namesOf(res.body)).toEqual(["A task tpl"]);
        });

        it("?q= filters by name, case-insensitively", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Eid Campaign",
            });
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Product Launch",
            });

            const res = await client.get(`${TEMPLATES}?q=campaign`);

            expect(namesOf(res.body)).toEqual(["Eid Campaign"]);
        });

        it("?q= treats % as a literal (wildcards escaped)", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "100% Bonus",
            });
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "100 Items",
            });

            const res = await client.get(`${TEMPLATES}?q=${encodeURIComponent("100%")}`);

            expect(namesOf(res.body)).toEqual(["100% Bonus"]);
        });

        it("422 for an invalid ?type= value", async () => {
            const { client } = await setup();

            const res = await client.get(`${TEMPLATES}?type=bogus`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.get(TEMPLATES);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .get(TEMPLATES)
                .set("Authorization", "Bearer not.a.jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(TEMPLATES)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any role) ───────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to list (200)`, async () => {
                const { ws, actor, client } = await setup(role);
                await seedTemplate({
                    workspaceId: ws.id,
                    createdBy: actor.id,
                    name: "Shared",
                });
                const res = await client.get(TEMPLATES);
                expect(res.status).toBe(200);
                expect(namesOf(res.body)).toEqual(["Shared"]);
            });
        }
    });

    // ─── g. Workspace isolation ───────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns only the caller's workspace templates", async () => {
            const { ws: wsA, actor: actorA, client } = await setup();
            const wsB = await makeWorkspace();
            const actorB = await makeUser({ workspaceId: wsB.id });
            await seedTemplate({
                workspaceId: wsA.id,
                createdBy: actorA.id,
                name: "A-one",
            });
            await seedTemplate({
                workspaceId: wsB.id,
                createdBy: actorB.id,
                name: "B-one",
            });

            expect(namesOf((await client.get(TEMPLATES)).body)).toEqual([
                "A-one",
            ]);
        });

        it("ignores a ?workspace_id query param", async () => {
            const { ws: wsA, actor: actorA, client } = await setup();
            const wsB = await makeWorkspace();
            const actorB = await makeUser({ workspaceId: wsB.id });
            await seedTemplate({
                workspaceId: wsA.id,
                createdBy: actorA.id,
                name: "A-one",
            });
            await seedTemplate({
                workspaceId: wsB.id,
                createdBy: actorB.id,
                name: "B-one",
            });

            const res = await client.get(
                `${TEMPLATES}?workspace_id=${wsB.id}`,
            );

            expect(namesOf(res.body)).toEqual(["A-one"]);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode name (Bangla + emoji)", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "ঈদ ক্যাম্পেইন 🎉",
            });

            expect(namesOf((await client.get(TEMPLATES)).body)).toContain(
                "ঈদ ক্যাম্পেইন 🎉",
            );
        });
    });

    // ─── l. Side effects (a read must mutate nothing) ─────────────────────────
    describe("Side effects", () => {
        it("does not change the templates row count", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({ workspaceId: ws.id, createdBy: actor.id });

            const before = await countInWorkspace(ws.id);
            await client.get(TEMPLATES);
            expect(await countInWorkspace(ws.id)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();
            const res = await client.get(TEMPLATES);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope with matching request_id on 401", async () => {
            const http = await oneOff();
            const res = await http.get(TEMPLATES);
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });
    });
});
