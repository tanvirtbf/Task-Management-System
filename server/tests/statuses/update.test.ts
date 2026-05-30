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
 * Tests for `PATCH /api/v1/statuses/:id` (§7 Statuses, endpoint #3).
 *
 * 👑 Owner/Admin only. Partial update of `name` / `color` / `status_group` (at
 * least one required → else 422). `position` / `scope_*` are NOT editable here.
 * The bare id is resolved within the caller's workspace via its list's space
 * (404 `status.not_found` otherwise) before the PK-keyed write. A name collision
 * with a sibling status (`uq_statuses_scope_name`) → 409 `status.duplicate`.
 * Returns 200 + the bare updated `Status`.
 */

const PATH = (id: string) => `/api/v1/statuses/${id}`;

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
 * A workspace + user (role configurable) + logged-in client + one list holding
 * one seeded status the caller can target.
 */
const setup = async (
    opts: { role?: Role; seed?: StatusSeed } = {},
) => {
    const ws = await makeWorkspace();
    const user = await makeUser({
        workspaceId: ws.id,
        role: opts.role ?? "owner",
    });
    const client = await makeLoggedInClient(user);
    const spaceId = await insertSpace(ws.id, user.id);
    const listId = await insertList(spaceId, user.id);
    const status = await insertStatus(listId, opts.seed ?? { name: "To Do" });
    return { ws, user, client, spaceId, listId, status };
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
const countStatuses = async () =>
    (await getDb().select({ id: statuses.id }).from(statuses)).length;
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
describe("PATCH /api/v1/statuses/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("updates name only and returns 200 with the new value", async () => {
            const { client, status } = await setup({ seed: { name: "Old", color: "#111111", statusGroup: "active" } });
            const res = await client.patch(PATH(status.id)).send({ name: "New" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("New");
            expect(res.body.color).toBe("#111111");
            expect(res.body.status_group).toBe("active");
        });

        it("updates color only", async () => {
            const { client, status } = await setup({ seed: { name: "Keep", color: "#111111" } });
            const res = await client.patch(PATH(status.id)).send({ color: "#22AA33" });
            expect(res.status).toBe(200);
            expect(res.body.color).toBe("#22AA33");
            expect(res.body.name).toBe("Keep");
        });

        it("updates status_group only", async () => {
            const { client, status } = await setup({ seed: { statusGroup: "active" } });
            const res = await client
                .patch(PATH(status.id))
                .send({ status_group: "done" });
            expect(res.status).toBe(200);
            expect(res.body.status_group).toBe("done");
        });

        it("updates all three fields at once", async () => {
            const { client, status } = await setup();
            const res = await client.patch(PATH(status.id)).send({
                name: "All",
                color: "#abcdef",
                status_group: "closed",
            });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                name: "All",
                color: "#abcdef",
                status_group: "closed",
            });
        });

        it("returns the bare Status wire shape (no envelope, no timestamps)", async () => {
            const { client, status } = await setup();
            const res = await client.patch(PATH(status.id)).send({ name: "Shape" });
            expect(Object.keys(res.body).sort()).toEqual(STATUS_KEYS);
        });

        it("leaves position unchanged (not editable via PATCH)", async () => {
            const { client, status } = await setup({ seed: { position: 3 } });
            const res = await client.patch(PATH(status.id)).send({ name: "X" });
            expect(res.body.position).toBe(3);
        });

        it("persists the change (a re-fetch reflects it)", async () => {
            const { client, status } = await setup();
            await client.patch(PATH(status.id)).send({ name: "Persisted" });
            const row = await fetchStatus(status.id);
            expect(row.name).toBe("Persisted");
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 validation.failed when the body is empty (no updatable field)", async () => {
            const { client, status } = await setup();
            const res = await client.patch(PATH(status.id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when only a non-updatable field (position) is supplied", async () => {
            const { client, status } = await setup({ seed: { position: 2 } });
            const res = await client.patch(PATH(status.id)).send({ position: 9 });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            const row = await fetchStatus(status.id);
            expect(row.position).toBe(2);
        });

        it("422 when name is an empty string", async () => {
            const { client, status } = await setup();
            const res = await client.patch(PATH(status.id)).send({ name: "  " });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when name exceeds 80 chars", async () => {
            const { client, status } = await setup();
            const res = await client
                .patch(PATH(status.id))
                .send({ name: "z".repeat(81) });
            expect(res.status).toBe(422);
        });

        it("422 when status_group is not a valid enum value", async () => {
            const { client, status } = await setup();
            const res = await client
                .patch(PATH(status.id))
                .send({ status_group: "wip" });
            expect(res.status).toBe(422);
        });

        it("422 when color is not a #RRGGBB hex code", async () => {
            const { client, status } = await setup();
            const res = await client
                .patch(PATH(status.id))
                .send({ color: "blue" });
            expect(res.status).toBe(422);
        });

        it("422 when id exceeds 64 chars", async () => {
            const { client } = await setup();
            const res = await client
                .patch(PATH("a".repeat(65)))
                .send({ name: "X" });
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("id");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { status } = await setup();
            const http = await oneOff();
            const res = await http.patch(PATH(status.id)).send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage Bearer token", async () => {
            const { status } = await setup();
            const http = await oneOff();
            const res = await http
                .patch(PATH(status.id))
                .set("Authorization", "Bearer not-a-jwt")
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { status } = await setup();
            const u = await makeUser();
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .patch(PATH(status.id))
                .set("Authorization", `Bearer ${expired}`)
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (200)", async () => {
            const { client, status } = await setup({ role: "owner" });
            const res = await client.patch(PATH(status.id)).send({ name: "O" });
            expect(res.status).toBe(200);
        });

        it("allows an admin (200)", async () => {
            const { client, status } = await setup({ role: "admin" });
            const res = await client.patch(PATH(status.id)).send({ name: "A" });
            expect(res.status).toBe(200);
        });

        it("forbids a member (403 auth.forbidden)", async () => {
            const { client, status } = await setup({ role: "member" });
            const res = await client.patch(PATH(status.id)).send({ name: "M" });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("forbids a guest (403 auth.forbidden)", async () => {
            const { client, status } = await setup({ role: "guest" });
            const res = await client.patch(PATH(status.id)).send({ name: "G" });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("does not mutate the row when a member is forbidden", async () => {
            const { client, status } = await setup({
                role: "member",
                seed: { name: "Original" },
            });
            await client.patch(PATH(status.id)).send({ name: "Hacked" });
            const row = await fetchStatus(status.id);
            expect(row.name).toBe("Original");
        });
    });

    // ─── e. Lifecycle / not-found ─────────────────────────────────────────────
    describe("Lifecycle & not-found", () => {
        it("404 status.not_found for a non-existent id", async () => {
            const { client } = await setup();
            const res = await client
                .patch(PATH(fakeId("s")))
                .send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });

        it("updates a status that lives under an archived list", async () => {
            // Mirrors POST/GET: an archived list still owns its workflow rows.
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const archived = await insertList(spaceId, user.id, {
                archivedAt: new Date(),
            });
            const st = await insertStatus(archived, { name: "Old" });
            const res = await client.patch(PATH(st.id)).send({ name: "New" });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("New");
        });
    });

    // ─── f. Conflict (duplicate name) ─────────────────────────────────────────
    describe("Conflict", () => {
        it("409 status.duplicate when renaming onto a sibling's name", async () => {
            const { client, listId, status } = await setup({
                seed: { name: "To Do", position: 0 },
            });
            await insertStatus(listId, { name: "In Progress", position: 1 });
            const res = await client
                .patch(PATH(status.id))
                .send({ name: "In Progress" });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.duplicate");
        });

        it("409 on a case-insensitive collision (utf8mb4_unicode_ci)", async () => {
            const { client, listId, status } = await setup({
                seed: { name: "To Do", position: 0 },
            });
            await insertStatus(listId, { name: "Done", position: 1 });
            const res = await client
                .patch(PATH(status.id))
                .send({ name: "done" });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.duplicate");
        });

        it("allows renaming a status to its own current name (no-op, 200)", async () => {
            const { client, status } = await setup({ seed: { name: "Same" } });
            const res = await client
                .patch(PATH(status.id))
                .send({ name: "Same" });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Same");
        });

        it("allows the same name as a status in a DIFFERENT list (200)", async () => {
            const { client, user, spaceId, status } = await setup({
                seed: { name: "Mine" },
            });
            const otherList = await insertList(spaceId, user.id);
            await insertStatus(otherList, { name: "Theirs" });
            const res = await client
                .patch(PATH(status.id))
                .send({ name: "Theirs" });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Theirs");
        });

        it("leaves the row unchanged after a 409 (rollback)", async () => {
            const { client, listId, status } = await setup({
                seed: { name: "To Do", position: 0 },
            });
            await insertStatus(listId, { name: "Busy", position: 1 });
            await client.patch(PATH(status.id)).send({ name: "Busy" });
            const row = await fetchStatus(status.id);
            expect(row.name).toBe("To Do");
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("404 status.not_found when the status belongs to another workspace", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            const stB = await insertStatus(listB, { name: "secret-b" });

            const res = await a.client.patch(PATH(stB.id)).send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });

        it("never mutates another workspace's status", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id, role: "owner" });
            const spaceB = await insertSpace(wsB.id, userB.id);
            const listB = await insertList(spaceB, userB.id);
            const stB = await insertStatus(listB, { name: "untouched-b" });

            await a.client.patch(PATH(stB.id)).send({ name: "X" });
            const row = await fetchStatus(stB.id);
            expect(row.name).toBe("untouched-b");
        });
    });

    // ─── h. Idempotency ───────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("applying the same PATCH twice yields the same result", async () => {
            const { client, status } = await setup();
            const a = await client.patch(PATH(status.id)).send({ name: "Same", color: "#123456" });
            const b = await client.patch(PATH(status.id)).send({ name: "Same", color: "#123456" });
            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect(a.body).toEqual(b.body);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel PATCHes of different fields leave a consistent row", async () => {
            const { client, status } = await setup({ seed: { name: "Base", color: "#111111", statusGroup: "active" } });
            const [a, b] = await Promise.all([
                client.patch(PATH(status.id)).send({ name: "Renamed" }),
                client.patch(PATH(status.id)).send({ color: "#999999" }),
            ]);
            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            const row = await fetchStatus(status.id);
            expect(row.name).toBe("Renamed");
            expect(row.color).toBe("#999999");
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts an exactly-80-char name", async () => {
            const { client, status } = await setup();
            const name = "w".repeat(80);
            const res = await client.patch(PATH(status.id)).send({ name });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });

        it("round-trips a unicode name (emoji + Bangla + RTL)", async () => {
            const { client, status } = await setup();
            const name = "সম্পন্ন ✅ مرحبا";
            const res = await client.patch(PATH(status.id)).send({ name });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("does not change the statuses row count", async () => {
            const { client, status } = await setup();
            const before = await countStatuses();
            await client.patch(PATH(status.id)).send({ name: "Z" });
            expect(await countStatuses()).toBe(before);
        });

        it("does not write task_activity or workspace_activity rows", async () => {
            const { client, status } = await setup();
            const a = await countTaskActivity();
            const w = await countWorkspaceActivity();
            await client.patch(PATH(status.id)).send({ name: "Z" });
            expect(await countTaskActivity()).toBe(a);
            expect(await countWorkspaceActivity()).toBe(w);
        });

        it("does not touch a sibling status in the same list", async () => {
            const { client, listId, status } = await setup({
                seed: { name: "Target", position: 0 },
            });
            const sibling = await insertStatus(listId, {
                name: "Sibling",
                position: 1,
            });
            await client.patch(PATH(status.id)).send({ name: "Changed" });
            const row = await fetchStatus(sibling.id);
            expect(row.name).toBe("Sibling");
        });
    });

    // ─── m. Mass-assignment hardening ─────────────────────────────────────────
    describe("Mass-assignment", () => {
        it("ignores scope_type / scope_id / id in the body", async () => {
            const { client, listId, status } = await setup();
            const res = await client.patch(PATH(status.id)).send({
                name: "Safe",
                scope_type: "space",
                scope_id: "elsewhere",
                id: "evil",
            });
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(status.id);
            expect(res.body.scope_type).toBe("list");
            expect(res.body.scope_id).toBe(listId);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on success", async () => {
            const { client, status } = await setup();
            const rid = "rid-status-update-1";
            const res = await client
                .patch(PATH(status.id))
                .set("X-Request-Id", rid)
                .send({ name: "R" });
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("treats a SQL-injection-style id as a literal id (404, no 500)", async () => {
            const { client } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client.patch(PATH(malicious)).send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });
    });
});
