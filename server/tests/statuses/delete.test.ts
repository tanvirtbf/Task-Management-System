import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
    makeTask,
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
 * Tests for `DELETE /api/v1/statuses/:id` (§7 Statuses, endpoint #4).
 *
 * 👑 Owner/Admin only. Deletes a status the caller's workspace owns (404
 * `status.not_found` otherwise). Refuses with `409 status.in_use` if any task
 * references it, and `422 status.last_in_group` if it is the last status of its
 * group (the Board view needs ≥1 status per group). Precedence: in_use (409)
 * before last_in_group (422). Returns 204 No Content on success.
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
 * A workspace + user + logged-in client + one list pre-seeded with two statuses
 * in the `active` group (`a` is the deletion target — removing it never trips
 * the last-in-group guard). Override the role to test authorization.
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
    const a = await insertStatus(listId, {
        name: "Active A",
        statusGroup: "active",
        position: 0,
    });
    const b = await insertStatus(listId, {
        name: "Active B",
        statusGroup: "active",
        position: 1,
    });
    return { ws, user, client, spaceId, listId, target: a, sibling: b };
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

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/statuses/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for a non-last, unreferenced status", async () => {
            const { client, target } = await setup();
            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("actually removes the row from the database", async () => {
            const { client, target } = await setup();
            await client.delete(PATH(target.id));
            expect(await fetchStatus(target.id)).toBeUndefined();
        });

        it("leaves sibling statuses in the list intact", async () => {
            const { client, listId, target, sibling } = await setup();
            const c = await insertStatus(listId, {
                name: "Done C",
                statusGroup: "done",
                position: 2,
            });
            await client.delete(PATH(target.id));
            expect(await fetchStatus(sibling.id)).toBeDefined();
            expect(await fetchStatus(c.id)).toBeDefined();
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 when id exceeds 64 chars", async () => {
            const { client } = await setup();
            const res = await client.delete(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details[0].field).toBe("id");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { target } = await setup();
            const http = await oneOff();
            const res = await http.delete(PATH(target.id));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage Bearer token", async () => {
            const { target } = await setup();
            const http = await oneOff();
            const res = await http
                .delete(PATH(target.id))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { target } = await setup();
            const u = await makeUser();
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .delete(PATH(target.id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (204)", async () => {
            const { client, target } = await setup({ role: "owner" });
            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(204);
        });

        it("allows an admin (204)", async () => {
            const { client, target } = await setup({ role: "admin" });
            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(204);
        });

        it("forbids a member (403 auth.forbidden)", async () => {
            const { client, target } = await setup({ role: "member" });
            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("forbids a guest (403 auth.forbidden)", async () => {
            const { client, target } = await setup({ role: "guest" });
            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("does not delete the row when a member is forbidden", async () => {
            const { client, target } = await setup({ role: "member" });
            await client.delete(PATH(target.id));
            expect(await fetchStatus(target.id)).toBeDefined();
        });
    });

    // ─── e. Lifecycle / not-found ─────────────────────────────────────────────
    describe("Lifecycle & not-found", () => {
        it("404 status.not_found for a non-existent id", async () => {
            const { client } = await setup();
            const res = await client.delete(PATH(fakeId("s")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });

        it("deletes a status under an archived list (when not last-in-group / in-use)", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const archived = await insertList(spaceId, user.id, {
                archivedAt: new Date(),
            });
            const a = await insertStatus(archived, {
                name: "A",
                statusGroup: "active",
                position: 0,
            });
            await insertStatus(archived, {
                name: "B",
                statusGroup: "active",
                position: 1,
            });
            const res = await client.delete(PATH(a.id));
            expect(res.status).toBe(204);
        });
    });

    // ─── f. Conflict: status.in_use (409) ─────────────────────────────────────
    describe("Conflict — status.in_use", () => {
        it("409 status.in_use when a task references the status", async () => {
            const { client, listId, target } = await setup();
            const ws = await makeWorkspace(); // task needs a workspace_id
            // Tie the task to the SAME list + status under test.
            const owner = await makeUser({ workspaceId: ws.id });
            await makeTask({
                workspaceId: ws.id,
                listId,
                statusId: target.id,
                createdBy: owner.id,
            });

            const res = await client.delete(PATH(target.id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.in_use");
        });

        it("does not delete the row on a 409 in_use", async () => {
            const { client, listId, target } = await setup();
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id });
            await makeTask({
                workspaceId: ws.id,
                listId,
                statusId: target.id,
                createdBy: owner.id,
            });

            await client.delete(PATH(target.id));
            expect(await fetchStatus(target.id)).toBeDefined();
        });

        it("in_use (409) takes precedence over last_in_group (422)", async () => {
            // A status that is BOTH the only one in its group AND referenced by a
            // task must surface 409, not 422 (documented precedence).
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            const sole = await insertStatus(listId, {
                name: "Sole Closed",
                statusGroup: "closed",
                position: 0,
            });
            await makeTask({
                workspaceId: ws.id,
                listId,
                statusId: sole.id,
                createdBy: user.id,
            });

            const res = await client.delete(PATH(sole.id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("status.in_use");
        });
    });

    // ─── (e/spec). 422 status.last_in_group ───────────────────────────────────
    describe("Last-in-group — status.last_in_group", () => {
        it("422 status.last_in_group when deleting the only status of its group", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            const sole = await insertStatus(listId, {
                name: "Sole Done",
                statusGroup: "done",
                position: 0,
            });
            // a different-group status so the list is not empty otherwise
            await insertStatus(listId, {
                name: "Active",
                statusGroup: "active",
                position: 1,
            });

            const res = await client.delete(PATH(sole.id));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("status.last_in_group");
        });

        it("does not delete the row on a 422 last_in_group", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            const sole = await insertStatus(listId, {
                name: "Sole Done",
                statusGroup: "done",
                position: 0,
            });
            await client.delete(PATH(sole.id));
            expect(await fetchStatus(sole.id)).toBeDefined();
        });

        it("deleting the first of two in a group succeeds, then the second is refused", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            const a = await insertStatus(listId, {
                name: "Done A",
                statusGroup: "done",
                position: 0,
            });
            const b = await insertStatus(listId, {
                name: "Done B",
                statusGroup: "done",
                position: 1,
            });

            const first = await client.delete(PATH(a.id));
            expect(first.status).toBe(204);
            const second = await client.delete(PATH(b.id));
            expect(second.status).toBe(422);
            expect(second.body.error.code).toBe("status.last_in_group");
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
            const stB = await insertStatus(listB, {
                name: "B",
                statusGroup: "active",
                position: 0,
            });
            await insertStatus(listB, {
                name: "B2",
                statusGroup: "active",
                position: 1,
            });

            const res = await a.client.delete(PATH(stB.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
            expect(await fetchStatus(stB.id)).toBeDefined();
        });
    });

    // ─── h/i. Idempotency & concurrency ───────────────────────────────────────
    describe("Idempotency & concurrency", () => {
        it("a second delete of the same status returns 404 (not idempotent-204)", async () => {
            const { client, target } = await setup();
            const first = await client.delete(PATH(target.id));
            expect(first.status).toBe(204);
            const second = await client.delete(PATH(target.id));
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("status.not_found");
        });

        it("two parallel deletes of the same status → one 204, one 404", async () => {
            const { client, target } = await setup();
            const [a, b] = await Promise.all([
                client.delete(PATH(target.id)),
                client.delete(PATH(target.id)),
            ]);
            const codes = [a.status, b.status].sort();
            expect(codes).toEqual([204, 404]);
        });

        it("two parallel deletes of the last two in a group → one 204, one 422, group keeps ≥1", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "owner" });
            const client = await makeLoggedInClient(user);
            const spaceId = await insertSpace(ws.id, user.id);
            const listId = await insertList(spaceId, user.id);
            const a = await insertStatus(listId, {
                name: "Closed A",
                statusGroup: "closed",
                position: 0,
            });
            const b = await insertStatus(listId, {
                name: "Closed B",
                statusGroup: "closed",
                position: 1,
            });

            const [r1, r2] = await Promise.all([
                client.delete(PATH(a.id)),
                client.delete(PATH(b.id)),
            ]);
            const codes = [r1.status, r2.status].sort();
            expect(codes).toEqual([204, 422]);
            // Exactly one of the two survives — the group invariant held.
            const survivors =
                ((await fetchStatus(a.id)) ? 1 : 0) +
                ((await fetchStatus(b.id)) ? 1 : 0);
            expect(survivors).toBe(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("decrements the list's status count by exactly one on success", async () => {
            const { client, listId, target } = await setup();
            const before = await countStatusesInList(listId);
            await client.delete(PATH(target.id));
            expect(await countStatusesInList(listId)).toBe(before - 1);
        });

        it("writes no task_activity or workspace_activity rows", async () => {
            const { client, target } = await setup();
            const a = await countTaskActivity();
            const w = await countWorkspaceActivity();
            await client.delete(PATH(target.id));
            expect(await countTaskActivity()).toBe(a);
            expect(await countWorkspaceActivity()).toBe(w);
        });

        it("leaves the list's status count unchanged on a 409 in_use", async () => {
            const { client, listId, target } = await setup();
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id });
            await makeTask({
                workspaceId: ws.id,
                listId,
                statusId: target.id,
                createdBy: owner.id,
            });
            const before = await countStatusesInList(listId);
            await client.delete(PATH(target.id));
            expect(await countStatusesInList(listId)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on a 204", async () => {
            const { client, target } = await setup();
            const rid = "rid-status-delete-1";
            const res = await client
                .delete(PATH(target.id))
                .set("X-Request-Id", rid);
            expect(res.status).toBe(204);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("treats a SQL-injection-style id as a literal id (404, no 500)", async () => {
            const { client } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client.delete(PATH(malicious));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("status.not_found");
        });
    });
});
