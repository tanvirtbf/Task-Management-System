import jwt from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";
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
 * Tests for `POST /api/v1/spaces/:id/archive`.
 *
 * Patterns mirror the other spaces suites (real DB writes via factories,
 * `makeLoggedInClient` cookies, `oneOff()` for negative auth). `beforeEach`
 * truncates every table so workspace-global counts start at zero.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (see setup-each-spaces.ts caveat).
 */
jest.setTimeout(30000);

const archivePath = (id: string) => `/api/v1/spaces/${id}/archive`;
const spacePath = (id: string) => `/api/v1/spaces/${id}`;

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
        .set({ archivedAt: new Date("2020-01-01T00:00:00.000Z") })
        .where(eq(lists.id, id));
};

const liveListCount = async (spaceId: string) => {
    const db = getDb();
    return (
        await db
            .select({ id: lists.id })
            .from(lists)
            .where(and(eq(lists.spaceId, spaceId), isNull(lists.archivedAt)))
    ).length;
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

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/spaces/:id/archive", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for an admin", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(s.id));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("allows an owner to archive", async () => {
            const u = await makeUser({ role: "owner" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(s.id));
            expect(res.status).toBe(204);
        });

        it("sets archived_at (the space then reads back archived)", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const row = await fetchSpaceRow(s.id);
            expect(row?.archivedAt).not.toBeNull();

            const got = await client.get(spacePath(s.id));
            expect(got.status).toBe(200);
            expect(typeof got.body.archived_at).toBe("string");
        });

        it("hides the space from the default list but shows it with ?include_archived=true", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const def = await client.get("/api/v1/spaces");
            expect(
                def.body.data.map((x: { id: string }) => x.id),
            ).not.toContain(s.id);

            const incl = await client.get(
                "/api/v1/spaces?include_archived=true",
            );
            expect(incl.body.data.map((x: { id: string }) => x.id)).toContain(
                s.id,
            );
        });

        it("cascade-archives the space's live lists with the same instant", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const l1 = await makeList({
                workspaceId: u.workspaceId,
                spaceId: s.id,
                createdBy: u.id,
            });
            const l2 = await makeList({
                workspaceId: u.workspaceId,
                spaceId: s.id,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const space = await fetchSpaceRow(s.id);
            const list1 = await fetchListRow(l1.id);
            const list2 = await fetchListRow(l2.id);

            expect(list1?.archivedAt).not.toBeNull();
            expect(list2?.archivedAt).not.toBeNull();
            // Same instant as the parent space.
            expect(list1?.archivedAt?.getTime()).toBe(
                space?.archivedAt?.getTime(),
            );
            expect(await liveListCount(s.id)).toBe(0);
        });

        it("writes exactly one workspace_activity row (action=archived) with name + lists_archived", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                name: "Ops",
            });
            await makeList({
                workspaceId: u.workspaceId,
                spaceId: s.id,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const rows = await fetchActivityFor(s.id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                workspaceId: u.workspaceId,
                actorId: u.id,
                entityType: "space",
                entityId: s.id,
                action: "archived",
            });
            const ctx = rows[0].context as {
                name?: string;
                lists_archived?: number;
            } | null;
            expect(ctx?.name).toBe("Ops");
            expect(ctx?.lists_archived).toBe(1);
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(s.id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation (:id)", () => {
        it("returns 422 for an id longer than 64 chars", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath("x".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.post(archivePath("sp-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .post(archivePath("sp-anything"))
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser({ role: "admin" });
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .post(archivePath("sp-anything"))
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
                .post(archivePath("sp-anything"))
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
                const s = await makeSpace({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);

                const res = await client.post(archivePath(s.id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("makes no change and writes no activity when forbidden", async () => {
            const u = await makeUser({ role: "member" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const row = await fetchSpaceRow(s.id);
            expect(row?.archivedAt).toBeNull();
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("enforces precedence: a member with an over-long id still gets 403 (role before validation)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath("x".repeat(65)));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("enforces precedence: no token + over-long id gives 401 (auth before validation)", async () => {
            const http = await oneOff();
            const res = await http.post(archivePath("x".repeat(65)));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. Not-found / idempotency (lifecycle) ───────────────────────────────
    describe("Not-found and idempotency", () => {
        it("returns 404 space.not_found for a well-formed but absent id", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(fakeId("sp")));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("is idempotent: archiving an already-archived space returns 204 and writes no new activity", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(s.id));

            expect(res.status).toBe(204);
            expect(await countWorkspaceActivity()).toBe(0);
            const row = await fetchSpaceRow(s.id);
            expect(row?.archivedAt?.toISOString()).toMatch(
                /^2026-01-02T03:04:05/,
            );
        });

        it("two sequential archives yield exactly one activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const r1 = await client.post(archivePath(s.id));
            const r2 = await client.post(archivePath(s.id));

            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
            expect(await fetchActivityFor(s.id)).toHaveLength(1);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns 404 (not 403) when archiving another workspace's space and leaves it live", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aSpace = await makeSpace({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.post(archivePath(aSpace.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");

            const row = await fetchSpaceRow(aSpace.id);
            expect(row?.archivedAt).toBeNull();
        });
    });

    // ─── h. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serializes 10 parallel archives into a single activity row (one wins the flip)", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    client.post(archivePath(s.id)),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await fetchActivityFor(s.id)).toHaveLength(1);
            const row = await fetchSpaceRow(s.id);
            expect(row?.archivedAt).not.toBeNull();
        });
    });

    // ─── i. Boundary / cascade edge values ────────────────────────────────────
    describe("Boundary values", () => {
        it("archives a space with no lists (lists_archived = 0)", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(archivePath(s.id));
            expect(res.status).toBe(204);

            const rows = await fetchActivityFor(s.id);
            const ctx = rows[0].context as { lists_archived?: number } | null;
            expect(ctx?.lists_archived).toBe(0);
        });

        it("counts only the live lists in the cascade (pre-archived lists are not recounted)", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const live = await makeList({
                workspaceId: u.workspaceId,
                spaceId: s.id,
                createdBy: u.id,
            });
            const already = await makeList({
                workspaceId: u.workspaceId,
                spaceId: s.id,
                createdBy: u.id,
            });
            await archiveListDirect(already.id);
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            const rows = await fetchActivityFor(s.id);
            const ctx = rows[0].context as { lists_archived?: number } | null;
            expect(ctx?.lists_archived).toBe(1);

            // Both lists end up archived; the pre-archived one keeps its
            // original (earlier) timestamp, not the cascade instant.
            expect((await fetchListRow(live.id))?.archivedAt).not.toBeNull();
            expect(
                (await fetchListRow(already.id))?.archivedAt?.toISOString(),
            ).toMatch(/^2020-01-01T00:00:00/);
        });

        it("does not touch another space's lists in the same workspace", async () => {
            const u = await makeUser({ role: "admin" });
            const target = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const other = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const otherList = await makeList({
                workspaceId: u.workspaceId,
                spaceId: other.id,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(target.id));

            expect((await fetchListRow(otherList.id))?.archivedAt).toBeNull();
        });
    });

    // ─── j. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes a workspace_activity row but no task_activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(archivePath(s.id));

            expect(await countWorkspaceActivity()).toBe(1);
            expect(await countTaskActivity()).toBe(0);
        });
    });
});
