import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeList,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, taskTypes, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import { TaskTypeService } from "../../src/services/TaskTypeService";
import type { TaskTypesRepo } from "../../src/repositories/TaskTypesRepo";
import type { WorkspaceActivityRepo } from "../../src/repositories/WorkspaceActivityRepo";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type * as schema from "../../src/db/schema";

/**
 * Tests for `DELETE /api/v1/task-types/:id` (§8 Task types, endpoint #4).
 *
 * 👑 Owner/Admin only. Deletes a task type the caller's workspace owns (404
 * `task_type.not_found` otherwise). Refuses with `403 task_type.system` for a
 * seeded system type, and `409 task_type.in_use` when any task references it
 * (`tasks.task_type_id`, FK RESTRICT) OR any list names it as its default
 * (`lists.default_task_type_id`, FK SET NULL → explicit app-level guard).
 * Precedence: not_found → system (403) → in_use (409). Writes a
 * `workspace_activity` "deleted" row in the same transaction. Returns 204.
 *
 * Patterns mirror tests/task-types/{create,update}.test.ts (real DB via
 * factories; no per-test truncate — every test uses a fresh workspace).
 */

const url = (id: string) => `/api/v1/task-types/${id}`;

// ─── seed / inspection helpers ───────────────────────────────────────────────

let _seq = 0;

/** Insert a task type directly so `is_system` can be set (the factory cannot). */
const seedType = async (
    workspaceId: string,
    opts: {
        name?: string;
        isSystem?: boolean;
        isDevType?: boolean;
        isMilestoneType?: boolean;
        position?: number;
    } = {},
): Promise<{ id: string; name: string }> => {
    const db = getDb();
    const id = fakeId("tt");
    const name = opts.name ?? `Type ${++_seq}`;
    await db.insert(taskTypes).values({
        id,
        workspaceId,
        name,
        isSystem: opts.isSystem ?? false,
        isDevType: opts.isDevType ?? false,
        isMilestoneType: opts.isMilestoneType ?? false,
        position: opts.position ?? 0,
    });
    return { id, name };
};

const rowById = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(taskTypes)
        .where(eq(taskTypes.id, id))
        .limit(1);
    return row;
};
const rowsIn = async (workspaceId: string) =>
    getDb().select().from(taskTypes).where(eq(taskTypes.workspaceId, workspaceId));
const activityIn = async (workspaceId: string) =>
    getDb()
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
const listById = async (id: string) => {
    const [row] = await getDb().select().from(lists).where(eq(lists.id, id)).limit(1);
    return row;
};

/** Point a list's `default_task_type_id` at a type (the factory cannot). */
const pointListAtType = async (workspaceId: string, typeId: string) => {
    const { id: listId } = await makeList({ workspaceId });
    await getDb()
        .update(lists)
        .set({ defaultTaskTypeId: typeId })
        .where(eq(lists.id, listId));
    return listId;
};

/** Workspace + an owner/admin actor (logged in), ready to delete. */
const setup = async (role: Role = "admin") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, client };
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

jest.setTimeout(30000);

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/task-types/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body and removes the row", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Promo" });

            const res = await client.delete(url(id));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
            expect(await rowById(id)).toBeUndefined();
        });

        it("writes exactly one workspace_activity 'deleted' row attributed to the actor", async () => {
            const { ws, actor, client } = await setup();
            const { id, name } = await seedType(ws.id, { name: "Audit Me" });

            await client.delete(url(id));

            const acts = await activityIn(ws.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].entityType).toBe("task_type");
            expect(acts[0].entityId).toBe(id);
            expect(acts[0].action).toBe("deleted");
            expect(acts[0].actorId).toBe(actor.id);
            // Exact payload — catches a leaked/extra context key, not just a subset.
            expect(acts[0].context).toEqual({ name });
        });

        it("removes only the target, leaving sibling types intact", async () => {
            const { ws, client } = await setup();
            const target = await seedType(ws.id, { name: "Target", position: 0 });
            const sibling = await seedType(ws.id, { name: "Sibling", position: 1 });

            await client.delete(url(target.id));

            expect(await rowById(target.id)).toBeUndefined();
            expect(await rowById(sibling.id)).toBeDefined();
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 validation.failed when id exceeds 64 chars", async () => {
            const { client } = await setup();
            const res = await client.delete(url("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details[0].field).toBe("id");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { ws } = await setup();
            const { id } = await seedType(ws.id);
            const http = await oneOff();
            const res = await http.delete(url(id));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed Bearer token", async () => {
            const { ws } = await setup();
            const { id } = await seedType(ws.id);
            const http = await oneOff();
            const res = await http
                .delete(url(id))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { ws, actor } = await setup();
            const { id } = await seedType(ws.id);
            const expired = signAccess(actor, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(url(id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (204)", async () => {
            const { ws, client } = await setup("owner");
            const { id } = await seedType(ws.id);
            expect((await client.delete(url(id))).status).toBe(204);
        });

        it("allows an admin (204)", async () => {
            const { ws, client } = await setup("admin");
            const { id } = await seedType(ws.id);
            expect((await client.delete(url(id))).status).toBe(204);
        });

        it("forbids a member (403 auth.forbidden)", async () => {
            const { ws, client } = await setup("member");
            const { id } = await seedType(ws.id);
            const res = await client.delete(url(id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("forbids a guest (403 auth.forbidden)", async () => {
            const { ws, client } = await setup("guest");
            const { id } = await seedType(ws.id);
            const res = await client.delete(url(id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("does not delete the row when a member is forbidden", async () => {
            const { ws, client } = await setup("member");
            const { id } = await seedType(ws.id);
            await client.delete(url(id));
            expect(await rowById(id)).toBeDefined();
        });

        it("rejects a member targeting a non-existent id with 403 (authz before lookup)", async () => {
            const { client } = await setup("member");
            const res = await client.delete(url(fakeId("tt")));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });
    });

    // ─── e. Lifecycle / not-found ─────────────────────────────────────────────
    describe("Not-found", () => {
        it("404 task_type.not_found for a non-existent id", async () => {
            const { client } = await setup();
            const res = await client.delete(url(fakeId("tt")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task_type.not_found");
        });
    });

    // ─── f. System guard (403 task_type.system) ───────────────────────────────
    describe("System type guard", () => {
        it("403 task_type.system when deleting a seeded system type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Task", isSystem: true });
            const res = await client.delete(url(id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
        });

        it("does not delete a system type and logs no activity", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { isSystem: true });
            await client.delete(url(id));
            expect(await rowById(id)).toBeDefined();
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("system (403) takes precedence over in_use (409) when a task also references it", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { isSystem: true });
            await makeTask({ workspaceId: ws.id, taskTypeId: id });

            const res = await client.delete(url(id));
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
        });
    });

    // ─── g. Conflict (409 task_type.in_use) ───────────────────────────────────
    describe("Conflict — in_use", () => {
        it("409 task_type.in_use when a task references the type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await makeTask({ workspaceId: ws.id, taskTypeId: id });

            const res = await client.delete(url(id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.in_use");
        });

        it("does not delete the row or log activity on a task in_use", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await makeTask({ workspaceId: ws.id, taskTypeId: id });

            await client.delete(url(id));
            expect(await rowById(id)).toBeDefined();
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("409 task_type.in_use when a list names it as its default", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await pointListAtType(ws.id, id);

            const res = await client.delete(url(id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.in_use");
            // A refused delete must roll back: no 'deleted' activity row.
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("does NOT null the list's default on a list in_use (refused before the FK SET NULL fires)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            const listId = await pointListAtType(ws.id, id);

            await client.delete(url(id));

            expect(await rowById(id)).toBeDefined();
            expect((await listById(listId)).defaultTaskTypeId).toBe(id);
        });

        it("409 when referenced by BOTH a task and a list", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await makeTask({ workspaceId: ws.id, taskTypeId: id });
            await pointListAtType(ws.id, id);

            const res = await client.delete(url(id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.in_use");
        });

        it("succeeds (204) once the referencing list's default is cleared", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            const listId = await pointListAtType(ws.id, id);

            // Clear the reference, then the delete is allowed.
            await getDb()
                .update(lists)
                .set({ defaultTaskTypeId: null })
                .where(eq(lists.id, listId));

            const res = await client.delete(url(id));
            expect(res.status).toBe(204);
            expect(await rowById(id)).toBeUndefined();
        });
    });

    // ─── h. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("404 task_type.not_found when the type belongs to another workspace", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const { id: bTypeId } = await seedType(wsB.id, { name: "B-only" });

            const res = await a.client.delete(url(bTypeId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task_type.not_found");
            expect(await rowById(bTypeId)).toBeDefined();
        });

        it("logs no activity in either workspace on a cross-tenant attempt", async () => {
            const a = await setup();
            const wsB = await makeWorkspace();
            const { id: bTypeId } = await seedType(wsB.id);

            await a.client.delete(url(bTypeId));
            expect(await activityIn(a.ws.id)).toHaveLength(0);
            expect(await activityIn(wsB.id)).toHaveLength(0);
        });
    });

    // ─── i. Idempotency & concurrency ─────────────────────────────────────────
    describe("Idempotency & concurrency", () => {
        it("a second delete of the same id returns 404 (not idempotent-204)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);

            expect((await client.delete(url(id))).status).toBe(204);
            const second = await client.delete(url(id));
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("task_type.not_found");
        });

        it("two parallel deletes of the same id → one 204, one 404", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);

            const [a, b] = await Promise.all([
                client.delete(url(id)),
                client.delete(url(id)),
            ]);
            expect([a.status, b.status].sort()).toEqual([204, 404]);
            // And exactly one activity row, from the single successful delete.
            expect(await activityIn(ws.id)).toHaveLength(1);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("decrements the workspace's task-type count by one on success", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await seedType(ws.id); // a second, untouched type
            const before = (await rowsIn(ws.id)).length;

            await client.delete(url(id));
            expect((await rowsIn(ws.id)).length).toBe(before - 1);
        });

        it("leaves the count unchanged and logs nothing on a 409 in_use", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            await makeTask({ workspaceId: ws.id, taskTypeId: id });
            const before = (await rowsIn(ws.id)).length;

            await client.delete(url(id));
            expect((await rowsIn(ws.id)).length).toBe(before);
            expect(await activityIn(ws.id)).toHaveLength(0);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("echoes a client X-Request-Id on a 204", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id);
            const rid = "rid-tasktype-delete-1";
            const res = await client.delete(url(id)).set("X-Request-Id", rid);
            expect(res.status).toBe(204);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("treats a SQL-injection-style id as a literal id (404, no 500)", async () => {
            const { client } = await setup();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client.delete(url(malicious));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task_type.not_found");
        });
    });
});

// ════════════════════════════════════════════════════════════════════════════
// FK RESTRICT race backstop (service unit test, no DB).
//
// The in_use pre-check (`countTasksUsingType`) short-circuits the integration
// tests before `deleteById` runs, so the `ER_ROW_IS_REFERENCED_2 → 409` catch —
// the backstop for a task inserted AFTER the count but before the DELETE commits
// — is unreachable from supertest. This exercises it directly with a stubbed
// repo whose `deleteById` throws the mysql2 FK-violation error.
// ════════════════════════════════════════════════════════════════════════════
describe("TaskTypeService.delete — FK RESTRICT race backstop", () => {
    it("maps a deleteById ER_ROW_IS_REFERENCED_2 to 409 task_type.in_use", async () => {
        const db = {
            transaction: async <T>(
                cb: (tx: unknown) => Promise<T>,
            ): Promise<T> => cb({}),
        } as unknown as MySql2Database<typeof schema>;

        const repo = {
            findByIdInWorkspace: async () => ({
                id: "tt-race",
                name: "Race",
                description: null,
                icon: "CheckSquare",
                color: "#6B7280",
                isMilestoneType: false,
                isSystem: false,
                isDevType: false,
                position: 0,
            }),
            // Pre-check sees zero references; the racing task lands between here
            // and the DELETE, so the FK RESTRICT fires at deleteById.
            countTasksUsingType: async () => 0,
            countListsUsingType: async () => 0,
            deleteById: async () => {
                throw { code: "ER_ROW_IS_REFERENCED_2" };
            },
        } as unknown as TaskTypesRepo;

        const activity = {
            record: async () => undefined,
        } as unknown as WorkspaceActivityRepo;

        const svc = new TaskTypeService(db, repo, activity);

        await expect(
            svc.delete({ workspaceId: "ws-x", actorId: "u-x", id: "tt-race" }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "task_type.in_use",
        });
    });
});
