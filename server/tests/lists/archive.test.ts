import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSpace,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/lists/:id/archive` (§6 Lists #6).
 *
 * Runs on the private no-truncate `tms_lists_test` DB (id-scoped assertions).
 * 👑 owner/admin. Soft-deletes a list (sets `archived_at`), idempotently, and
 * records one `archived` activity row on a real transition. Returns 204.
 */

const url = (id: string): string => `/api/v1/lists/${id}/archive`;

const insertList = async (input: {
    spaceId: string;
    createdBy: string;
    name?: string;
    archivedAt?: Date | null;
}): Promise<string> => {
    const db = getDb();
    const id = fakeId("l");
    await db.insert(lists).values({
        id,
        spaceId: input.spaceId,
        createdBy: input.createdBy,
        name: input.name ?? "Orders",
        archivedAt: input.archivedAt ?? null,
    });
    return id;
};

const listRow = async (id: string) => {
    const db = getDb();
    const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
    return row;
};

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

const setup = async (
    opts: { role?: Role; archived?: boolean } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const space = await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
    const listId = await insertList({
        spaceId: space.id,
        createdBy: u.id,
        archivedAt: opts.archived ? new Date() : null,
    });
    const client = await makeLoggedInClient(u);
    return { u, space, listId, client };
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

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/lists/:id/archive", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("archives an active list and returns 204 with an empty body", async () => {
            const { listId, client } = await setup();

            const res = await client.post(url(listId));

            expect(res.status).toBe(204);
            expect(res.text).toBe("");
            expect((await listRow(listId)).archivedAt).not.toBeNull();
        });

        it("drops the list from the default space listing but keeps it under include_archived", async () => {
            const { space, listId, client } = await setup();

            await client.post(url(listId));

            const def = await client.get(`/api/v1/spaces/${space.id}/lists`);
            expect(def.body.data.map((l: { id: string }) => l.id)).not.toContain(
                listId,
            );

            const incl = await client.get(
                `/api/v1/spaces/${space.id}/lists?include_archived=true`,
            );
            expect(incl.body.data.map((l: { id: string }) => l.id)).toContain(
                listId,
            );
        });

        it("still resolves on a direct GET /lists/:id with archived_at set", async () => {
            const { listId, client } = await setup();

            await client.post(url(listId));
            const res = await client.get(`/api/v1/lists/${listId}`);

            expect(res.status).toBe(200);
            expect(res.body.archived_at).not.toBeNull();
            expect(res.body.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        });
    });

    // ─── Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (list/archived)", async () => {
            const { u, listId, client } = await setup();

            await client.post(url(listId));
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("list");
            expect(rows[0].entityId).toBe(listId);
            expect(rows[0].action).toBe("archived");
            expect(rows[0].actorId).toBe(u.id);
        });
    });

    // ─── Idempotency ────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("archiving an already-archived list is a 204 no-op with no second activity row", async () => {
            const { u, listId, client } = await setup();

            const first = await client.post(url(listId));
            const firstArchivedAt = (await listRow(listId)).archivedAt;
            const second = await client.post(url(listId));

            expect(first.status).toBe(204);
            expect(second.status).toBe(204);
            // archived_at not moved by the no-op.
            expect((await listRow(listId)).archivedAt?.getTime()).toBe(
                firstArchivedAt?.getTime(),
            );
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });

        it("archiving a pre-archived list writes no activity at all", async () => {
            const { u, listId, client } = await setup({ archived: true });

            const res = await client.post(url(listId));

            expect(res.status).toBe(204);
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── Validation ─────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.post(url("l".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── Authentication ─────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http.post(url(listId));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http
                .post(url(listId))
                .set("Authorization", "Bearer not.a.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, listId } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .post(url(listId))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── Authorization (👑 owner/admin) ─────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to archive (204)`, async () => {
                const { listId, client } = await setup({ role });

                const res = await client.post(url(listId));

                expect(res.status).toBe(204);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403) and leaves the list active`, async () => {
                const { u, listId, client } = await setup({ role });

                const res = await client.post(url(listId));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await listRow(listId)).archivedAt).toBeNull();
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE resource existence (403, not 404, for a member on a missing id)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(url("l-nope"));

            expect(res.status).toBe(403);
        });
    });

    // ─── Not found ──────────────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 list.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.post(url("l-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    // ─── Tenant isolation ───────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 for a list in another workspace [IDOR] and leaves it active", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const listB = await insertList({
                spaceId: spaceB.id,
                createdBy: spaceB.createdBy,
            });
            const client = await makeLoggedInClient(userA);

            const res = await client.post(url(listB));

            expect(res.status).toBe(404);
            expect((await listRow(listB)).archivedAt).toBeNull();
        });
    });

    // ─── Concurrency ────────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("5 parallel archives of one list — all 204, exactly one activity row", async () => {
            const { u, listId, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () => client.post(url(listId))),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect((await listRow(listId)).archivedAt).not.toBeNull();
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("sends an X-Request-Id header on the 204", async () => {
            const { listId, client } = await setup();

            const res = await client.post(url(listId));

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for GET on the archive path", async () => {
            const { listId, client } = await setup();

            const res = await client.get(url(listId));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.post(
                url(encodeURIComponent("l-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });
});
