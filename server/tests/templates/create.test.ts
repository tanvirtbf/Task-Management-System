import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTag,
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
    setup,
    signAccess,
    validStructure,
    type WireTemplate,
} from "./helpers";

/**
 * Tests for `POST /api/v1/templates` (§23 #3).
 *
 * 👑 owner/admin. Validates the structure (≥1 checklist item, a valid
 * `taskTypeId`, existing `tags[]`) and a workspace-unique name, then returns
 * 201 with the bare created `Template`.
 */

const rowsIn = async (workspaceId: string) =>
    getDb()
        .select()
        .from(templates)
        .where(eq(templates.workspaceId, workspaceId));

describe("POST /api/v1/templates", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a template from a minimal valid body (201)", async () => {
            const { ws, actor, client } = await setup();

            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Eid Campaign",
                structure: validStructure(),
            });

            expect(res.status).toBe(201);
            const body = res.body as WireTemplate;
            expect(body.id).toMatch(/^tpl-/);
            expect(body.workspace_id).toBe(ws.id);
            expect(body.type).toBe("task");
            expect(body.name).toBe("Eid Campaign");
            expect(body.description).toBeNull();
            expect(body.icon).toBeNull();
            expect(body.color).toBeNull();
            expect(body.usage_count).toBe(0);
            expect(body.created_by).toBe(actor.id);
            expect(body.structure.checklistItems).toHaveLength(2);

            const rows = await rowsIn(ws.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(body.id);
        });

        it("stores the full optional payload, including a seeded taskTypeId and tags", async () => {
            const { ws, client } = await setup("owner");
            const tt = await makeTaskType({ workspaceId: ws.id });
            const tag = await makeTag({ workspaceId: ws.id });

            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Product Launch",
                description: "7-step pipeline",
                icon: "Package",
                color: "#8B5CF6",
                structure: validStructure({
                    taskTypeId: tt.id,
                    priority: 3,
                    tags: [tag.id],
                    checklistName: "Launch checklist",
                }),
            });

            expect(res.status).toBe(201);
            const body = res.body as WireTemplate;
            expect(body.description).toBe("7-step pipeline");
            expect(body.icon).toBe("Package");
            expect(body.color).toBe("#8B5CF6");
            expect(body.structure.taskTypeId).toBe(tt.id);
            expect(body.structure.priority).toBe(3);
            expect(body.structure.tags).toEqual([tag.id]);
            expect(body.structure.checklistName).toBe("Launch checklist");
        });
    });

    // ─── b. Validation (422 validation.failed) ────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["name missing", { type: "task", structure: validStructure() }],
            ["name empty", { type: "task", name: "", structure: validStructure() }],
            ["name too long (121)", { type: "task", name: "x".repeat(121), structure: validStructure() }],
            ["name not a string", { type: "task", name: 5, structure: validStructure() }],
            ["type missing", { name: "N", structure: validStructure() }],
            ["type invalid", { type: "epic", name: "N", structure: validStructure() }],
            ["color not hex", { type: "task", name: "N", color: "blurple", structure: validStructure() }],
            ["icon too long (61)", { type: "task", name: "N", icon: "x".repeat(61), structure: validStructure() }],
            ["structure missing", { type: "task", name: "N" }],
            ["structure not an object", { type: "task", name: "N", structure: "nope" }],
            ["structure is an array", { type: "task", name: "N", structure: [] }],
            ["checklist item text empty", { type: "task", name: "N", structure: { checklistItems: [{ text: "" }] } }],
            ["checklist item text missing", { type: "task", name: "N", structure: { checklistItems: [{ dueOffsetDays: 1 }] } }],
            ["priority out of range", { type: "task", name: "N", structure: { ...validStructure(), priority: 9 } }],
            ["tags not an array", { type: "task", name: "N", structure: { ...validStructure(), tags: "tag-1" } }],
            ["dueOffsetDays negative", { type: "task", name: "N", structure: { checklistItems: [{ text: "a", dueOffsetDays: -1 }] } }],
        ];
        for (const [label, payload] of cases) {
            it(`422 when ${label}`, async () => {
                const { client } = await setup();
                const res = await client.post(TEMPLATES).send(payload);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("writes nothing on a validation failure", async () => {
            const { ws, client } = await setup();
            await client.post(TEMPLATES).send({ type: "task", name: "" });
            expect(await rowsIn(ws.id)).toHaveLength(0);
        });
    });

    // ─── Business-rule 422s (dedicated template.* codes) ──────────────────────
    describe("Structure business rules", () => {
        it("422 template.empty_structure when checklistItems is an empty array", async () => {
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Empty",
                structure: { checklistName: "x", checklistItems: [] },
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.empty_structure");
        });

        it("422 template.empty_structure when checklistItems is absent", async () => {
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "NoItems",
                structure: { checklistName: "x" },
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.empty_structure");
        });

        it("422 template.invalid_task_type when structure.taskTypeId is not in the workspace", async () => {
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "BadType",
                structure: validStructure({ taskTypeId: "tt-not-here" }),
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_task_type");
        });

        it("422 template.invalid_task_type for a task type from another workspace", async () => {
            const other = await makeWorkspace();
            const foreignType = await makeTaskType({ workspaceId: other.id });
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "CrossType",
                structure: validStructure({ taskTypeId: foreignType.id }),
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_task_type");
        });

        it("422 template.invalid_tag when a tag id is not in the workspace", async () => {
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "BadTag",
                structure: validStructure({ tags: ["tag-nope"] }),
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("template.invalid_tag");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http
                .post(TEMPLATES)
                .send({ type: "task", name: "X", structure: validStructure() });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser({ role: "admin" });
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .post(TEMPLATES)
                .set("Authorization", `Bearer ${token}`)
                .send({ type: "task", name: "X", structure: validStructure() });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to create (201)`, async () => {
                const { client } = await setup(role);
                const res = await client.post(TEMPLATES).send({
                    type: "task",
                    name: `By-${role}`,
                    structure: validStructure(),
                });
                expect(res.status).toBe(201);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 auth.forbidden and writes nothing`, async () => {
                const { ws, client } = await setup(role);
                const res = await client.post(TEMPLATES).send({
                    type: "task",
                    name: "Nope",
                    structure: validStructure(),
                });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await rowsIn(ws.id)).toHaveLength(0);
            });
        }

        it("rejects a member BEFORE validating the body (403, not 422)", async () => {
            const { client } = await setup("member");
            const res = await client.post(TEMPLATES).send({ name: "" });
            expect(res.status).toBe(403);
        });
    });

    // ─── e. Conflict (duplicate name) ─────────────────────────────────────────
    describe("Conflict", () => {
        it("409 template.duplicate when the name already exists", async () => {
            const { ws, client } = await setup();
            await client.post(TEMPLATES).send({
                type: "task",
                name: "Eid",
                structure: validStructure(),
            });

            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Eid",
                structure: validStructure(),
            });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("template.duplicate");
            expect(await rowsIn(ws.id)).toHaveLength(1);
        });

        it("409 on a case-insensitive duplicate (utf8mb4_unicode_ci)", async () => {
            const { client } = await setup();
            await client.post(TEMPLATES).send({
                type: "task",
                name: "Eid",
                structure: validStructure(),
            });
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "eid",
                structure: validStructure(),
            });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("template.duplicate");
        });
    });

    // ─── g. Workspace isolation + mass-assignment ─────────────────────────────
    describe("Workspace isolation & mass-assignment", () => {
        it("a name taken in another workspace does not collide", async () => {
            const other = await makeWorkspace();
            const otherUser = await makeUser({ workspaceId: other.id });
            const db = getDb();
            await db.insert(templates).values({
                id: "tpl-foreign",
                workspaceId: other.id,
                type: "task",
                name: "Shared",
                structure: validStructure(),
                createdBy: otherUser.id,
            });
            const { ws, client } = await setup();

            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Shared",
                structure: validStructure(),
            });

            expect(res.status).toBe(201);
            expect(await rowsIn(ws.id)).toHaveLength(1);
        });

        it("creates in the caller's workspace, ignoring body workspace_id/usage_count/created_by/id", async () => {
            const other = await makeWorkspace();
            const { ws, actor, client } = await setup();

            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "Scoped",
                structure: validStructure(),
                workspace_id: other.id,
                usage_count: 99,
                created_by: "u-hacker",
                id: "tpl-hacker",
            });

            expect(res.status).toBe(201);
            const body = res.body as WireTemplate;
            expect(body.id).not.toBe("tpl-hacker");
            expect(body.workspace_id).toBe(ws.id);
            expect(body.usage_count).toBe(0);
            expect(body.created_by).toBe(actor.id);
            expect(await rowsIn(other.id)).toHaveLength(0);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("N parallel identical creates → exactly one 201, the rest 409, one row", async () => {
            const { ws, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 6 }, () =>
                    client.post(TEMPLATES).send({
                        type: "task",
                        name: "Race",
                        structure: validStructure(),
                    }),
                ),
            );

            expect(results.filter((r) => r.status === 201)).toHaveLength(1);
            expect(results.filter((r) => r.status === 409)).toHaveLength(5);
            expect(await rowsIn(ws.id)).toHaveLength(1);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a max-length (120-char) name", async () => {
            const { client } = await setup();
            const name = "x".repeat(120);
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name,
                structure: validStructure(),
            });
            expect(res.status).toBe(201);
            expect((res.body as WireTemplate).name).toBe(name);
        });

        it("round-trips a unicode name (Bangla + emoji)", async () => {
            const { client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "ঈদ ক্যাম্পেইন 🎉",
                structure: validStructure(),
            });
            expect(res.status).toBe(201);
            expect((res.body as WireTemplate).name).toBe("ঈদ ক্যাম্পেইন 🎉");
        });

        it("trims surrounding whitespace from the stored name", async () => {
            const { ws, client } = await setup();
            const res = await client.post(TEMPLATES).send({
                type: "task",
                name: "  Spacey  ",
                structure: validStructure(),
            });
            expect(res.status).toBe(201);
            const [row] = await rowsIn(ws.id);
            expect(row.name).toBe("Spacey");
        });
    });
});
