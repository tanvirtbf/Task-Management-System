import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSpace,
    makeStatus,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, statuses, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `DELETE /api/v1/lists/:id` (§6 Lists #8).
 *
 * Runs on the private no-truncate `tms_lists_test` DB (id-scoped assertions).
 * 🛡️ OWNER only (admin is NOT enough). Hard-deletes a list that is archived AND
 * empty; tears down its list-scoped statuses, records one `deleted` activity
 * row. Returns 204.
 */

const url = (id: string): string => `/api/v1/lists/${id}`;

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
    return row ?? null;
};

const statusCount = async (listId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: statuses.id })
            .from(statuses)
            .where(and(eq(statuses.scopeType, "list"), eq(statuses.scopeId, listId)))
    ).length;
};

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

/** A user + space + an archived (by default) list + a logged-in client. */
const setup = async (
    opts: { role?: Role; archived?: boolean } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const space = await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
    const listId = await insertList({
        spaceId: space.id,
        createdBy: u.id,
        archivedAt: opts.archived === false ? null : new Date(),
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
describe("DELETE /api/v1/lists/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("deletes an archived empty list and returns 204 with an empty body", async () => {
            const { listId, client } = await setup();

            const res = await client.delete(url(listId));

            expect(res.status).toBe(204);
            expect(res.text).toBe("");
            expect(await listRow(listId)).toBeNull();
        });

        it("tears down the list's list-scoped statuses", async () => {
            const { listId, client } = await setup();
            await makeStatus({ scopeId: listId });
            await makeStatus({ scopeId: listId });
            expect(await statusCount(listId)).toBe(2);

            await client.delete(url(listId));

            expect(await statusCount(listId)).toBe(0);
        });

        it("makes a follow-up GET /lists/:id return 404", async () => {
            const { listId, client } = await setup();

            await client.delete(url(listId));
            const res = await client.get(url(listId));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    // ─── Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (list/deleted) with context", async () => {
            const { u, space, listId, client } = await setup();

            await client.delete(url(listId));
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("list");
            expect(rows[0].entityId).toBe(listId);
            expect(rows[0].action).toBe("deleted");
            expect(rows[0].actorId).toBe(u.id);
            expect(rows[0].context).toMatchObject({ space_id: space.id });
        });
    });

    // ─── Validation ─────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.delete(url("l".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── Authentication ─────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http.delete(url(listId));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
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
                .delete(url(listId))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── Authorization (🛡️ OWNER only — admin is NOT enough) ─────────────────
    describe("Authorization", () => {
        it("allows an owner to delete (204)", async () => {
            const { listId, client } = await setup({ role: "owner" });

            const res = await client.delete(url(listId));

            expect(res.status).toBe(204);
        });

        for (const role of ["admin", "member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and keeps the list`, async () => {
                const { u, listId, client } = await setup({ role });

                const res = await client.delete(url(listId));

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await listRow(listId)).not.toBeNull();
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE resource existence (403, not 404, for an admin on a missing id)", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(url("l-nope"));

            expect(res.status).toBe(403);
        });
    });

    // ─── Preconditions: not-found / not-archived / not-empty ────────────────
    describe("Preconditions", () => {
        it("returns 404 list.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.delete(url("l-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 409 list.not_archived for an active (non-archived) list", async () => {
            const { u, listId, client } = await setup({ archived: false });

            const res = await client.delete(url(listId));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.not_archived");
            expect(await listRow(listId)).not.toBeNull();
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });

        it("returns 409 list.not_empty for an archived list with a live task", async () => {
            const { u, listId, client } = await setup();
            await makeTask({ workspaceId: u.workspaceId, listId });

            const res = await client.delete(url(listId));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.not_empty");
            expect(await listRow(listId)).not.toBeNull();
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });

        it("returns 409 list.not_empty even when the only task is itself archived (FK RESTRICT)", async () => {
            const { u, listId, client } = await setup();
            await makeTask({
                workspaceId: u.workspaceId,
                listId,
                archivedAt: new Date(),
            });

            const res = await client.delete(url(listId));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.not_empty");
            expect(await listRow(listId)).not.toBeNull();
        });

        it("does not tear down statuses when the delete is refused (not_empty)", async () => {
            const { u, listId, client } = await setup();
            // makeTask seeds a status in the list; capture the count so we can
            // assert the refused delete left the statuses untouched.
            await makeTask({ workspaceId: u.workspaceId, listId });
            const before = await statusCount(listId);

            await client.delete(url(listId));

            expect(await statusCount(listId)).toBe(before);
        });
    });

    // ─── Tenant isolation ───────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 for an archived empty list in another workspace [IDOR] and keeps it", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const listB = await insertList({
                spaceId: spaceB.id,
                createdBy: spaceB.createdBy,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(userA);

            const res = await client.delete(url(listB));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
            expect(await listRow(listB)).not.toBeNull();
        });
    });

    // ─── Concurrency ────────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("5 parallel deletes — all 204/404, exactly one activity row, list gone", async () => {
            const { u, listId, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () => client.delete(url(listId))),
            );

            for (const r of results) expect([204, 404]).toContain(r.status);
            expect(results.some((r) => r.status === 204)).toBe(true);
            expect(await listRow(listId)).toBeNull();
            expect(await activityRows(u.workspaceId)).toHaveLength(1);
        });
    });

    // ─── Cross-cutting & exploratory ────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("sends an X-Request-Id header on the 204", async () => {
            const { listId, client } = await setup();

            const res = await client.delete(url(listId));

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for PUT on the same path", async () => {
            const { listId, client } = await setup();

            const res = await client.put(url(listId)).send({ name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.delete(
                url(encodeURIComponent("l-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });
});
