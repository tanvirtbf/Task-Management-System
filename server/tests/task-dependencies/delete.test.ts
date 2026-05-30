import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskActivity, taskDependencies } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `DELETE /api/v1/task-dependencies/:id` (§12 #3).
 *
 * Private DB `tms_taskdeps_test`. 🔐 any member. Removes one edge resolved within
 * the caller's workspace (404 dep.not_found otherwise); writes a
 * dependency_removed task_activity row on BOTH endpoints; returns 204.
 */

const url = (id: string) => `/api/v1/task-dependencies/${id}`;

const depRow = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.id, id))
        .limit(1);
    return row ?? null;
};
const getActivity = async (taskId: string) =>
    getDb().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

/** Insert a raw `blocks` edge directly. Returns the dep id. */
const seedDep = async (taskId: string, relatedTaskId: string, createdBy: string) => {
    const id = fakeId("dep");
    await getDb()
        .insert(taskDependencies)
        .values({ id, taskId, relatedTaskId, depType: "blocks", createdBy });
    return id;
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

/** An owner + client + an edge a→b in their workspace. */
const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    const a = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    const b = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    const depId = await seedDep(a.id, b.id, u.id);
    return { u, client, a, b, depId };
};

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/task-dependencies/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("deletes the edge and returns 204 with an empty body", async () => {
            const { depId, client } = await setup();

            const res = await client.delete(url(depId));

            expect(res.status).toBe(204);
            expect(res.text).toBe("");
            expect(await depRow(depId)).toBeNull();
        });
    });

    // ─── Side effects (activity on BOTH tasks) ──────────────────────────────
    describe("Side effects", () => {
        it("writes a dependency_removed activity row on BOTH endpoints", async () => {
            const { u, a, b, depId, client } = await setup();

            await client.delete(url(depId));

            const aAct = await getActivity(a.id);
            const bAct = await getActivity(b.id);
            expect(aAct).toHaveLength(1);
            expect(aAct[0].action).toBe("dependency_removed");
            expect(aAct[0].actorId).toBe(u.id);
            expect(aAct[0].context).toMatchObject({ dependency_id: depId, blocks: b.id });
            expect(bAct).toHaveLength(1);
            expect(bAct[0].action).toBe("dependency_removed");
            expect(bAct[0].context).toMatchObject({ dependency_id: depId, blocked_by: a.id });
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.delete(url("d".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { depId } = await setup();
            const http = await oneOff();

            const res = await http.delete(url(depId));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, depId } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .delete(url(depId))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any role) ─────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to delete a dependency (204)`, async () => {
                const { depId, client } = await setup({ role });

                const res = await client.delete(url(depId));

                expect(res.status).toBe(204);
            });
        }
    });

    // ─── e. Not found / isolation ───────────────────────────────────────────
    describe("Not found & isolation", () => {
        it("returns 404 dep.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.delete(url("dep-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("dep.not_found");
        });

        it("returns 404 for an edge in another workspace [IDOR] and keeps it", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const t1 = await makeTask({ workspaceId: wsB.id });
            const t2 = await makeTask({ workspaceId: wsB.id, createdBy: t1.createdBy });
            const depB = await seedDep(t1.id, t2.id, t1.createdBy);
            const client = await makeLoggedInClient(userA);

            const res = await client.delete(url(depB));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("dep.not_found");
            expect(await depRow(depB)).not.toBeNull();
        });
    });

    // ─── g. Idempotency / concurrency ───────────────────────────────────────
    describe("Idempotency & concurrency", () => {
        it("deleting twice returns 204 then 404", async () => {
            const { depId, client } = await setup();

            const first = await client.delete(url(depId));
            const second = await client.delete(url(depId));

            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("dep.not_found");
        });

        it("5 parallel deletes — all 204/404, edge gone, exactly 2 activity rows total", async () => {
            const { a, b, depId, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () => client.delete(url(depId))),
            );

            for (const r of results) expect([204, 404]).toContain(r.status);
            expect(results.some((r) => r.status === 204)).toBe(true);
            expect(await depRow(depId)).toBeNull();
            // Exactly one logical removal → one activity row per endpoint task.
            expect(await getActivity(a.id)).toHaveLength(1);
            expect(await getActivity(b.id)).toHaveLength(1);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("sends an X-Request-Id header on the 204", async () => {
            const { depId, client } = await setup();

            const res = await client.delete(url(depId));

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for GET on the dependency path", async () => {
            const { depId, client } = await setup();

            const res = await client.get(url(depId));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});
