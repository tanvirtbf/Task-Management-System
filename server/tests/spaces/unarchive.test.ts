import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeSpace,
    makeList,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    spaces,
    lists,
    taskActivity,
    workspaceActivity,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `POST /api/v1/spaces/:id/unarchive`.
 *
 * Patterns mirror `tests/spaces/archive.test.ts`. `beforeEach` truncates every
 * table so workspace-global counts start at zero.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (see setup-each-spaces.ts caveat).
 */
jest.setTimeout(30000);

const unarchivePath = (id: string) => `/api/v1/spaces/${id}/unarchive`;
const spacePath = (id: string) => `/api/v1/spaces/${id}`;

const ARCHIVED_AT = new Date("2026-01-02T03:04:05.000Z");

// ─── helpers ─────────────────────────────────────────────────────────────────

const fetchSpaceRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({
            id: spaces.id,
            name: spaces.name,
            archivedAt: spaces.archivedAt,
        })
        .from(spaces)
        .where(eq(spaces.id, id))
        .limit(1);
    return row ?? null;
};

const fetchListRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({ id: lists.id, archivedAt: lists.archivedAt })
        .from(lists)
        .where(eq(lists.id, id))
        .limit(1);
    return row ?? null;
};

/** Directly archive a list (factory has no archivedAt knob). */
const archiveListDirect = async (id: string) => {
    const db = getDb();
    await db
        .update(lists)
        .set({ archivedAt: ARCHIVED_AT })
        .where(eq(lists.id, id));
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

/** Seed an already-archived space owned by `user`'s workspace. */
const seedArchivedSpace = async (
    user: { id: string; workspaceId: string },
    name = "Archived",
) => {
    const s = await makeSpace({
        workspaceId: user.workspaceId,
        createdBy: user.id,
        name,
        archivedAt: ARCHIVED_AT,
    });
    return s.id;
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/spaces/:id/unarchive", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for an admin", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath(id));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("allows an owner to unarchive", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath(id));
            expect(res.status).toBe(204);
        });

        it("clears archived_at (the space reads back live and reappears in the default list)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            await client.post(unarchivePath(id));

            const row = await fetchSpaceRow(id);
            expect(row?.archivedAt).toBeNull();

            const got = await client.get(spacePath(id));
            expect(got.body.archived_at).toBeNull();

            const def = await client.get("/api/v1/spaces");
            expect(def.body.data.map((x: { id: string }) => x.id)).toContain(
                id,
            );
        });

        it("writes exactly one workspace_activity row (action=unarchived) with the name", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u, "Ops");
            const client = await makeLoggedInClient(u);

            await client.post(unarchivePath(id));

            const rows = await fetchActivityFor(id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                workspaceId: u.workspaceId,
                actorId: u.id,
                entityType: "space",
                entityId: id,
                action: "unarchived",
            });
            const ctx = rows[0].context as { name?: string } | null;
            expect(ctx?.name).toBe("Ops");
        });

        it("restores the lists the space-archive cascaded — and ONLY those (ISS-041)", async () => {
            // F16 flipped this spec. It used to assert "no cascade reversal" —
            // which is ISS-041: a space came back EMPTY (Marketing's three
            // boards were invisible for ninety minutes in P8). The archive
            // cascade stamps its lists with the SAME instant the space gets,
            // and that instant is the discriminator: unarchive restores
            // exactly the lists whose archived_at equals the space's own, so
            // an independently-archived list (its own, different timestamp)
            // stays archived — the very concern the old comment raised.
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const cascaded = await makeList({
                workspaceId: u.workspaceId,
                spaceId: id,
                createdBy: u.id,
            });
            const independent = await makeList({
                workspaceId: u.workspaceId,
                spaceId: id,
                createdBy: u.id,
            });
            // the cascade's signature: the space's exact archived_at instant
            await archiveListDirect(cascaded.id);
            // an earlier, independent archive: a DIFFERENT instant
            const db = getDb();
            await db
                .update(lists)
                .set({ archivedAt: new Date(ARCHIVED_AT.getTime() - 3600_000) })
                .where(eq(lists.id, independent.id));
            const client = await makeLoggedInClient(u);

            await client.post(unarchivePath(id));

            // Space restored…
            expect((await fetchSpaceRow(id))?.archivedAt).toBeNull();
            // …the cascaded list came back with it…
            expect((await fetchListRow(cascaded.id))?.archivedAt).toBeNull();
            // …and the independently archived one STAYED archived.
            expect(
                (await fetchListRow(independent.id))?.archivedAt,
            ).not.toBeNull();
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath(id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation (:id)", () => {
        it("returns 422 for an id longer than 64 chars", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath("x".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.post(unarchivePath("sp-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .post(unarchivePath("sp-anything"))
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .post(unarchivePath("sp-anything"))
                .set("Authorization", `Bearer ${forged}`);

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
                .post(unarchivePath("sp-anything"))
                .set("Authorization", `Bearer ${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization (👑 admin/owner only)", () => {
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 auth.forbidden for a ${role}`, async () => {
                const u = await makeUser({ role });
                const id = await seedArchivedSpace(u);
                const client = await makeLoggedInClient(u);

                const res = await client.post(unarchivePath(id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("makes no change and writes no activity when forbidden", async () => {
            const u = await makeUser({ role: "member" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            await client.post(unarchivePath(id));

            expect((await fetchSpaceRow(id))?.archivedAt).not.toBeNull();
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("enforces precedence: a member with an over-long id still gets 403 (role before validation)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath("x".repeat(65)));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("enforces precedence: no token + over-long id gives 401 (auth before validation)", async () => {
            const http = await oneOff();
            const res = await http.post(unarchivePath("x".repeat(65)));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. Not-found / idempotency (lifecycle) ───────────────────────────────
    describe("Not-found and idempotency", () => {
        it("returns 404 space.not_found for a well-formed but absent id", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath(fakeId("sp")));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("is idempotent: unarchiving a live (non-archived) space returns 204 and writes no activity", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            }); // live (archived_at null)
            const client = await makeLoggedInClient(u);

            const res = await client.post(unarchivePath(s.id));

            expect(res.status).toBe(204);
            expect(await countWorkspaceActivity()).toBe(0);
            expect((await fetchSpaceRow(s.id))?.archivedAt).toBeNull();
        });

        it("two sequential unarchives yield exactly one activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            const r1 = await client.post(unarchivePath(id));
            const r2 = await client.post(unarchivePath(id));

            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
            expect(await fetchActivityFor(id)).toHaveLength(1);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns 404 (not 403) when unarchiving another workspace's space and leaves it archived", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aId = await seedArchivedSpace(ua);

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.post(unarchivePath(aId));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
            expect((await fetchSpaceRow(aId))?.archivedAt).not.toBeNull();
        });
    });

    // ─── h. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serializes 10 parallel unarchives into a single activity row (one wins the flip)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    client.post(unarchivePath(id)),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await fetchActivityFor(id)).toHaveLength(1);
            expect((await fetchSpaceRow(id))?.archivedAt).toBeNull();
        });
    });

    // ─── j. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a workspace_activity row but no task_activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedArchivedSpace(u);
            const client = await makeLoggedInClient(u);

            await client.post(unarchivePath(id));

            expect(await countWorkspaceActivity()).toBe(1);
            expect(await countTaskActivity()).toBe(0);
        });
    });
});
