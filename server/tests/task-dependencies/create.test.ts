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
 * Tests for `POST /api/v1/task-dependencies` (§12 #2).
 *
 * Private DB `tms_taskdeps_test`. 🔐 any member. Adds a `blocks` edge
 * `task_id → related_task_id`. Guards: 422 dep.self, 404 task.not_found, 422
 * dep.cycle, 409 dep.duplicate. Writes one task_activity row on BOTH endpoints.
 */

const URL = "/api/v1/task-dependencies";

const depRows = async () => getDb().select().from(taskDependencies);
const depsForTask = async (taskId: string) =>
    getDb()
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, taskId));
const getActivity = async (taskId: string) =>
    getDb().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

/** Insert a raw `blocks` edge directly (to set up pre-existing graph state). */
const seedDep = async (taskId: string, relatedTaskId: string, createdBy: string) => {
    await getDb()
        .insert(taskDependencies)
        .values({ id: fakeId("dep"), taskId, relatedTaskId, depType: "blocks", createdBy });
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

/** An owner + client + two tasks (a, b) in their workspace. */
const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    const a = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    const b = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    return { u, client, a, b };
};
const mk = (workspaceId: string, createdBy: string) =>
    makeTask({ workspaceId, createdBy });

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/task-dependencies", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a blocks edge and returns 201 with the hydrated other end", async () => {
            const { a, b, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id, type: "blocks" });

            expect(res.status).toBe(201);
            expect(res.body.id).toMatch(/^dep-/);
            expect(res.body.type).toBe("blocks");
            expect(res.body.task.id).toBe(b.id); // the OTHER end (related)
            expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        });

        it("persists the edge with created_by = actor", async () => {
            const { u, a, b, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id });
            const [row] = await depsForTask(a.id);

            expect(row.id).toBe(res.body.id);
            expect(row.relatedTaskId).toBe(b.id);
            expect(row.depType).toBe("blocks");
            expect(row.createdBy).toBe(u.id);
        });

        it("defaults type to blocks when omitted", async () => {
            const { a, b, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id });

            expect(res.status).toBe(201);
        });
    });

    // ─── Side effects (activity on BOTH tasks) ──────────────────────────────
    describe("Side effects", () => {
        it("writes a dependency_added activity row on BOTH endpoints", async () => {
            const { u, a, b, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id });
            const depId = res.body.id;

            const aAct = await getActivity(a.id);
            const bAct = await getActivity(b.id);
            expect(aAct).toHaveLength(1);
            expect(aAct[0].action).toBe("dependency_added");
            expect(aAct[0].actorId).toBe(u.id);
            expect(aAct[0].context).toMatchObject({ dependency_id: depId, blocks: b.id });
            expect(bAct).toHaveLength(1);
            expect(bAct[0].action).toBe("dependency_added");
            expect(bAct[0].context).toMatchObject({ dependency_id: depId, blocked_by: a.id });
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>, string]> = [
            ["missing task_id", { related_task_id: "t-x" }, "task_id"],
            ["missing related_task_id", { task_id: "t-x" }, "related_task_id"],
            ["empty task_id", { task_id: "", related_task_id: "t-x" }, "task_id"],
            ["task_id over 64", { task_id: "t".repeat(65), related_task_id: "t-x" }, "task_id"],
            ["non-string task_id", { task_id: 7, related_task_id: "t-x" }, "task_id"],
            ["invalid type", { task_id: "t-a", related_task_id: "t-b", type: "blocked_by" }, "type"],
        ];

        for (const [label, body, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { client } = await setup();

                const res = await client.post(URL).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { a, b } = await setup();
            const http = await oneOff();

            const res = await http
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, a, b } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .post(URL)
                .set("Authorization", `Bearer ${token}`)
                .send({ task_id: a.id, related_task_id: b.id });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any role) ─────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to add a dependency (201)`, async () => {
                const { a, b, client } = await setup({ role });

                const res = await client
                    .post(URL)
                    .send({ task_id: a.id, related_task_id: b.id });

                expect(res.status).toBe(201);
            });
        }
    });

    // ─── e. Self-loop (422 dep.self) ────────────────────────────────────────
    describe("Self dependency", () => {
        it("returns 422 dep.self when task_id === related_task_id and writes nothing", async () => {
            const { a, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: a.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("dep.self");
            expect(await depRows()).toHaveLength(0);
            expect(await getActivity(a.id)).toHaveLength(0);
        });
    });

    // ─── f. Not found / isolation ───────────────────────────────────────────
    describe("Not found & isolation", () => {
        it("returns 404 task.not_found when task_id does not exist", async () => {
            const { b, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: "t-nope", related_task_id: b.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 404 task.not_found when related_task_id does not exist", async () => {
            const { a, client } = await setup();

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: "t-nope" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 404 for a related_task_id in another workspace [IDOR] and writes nothing", async () => {
            const { a, client } = await setup();
            const wsB = await makeWorkspace();
            const taskB = await makeTask({ workspaceId: wsB.id });

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: taskB.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await depRows()).toHaveLength(0);
        });
    });

    // ─── g. Cycle detection (422 dep.cycle) ─────────────────────────────────
    describe("Cycle detection", () => {
        it("rejects a direct 2-cycle (A→B exists, add B→A) with 422 dep.cycle", async () => {
            const { u, a, b, client } = await setup();
            await seedDep(a.id, b.id, u.id); // A blocks B

            const res = await client
                .post(URL)
                .send({ task_id: b.id, related_task_id: a.id }); // B blocks A → cycle

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("dep.cycle");
            expect(await depRows()).toHaveLength(1); // nothing added
        });

        it("rejects a 3-hop cycle (A→B→C exists, add C→A)", async () => {
            const { u, a, b, client } = await setup();
            const c = await mk(u.workspaceId, u.id);
            await seedDep(a.id, b.id, u.id); // A→B
            await seedDep(b.id, c.id, u.id); // B→C

            const res = await client
                .post(URL)
                .send({ task_id: c.id, related_task_id: a.id }); // C→A closes the loop

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("dep.cycle");
        });

        it("allows a non-cyclic diamond (A→B, A→C, then B→D, C→D)", async () => {
            const { u, a, b, client } = await setup();
            const c = await mk(u.workspaceId, u.id);
            const d = await mk(u.workspaceId, u.id);
            await seedDep(a.id, b.id, u.id);
            await seedDep(a.id, c.id, u.id);

            const r1 = await client.post(URL).send({ task_id: b.id, related_task_id: d.id });
            const r2 = await client.post(URL).send({ task_id: c.id, related_task_id: d.id });

            expect(r1.status).toBe(201);
            expect(r2.status).toBe(201); // converging, not cyclic
        });

        it("allows a long acyclic chain extension (A→B→C, add C→D)", async () => {
            const { u, a, b, client } = await setup();
            const c = await mk(u.workspaceId, u.id);
            const d = await mk(u.workspaceId, u.id);
            await seedDep(a.id, b.id, u.id);
            await seedDep(b.id, c.id, u.id);

            const res = await client.post(URL).send({ task_id: c.id, related_task_id: d.id });

            expect(res.status).toBe(201);
        });
    });

    // ─── h. Duplicate (409 dep.duplicate) ───────────────────────────────────
    describe("Duplicate edge", () => {
        it("returns 409 dep.duplicate when the same edge is added twice", async () => {
            const { a, b, client } = await setup();
            await client.post(URL).send({ task_id: a.id, related_task_id: b.id });

            const res = await client
                .post(URL)
                .send({ task_id: a.id, related_task_id: b.id });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("dep.duplicate");
            expect(await depRows()).toHaveLength(1); // no second row
        });

        it("allows the reverse edge only when it does not form a cycle (here it does → 422)", async () => {
            // A→B then B→A is the 2-cycle case (already covered) — this asserts a
            // duplicate is distinct from the reverse: re-adding A→B is duplicate,
            // adding B→A is a cycle.
            const { a, b, client } = await setup();
            await client.post(URL).send({ task_id: a.id, related_task_id: b.id });

            const dup = await client.post(URL).send({ task_id: a.id, related_task_id: b.id });
            const rev = await client.post(URL).send({ task_id: b.id, related_task_id: a.id });

            expect(dup.body.error.code).toBe("dep.duplicate");
            expect(rev.body.error.code).toBe("dep.cycle");
        });
    });

    // ─── i. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("5 parallel adds of the SAME edge — exactly one 201, the rest 409", async () => {
            const { a, b, client } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () =>
                    client.post(URL).send({ task_id: a.id, related_task_id: b.id }),
                ),
            );

            expect(results.filter((r) => r.status === 201)).toHaveLength(1);
            expect(results.filter((r) => r.status === 409)).toHaveLength(4);
            expect(await depRows()).toHaveLength(1);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { a, b, client } = await setup();

            const res = await client.post(URL).send({ task_id: a.id, related_task_id: b.id });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 400 for a malformed JSON body", async () => {
            const { client } = await setup();

            const res = await client
                .post(URL)
                .set("Content-Type", "application/json")
                .send('{"task_id": ');

            expect(res.status).toBe(400);
        });

        it("ignores a body created_by / id (mass-assignment)", async () => {
            const { u, a, b, client } = await setup();

            const res = await client.post(URL).send({
                task_id: a.id,
                related_task_id: b.id,
                id: "dep-forced",
                created_by: "u-attacker",
            });

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe("dep-forced");
            const [row] = await depsForTask(a.id);
            expect(row.createdBy).toBe(u.id);
        });
    });
});
