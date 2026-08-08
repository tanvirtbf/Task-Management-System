import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeSpace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { spaces, taskActivity, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `PATCH /api/v1/spaces/:id`.
 *
 * Patterns mirror `tests/spaces/create.test.ts` + `get.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (a space is seeded with
 *     `makeSpace`, then patched through the HTTP layer).
 *   - `makeLoggedInClient(user)` mints real access+refresh cookies for the
 *     authenticated paths; `oneOff()` + a hand-forged Bearer drives the
 *     negative auth cases.
 *   - `beforeEach` in `tests/test-utils/setup-each-spaces.ts` truncates every
 *     table, so workspace-global activity counts start at zero.
 *   - RUN ONE FILE PER JEST PROCESS (see setup-each-spaces.ts caveat).
 *
 * The first iteration pays bcrypt's cold-cache cost (factories hash passwords),
 * so raise jest's default 5s timeout.
 */
jest.setTimeout(30000);

const spacePath = (id: string) => `/api/v1/spaces/${id}`;

// The exact wire-`Space` keys per API_DESIGN.md Appendix A.
const SPACE_KEYS = [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "is_private",
    "head_user_id",
    "head",
    "position",
    "archived_at",
    "created_by",
    "created_at",
].sort();

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Read the persisted row (incl. `workspace_id`, hidden from the wire shape). */
const fetchSpaceRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({
            id: spaces.id,
            workspaceId: spaces.workspaceId,
            name: spaces.name,
            description: spaces.description,
            icon: spaces.icon,
            color: spaces.color,
            isPrivate: spaces.isPrivate,
            position: spaces.position,
            archivedAt: spaces.archivedAt,
            createdBy: spaces.createdBy,
        })
        .from(spaces)
        .where(eq(spaces.id, id))
        .limit(1);
    return row ?? null;
};

const fetchActivityFor = async (entityId: string) => {
    const db = getDb();
    return db
        .select({
            id: workspaceActivity.id,
            workspaceId: workspaceActivity.workspaceId,
            actorId: workspaceActivity.actorId,
            entityType: workspaceActivity.entityType,
            entityId: workspaceActivity.entityId,
            action: workspaceActivity.action,
            context: workspaceActivity.context,
        })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

const countTaskActivity = async () => {
    const db = getDb();
    return (await db.select({ id: taskActivity.id }).from(taskActivity)).length;
};

/** Forge an access token for a user with an arbitrary signing secret / opts. */
const signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

/** Seed a space owned by `user`'s workspace and return its id. */
const seedSpace = async (
    user: { id: string; workspaceId: string },
    over: {
        name?: string;
        description?: string | null;
        icon?: string;
        color?: string;
        isPrivate?: boolean;
        position?: number;
        archivedAt?: Date | null;
    } = {},
) => {
    const s = await makeSpace({
        workspaceId: user.workspaceId,
        createdBy: user.id,
        ...over,
    });
    return s.id;
};

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/spaces/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the bare wire Space for an admin (name updated)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, { name: "Before" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ name: "After" });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body.id).toBe(id);
            expect(res.body.name).toBe("After");
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("pagination");
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("allows an owner to update a space", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ name: "Owned" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Owned");
        });

        it("updates every editable field at once", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, { name: "Old", position: 1 });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(spacePath(id)).send({
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                is_private: true,
                position: 9,
            });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                is_private: true,
                position: 9,
            });
        });

        it("updates a single field and leaves the others intact", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, {
                name: "Keep",
                icon: "Boxes",
                color: "#112233",
                isPrivate: false,
                position: 4,
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ is_private: true });

            expect(res.status).toBe(200);
            expect(res.body.is_private).toBe(true);
            expect(res.body).toMatchObject({
                name: "Keep",
                icon: "Boxes",
                color: "#112233",
                position: 4,
            });
        });

        it("reflects the update on a subsequent GET /:id (identical body)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const patched = await client
                .patch(spacePath(id))
                .send({ name: "RoundTrip", color: "#abcDEF" });
            expect(patched.status).toBe(200);

            const fetched = await client.get(spacePath(id));
            expect(fetched.status).toBe(200);
            expect(fetched.body).toEqual(patched.body);
        });

        it("writes exactly one workspace_activity row (action=updated) listing the changed fields", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            await client
                .patch(spacePath(id))
                .send({ name: "Audited", color: "#001122" });

            const rows = await fetchActivityFor(id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                workspaceId: u.workspaceId,
                actorId: u.id,
                entityType: "space",
                entityId: id,
                action: "updated",
            });
            const ctx = rows[0].context as { fields?: string[] } | null;
            expect(ctx?.fields).toEqual(
                expect.arrayContaining(["name", "color"]),
            );
        });

        it("responds as JSON and carries an X-Request-Id header", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ name: "Json" });

            expect(res.get("content-type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("treats an empty body as a no-op: 200, unchanged space, no activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, { name: "Untouched" });
            const client = await makeLoggedInClient(u);

            const before = await client.get(spacePath(id));
            const res = await client.patch(spacePath(id)).send({});

            expect(res.status).toBe(200);
            expect(res.body).toEqual(before.body);
            expect(res.body.name).toBe("Untouched");
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("preserves created_at and created_by across an update", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const before = await client.get(spacePath(id));
            const res = await client
                .patch(spacePath(id))
                .send({ name: "Renamed" });

            expect(res.body.created_at).toBe(before.body.created_at);
            expect(res.body.created_by).toBe(u.id);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        const expect422 = (res: {
            status: number;
            body: { error: { code: string } };
        }) => {
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        };

        const fieldsOf = (res: {
            body: { error: { details: Array<{ field: string }> } };
        }) => res.body.error.details.map((d) => d.field);

        it("returns 422 for an id longer than 64 chars", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath("x".repeat(65)))
                .send({ name: "X" });

            expect422(res);
            expect(fieldsOf(res)).toContain("id");
        });

        it("rejects an empty / whitespace-only name", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const empty = await client.patch(spacePath(id)).send({ name: "" });
            const blank = await client
                .patch(spacePath(id))
                .send({ name: "   " });

            expect422(empty);
            expect422(blank);
        });

        it("rejects a non-string name", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client.patch(spacePath(id)).send({ name: 12345 });

            expect422(res);
            expect(fieldsOf(res)).toContain("name");
        });

        it("accepts a 120-char name but rejects 121", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const ok = await client
                .patch(spacePath(id))
                .send({ name: "x".repeat(120) });
            const tooLong = await client
                .patch(spacePath(id))
                .send({ name: "x".repeat(121) });

            expect(ok.status).toBe(200);
            expect422(tooLong);
        });

        it("accepts a 500-char description but rejects 501", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const ok = await client
                .patch(spacePath(id))
                .send({ description: "d".repeat(500) });
            const tooLong = await client
                .patch(spacePath(id))
                .send({ description: "d".repeat(501) });

            expect(ok.status).toBe(200);
            expect422(tooLong);
        });

        it("rejects malformed colors and accepts #RRGGBB (case-insensitive)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            for (const bad of ["red", "#FFF", "#12345G", "123456"]) {
                const res = await client
                    .patch(spacePath(id))
                    .send({ color: bad });
                expect422(res);
            }
            for (const good of ["#abcDEF", "#ABCDEF"]) {
                const res = await client
                    .patch(spacePath(id))
                    .send({ color: good });
                expect(res.status).toBe(200);
            }
        });

        it("rejects an empty icon and a 65-char icon, accepts 64", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const empty = await client.patch(spacePath(id)).send({ icon: "" });
            const tooLong = await client
                .patch(spacePath(id))
                .send({ icon: "x".repeat(65) });
            const ok = await client
                .patch(spacePath(id))
                .send({ icon: "x".repeat(64) });

            expect422(empty);
            expect422(tooLong);
            expect(ok.status).toBe(200);
        });

        it('rejects a non-boolean is_private (1, "true", "yes")', async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            for (const bad of [1, "true", "yes"]) {
                const res = await client
                    .patch(spacePath(id))
                    .send({ is_private: bad });
                expect422(res);
                expect(fieldsOf(res)).toContain("is_private");
            }
        });

        it("rejects out-of-range / non-integer position, accepts 0 and the uint32 max", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            for (const bad of [-1, 1.5, 4294967296]) {
                const res = await client
                    .patch(spacePath(id))
                    .send({ position: bad });
                expect422(res);
            }
            const zero = await client
                .patch(spacePath(id))
                .send({ position: 0 });
            const max = await client
                .patch(spacePath(id))
                .send({ position: 4294967295 });
            expect(zero.status).toBe(200);
            expect(max.status).toBe(200);
            expect(max.body.position).toBe(4294967295);
        });

        it("ignores stray body fields (workspace_id, created_by, id, archived_at)", async () => {
            const u = await makeUser({ role: "admin" });
            const other = await makeUser();
            const id = await seedSpace(u, { name: "Orig" });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(spacePath(id)).send({
                name: "New",
                workspace_id: other.workspaceId,
                created_by: "u-attacker",
                id: "sp-attacker",
                archived_at: "2020-01-01T00:00:00Z",
            });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(id);
            expect(res.body.name).toBe("New");
            expect(res.body.created_by).toBe(u.id);
            expect(res.body.archived_at).toBeNull();

            const row = await fetchSpaceRow(id);
            expect(row?.workspaceId).toBe(u.workspaceId);
            expect(row?.createdBy).toBe(u.id);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http
                .patch(spacePath("sp-anything"))
                .send({ name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .patch(spacePath("sp-anything"))
                .set("Authorization", "Bearer not-a-jwt")
                .send({ name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a wrong-secret JWT", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, "wrong-secret");
            const http = await oneOff();

            const res = await http
                .patch(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${forged}`)
                .send({ name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .patch(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${forged}`)
                .send({ name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser({ role: "admin" });
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .patch(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${expired}`)
                .send({ name: "X" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization (👑 admin/owner only)", () => {
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 auth.forbidden for a ${role}`, async () => {
                const u = await makeUser({ role });
                const id = await seedSpace(u);
                const client = await makeLoggedInClient(u);

                const res = await client
                    .patch(spacePath(id))
                    .send({ name: "Nope" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("makes no change and writes no activity row when forbidden", async () => {
            const u = await makeUser({ role: "member" });
            const id = await seedSpace(u, { name: "Safe" });
            const client = await makeLoggedInClient(u);

            await client.patch(spacePath(id)).send({ name: "Hacked" });

            const row = await fetchSpaceRow(id);
            expect(row?.name).toBe("Safe");
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("enforces precedence: a member with an invalid body still gets 403 (role before validation)", async () => {
            const u = await makeUser({ role: "member" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client.patch(spacePath(id)).send({ name: "" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("enforces precedence: no token + invalid body gives 401 (auth before validation)", async () => {
            const http = await oneOff();
            const res = await http
                .patch(spacePath("sp-anything"))
                .send({ name: "" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. Resource lifecycle (not-found / archived) ─────────────────────────
    describe("Not-found and archived", () => {
        it("returns 404 space.not_found for a well-formed but absent id", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(fakeId("sp")))
                .send({ name: "X" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("refuses to edit an archived space — unarchive first (F22/ISS-034)", async () => {
            // Pre-F22 this spec asserted the bug: an archived space stayed
            // fully editable while archived LISTS were frozen. Lists were the
            // model; archived now means frozen everywhere.
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, {
                name: "Archived",
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ name: "Renamed while archived" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.archived");
        });
    });

    // ─── f. Conflict (none — no unique constraint) ────────────────────────────
    describe("Name conflict (F27/ISS-033)", () => {
        it("refuses renaming a space onto another space's name", async () => {
            // D11: the rule holds on RENAME as well as create — this spec used
            // to assert the opposite, and the duplicate "Marketing" ISS-033
            // records is exactly one PATCH away without it.
            const u = await makeUser({ role: "admin" });
            await seedSpace(u, { name: "Shared" });
            const second = await seedSpace(u, { name: "Other" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(second))
                .send({ name: "Shared" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.duplicate");
        });

        it("still allows a rename that collides with nothing", async () => {
            const u = await makeUser({ role: "admin" });
            const only = await seedSpace(u, { name: "Only" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(only))
                .send({ name: "Only, renamed" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Only, renamed");
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns 404 (not 403) when updating another workspace's space and leaves it unchanged", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aId = await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
                name: "A-Space",
            }).then((s) => s.id);

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB
                .patch(spacePath(aId))
                .send({ name: "Hijacked" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");

            const row = await fetchSpaceRow(aId);
            expect(row?.name).toBe("A-Space");
        });
    });

    // ─── h. Idempotency / concurrency ─────────────────────────────────────────
    describe("Idempotency and concurrency", () => {
        it("applies an identical patch twice with the same result (two activity rows, no key dedupe)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const r1 = await client.patch(spacePath(id)).send({ name: "Same" });
            const r2 = await client.patch(spacePath(id)).send({ name: "Same" });

            expect(r1.status).toBe(200);
            expect(r2.status).toBe(200);
            expect(r2.body.name).toBe("Same");
            expect(await fetchActivityFor(id)).toHaveLength(2);
        });

        it("serializes 10 parallel updates on the same space (all 200, consistent final state)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    client.patch(spacePath(id)).send({ name: `N${i}` }),
                ),
            );

            for (const r of results) expect(r.status).toBe(200);
            expect(await fetchActivityFor(id)).toHaveLength(10);

            const row = await fetchSpaceRow(id);
            const sent = Array.from({ length: 10 }, (_, i) => `N${i}`);
            expect(sent).toContain(row?.name);
        });
    });

    // ─── i. Boundary / edge values ────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves a unicode name (Bangla + emoji + RTL) byte-for-byte", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);
            const name = "অর্ডার 📦 مرحبا";

            const res = await client.patch(spacePath(id)).send({ name });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });

        it("trims surrounding whitespace on name", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ name: "  Operations  " });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Operations");
        });

        it("stores a SQL-ish name literally and leaves the table intact", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);
            const name = "'); DROP TABLE spaces;--";

            const res = await client.patch(spacePath(id)).send({ name });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);

            const reread = await client.get(spacePath(id));
            expect(reread.status).toBe(200);
            expect(reread.body.name).toBe(name);
        });

        it("clears a description to empty string when sent as ''", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u, { description: "Has text" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(id))
                .send({ description: "" });

            expect(res.status).toBe(200);
            expect(res.body.description).toBe("");
        });
    });

    // ─── j. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a workspace_activity row but no task_activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            await client.patch(spacePath(id)).send({ name: "Audited" });

            expect(await countWorkspaceActivity()).toBe(1);
            expect(await countTaskActivity()).toBe(0);
        });

        it("pairs each non-empty update with exactly one activity row (atomicity)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedSpace(u);
            const client = await makeLoggedInClient(u);

            const wsBefore = await countWorkspaceActivity();
            await client.patch(spacePath(id)).send({ position: 7 });

            expect(await countWorkspaceActivity()).toBe(wsBefore + 1);
        });
    });

    // ─── Cross-cutting: error envelope ────────────────────────────────────────
    describe("Error envelope", () => {
        it("renders {error:{code,message,request_id}} on the 404 path", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .patch(spacePath(fakeId("sp")))
                .send({ name: "X" });

            expect(res.status).toBe(404);
            expect(res.body).toEqual({
                error: {
                    code: "space.not_found",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
            expect(res.body.error.request_id).toMatch(/^req_/);
        });
    });
});
