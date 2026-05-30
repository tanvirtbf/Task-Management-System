import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    spaces,
    lists,
    statuses,
    taskActivity,
    workspaceActivity,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/lists/:listId/statuses/reorder` (§7 Statuses, #5).
 *
 * 👑 Owner/Admin only. Bulk-repositions a list's statuses from a bare JSON array
 * of `{ id, position }` items, in one transaction. 404 `list.not_found` if the
 * list is missing/cross-workspace; 404 `status.not_found` if any id is not a
 * status in this list (whole batch rolls back). Returns 200 with the full list
 * reordered (GET shape). Partial subsets are allowed; unlisted statuses keep
 * their position.
 */

const PATH = (listId: string) =>
    `/api/v1/lists/${listId}/statuses/reorder`;

type StatusGroup = "not_started" | "active" | "done" | "closed";

// ─── local seed helpers (real DB inserts) ────────────────────────────────────

const insertSpace = async (
    workspaceId: string,
    createdBy: string,
    overrides: Partial<{ id: string; archivedAt: Date | null }> = {},
): Promise<string> => {
    const db = getDb();
    const id = overrides.id ?? fakeId("sp");
    await db.insert(spaces).values({
        id,
        workspaceId,
        name: "Test Space",
        createdBy,
        archivedAt: overrides.archivedAt ?? null,
    });
    return id;
};

const insertList = async (
    spaceId: string,
    createdBy: string,
    overrides: Partial<{ id: string; archivedAt: Date | null }> = {},
): Promise<string> => {
    const db = getDb();
    const id = overrides.id ?? fakeId("l");
    await db.insert(lists).values({
        id,
        spaceId,
        name: "Test List",
        createdBy,
        archivedAt: overrides.archivedAt ?? null,
    });
    return id;
};

interface StatusSeed {
    id?: string;
    name?: string;
    color?: string;
    statusGroup?: StatusGroup;
    position?: number;
    scopeType?: "list" | "space";
}

let _statusSeq = 0;

const insertStatus = async (
    listId: string,
    seed: StatusSeed = {},
): Promise<{ id: string; name: string }> => {
    const db = getDb();
    const id = seed.id ?? fakeId("s");
    const name = seed.name ?? `Seed ${++_statusSeq}`;
    await db.insert(statuses).values({
        id,
        scopeType: seed.scopeType ?? "list",
        scopeId: listId,
        name,
        color: seed.color ?? "#94A3B8",
        statusGroup: seed.statusGroup ?? "active",
        position: seed.position ?? 0,
    });
    return { id, name };
};

/**
 * A workspace + user + client + one list seeded with three statuses at
 * positions 0/1/2 (`s0`, `s1`, `s2`).
 */
const setup = async (opts: { role?: Role } = {}) => {
    const ws = await makeWorkspace();
    const user = await makeUser({
        workspaceId: ws.id,
        role: opts.role ?? "owner",
    });
    const client = await makeLoggedInClient(user);
    const spaceId = await insertSpace(ws.id, user.id);
    const listId = await insertList(spaceId, user.id);
    const s0 = await insertStatus(listId, {
        name: "S0",
        statusGroup: "not_started",
        position: 0,
    });
    const s1 = await insertStatus(listId, {
        name: "S1",
        statusGroup: "active",
        position: 1,
    });
    const s2 = await insertStatus(listId, {
        name: "S2",
        statusGroup: "done",
        position: 2,
    });
    return { ws, user, client, spaceId, listId, s0, s1, s2 };
};

// ─── fetch / count helpers ───────────────────────────────────────────────────

const fetchStatus = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(statuses)
        .where(eq(statuses.id, id))
        .limit(1);
    return row;
};
const positionOf = async (id: string) => (await fetchStatus(id)).position;
const countStatusesInList = async (listId: string) =>
    (
        await getDb()
            .select({ id: statuses.id })
            .from(statuses)
            .where(eq(statuses.scopeId, listId))
    ).length;
const countTaskActivity = async () =>
    (await getDb().select({ id: taskActivity.id }).from(taskActivity)).length;
const countWorkspaceActivity = async () =>
    (await getDb().select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;

const STATUS_KEYS = [
    "color",
    "id",
    "name",
    "position",
    "scope_id",
    "scope_type",
    "status_group",
];

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/lists/:listId/statuses/reorder", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("reorders the full set and returns 200 with the new order", async () => {
            const { client, listId, s0, s1, s2 } = await setup();
            const res = await client.patch(PATH(listId)).send([
                { id: s0.id, position: 2 },
                { id: s1.id, position: 0 },
                { id: s2.id, position: 1 },
            ]);

            expect(res.status).toBe(200);
            expect(res.body.map((s: { id: string }) => s.id)).toEqual([
                s1.id,
                s2.id,
                s0.id,
            ]);
            expect(res.body.map((s: { position: number }) => s.position)).toEqual([
                0, 1, 2,
            ]);
        });

        it("persists the new positions", async () => {
            const { client, listId, s0, s1, s2 } = await setup();
            await client.patch(PATH(listId)).send([
                { id: s0.id, position: 2 },
                { id: s1.id, position: 0 },
                { id: s2.id, position: 1 },
            ]);
            expect(await positionOf(s0.id)).toBe(2);
            expect(await positionOf(s1.id)).toBe(0);
            expect(await positionOf(s2.id)).toBe(1);
        });

        it("returns the full list (every status), as a bare array in GET shape", async () => {
            const { client, listId, s1 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s1.id, position: 0 }]);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).toHaveLength(3);
            expect(Object.keys(res.body[0]).sort()).toEqual(STATUS_KEYS);
        });

        it("accepts a partial subset — unlisted statuses keep their position", async () => {
            const { client, listId, s0, s2 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s2.id, position: 0 }]);
            expect(res.status).toBe(200);
            expect(await positionOf(s2.id)).toBe(0);
            expect(await positionOf(s0.id)).toBe(0); // unchanged
        });

        it("accepts a single-item array", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 9 }]);
            expect(res.status).toBe(200);
            expect(await positionOf(s0.id)).toBe(9);
        });

        it("allows duplicate target positions (read path tie-breaks by id)", async () => {
            const { client, listId, s0, s1 } = await setup();
            const res = await client.patch(PATH(listId)).send([
                { id: s0.id, position: 5 },
                { id: s1.id, position: 5 },
            ]);
            expect(res.status).toBe(200);
            expect(await positionOf(s0.id)).toBe(5);
            expect(await positionOf(s1.id)).toBe(5);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 when the body is an object, not an array", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send({ id: s0.id, position: 0 });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when the body is an empty array", async () => {
            const { client, listId } = await setup();
            const res = await client.patch(PATH(listId)).send([]);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when an item is missing id", async () => {
            const { client, listId } = await setup();
            const res = await client.patch(PATH(listId)).send([{ position: 0 }]);
            expect(res.status).toBe(422);
        });

        it("422 when an item is missing position", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client.patch(PATH(listId)).send([{ id: s0.id }]);
            expect(res.status).toBe(422);
        });

        it("422 when an item id is not a string", async () => {
            const { client, listId } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: 123, position: 0 }]);
            expect(res.status).toBe(422);
        });

        it("422 when an item id exceeds 64 chars", async () => {
            const { client, listId } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: "a".repeat(65), position: 0 }]);
            expect(res.status).toBe(422);
        });

        it("422 when a position is negative", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: -1 }]);
            expect(res.status).toBe(422);
        });

        it("422 when a position is a non-integer float", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 1.5 }]);
            expect(res.status).toBe(422);
        });

        it("422 when a position is a numeric string (strict)", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: "0" }]);
            expect(res.status).toBe(422);
        });

        it("422 on duplicate ids in the batch", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client.patch(PATH(listId)).send([
                { id: s0.id, position: 0 },
                { id: s0.id, position: 1 },
            ]);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when listId exceeds 64 chars", async () => {
            const { client, s0 } = await setup();
            const res = await client
                .patch(PATH("a".repeat(65)))
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("listId");
        });

        it("does not write any position on a validation failure", async () => {
            const { client, listId, s0 } = await setup();
            await client.patch(PATH(listId)).send([{ id: s0.id, position: -5 }]);
            expect(await positionOf(s0.id)).toBe(0);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { listId, s0 } = await setup();
            const http = await oneOff();
            const res = await http
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage Bearer token", async () => {
            const { listId, s0 } = await setup();
            const http = await oneOff();
            const res = await http
                .patch(PATH(listId))
                .set("Authorization", "Bearer not-a-jwt")
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { listId, s0 } = await setup();
            const u = await makeUser();
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .patch(PATH(listId))
                .set("Authorization", `Bearer ${expired}`)
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (200)", async () => {
            const { client, listId, s0 } = await setup({ role: "owner" });
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 1 }]);
            expect(res.status).toBe(200);
        });

        it("allows an admin (200)", async () => {
            const { client, listId, s0 } = await setup({ role: "admin" });
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 1 }]);
            expect(res.status).toBe(200);
        });

        it("forbids a member (403 auth.forbidden)", async () => {
            const { client, listId, s0 } = await setup({ role: "member" });
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 1 }]);
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("forbids a guest (403 auth.forbidden)", async () => {
            const { client, listId, s0 } = await setup({ role: "guest" });
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 1 }]);
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("does not reorder when a member is forbidden", async () => {
            const { client, listId, s0 } = await setup({ role: "member" });
            await client.patch(PATH(listId)).send([{ id: s0.id, position: 9 }]);
            expect(await positionOf(s0.id)).toBe(0);
        });
    });

    // ─── e. Lifecycle / not-found & atomicity ─────────────────────────────────
    describe("Lifecycle & not-found", () => {
        it("404 list.not_found for a non-existent listId", async () => {
            const { client, s0 } = await setup();
            const res = await client
                .patch(PATH(fakeId("l")))
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("404 status.not_found when an id is not in the list", async () => {
            const { client, listId } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: fakeId("s"), position: 0 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });

        it("404 status.not_found for a status id from another list (no cross-list move)", async () => {
            const { client, listId, user, spaceId } = await setup();
            const otherList = await insertList(spaceId, user.id);
            const foreign = await insertStatus(otherList, { name: "X", position: 0 });
            const res = await client
                .patch(PATH(listId))
                .send([{ id: foreign.id, position: 0 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
            expect(await positionOf(foreign.id)).toBe(0); // untouched
        });

        it("rolls back the WHOLE batch when one id is invalid (atomicity)", async () => {
            const { client, listId, s0, s1 } = await setup();
            const res = await client.patch(PATH(listId)).send([
                { id: s0.id, position: 7 }, // valid
                { id: fakeId("s"), position: 8 }, // invalid → aborts everything
            ]);
            expect(res.status).toBe(404);
            // s0 must NOT have been moved — no partial reorder.
            expect(await positionOf(s0.id)).toBe(0);
            expect(await positionOf(s1.id)).toBe(1);
        });

        it("reorders statuses under an archived list (200)", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const archived = await insertList(spaceId, user.id, {
                archivedAt: new Date(),
            });
            const a = await insertStatus(archived, { name: "A", position: 0 });
            const res = await client
                .patch(PATH(archived))
                .send([{ id: a.id, position: 3 }]);
            expect(res.status).toBe(200);
            expect(await positionOf(a.id)).toBe(3);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("404 list.not_found when the list belongs to another workspace", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            const stB = await insertStatus(listB, { name: "B", position: 0 });

            const res = await a.client
                .patch(PATH(listB))
                .send([{ id: stB.id, position: 1 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
            expect(await positionOf(stB.id)).toBe(0);
        });

        it("404 status.not_found for a status id from another workspace", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            const stB = await insertStatus(listB, { name: "B", position: 0 });

            // Caller targets THEIR own list but references workspace B's status id.
            const res = await a.client
                .patch(PATH(a.listId))
                .send([{ id: stB.id, position: 1 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
            expect(await positionOf(stB.id)).toBe(0);
        });
    });

    // ─── h/i. Idempotency & concurrency ───────────────────────────────────────
    describe("Idempotency & concurrency", () => {
        it("applying the same reorder twice yields the same order", async () => {
            const { client, listId, s0, s1, s2 } = await setup();
            const batch = [
                { id: s0.id, position: 2 },
                { id: s1.id, position: 0 },
                { id: s2.id, position: 1 },
            ];
            const a = await client.patch(PATH(listId)).send(batch);
            const b = await client.patch(PATH(listId)).send(batch);
            expect(a.body.map((s: { id: string }) => s.id)).toEqual(
                b.body.map((s: { id: string }) => s.id),
            );
        });

        it("two parallel reorders of the same list both succeed and keep all rows", async () => {
            const { client, listId, s0, s1, s2 } = await setup();
            const [r1, r2] = await Promise.all([
                client.patch(PATH(listId)).send([
                    { id: s0.id, position: 0 },
                    { id: s1.id, position: 1 },
                    { id: s2.id, position: 2 },
                ]),
                client.patch(PATH(listId)).send([
                    { id: s0.id, position: 2 },
                    { id: s1.id, position: 1 },
                    { id: s2.id, position: 0 },
                ]),
            ]);
            expect(r1.status).toBe(200);
            expect(r2.status).toBe(200);
            expect(await countStatusesInList(listId)).toBe(3);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a large position value", async () => {
            const { client, listId, s0 } = await setup();
            const res = await client
                .patch(PATH(listId))
                .send([{ id: s0.id, position: 2_000_000_000 }]);
            expect(res.status).toBe(200);
            expect(await positionOf(s0.id)).toBe(2_000_000_000);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("does not change the list's status count", async () => {
            const { client, listId, s0 } = await setup();
            const before = await countStatusesInList(listId);
            await client.patch(PATH(listId)).send([{ id: s0.id, position: 1 }]);
            expect(await countStatusesInList(listId)).toBe(before);
        });

        it("writes no task_activity or workspace_activity rows", async () => {
            const { client, listId, s0 } = await setup();
            const a = await countTaskActivity();
            const w = await countWorkspaceActivity();
            await client.patch(PATH(listId)).send([{ id: s0.id, position: 1 }]);
            expect(await countTaskActivity()).toBe(a);
            expect(await countWorkspaceActivity()).toBe(w);
        });

        it("changes only position — name / color / status_group are untouched", async () => {
            const { client, listId, s0 } = await setup();
            const before = await fetchStatus(s0.id);
            await client.patch(PATH(listId)).send([{ id: s0.id, position: 8 }]);
            const after = await fetchStatus(s0.id);
            expect(after.name).toBe(before.name);
            expect(after.color).toBe(before.color);
            expect(after.statusGroup).toBe(before.statusGroup);
            expect(after.position).toBe(8);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on success", async () => {
            const { client, listId, s0 } = await setup();
            const rid = "rid-status-reorder-1";
            const res = await client
                .patch(PATH(listId))
                .set("X-Request-Id", rid)
                .send([{ id: s0.id, position: 1 }]);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("treats a SQL-injection-style listId as a literal id (404, no 500)", async () => {
            const { client, s0 } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client
                .patch(PATH(malicious))
                .send([{ id: s0.id, position: 0 }]);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });
});
