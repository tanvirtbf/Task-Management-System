import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { templates } from "../../src/db/schema";
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
 * Tests for `PATCH /api/v1/templates/:id` (§23 #4).
 *
 * 👑 owner/admin partial update. `type` is immutable and `usage_count` is
 * read-only (both ignored if sent). `structure`, when supplied, is a full
 * replacement and is re-validated. Returns 200 with the bare updated Template.
 */

const rowOf = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(templates)
        .where(eq(templates.id, id));
    return row;
};

describe("PATCH /api/v1/templates/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("updates the name only, leaving other fields intact (200)", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Old",
                icon: "Sparkles",
            });

            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ name: "New" });

            expect(res.status).toBe(200);
            const body = res.body as WireTemplate;
            expect(body.name).toBe("New");
            expect(body.icon).toBe("Sparkles");
        });

        it("replaces the structure wholesale", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                structure: validStructure({ priority: 1 }),
            });

            const res = await client.patch(`${TEMPLATES}/${t.id}`).send({
                structure: {
                    checklistName: "Replaced",
                    checklistItems: [{ text: "Only step" }],
                },
            });

            expect(res.status).toBe(200);
            const body = res.body as WireTemplate;
            expect(body.structure.checklistName).toBe("Replaced");
            expect(body.structure.checklistItems).toHaveLength(1);
            expect(body.structure.priority).toBeUndefined();
        });

        it("clears description to null when null is sent", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                description: "had one",
            });

            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ description: null });

            expect(res.status).toBe(200);
            expect((res.body as WireTemplate).description).toBeNull();
        });
    });

    // ─── Immutability (type, usage_count) ─────────────────────────────────────
    describe("Immutability", () => {
        it("ignores a body `type` (type stays unchanged)", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                type: "task",
            });

            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ name: "Renamed", type: "list" });

            expect(res.status).toBe(200);
            expect((res.body as WireTemplate).type).toBe("task");
            expect((await rowOf(t.id)).type).toBe("task");
        });

        it("ignores a body `usage_count` (stays unchanged)", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                usageCount: 7,
            });

            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ name: "Renamed", usage_count: 999 });

            expect(res.status).toBe(200);
            expect((res.body as WireTemplate).usage_count).toBe(7);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 validation.failed on an empty patch", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client.patch(`${TEMPLATES}/${t.id}`).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 validation.failed for a bad color", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ color: "nothex" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 template.empty_structure when replacing with no items", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ structure: { checklistItems: [] } });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.empty_structure");
        });

        it("422 template.invalid_task_type when replacing with an unknown taskTypeId", async () => {
            const { ws, actor, client } = await setup();
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ structure: validStructure({ taskTypeId: "tt-nope" }) });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_task_type");
        });

        it("accepts a structure replacement with a valid seeded taskTypeId", async () => {
            const { ws, actor, client } = await setup();
            const tt = await makeTaskType({ workspaceId: ws.id });
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
            });
            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ structure: validStructure({ taskTypeId: tt.id }) });
            expect(res.status).toBe(200);
            expect((res.body as WireTemplate).structure.taskTypeId).toBe(tt.id);
        });
    });

    // ─── Not found ────────────────────────────────────────────────────────────
    describe("Not found", () => {
        it("404 template.not_found for an unknown id", async () => {
            const { client } = await setup();
            const res = await client
                .patch(`${TEMPLATES}/tpl-missing`)
                .send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });

        it("404 (not 422) when the id is missing even with an invalid body field", async () => {
            const { client } = await setup();
            const res = await client
                .patch(`${TEMPLATES}/tpl-missing`)
                .send({ structure: { checklistItems: [] } });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("template.not_found");
        });
    });

    // ─── Conflict ───────────────────────────────────────────────────────────--
    describe("Conflict", () => {
        it("409 template.duplicate when renaming to an existing name", async () => {
            const { ws, actor, client } = await setup();
            await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Taken",
            });
            const t = await seedTemplate({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "Mine",
            });

            const res = await client
                .patch(`${TEMPLATES}/${t.id}`)
                .send({ name: "Taken" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("template.duplicate");
        });
    });

    // ─── Authentication / Authorization ───────────────────────────────────────
    describe("Authentication & authorization", () => {
        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser({ role: "admin" });
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .patch(`${TEMPLATES}/tpl-x`)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "X" });
            expect(res.status).toBe(401);
        });

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 and writes nothing`, async () => {
                const ws = await makeWorkspace();
                const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
                const t = await seedTemplate({
                    workspaceId: ws.id,
                    createdBy: owner.id,
                    name: "Untouched",
                });
                const member = await makeUser({ workspaceId: ws.id, role });
                const client = await makeLoggedInClient(member);

                const res = await client
                    .patch(`${TEMPLATES}/${t.id}`)
                    .send({ name: "Hacked" });

                expect(res.status).toBe(403);
                expect((await rowOf(t.id)).name).toBe("Untouched");
            });
        }
    });

    // ─── Workspace isolation ──────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 when patching a template in another workspace", async () => {
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const foreign = await seedTemplate({
                workspaceId: other.id,
                createdBy: otherUser.id,
                name: "Foreign",
            });
            const { client } = await setup();

            const res = await client
                .patch(`${TEMPLATES}/${foreign.id}`)
                .send({ name: "Hijack" });

            expect(res.status).toBe(404);
            expect((await rowOf(foreign.id)).name).toBe("Foreign");
        });
    });
});
