import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTag,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tags, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/tags/:id` (§9 #3).
 *
 * Runs under jest.tags.config.js (private DB). Assertions are workspace_id- /
 * id-scoped so they hold regardless of the per-test reset. 👑 owner/admin;
 * partial `{name?, color?}` with at least one required; returns the bare wire
 * Tag `{id,name,color}` with 200. A rename collision is `409 tag.duplicate`; a
 * genuine no-op returns 200 and writes NO activity row.
 */

jest.setTimeout(30000);

const url = (id: string): string => `/api/v1/tags/${id}`;

interface WireTag {
    id: string;
    name: string;
    color: string;
}

const tagRow = async (id: string) => {
    const db = getDb();
    const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    return row ?? null;
};

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

/** An owner (default) + a tag in their workspace + a logged-in client. */
const setup = async (
    opts: { role?: Role; name?: string; color?: string } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const tag = await makeTag({
        workspaceId: u.workspaceId,
        name: opts.name ?? "Original",
        color: opts.color ?? "#111111",
    });
    const client = await makeLoggedInClient(u);
    return { u, tag, client };
};

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/tags/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("updates the name and returns 200 with the bare wire Tag", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ name: "Renamed" });

            expect(res.status).toBe(200);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.id).toBe(tag.id);
            expect(res.body.name).toBe("Renamed");
        });

        it("shapes the response as exactly { id, name, color } — no leaks", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ name: "Renamed" });

            expect(Object.keys(res.body as WireTag).sort()).toEqual([
                "color",
                "id",
                "name",
            ]);
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("updates name only, leaving color unchanged", async () => {
            const { tag, client } = await setup({ color: "#abcdef" });

            const res = await client.patch(url(tag.id)).send({ name: "OnlyName" });

            expect(res.body.name).toBe("OnlyName");
            expect(res.body.color).toBe("#abcdef");
        });

        it("updates color only, leaving name unchanged", async () => {
            const { tag, client } = await setup({ name: "KeepMe" });

            const res = await client.patch(url(tag.id)).send({ color: "#00ff00" });

            expect(res.body.name).toBe("KeepMe");
            expect(res.body.color).toBe("#00ff00");
        });

        it("updates both fields at once", async () => {
            const { tag, client } = await setup();

            const res = await client
                .patch(url(tag.id))
                .send({ name: "Both", color: "#0000ff" });

            expect(res.body.name).toBe("Both");
            expect(res.body.color).toBe("#0000ff");
        });

        it("persists the change so a follow-up GET reflects it", async () => {
            const { tag, client } = await setup();

            await client.patch(url(tag.id)).send({ name: "Persisted" });
            const list = await client.get("/api/v1/tags");

            const found = (list.body.data as WireTag[]).find((t) => t.id === tag.id);
            expect(found?.name).toBe("Persisted");
        });

        it("persists the exact color through the DB (CHAR(7), no pad/truncate)", async () => {
            // The service returns the in-memory next color; verify the value
            // actually stored survives the CHAR(7) round-trip via the read path.
            const { tag, client } = await setup();

            await client.patch(url(tag.id)).send({ color: "#0FA1B2" });
            const list = await client.get("/api/v1/tags");
            const found = (list.body.data as WireTag[]).find((t) => t.id === tag.id);

            expect(found?.color).toBe("#0FA1B2");
            expect(found?.color).toHaveLength(7);
        });
    });

    // ─── Side effects (incl. no-op) ─────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (tag/updated) with the changes", async () => {
            const { u, tag, client } = await setup({ name: "Old", color: "#111111" });

            await client.patch(url(tag.id)).send({ name: "New", color: "#222222" });
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("tag");
            expect(rows[0].entityId).toBe(tag.id);
            expect(rows[0].action).toBe("updated");
            expect(rows[0].context).toMatchObject({
                changes: {
                    name: { from: "Old", to: "New" },
                    color: { from: "#111111", to: "#222222" },
                },
            });
        });

        it("a genuine no-op (same values) returns 200 and writes NO activity row", async () => {
            const { u, tag, client } = await setup({ name: "Same", color: "#333333" });

            const res = await client
                .patch(url(tag.id))
                .send({ name: "Same", color: "#333333" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Same");
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });

        it("records only the actually-changed field in the activity context", async () => {
            const { u, tag, client } = await setup({ name: "Keep", color: "#111111" });

            // name resubmitted unchanged; only color differs.
            await client.patch(url(tag.id)).send({ name: "Keep", color: "#999999" });
            const [row] = await activityRows(u.workspaceId);

            expect(row.context).toMatchObject({
                changes: { color: { from: "#111111", to: "#999999" } },
            });
            expect((row.context as { changes: object }).changes).not.toHaveProperty("name");
        });

        it("treats a same-color-different-case PATCH as a real change (color compare is case-sensitive)", async () => {
            // The no-op guard diffs color with strict `!==`; the DB stores the
            // literal case. A case-only edit therefore changes the stored value
            // and IS audited — documenting the contract (not a case-normalised no-op).
            const { u, tag, client } = await setup({ color: "#aabbcc" });

            const res = await client.patch(url(tag.id)).send({ color: "#AABBCC" });

            expect(res.status).toBe(200);
            expect(res.body.color).toBe("#AABBCC");
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an empty body (no field to update)", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({});

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        const cases: Array<[string, Record<string, unknown>, string]> = [
            ["empty name", { name: "" }, "name"],
            ["whitespace-only name", { name: "   " }, "name"],
            ["name over 60", { name: "x".repeat(61) }, "name"],
            ["non-string name", { name: 7 }, "name"],
            ["bad color", { color: "blue" }, "color"],
            ["3-digit hex", { color: "#fff" }, "color"],
            ["color one hex too long (8 chars)", { color: "#FFFFFFF" }, "color"],
            ["color one hex too short (6 chars)", { color: "#FFFFF" }, "color"],
        ];

        for (const [label, body, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { tag, client } = await setup();

                const res = await client.patch(url(tag.id)).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }

        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.patch(url("t".repeat(65))).send({ name: "x" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a 60-char name (boundary)", async () => {
            const { tag, client } = await setup();
            const name = "x".repeat(60);

            const res = await client.patch(url(tag.id)).send({ name });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { tag } = await setup();
            const http = await oneOff();

            const res = await http.patch(url(tag.id)).send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, tag } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .patch(url(tag.id))
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ──────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to update (200)`, async () => {
                const { tag, client } = await setup({ role });

                const res = await client.patch(url(tag.id)).send({ name: "x" });

                expect(res.status).toBe(200);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403) and changes nothing`, async () => {
                const { u, tag, client } = await setup({ role });

                const res = await client.patch(url(tag.id)).send({ name: "Hacked" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await tagRow(tag.id))?.name).toBe("Original");
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE body validation (403, not 422, for a member with an empty body)", async () => {
            const { tag, client } = await setup({ role: "member" });

            const res = await client.patch(url(tag.id)).send({});

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("checks the role BEFORE id validation (403, not 422, for a member with a 65-char id)", async () => {
            const { client } = await setup({ role: "member" });

            const res = await client.patch(url("t".repeat(65))).send({ name: "x" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── e. Not found ───────────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 tag.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.patch(url("tag-nope")).send({ name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("tag.not_found");
        });

        it("returns 404 for a tag in another workspace [IDOR] and changes nothing", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const tagB = await makeTag({ workspaceId: wsB.id, name: "B-tag" });
            const client = await makeLoggedInClient(userA);

            const res = await client.patch(url(tagB.id)).send({ name: "Hacked" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("tag.not_found");
            expect((await tagRow(tagB.id))?.name).toBe("B-tag");
        });
    });

    // ─── f. Conflict (rename collision) ─────────────────────────────────────
    describe("Rename collision", () => {
        it("returns 409 tag.duplicate when renaming onto a sibling's name", async () => {
            const u = await makeUser({ role: "owner" });
            const a = await makeTag({ workspaceId: u.workspaceId, name: "Alpha" });
            await makeTag({ workspaceId: u.workspaceId, name: "Beta" });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(url(a.id)).send({ name: "Beta" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.duplicate");
        });

        it("treats the rename collision case-insensitively → 409", async () => {
            const u = await makeUser({ role: "owner" });
            const a = await makeTag({ workspaceId: u.workspaceId, name: "Alpha" });
            await makeTag({ workspaceId: u.workspaceId, name: "Beta" });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(url(a.id)).send({ name: "BETA" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("tag.duplicate");
        });

        it("renaming a tag to its OWN current name is a 200 no-op (not 409)", async () => {
            const { u, tag, client } = await setup({ name: "Self" });

            const res = await client.patch(url(tag.id)).send({ name: "Self" });

            expect(res.status).toBe(200);
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });

        it("allows a name that collides only with a DIFFERENT workspace's tag", async () => {
            const u = await makeUser({ role: "owner" });
            const mine = await makeTag({ workspaceId: u.workspaceId, name: "Mine" });
            const wsB = await makeWorkspace();
            await makeTag({ workspaceId: wsB.id, name: "Shared" });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(url(mine.id)).send({ name: "Shared" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Shared");
        });
    });

    // ─── h. Idempotency ─────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("patching to a new value, then the same value again, writes only one activity row", async () => {
            const { u, tag, client } = await setup({ name: "v0" });

            await client.patch(url(tag.id)).send({ name: "v1" }); // real change → 1 activity
            const second = await client.patch(url(tag.id)).send({ name: "v1" }); // no-op

            expect(second.status).toBe(200);
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── i. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel patches on different fields both apply (lock serializes)", async () => {
            const { tag, client } = await setup({ name: "C0", color: "#000000" });

            const [a, b] = await Promise.all([
                client.patch(url(tag.id)).send({ name: "Conc" }),
                client.patch(url(tag.id)).send({ color: "#0f0f0f" }),
            ]);

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            const row = await tagRow(tag.id);
            expect(row?.name).toBe("Conc");
            expect(row?.color).toBe("#0f0f0f");
        });
    });

    // ─── k. Boundary & cross-cutting ────────────────────────────────────────
    describe("Boundary & cross-cutting", () => {
        it("accepts unicode names", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ name: "🔥 ঈদ" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("🔥 ঈদ");
        });

        it("trims surrounding whitespace in the name", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ name: "  Trim  " });

            expect(res.body.name).toBe("Trim");
        });

        it("accepts a mixed-case hex color", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ color: "#AbCdEf" });

            expect(res.body.color).toBe("#AbCdEf");
        });

        it("responds as application/json with an X-Request-Id header", async () => {
            const { tag, client } = await setup();

            const res = await client.patch(url(tag.id)).send({ name: "x" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 400 for a malformed JSON body", async () => {
            const { tag, client } = await setup();

            const res = await client
                .patch(url(tag.id))
                .set("Content-Type", "application/json")
                .send('{"name": ');

            expect(res.status).toBe(400);
        });

        it("stores an injection-shaped name verbatim", async () => {
            const { tag, client } = await setup();
            const name = "x'); DROP TABLE tags;--";

            const res = await client.patch(url(tag.id)).send({ name });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
            expect((await tagRow(tag.id))?.name).toBe(name);
        });
    });
});
