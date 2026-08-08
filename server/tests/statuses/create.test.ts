import jwt from "jsonwebtoken";
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
import { eq } from "drizzle-orm";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/lists/:listId/statuses` (§7 Statuses, endpoint #2).
 *
 * 👑 Owner/Admin only. Adds a status to a list the caller's workspace owns
 * (404 `list.not_found` otherwise), appended to the end of the workflow unless
 * `position` is supplied. A duplicate name in the list (`uq_statuses_scope_name`,
 * case-insensitive collation) → 409 `status.duplicate`. Returns 201 + the bare
 * `Status` wire object.
 *
 * Patterns mirror `tests/statuses/list.test.ts`: real DB writes, id-scoped
 * setup (no per-test truncate — see `setup-each-statuses.ts`), `oneOff()` for
 * stateless negatives.
 */

const PATH = (listId: string) => `/api/v1/lists/${listId}/statuses`;

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

let listSeq = 0;
const insertList = async (
    spaceId: string,
    createdBy: string,
    overrides: Partial<{ id: string; archivedAt: Date | null }> = {},
): Promise<string> => {
    const db = getDb();
    const id = overrides.id ?? fakeId("l");
    // F27 (ISS-035): list names are unique per SPACE now, and several specs
    // here put a second list in the same space to prove status scoping. The
    // name is irrelevant to what they test, so make it distinct.
    listSeq += 1;
    await db.insert(lists).values({
        id,
        spaceId,
        name: `Test List ${listSeq}`,
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

/** A workspace + user (role configurable) + logged-in client + one empty list. */
const setup = async (opts: { role?: Role } = {}) => {
    const ws = await makeWorkspace();
    const user = await makeUser({
        workspaceId: ws.id,
        role: opts.role ?? "owner",
    });
    const client = await makeLoggedInClient(user);
    const spaceId = await insertSpace(ws.id, user.id);
    const listId = await insertList(spaceId, user.id);
    return { ws, user, client, spaceId, listId };
};

// ─── count / fetch helpers ───────────────────────────────────────────────────

const countStatuses = async () =>
    (await getDb().select({ id: statuses.id }).from(statuses)).length;
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

const validBody = (over: Record<string, unknown> = {}) => ({
    name: "In Review",
    status_group: "active",
    ...over,
});

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/lists/:listId/statuses", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 201 and a bare Status object (no {data} envelope)", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send(validBody());

            expect(res.status).toBe(201);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("error");
            expect(Object.keys(res.body).sort()).toEqual(STATUS_KEYS);
        });

        it("returns the created status with the supplied field values", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "Blocked", color: "#F59E0B", position: 7 }));

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                scope_type: "list",
                scope_id: listId,
                name: "Blocked",
                color: "#F59E0B",
                status_group: "active",
                position: 7,
            });
            expect(typeof res.body.id).toBe("string");
            expect(res.body.id.length).toBeGreaterThan(0);
        });

        it("pins scope_type='list' and scope_id to the path listId", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.body.scope_type).toBe("list");
            expect(res.body.scope_id).toBe(listId);
        });

        it("defaults color to #94A3B8 when omitted", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.body.color).toBe("#94A3B8");
        });

        it("appends position 0 on the first status of an empty list", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.body.position).toBe(0);
        });

        it("appends to max+1 when the list already has statuses and no position is given", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { name: "A", position: 0 });
            await insertStatus(listId, { name: "B", position: 4 });

            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "C" }));
            expect(res.status).toBe(201);
            expect(res.body.position).toBe(5);
        });

        it("persists the row (a follow-up GET returns it)", async () => {
            const { client, listId } = await setup();
            const create = await client
                .post(PATH(listId))
                .send(validBody({ name: "Persisted" }));

            const list = await client.get(PATH(listId));
            const found = list.body.find(
                (s: { id: string }) => s.id === create.body.id,
            );
            expect(found).toBeDefined();
            expect(found.name).toBe("Persisted");
        });

        it("accepts each of the four status_group values", async () => {
            const { client, listId } = await setup();
            const groups: StatusGroup[] = [
                "not_started",
                "active",
                "done",
                "closed",
            ];
            for (const [i, g] of groups.entries()) {
                const res = await client
                    .post(PATH(listId))
                    .send(validBody({ name: `g-${g}`, status_group: g, position: i }));
                expect(res.status).toBe(201);
                expect(res.body.status_group).toBe(g);
            }
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 when name is missing", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send({ status_group: "active" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details.some((d: { field: string }) => d.field === "name")).toBe(true);
        });

        it("422 when name is empty / whitespace-only (trim)", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "   " }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when name exceeds 80 chars", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "x".repeat(81) }));
            expect(res.status).toBe(422);
            expect(res.body.error.details.some((d: { field: string }) => d.field === "name")).toBe(true);
        });

        it("accepts an exactly-80-char name (201)", async () => {
            const { client, listId } = await setup();
            const name = "y".repeat(80);
            const res = await client.post(PATH(listId)).send(validBody({ name }));
            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
        });

        it("422 when status_group is missing", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send({ name: "X" });
            expect(res.status).toBe(422);
            expect(res.body.error.details.some((d: { field: string }) => d.field === "status_group")).toBe(true);
        });

        it("422 when status_group is not a valid enum value", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ status_group: "in_progress" }));
            expect(res.status).toBe(422);
            expect(res.body.error.details.some((d: { field: string }) => d.field === "status_group")).toBe(true);
        });

        it("422 when color is not a #RRGGBB hex code", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ color: "red" }));
            expect(res.status).toBe(422);
            expect(res.body.error.details.some((d: { field: string }) => d.field === "color")).toBe(true);
        });

        it("422 for a 3-digit shorthand hex (#FFF)", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ color: "#FFF" }));
            expect(res.status).toBe(422);
        });

        it("accepts a lowercase hex color (201)", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ color: "#abcdef" }));
            expect(res.status).toBe(201);
            expect(res.body.color).toBe("#abcdef");
        });

        it("422 when position is negative", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ position: -1 }));
            expect(res.status).toBe(422);
            expect(res.body.error.details.some((d: { field: string }) => d.field === "position")).toBe(true);
        });

        it("422 when position is a non-integer", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ position: "abc" }));
            expect(res.status).toBe(422);
        });

        it("accepts position 0 explicitly (201)", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ position: 0 }));
            expect(res.status).toBe(201);
            expect(res.body.position).toBe(0);
        });

        it("422 when listId exceeds 64 chars", async () => {
            const { client } = await setup();
            const res = await client
                .post(PATH("a".repeat(65)))
                .send(validBody());
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("listId");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { listId } = await setup();
            const http = await oneOff();
            const res = await http.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage Bearer token", async () => {
            const { listId } = await setup();
            const http = await oneOff();
            const res = await http
                .post(PATH(listId))
                .set("Authorization", "Bearer not-a-jwt")
                .send(validBody());
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser();
            const { listId } = await setup();
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .post(PATH(listId))
                .set("Authorization", `Bearer ${expired}`)
                .send(validBody());
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("runs authentication before authorization (unauth → 401, not 403)", async () => {
            const { listId } = await setup();
            const http = await oneOff();
            const res = await http.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(401);
        });
    });

    // ─── d. Authorization (role tiers) ────────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (201)", async () => {
            const { client, listId } = await setup({ role: "owner" });
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(201);
        });

        it("allows an admin (201)", async () => {
            const { client, listId } = await setup({ role: "admin" });
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(201);
        });

        it("forbids a member (403 auth.forbidden)", async () => {
            const { client, listId } = await setup({ role: "member" });
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("forbids a guest (403 auth.forbidden)", async () => {
            const { client, listId } = await setup({ role: "guest" });
            const res = await client.post(PATH(listId)).send(validBody());
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("does not write a row when a member is forbidden", async () => {
            const { client, listId } = await setup({ role: "member" });
            const before = await countStatusesInList(listId);
            await client.post(PATH(listId)).send(validBody());
            expect(await countStatusesInList(listId)).toBe(before);
        });
    });

    // ─── e. Resource lifecycle / not-found ────────────────────────────────────
    describe("Lifecycle & not-found", () => {
        it("404 list.not_found for a non-existent listId", async () => {
            const { client } = await setup();
            const res = await client.post(PATH(fakeId("l"))).send(validBody());
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("does not write a row for a non-existent listId", async () => {
            const { client } = await setup();
            const before = await countStatuses();
            await client.post(PATH(fakeId("l"))).send(validBody());
            expect(await countStatuses()).toBe(before);
        });

        it("still accepts a status on an archived list (archive hides from listings, not direct writes)", async () => {
            // Documented default: §7 spec is silent on archived-list writes and
            // the list-archive cascade (baseline drift #9) is undecided. The
            // service resolves the list regardless of archived_at, mirroring how
            // GET still reads an archived list's statuses.
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const archived = await insertList(spaceId, user.id, {
                archivedAt: new Date(),
            });
            const res = await client.post(PATH(archived)).send(validBody());
            expect(res.status).toBe(201);
        });
    });

    // ─── f. Conflict (duplicate name) ─────────────────────────────────────────
    describe("Conflict", () => {
        it("409 status.duplicate on an exact duplicate name in the same list", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { name: "To Do", position: 0 });
            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "To Do" }));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.duplicate");
        });

        it("409 on a case-insensitive duplicate (utf8mb4_unicode_ci collation)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { name: "To Do", position: 0 });
            const res = await client
                .post(PATH(listId))
                .send(validBody({ name: "to do" }));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.duplicate");
        });

        it("allows the same name in a different list (scope differs → 201)", async () => {
            const { client, user, spaceId, listId } = await setup();
            await insertStatus(listId, { name: "Shared", position: 0 });
            const otherList = await insertList(spaceId, user.id);
            const res = await client
                .post(PATH(otherList))
                .send(validBody({ name: "Shared" }));
            expect(res.status).toBe(201);
        });

        it("does not add a second row on a duplicate (count unchanged)", async () => {
            const { client, listId } = await setup();
            await insertStatus(listId, { name: "Dup", position: 0 });
            const before = await countStatusesInList(listId);
            await client.post(PATH(listId)).send(validBody({ name: "Dup" }));
            expect(await countStatusesInList(listId)).toBe(before);
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Tenant isolation", () => {
        it("404 list.not_found when the list belongs to another workspace", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);

            const res = await a.client.post(PATH(listB)).send(validBody());
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("never writes into another workspace's list", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);

            await a.client.post(PATH(listB)).send(validBody());
            expect(await countStatusesInList(listB)).toBe(0);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel creates of the SAME name → one 201, one 409", async () => {
            const { client, listId } = await setup();
            const [a, b] = await Promise.all([
                client.post(PATH(listId)).send(validBody({ name: "Race" })),
                client.post(PATH(listId)).send(validBody({ name: "Race" })),
            ]);
            const codes = [a.status, b.status].sort();
            expect(codes).toEqual([201, 409]);
            expect(await countStatusesInList(listId)).toBe(1);
        });

        it("two parallel creates with different names and omitted position both succeed", async () => {
            const { client, listId } = await setup();
            const [a, b] = await Promise.all([
                client.post(PATH(listId)).send(validBody({ name: "P1" })),
                client.post(PATH(listId)).send(validBody({ name: "P2" })),
            ]);
            expect(a.status).toBe(201);
            expect(b.status).toBe(201);
            expect(await countStatusesInList(listId)).toBe(2);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode name (emoji + Bangla + RTL)", async () => {
            const { client, listId } = await setup();
            const name = "নতুন 🎉 مرحبا";
            const res = await client.post(PATH(listId)).send(validBody({ name }));
            expect(res.status).toBe(201);
            expect(res.body.name).toBe(name);
        });

        it("accepts a large position value", async () => {
            const { client, listId } = await setup();
            const res = await client
                .post(PATH(listId))
                .send(validBody({ position: 2_000_000_000 }));
            expect(res.status).toBe(201);
            expect(res.body.position).toBe(2_000_000_000);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("increments the statuses row count by exactly one", async () => {
            const { client, listId } = await setup();
            const before = await countStatuses();
            await client.post(PATH(listId)).send(validBody());
            expect(await countStatuses()).toBe(before + 1);
        });

        it("does not write task_activity rows", async () => {
            const { client, listId } = await setup();
            const before = await countTaskActivity();
            await client.post(PATH(listId)).send(validBody());
            expect(await countTaskActivity()).toBe(before);
        });

        it("does not write workspace_activity rows", async () => {
            const { client, listId } = await setup();
            const before = await countWorkspaceActivity();
            await client.post(PATH(listId)).send(validBody());
            expect(await countWorkspaceActivity()).toBe(before);
        });
    });

    // ─── m. Cleanup / mass-assignment hardening ───────────────────────────────
    describe("Mass-assignment & rollback", () => {
        it("ignores client-supplied id / scope_type / scope_id (mass-assignment guard)", async () => {
            const { client, listId } = await setup();
            const res = await client.post(PATH(listId)).send(
                validBody({
                    id: "evil-id",
                    scope_type: "space",
                    scope_id: "other-list",
                }),
            );
            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("evil-id");
            expect(res.body.scope_type).toBe("list");
            expect(res.body.scope_id).toBe(listId);
        });

        it("leaves no partial row after a validation failure", async () => {
            const { client, listId } = await setup();
            const before = await countStatusesInList(listId);
            await client.post(PATH(listId)).send({ status_group: "active" });
            expect(await countStatusesInList(listId)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on success", async () => {
            const { client, listId } = await setup();
            const rid = "rid-status-create-1";
            const res = await client
                .post(PATH(listId))
                .set("X-Request-Id", rid)
                .send(validBody());
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("treats a SQL-injection-style listId as a literal id (404, no 500)", async () => {
            const { client } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client.post(PATH(malicious)).send(validBody());
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });
});
