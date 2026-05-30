import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSpace,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, statuses, workspaceActivity } from "../../src/db/schema";
import { DEFAULT_LIST_STATUSES } from "../../src/repositories/StatusesRepo";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/lists` (§6 Lists #4).
 *
 * Patterns mirror `tests/lists/list-by-space.test.ts` and
 * `tests/spaces/*`: real DB writes via factories (no mocks), `oneOff()` for
 * unauthenticated cases, authed calls via `makeLoggedInClient`, and the default
 * `setup-each.ts` truncate-before-each so tests are order-free.
 *
 * The endpoint is 👑 (owner/admin), creates a list in a space the caller's
 * workspace owns, seeds the 5 default statuses, and writes one
 * `workspace_activity` row — all atomically. It returns the bare wire `List`
 * (single-resource shape) with 201.
 */

const URL = "/api/v1/lists";

interface WireList {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    default_task_type_id: string | null;
    is_private: boolean;
    archived_at: string | null;
    created_by: string;
    created_at: string;
}

const WIRE_LIST_KEYS = [
    "archived_at",
    "color",
    "created_at",
    "created_by",
    "default_task_type_id",
    "description",
    "icon",
    "id",
    "is_private",
    "name",
    "position",
    "space_id",
].sort();

/** A user (default owner) + a space in their workspace + a logged-in client. */
const setup = async (
    opts: { role?: Role; status?: "active" | "invited" | "deactivated" } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner", status: opts.status });
    const space = await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
    const client = await makeLoggedInClient(u);
    return { u, space, client };
};

const listRows = async (spaceId: string) => {
    const db = getDb();
    return db.select().from(lists).where(eq(lists.spaceId, spaceId));
};

const statusRows = async (listId: string) => {
    const db = getDb();
    return db
        .select()
        .from(statuses)
        .where(and(eq(statuses.scopeType, "list"), eq(statuses.scopeId, listId)));
};

// Scoped to one workspace so the suite needs no global per-test truncate (it
// runs on the private no-truncate `tms_lists_test` DB): every test mints its own
// workspace, so cross-test rows never leak into these counts.
const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

/** Mint a raw access token for the negative-auth cases. */
const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/lists", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a list and returns 201 with the bare wire List", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "Orders" });

            expect(res.status).toBe(201);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.space_id).toBe(space.id);
            expect(res.body.name).toBe("Orders");
        });

        it("shapes the response as exactly the 12 wire fields — no extras", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "Orders" });

            expect(Object.keys(res.body as WireList).sort()).toEqual(WIRE_LIST_KEYS);
        });

        it("never leaks workspace_id, updated_at, internal_id, or folder_id", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "Orders" });

            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("workspaceId");
            expect(res.body).not.toHaveProperty("updated_at");
            expect(res.body).not.toHaveProperty("internal_id");
            expect(res.body).not.toHaveProperty("folder_id");
        });

        it("applies schema defaults for omitted optional fields", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "Orders" });

            expect(res.body.icon).toBe("ListChecks");
            expect(res.body.color).toBe("#4F46E5");
            expect(res.body.is_private).toBe(false);
            expect(res.body.description).toBeNull();
            expect(res.body.default_task_type_id).toBeNull();
            expect(res.body.archived_at).toBeNull();
        });

        it("sets created_by from the token, not the body, and id/created_at shapes", async () => {
            const { u, space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "Orders" });

            expect(res.body.created_by).toBe(u.id);
            expect(res.body.id).toMatch(/^l-/);
            expect(typeof res.body.created_at).toBe("string");
            expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        });

        it("echoes the provided description, icon, color, and is_private", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({
                space_id: space.id,
                name: "Bugs",
                description: "All the bugs",
                icon: "Bug",
                color: "#112233",
                is_private: true,
            });

            expect(res.body.description).toBe("All the bugs");
            expect(res.body.icon).toBe("Bug");
            expect(res.body.color).toBe("#112233");
            expect(res.body.is_private).toBe(true);
        });

        it("accepts a valid default_task_type_id in the workspace", async () => {
            const { u, space, client } = await setup();
            const tt = await makeTaskType({ workspaceId: u.workspaceId });

            const res = await client
                .post(URL)
                .send({ space_id: space.id, name: "Bugs", default_task_type_id: tt.id });

            expect(res.status).toBe(201);
            expect(res.body.default_task_type_id).toBe(tt.id);
        });

        it("persists the row so a follow-up GET returns it", async () => {
            const { space, client } = await setup();

            const created = (
                await client.post(URL).send({ space_id: space.id, name: "Orders" })
            ).body as WireList;
            const fetched = await client.get(`${URL}/${created.id}`);

            expect(fetched.status).toBe(200);
            expect(fetched.body.id).toBe(created.id);
            expect(fetched.body.name).toBe("Orders");
        });

        it("appends position: 0 for the first list, then 1, 2, …", async () => {
            const { space, client } = await setup();

            const a = await client.post(URL).send({ space_id: space.id, name: "a" });
            const b = await client.post(URL).send({ space_id: space.id, name: "b" });
            const c = await client.post(URL).send({ space_id: space.id, name: "c" });

            expect(a.body.position).toBe(0);
            expect(b.body.position).toBe(1);
            expect(c.body.position).toBe(2);
        });
    });

    // ─── Side effects: default statuses + activity ──────────────────────────
    describe("Side effects — seeded statuses & activity", () => {
        it("seeds exactly the 5 default statuses with correct names, groups, colors, order", async () => {
            const { space, client } = await setup();

            const created = (
                await client.post(URL).send({ space_id: space.id, name: "Orders" })
            ).body as WireList;
            const seeded = (await statusRows(created.id)).sort(
                (x, y) => x.position - y.position,
            );

            expect(seeded).toHaveLength(5);
            expect(seeded.map((s) => s.name)).toEqual(
                DEFAULT_LIST_STATUSES.map((d) => d.name),
            );
            expect(seeded.map((s) => s.statusGroup)).toEqual(
                DEFAULT_LIST_STATUSES.map((d) => d.statusGroup),
            );
            expect(seeded.map((s) => s.color)).toEqual(
                DEFAULT_LIST_STATUSES.map((d) => d.color),
            );
            expect(seeded.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
            for (const s of seeded) expect(s.scopeType).toBe("list");
        });

        it("exposes the seeded statuses through GET /lists/:listId/statuses", async () => {
            const { space, client } = await setup();

            const created = (
                await client.post(URL).send({ space_id: space.id, name: "Orders" })
            ).body as WireList;
            const res = await client.get(`${URL}/${created.id}/statuses`);

            expect(res.status).toBe(200);
            expect(res.body.map((s: { name: string }) => s.name)).toEqual(
                DEFAULT_LIST_STATUSES.map((d) => d.name),
            );
        });

        it("writes exactly one workspace_activity row (list/created) with actor + context", async () => {
            const { u, space, client } = await setup();

            const created = (
                await client.post(URL).send({ space_id: space.id, name: "Orders" })
            ).body as WireList;
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row.entityType).toBe("list");
            expect(row.entityId).toBe(created.id);
            expect(row.action).toBe("created");
            expect(row.actorId).toBe(u.id);
            expect(row.workspaceId).toBe(u.workspaceId);
            expect(row.context).toMatchObject({ name: "Orders", space_id: space.id });
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>, string]> = [
            ["missing space_id", { name: "x" }, "space_id"],
            ["missing name", { space_id: "placeholder" }, "name"],
            ["empty name", { space_id: "placeholder", name: "" }, "name"],
            ["whitespace-only name", { space_id: "placeholder", name: "   " }, "name"],
            [
                "name over 120 chars",
                { space_id: "placeholder", name: "x".repeat(121) },
                "name",
            ],
            [
                "description over 500 chars",
                { space_id: "placeholder", name: "x", description: "d".repeat(501) },
                "description",
            ],
            [
                "icon over 64 chars",
                { space_id: "placeholder", name: "x", icon: "i".repeat(65) },
                "icon",
            ],
            [
                "empty icon",
                { space_id: "placeholder", name: "x", icon: "" },
                "icon",
            ],
            [
                "bad color format",
                { space_id: "placeholder", name: "x", color: "red" },
                "color",
            ],
            [
                "3-digit hex color",
                { space_id: "placeholder", name: "x", color: "#fff" },
                "color",
            ],
            [
                "is_private as number 1",
                { space_id: "placeholder", name: "x", is_private: 1 },
                "is_private",
            ],
            [
                'is_private as string "true"',
                { space_id: "placeholder", name: "x", is_private: "true" },
                "is_private",
            ],
            [
                "non-string name",
                { space_id: "placeholder", name: 42 },
                "name",
            ],
            [
                "space_id over 64 chars",
                { space_id: "s".repeat(65), name: "x" },
                "space_id",
            ],
            [
                "empty default_task_type_id",
                { space_id: "placeholder", name: "x", default_task_type_id: "" },
                "default_task_type_id",
            ],
            [
                "default_task_type_id over 64 chars",
                { space_id: "placeholder", name: "x", default_task_type_id: "t".repeat(65) },
                "default_task_type_id",
            ],
        ];

        for (const [label, body, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { space, client } = await setup();
                const payload = { ...body };
                if (payload.space_id === "placeholder") payload.space_id = space.id;

                const res = await client.post(URL).send(payload);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }

        it("accepts a 120-char name (boundary)", async () => {
            const { space, client } = await setup();
            const name = "x".repeat(120);

            const res = await client.post(URL).send({ space_id: space.id, name });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
        });

        it("accepts a 500-char description (boundary)", async () => {
            const { space, client } = await setup();
            const description = "d".repeat(500);

            const res = await client.post(URL).send({ space_id: space.id, name: "x", description });

            expect(res.status).toBe(201);
            expect(res.body.description).toBe(description);
        });

        it("writes nothing when validation fails", async () => {
            const { u, space, client } = await setup();

            await client.post(URL).send({ space_id: space.id, name: "" });

            expect(await listRows(space.id)).toHaveLength(0);
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { space } = await setup();
            const http = await oneOff();

            const res = await http.post(URL).send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const { space } = await setup();
            const http = await oneOff();

            const res = await http
                .post(URL)
                .set("Authorization", "Bearer not.a.real.jwt")
                .send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a token signed with the wrong secret", async () => {
            const { u, space } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                "wrong-secret",
                { expiresIn: "15m" },
            );
            const http = await oneOff();

            const res = await http
                .post(URL)
                .set("Authorization", `Bearer ${token}`)
                .send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, space } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .post(URL)
                .set("Authorization", `Bearer ${token}`)
                .send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ──────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to create a list (201)`, async () => {
                const { space, client } = await setup({ role });

                const res = await client.post(URL).send({ space_id: space.id, name: "x" });

                expect(res.status).toBe(201);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and writes nothing`, async () => {
                const { u, space, client } = await setup({ role });

                const res = await client.post(URL).send({ space_id: space.id, name: "x" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await listRows(space.id)).toHaveLength(0);
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE body validation (403, not 422, for a member with a bad body)", async () => {
            const { client } = await setup({ role: "member" });

            const res = await client.post(URL).send({}); // missing space_id + name

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── e. Resource lifecycle (not found / archived parent) ────────────────
    describe("Parent space lifecycle", () => {
        it("returns 404 space.not_found for a non-existent space_id", async () => {
            const { client } = await setup();

            const res = await client.post(URL).send({ space_id: "sp-nope", name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("returns 409 space.archived when the parent space is archived", async () => {
            const u = await makeUser({ role: "owner" });
            const space = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(URL).send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.archived");
            expect(await listRows(space.id)).toHaveLength(0);
        });
    });

    // ─── f. Conflict / invalid references ───────────────────────────────────
    describe("References & conflict", () => {
        it("allows two lists with the same name in a space (no unique constraint)", async () => {
            const { space, client } = await setup();

            const a = await client.post(URL).send({ space_id: space.id, name: "Dup" });
            const b = await client.post(URL).send({ space_id: space.id, name: "Dup" });

            expect(a.status).toBe(201);
            expect(b.status).toBe(201);
            expect(a.body.id).not.toBe(b.body.id);
        });

        it("returns 422 list.invalid_task_type for an unknown default_task_type_id", async () => {
            const { space, client } = await setup();

            const res = await client
                .post(URL)
                .send({ space_id: space.id, name: "x", default_task_type_id: "tt-nope" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("list.invalid_task_type");
        });

        it("rolls back fully when default_task_type_id is invalid (no list/status/activity)", async () => {
            const { u, space, client } = await setup();

            await client
                .post(URL)
                .send({ space_id: space.id, name: "x", default_task_type_id: "tt-nope" });

            expect(await listRows(space.id)).toHaveLength(0);
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── g. Tenant / workspace isolation ────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not the data) for a space in another workspace [IDOR]", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(userA);

            const res = await client.post(URL).send({ space_id: spaceB.id, name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
            expect(await listRows(spaceB.id)).toHaveLength(0);
        });

        it("rejects a default_task_type_id from another workspace (422)", async () => {
            const userA = await makeUser({ role: "owner" });
            const spaceA = await makeSpace({
                workspaceId: userA.workspaceId,
                createdBy: userA.id,
            });
            const wsB = await makeWorkspace();
            const ttB = await makeTaskType({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(userA);

            const res = await client
                .post(URL)
                .send({ space_id: spaceA.id, name: "x", default_task_type_id: ttB.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("list.invalid_task_type");
        });

        it("ignores body workspace_id / created_by / id / position (mass-assignment)", async () => {
            const { u, space, client } = await setup();
            const wsB = await makeWorkspace();

            const res = await client.post(URL).send({
                space_id: space.id,
                name: "x",
                workspace_id: wsB.id,
                created_by: "u-attacker",
                id: "l-forced",
                position: 999,
            });

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("l-forced");
            expect(res.body.created_by).toBe(u.id);
            expect(res.body.position).toBe(0);
        });
    });

    // ─── i. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("handles 10 parallel creates in one space — all 201, distinct ids, full side effects", async () => {
            const { u, space, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    client.post(URL).send({ space_id: space.id, name: `L${i}` }),
                ),
            );

            for (const r of results) expect(r.status).toBe(201);
            const ids = new Set(results.map((r) => r.body.id));
            expect(ids.size).toBe(10);
            expect(await listRows(space.id)).toHaveLength(10);
            expect(await activityRows(u.workspaceId)).toHaveLength(10);
            // 10 lists × 5 default statuses each.
            const allStatuses = (
                await Promise.all([...ids].map((id) => statusRows(id as string)))
            ).flat();
            expect(allStatuses).toHaveLength(50);
        });
    });

    // ─── k. Boundary values ─────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves unicode names (Bangla, emoji, RTL Arabic)", async () => {
            const { space, client } = await setup();

            for (const name of ["ক্রয় আদেশ", "🔥 Hotlist", "قائمة"]) {
                const res = await client.post(URL).send({ space_id: space.id, name });
                expect(res.status).toBe(201);
                expect(res.body.name).toBe(name);
            }
        });

        it("accepts mixed-case hex color", async () => {
            const { space, client } = await setup();

            const res = await client
                .post(URL)
                .send({ space_id: space.id, name: "x", color: "#AbCdEf" });

            expect(res.status).toBe(201);
            expect(res.body.color).toBe("#AbCdEf");
        });

        it("accepts an explicit null default_task_type_id", async () => {
            const { space, client } = await setup();

            const res = await client
                .post(URL)
                .send({ space_id: space.id, name: "x", default_task_type_id: null });

            expect(res.status).toBe(201);
            expect(res.body.default_task_type_id).toBeNull();
        });

        it("trims surrounding whitespace in the name", async () => {
            const { space, client } = await setup();

            const res = await client
                .post(URL)
                .send({ space_id: space.id, name: "  Trimmed  " });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe("Trimmed");
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { space, client } = await setup();

            const res = await client.post(URL).send({ space_id: space.id, name: "x" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for PUT /lists", async () => {
            const { client } = await setup();

            const res = await client.put(URL).send({ name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 400 for a malformed JSON body", async () => {
            const { client } = await setup();

            const res = await client
                .post(URL)
                .set("Content-Type", "application/json")
                .send('{"space_id": "x", "name": ');

            expect(res.status).toBe(400);
        });
    });

    // ─── Exploratory probes ─────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("treats an injection-shaped space_id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client
                .post(URL)
                .send({ space_id: "sp-1' OR '1'='1", name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("treats an injection-shaped name as a literal value (stored verbatim)", async () => {
            const { space, client } = await setup();
            const name = "Robert'); DROP TABLE lists;--";

            const res = await client.post(URL).send({ space_id: space.id, name });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
            // The table still exists and holds exactly this one row.
            expect(await listRows(space.id)).toHaveLength(1);
        });

        it("ignores a stray array-typed query string and still creates", async () => {
            const { space, client } = await setup();

            const res = await client
                .post(`${URL}?foo=1&foo=2`)
                .send({ space_id: space.id, name: "x" });

            expect(res.status).toBe(201);
        });
    });
});
