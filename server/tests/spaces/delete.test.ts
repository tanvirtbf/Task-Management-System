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
 * Tests for `DELETE /api/v1/spaces/:id` (hard delete, 🛡️ OWNER only).
 *
 * Preconditions: the space must be archived AND hold no lists; otherwise 409.
 * Patterns mirror the other spaces suites. `beforeEach` truncates every table
 * so workspace-global counts start at zero.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (see setup-each-spaces.ts caveat).
 */
jest.setTimeout(30000);

const spacePath = (id: string) => `/api/v1/spaces/${id}`;

const ARCHIVED_AT = new Date("2026-01-02T03:04:05.000Z");

// ─── helpers ─────────────────────────────────────────────────────────────────

const fetchSpaceRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({ id: spaces.id, archivedAt: spaces.archivedAt })
        .from(spaces)
        .where(eq(spaces.id, id))
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

/** Seed an archived, list-less space (the deletable state) owned by `user`. */
const seedDeletable = async (user: { id: string; workspaceId: string }) => {
    const s = await makeSpace({
        workspaceId: user.workspaceId,
        createdBy: user.id,
        archivedAt: ARCHIVED_AT,
    });
    return s.id;
};

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/spaces/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for an owner deleting an archived empty space", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(id));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("removes the space (GET /:id is then 404 and it is absent from the list)", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            await client.delete(spacePath(id));

            expect(await fetchSpaceRow(id)).toBeNull();

            const got = await client.get(spacePath(id));
            expect(got.status).toBe(404);
            expect(got.body.error.code).toBe("space.not_found");

            const list = await client.get(
                "/api/v1/spaces?include_archived=true",
            );
            expect(
                list.body.data.map((x: { id: string }) => x.id),
            ).not.toContain(id);
        });

        it("writes a workspace_activity row (action=deleted) that survives the row deletion", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            await client.delete(spacePath(id));

            const rows = await fetchActivityFor(id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                workspaceId: u.workspaceId,
                actorId: u.id,
                entityType: "space",
                entityId: id,
                action: "deleted",
            });
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation (:id)", () => {
        it("returns 422 for an id longer than 64 chars", async () => {
            const u = await makeUser({ role: "owner" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath("x".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(spacePath("sp-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .delete(spacePath("sp-anything"))
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 for a JWT signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser({ role: "owner" });
            const forged = signAccess(u, Config.REFRESH_TOKEN_SECRET!);
            const http = await oneOff();

            const res = await http
                .delete(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser({ role: "owner" });
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .delete(spacePath("sp-anything"))
                .set("Authorization", `Bearer ${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🛡️ OWNER only — admin is NOT enough) ───────────────
    describe("Authorization (🛡️ owner only)", () => {
        for (const role of ["admin", "member", "guest"] as const) {
            it(`returns 403 auth.forbidden for a ${role} (only the owner may delete)`, async () => {
                const u = await makeUser({ role });
                const id = await seedDeletable(u);
                const client = await makeLoggedInClient(u);

                const res = await client.delete(spacePath(id));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }

        it("makes no change and writes no activity when forbidden (admin)", async () => {
            const u = await makeUser({ role: "admin" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            await client.delete(spacePath(id));

            expect(await fetchSpaceRow(id)).not.toBeNull();
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("enforces precedence: an admin with an over-long id still gets 403 (role before validation)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath("x".repeat(65)));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("enforces precedence: no token + over-long id gives 401 (auth before validation)", async () => {
            const http = await oneOff();
            const res = await http.delete(spacePath("x".repeat(65)));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    // ─── e. Preconditions (not-found / archived / empty) ──────────────────────
    describe("Preconditions", () => {
        it("returns 404 space.not_found for a well-formed but absent id", async () => {
            const u = await makeUser({ role: "owner" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(fakeId("sp")));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
        });

        it("returns 409 space.not_archived for a live (non-archived) space and leaves it", async () => {
            const u = await makeUser({ role: "owner" });
            const s = await makeSpace({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            }); // live
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(s.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.not_archived");
            expect(await fetchSpaceRow(s.id)).not.toBeNull();
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("returns 409 space.not_empty for an archived space that still has a live list", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            await makeList({
                workspaceId: u.workspaceId,
                spaceId: id,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.not_empty");
            expect(await fetchSpaceRow(id)).not.toBeNull();
        });

        it("returns 409 space.not_empty even when the only remaining list is archived", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const l = await makeList({
                workspaceId: u.workspaceId,
                spaceId: id,
                createdBy: u.id,
            });
            await archiveListDirect(l.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(spacePath(id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.not_empty");
            expect(await fetchSpaceRow(id)).not.toBeNull();
        });

        it("deletes successfully once the blocking lists are removed", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const l = await makeList({
                workspaceId: u.workspaceId,
                spaceId: id,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const blocked = await client.delete(spacePath(id));
            expect(blocked.status).toBe(409);

            // Remove the list directly, then the space deletes cleanly.
            const db = getDb();
            await db.delete(lists).where(eq(lists.id, l.id));

            const ok = await client.delete(spacePath(id));
            expect(ok.status).toBe(204);
            expect(await fetchSpaceRow(id)).toBeNull();
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns 404 (not 403) when an owner deletes another workspace's space and leaves it", async () => {
            const ua = await makeUser({ role: "owner" });
            const ub = await makeUser({ role: "owner" });
            const aId = await seedDeletable(ua);

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.delete(spacePath(aId));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("space.not_found");
            expect(await fetchSpaceRow(aId)).not.toBeNull();
        });
    });

    // ─── h. Idempotency / concurrency ─────────────────────────────────────────
    describe("Idempotency and concurrency", () => {
        it("a second delete of the same space returns 404 (already gone)", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            const first = await client.delete(spacePath(id));
            const second = await client.delete(spacePath(id));

            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("space.not_found");
        });

        it("10 parallel deletes remove the space once with exactly one activity row", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () => client.delete(spacePath(id))),
            );

            // Every response is a clean outcome — either it deleted (204) or it
            // saw the space already gone (404). No 500s, no 409s.
            for (const r of results) {
                expect([204, 404]).toContain(r.status);
            }
            expect(await fetchSpaceRow(id)).toBeNull();
            expect(await fetchActivityFor(id)).toHaveLength(1);
        });
    });

    // ─── j. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row and no task_activity row", async () => {
            const u = await makeUser({ role: "owner" });
            const id = await seedDeletable(u);
            const client = await makeLoggedInClient(u);

            await client.delete(spacePath(id));

            expect(await countWorkspaceActivity()).toBe(1);
            expect(await countTaskActivity()).toBe(0);
        });
    });
});
