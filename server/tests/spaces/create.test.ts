import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { spaces, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `POST /api/v1/spaces`.
 *
 * Patterns mirror `tests/spaces/list.test.ts` + `get.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - `makeLoggedInClient(user)` mints real access+refresh cookies for the
 *     authenticated paths; `oneOff()` + a hand-forged Bearer drives the
 *     negative auth cases.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * The first iteration pays bcrypt's cold-cache cost (factories hash passwords),
 * so raise jest's default 5s timeout.
 */
jest.setTimeout(30000);

const CREATE_SPACE = "/api/v1/spaces";

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

/** A fully-populated, valid create body; override any field per test. */
const validBody = (over: Record<string, unknown> = {}) => ({
    name: "Operations",
    description: "Ops team",
    icon: "Boxes",
    color: "#112233",
    is_private: false,
    position: 3,
    ...over,
});

/** Read the persisted row (incl. `workspace_id`, hidden from the wire shape). */
const fetchSpaceRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({
            id: spaces.id,
            workspaceId: spaces.workspaceId,
            name: spaces.name,
            archivedAt: spaces.archivedAt,
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
        })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
};

const countSpaces = async (workspaceId: string) => {
    const db = getDb();
    return (
        await db
            .select({ id: spaces.id })
            .from(spaces)
            .where(eq(spaces.workspaceId, workspaceId))
    ).length;
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
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

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/spaces", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 201 with the bare wire Space for an admin", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send(validBody());

            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body).toMatchObject({
                name: "Operations",
                description: "Ops team",
                icon: "Boxes",
                color: "#112233",
                is_private: false,
                position: 3,
                archived_at: null,
                created_by: u.id,
            });
            expect(res.body.id).toMatch(/^sp-/);
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("allows an owner to create a space", async () => {
            const u = await makeUser({ role: "owner" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send(validBody());

            expect(res.status).toBe(201);
        });

        it("applies schema defaults when optional fields are omitted", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(CREATE_SPACE)
                .send({ name: "Minimal" });

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                name: "Minimal",
                description: null,
                icon: "Folder",
                color: "#4F46E5",
                is_private: false,
                position: 0,
                archived_at: null,
            });
        });

        it("persists is_private=true", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(CREATE_SPACE)
                .send(validBody({ is_private: true }));

            expect(res.status).toBe(201);
            expect(res.body.is_private).toBe(true);
        });

        it("emits created_at as an ISO string and is readable via GET /:id with an identical body", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const created = await client.post(CREATE_SPACE).send(validBody());
            expect(created.status).toBe(201);
            expect(typeof created.body.created_at).toBe("string");
            expect(created.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );

            const fetched = await client.get(
                `${CREATE_SPACE}/${created.body.id}`,
            );
            expect(fetched.status).toBe(200);
            expect(fetched.body).toEqual(created.body);
        });

        it("surfaces the new space in the subsequent list", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const created = await client
                .post(CREATE_SPACE)
                .send(validBody({ name: "Listed" }));

            const list = await client.get(CREATE_SPACE);
            const ids = list.body.data.map((s: { id: string }) => s.id);
            expect(ids).toContain(created.body.id);
        });

        it("writes exactly one workspace_activity row (entity_type=space, action=created)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send(validBody());

            const rows = await fetchActivityFor(res.body.id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                workspaceId: u.workspaceId,
                actorId: u.id,
                entityType: "space",
                entityId: res.body.id,
                action: "created",
            });
        });

        it("responds as JSON and carries an X-Request-Id header", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send(validBody());

            expect(res.get("content-type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
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

        it("rejects a missing name", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send({ icon: "Box" });

            expect422(res);
            expect(fieldsOf(res)).toContain("name");
        });

        it("rejects an empty / whitespace-only name", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const empty = await client.post(CREATE_SPACE).send({ name: "" });
            const blank = await client.post(CREATE_SPACE).send({ name: "   " });

            expect422(empty);
            expect422(blank);
        });

        it("rejects a non-string name", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send({ name: 12345 });

            expect422(res);
            expect(fieldsOf(res)).toContain("name");
        });

        it("accepts a 120-char name but rejects 121", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const ok = await client
                .post(CREATE_SPACE)
                .send({ name: "x".repeat(120) });
            const tooLong = await client
                .post(CREATE_SPACE)
                .send({ name: "x".repeat(121) });

            expect(ok.status).toBe(201);
            expect422(tooLong);
        });

        it("accepts a 500-char description but rejects 501", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const ok = await client
                .post(CREATE_SPACE)
                .send(validBody({ description: "d".repeat(500) }));
            const tooLong = await client
                .post(CREATE_SPACE)
                .send(validBody({ description: "d".repeat(501) }));

            expect(ok.status).toBe(201);
            expect422(tooLong);
        });

        it("rejects malformed colors and accepts #RRGGBB (case-insensitive)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            for (const bad of ["red", "#FFF", "#12345G", "123456"]) {
                const res = await client
                    .post(CREATE_SPACE)
                    .send(validBody({ color: bad }));
                expect422(res);
            }
            // F27 (ISS-033): names are unique per workspace now, so a loop
            // that creates several spaces has to vary the name. The colour is
            // what this spec is about.
            // …and INDEXED, not named after the colour: "#abcDEF" and
            // "#ABCDEF" differ only in case, and the name rule is
            // case-insensitive — so naming the spaces after them would collide.
            for (const [i, good] of ["#abcDEF", "#ABCDEF"].entries()) {
                const res = await client
                    .post(CREATE_SPACE)
                    .send(validBody({ color: good, name: `Colour ${i}` }));
                expect(res.status).toBe(201);
            }
        });

        it("rejects an empty icon and a 65-char icon, accepts 64", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const empty = await client
                .post(CREATE_SPACE)
                .send(validBody({ icon: "" }));
            const tooLong = await client
                .post(CREATE_SPACE)
                .send(validBody({ icon: "x".repeat(65) }));
            const ok = await client
                .post(CREATE_SPACE)
                .send(validBody({ icon: "x".repeat(64) }));

            expect422(empty);
            expect422(tooLong);
            expect(ok.status).toBe(201);
        });

        it('rejects a non-boolean is_private (1, "true", "yes")', async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            for (const bad of [1, "true", "yes"]) {
                const res = await client
                    .post(CREATE_SPACE)
                    .send(validBody({ is_private: bad }));
                expect422(res);
                expect(fieldsOf(res)).toContain("is_private");
            }
        });

        it("rejects out-of-range / non-integer position, accepts 0 and the uint32 max", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            for (const bad of [-1, 1.5, 4294967296]) {
                const res = await client
                    .post(CREATE_SPACE)
                    .send(validBody({ position: bad }));
                expect422(res);
            }
            // F27 (ISS-033): distinct names — two spaces are created here and
            // the workspace name rule now applies. Position is the subject.
            const zero = await client
                .post(CREATE_SPACE)
                .send(validBody({ position: 0, name: "Position zero" }));
            const max = await client
                .post(CREATE_SPACE)
                .send(validBody({ position: 4294967295, name: "Position max" }));
            expect(zero.status).toBe(201);
            expect(max.status).toBe(201);
            expect(max.body.position).toBe(4294967295);
        });

        it("ignores stray body fields (workspace_id, created_by, id, archived_at)", async () => {
            const u = await makeUser({ role: "admin" });
            const other = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send(
                validBody({
                    workspace_id: other.workspaceId,
                    created_by: "u-attacker",
                    id: "sp-attacker",
                    archived_at: "2020-01-01T00:00:00Z",
                }),
            );

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("sp-attacker");
            expect(res.body.created_by).toBe(u.id);
            expect(res.body.archived_at).toBeNull();

            const row = await fetchSpaceRow(res.body.id);
            expect(row?.workspaceId).toBe(u.workspaceId);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.post(CREATE_SPACE).send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .post(CREATE_SPACE)
                .set("Authorization", "Bearer not-a-jwt")
                .send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a wrong-secret JWT", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, "wrong-secret");
            const http = await oneOff();

            const res = await http
                .post(CREATE_SPACE)
                .set("Authorization", `Bearer ${forged}`)
                .send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .post(CREATE_SPACE)
                .set("Authorization", `Bearer ${forged}`)
                .send(validBody());

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
                .post(CREATE_SPACE)
                .set("Authorization", `Bearer ${expired}`)
                .send(validBody());

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization (👑 admin/owner only)", () => {
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 auth.forbidden for a ${role}`, async () => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);

                const res = await client.post(CREATE_SPACE).send(validBody());

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("writes no space or activity row when forbidden", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            await client.post(CREATE_SPACE).send(validBody());

            expect(await countSpaces(u.workspaceId)).toBe(0);
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("enforces precedence: a member with an invalid body still gets 403 (role before validation)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(CREATE_SPACE).send({ name: "" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("enforces precedence: no token + invalid body gives 401 (auth before validation)", async () => {
            const http = await oneOff();
            const res = await http.post(CREATE_SPACE).send({ name: "" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. No conflict (duplicate names allowed) ─────────────────────────────
    describe("Duplicate names", () => {
        it("refuses a second space with the same name (F27/ISS-033)", async () => {
            // This spec used to assert the absence of the constraint as a
            // feature — and ISS-033 is the incident it allowed: two spaces
            // called "Marketing" rendering identically in the sidebar.
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const first = await client.post(CREATE_SPACE).send(validBody());
            const second = await client.post(CREATE_SPACE).send(validBody());

            expect(first.status).toBe(201);
            expect(second.status).toBe(409);
            expect(second.body.error.code).toBe("space.duplicate");
        });

        it("still allows the same name in a DIFFERENT workspace", async () => {
            const a = await makeUser({ role: "admin" });
            const b = await makeUser({ role: "admin" });
            const clientA = await makeLoggedInClient(a);
            const clientB = await makeLoggedInClient(b);

            expect((await clientA.post(CREATE_SPACE).send(validBody())).status).toBe(201);
            expect((await clientB.post(CREATE_SPACE).send(validBody())).status).toBe(201);
        });
    });

    // ─── f. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("creates the space in the caller's workspace, never another's", async () => {
            const admin = await makeUser({ role: "admin" });
            const other = await makeUser();
            const client = await makeLoggedInClient(admin);

            const res = await client
                .post(CREATE_SPACE)
                .send(validBody({ workspace_id: other.workspaceId }));

            const row = await fetchSpaceRow(res.body.id);
            expect(row?.workspaceId).toBe(admin.workspaceId);

            // The other workspace's user never sees it.
            const otherClient = await makeLoggedInClient(other);
            const otherList = await otherClient.get(CREATE_SPACE);
            const otherIds = otherList.body.data.map(
                (s: { id: string }) => s.id,
            );
            expect(otherIds).not.toContain(res.body.id);
        });

        it("records the activity row in the caller's workspace", async () => {
            const admin = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(admin);

            const res = await client.post(CREATE_SPACE).send(validBody());

            const rows = await fetchActivityFor(res.body.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].workspaceId).toBe(admin.workspaceId);
        });
    });

    // ─── g. Idempotency / concurrency ─────────────────────────────────────────
    describe("Idempotency and concurrency", () => {
        it("does not dedupe retries (no Idempotency-Key support)", async () => {
            // F27: an IDENTICAL retry is now refused by the name rule, so the
            // absence of Idempotency-Key infrastructure is shown with two
            // distinct bodies — which is what this spec is actually about.
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            await client.post(CREATE_SPACE).send(validBody({ name: "Retry A" }));
            await client.post(CREATE_SPACE).send(validBody({ name: "Retry B" }));

            expect(await countSpaces(u.workspaceId)).toBe(2);
        });

        it("pairs each space with exactly one activity row (atomicity)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const spacesBefore = await countSpaces(u.workspaceId);
            const activityBefore = await countWorkspaceActivity();

            await client.post(CREATE_SPACE).send(validBody());

            expect(await countSpaces(u.workspaceId)).toBe(spacesBefore + 1);
            expect(await countWorkspaceActivity()).toBe(activityBefore + 1);
        });

        it("handles 10 parallel creates with distinct ids and paired activity", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    client
                        .post(CREATE_SPACE)
                        .send(validBody({ name: `S${i}` })),
                ),
            );

            const ids = new Set(results.map((r) => r.body.id));
            for (const r of results) expect(r.status).toBe(201);
            expect(ids.size).toBe(10);
            expect(await countSpaces(u.workspaceId)).toBe(10);
            expect(await countWorkspaceActivity()).toBe(10);
        });
    });

    // ─── h. Boundary / edge values ────────────────────────────────────────────
    describe("Boundary values", () => {
        it("preserves a unicode name (Bangla + emoji + RTL) byte-for-byte", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const name = "অর্ডার 📦 مرحبا";

            const res = await client
                .post(CREATE_SPACE)
                .send(validBody({ name }));

            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
        });

        it("trims surrounding whitespace on name", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client
                .post(CREATE_SPACE)
                .send(validBody({ name: "  Operations  " }));

            expect(res.status).toBe(201);
            expect(res.body.name).toBe("Operations");
        });

        it("stores a SQL-ish name literally and leaves the table intact", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);
            const name = "'); DROP TABLE spaces;--";

            const res = await client
                .post(CREATE_SPACE)
                .send(validBody({ name }));
            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);

            // The table still exists and serves reads.
            const list = await client.get(CREATE_SPACE);
            expect(list.status).toBe(200);
        });
    });
});
