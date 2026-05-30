import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tags, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/tags` (§9 #2).
 *
 * Runs under jest.tags.config.js (private DB `taskmanagement_tags_test`).
 * `setup-each-tags` truncates {sessions, tags, workspace_activity, users,
 * workspaces} per test, but assertions are additionally scoped by workspace_id
 * so they stay correct regardless. 👑 owner/admin; body `{name, color?}` (color
 * defaults to `#94A3B8`); returns the bare wire Tag `{id,name,color}` with 201.
 * A `(workspace_id, name)` collision (case-insensitive collation) is `409
 * tag.duplicate`; each mutation writes one `workspace_activity` row.
 */

// The tags suite sets no global timeout; a write test does bcrypt-bearing
// factory inserts + concurrency, which can exceed the 5s default under load.
jest.setTimeout(30000);

const TAGS = "/api/v1/tags";

interface WireTag {
    id: string;
    name: string;
    color: string;
}

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

const tagRows = async (workspaceId: string) => {
    const db = getDb();
    return db.select().from(tags).where(eq(tags.workspaceId, workspaceId));
};

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

/** An owner (default) + a logged-in client. */
const setup = async (
    opts: { role?: Role; status?: "active" | "invited" | "deactivated" } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner", status: opts.status });
    const client = await makeLoggedInClient(u);
    return { u, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/tags", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a tag and returns 201 with the bare wire Tag", async () => {
            const { client } = await setup();

            const res = await client.post(TAGS).send({ name: "Urgent" });

            expect(res.status).toBe(201);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.name).toBe("Urgent");
            expect(res.body.id).toMatch(/^tag-/);
        });

        it("shapes the response as exactly { id, name, color } — no leaks", async () => {
            const { client } = await setup();

            const res = await client.post(TAGS).send({ name: "Urgent" });

            expect(Object.keys(res.body as WireTag).sort()).toEqual([
                "color",
                "id",
                "name",
            ]);
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("created_at");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("applies the schema default color #94A3B8 when color is omitted", async () => {
            const { client } = await setup();

            const res = await client.post(TAGS).send({ name: "Plain" });

            expect(res.body.color).toBe("#94A3B8");
        });

        it("echoes an explicit color verbatim", async () => {
            const { client } = await setup();

            const res = await client
                .post(TAGS)
                .send({ name: "Red", color: "#FF0000" });

            expect(res.body.color).toBe("#FF0000");
        });

        it("persists the row so a follow-up GET returns it", async () => {
            const { client } = await setup();

            const created = (await client.post(TAGS).send({ name: "Persisted" }))
                .body as WireTag;
            const list = await client.get(TAGS);

            expect(
                (list.body.data as WireTag[]).map((t) => t.id),
            ).toContain(created.id);
        });

        it("persists the exact color through the DB (CHAR(7), no pad/truncate)", async () => {
            // tags.color is CHAR(7) with NO DB CHECK, and the repo returns the
            // input color rather than re-reading — so verify the value survives
            // the round-trip via the read path, not just the create response.
            const { client } = await setup();

            const created = (
                await client.post(TAGS).send({ name: "ColorCheck", color: "#FF00AA" })
            ).body as WireTag;
            const list = await client.get(TAGS);
            const stored = (list.body.data as WireTag[]).find(
                (t) => t.id === created.id,
            );

            expect(stored?.color).toBe("#FF00AA");
            expect(stored?.color).toHaveLength(7);
        });
    });

    // ─── Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (tag/created) with context", async () => {
            const { u, client } = await setup();

            const created = (await client.post(TAGS).send({ name: "Audited", color: "#010203" }))
                .body as WireTag;
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("tag");
            expect(rows[0].entityId).toBe(created.id);
            expect(rows[0].action).toBe("created");
            expect(rows[0].actorId).toBe(u.id);
            expect(rows[0].context).toMatchObject({ name: "Audited", color: "#010203" });
        });

        it("increments the workspace's tag row count by exactly one", async () => {
            const { u, client } = await setup();

            await client.post(TAGS).send({ name: "One" });

            expect(await tagRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>, string]> = [
            ["missing name", {}, "name"],
            ["empty name", { name: "" }, "name"],
            ["whitespace-only name", { name: "   " }, "name"],
            ["name over 60 chars", { name: "x".repeat(61) }, "name"],
            ["non-string name", { name: 7 }, "name"],
            ["bad color (word)", { name: "x", color: "red" }, "color"],
            ["3-digit hex color", { name: "x", color: "#fff" }, "color"],
            ["color one hex too long (8 chars)", { name: "x", color: "#FFFFFFF" }, "color"],
            ["color one hex too short (6 chars)", { name: "x", color: "#FFFFF" }, "color"],
            ["non-string color", { name: "x", color: 123 }, "color"],
        ];

        for (const [label, body, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { client } = await setup();

                const res = await client.post(TAGS).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }

        it("accepts a 60-char name (boundary)", async () => {
            const { client } = await setup();
            const name = "x".repeat(60);

            const res = await client.post(TAGS).send({ name });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
        });

        it("writes nothing when validation fails", async () => {
            const { u, client } = await setup();

            await client.post(TAGS).send({ name: "" });

            expect(await tagRows(u.workspaceId)).toHaveLength(0);
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http.post(TAGS).send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();

            const res = await http
                .post(TAGS)
                .set("Authorization", "Bearer not.a.jwt")
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a token signed with the wrong secret", async () => {
            const { u } = await setup();
            const token = signAccess(u, "wrong-secret", { expiresIn: "15m" });
            const http = await oneOff();

            const res = await http
                .post(TAGS)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .post(TAGS)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ──────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to create a tag (201)`, async () => {
                const { client } = await setup({ role });

                const res = await client.post(TAGS).send({ name: "x" });

                expect(res.status).toBe(201);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and writes nothing`, async () => {
                const { u, client } = await setup({ role });

                const res = await client.post(TAGS).send({ name: "x" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await tagRows(u.workspaceId)).toHaveLength(0);
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE body validation (403, not 422, for a member with an empty body)", async () => {
            const { client } = await setup({ role: "member" });

            const res = await client.post(TAGS).send({});

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── e/f. Conflict (duplicate name) ─────────────────────────────────────
    describe("Duplicate name", () => {
        it("returns 409 tag.duplicate for a duplicate name in the same workspace", async () => {
            const { client } = await setup();
            await client.post(TAGS).send({ name: "Dup" });

            const res = await client.post(TAGS).send({ name: "Dup" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.duplicate");
        });

        it("treats names case-insensitively (utf8mb4_unicode_ci) → 409", async () => {
            const { client } = await setup();
            await client.post(TAGS).send({ name: "Urgent" });

            const res = await client.post(TAGS).send({ name: "urgent" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.duplicate");
        });

        it("writes no extra rows on a duplicate (one tag, one activity)", async () => {
            const { u, client } = await setup();
            await client.post(TAGS).send({ name: "Dup" });

            await client.post(TAGS).send({ name: "Dup" });

            expect(await tagRows(u.workspaceId)).toHaveLength(1);
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });

        it("allows the same name in a DIFFERENT workspace (201)", async () => {
            const a = await setup();
            await a.client.post(TAGS).send({ name: "Shared" });
            const b = await setup();

            const res = await b.client.post(TAGS).send({ name: "Shared" });

            expect(res.status).toBe(201);
        });
    });

    // ─── g. Tenant / workspace isolation ────────────────────────────────────
    describe("Workspace isolation", () => {
        it("lands the tag in the caller's workspace, ignoring a body workspace_id", async () => {
            const { u, client } = await setup();
            const other = await makeWorkspace();

            const res = await client
                .post(TAGS)
                .send({ name: "Scoped", workspace_id: other.id, workspaceId: other.id });

            expect(res.status).toBe(201);
            const mine = await tagRows(u.workspaceId);
            expect(mine.map((t) => t.id)).toContain(res.body.id);
            expect(await tagRows(other.id)).toHaveLength(0);
        });

        it("ignores a body id / created_by (mass-assignment)", async () => {
            const { client } = await setup();

            const res = await client
                .post(TAGS)
                .send({ name: "x", id: "tag-forced", created_by: "u-attacker" });

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("tag-forced");
        });
    });

    // ─── h. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("5 parallel creates of the SAME name — exactly one 201, the rest 409", async () => {
            const { u, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () =>
                    client.post(TAGS).send({ name: "Race" }),
                ),
            );

            const created = results.filter((r) => r.status === 201);
            const dup = results.filter((r) => r.status === 409);
            expect(created).toHaveLength(1);
            expect(dup).toHaveLength(4);
            expect(await tagRows(u.workspaceId)).toHaveLength(1);
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });

        it("10 parallel creates of DISTINCT names — all 201", async () => {
            const { u, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    client.post(TAGS).send({ name: `T${i}` }),
                ),
            );

            for (const r of results) expect(r.status).toBe(201);
            expect(await tagRows(u.workspaceId)).toHaveLength(10);
            expect(await activityRows(u.workspaceId)).toHaveLength(10);
        });
    });

    // ─── k. Boundary values ─────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves unicode names (Bangla, emoji, RTL)", async () => {
            const { client } = await setup();

            for (const name of ["ঈদ", "🔥 Sale", "عرض"]) {
                const res = await client.post(TAGS).send({ name });
                expect(res.status).toBe(201);
                expect(res.body.name).toBe(name);
            }
        });

        it("accepts a mixed-case hex color", async () => {
            const { client } = await setup();

            const res = await client
                .post(TAGS)
                .send({ name: "Mixed", color: "#AbCdEf" });

            expect(res.status).toBe(201);
            expect(res.body.color).toBe("#AbCdEf");
        });

        it("trims surrounding whitespace in the name", async () => {
            const { client } = await setup();

            const res = await client.post(TAGS).send({ name: "  Trim  " });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe("Trim");
        });

        it("detects a duplicate after trimming (' Dup ' vs 'Dup')", async () => {
            const { client } = await setup();
            await client.post(TAGS).send({ name: "Dup" });

            const res = await client.post(TAGS).send({ name: "  Dup  " });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.duplicate");
        });
    });

    // ─── Cross-cutting & exploratory ────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();

            const res = await client.post(TAGS).send({ name: "x" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 400 for a malformed JSON body", async () => {
            const { client } = await setup();

            const res = await client
                .post(TAGS)
                .set("Content-Type", "application/json")
                .send('{"name": ');

            expect(res.status).toBe(400);
        });

        it("stores an injection-shaped name verbatim", async () => {
            const { u, client } = await setup();
            const name = "x'); DROP TABLE tags;--";

            const res = await client.post(TAGS).send({ name });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
            expect(await tagRows(u.workspaceId)).toHaveLength(1);
        });
    });
});
