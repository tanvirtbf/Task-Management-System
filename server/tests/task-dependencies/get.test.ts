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
import {
    customFields,
    taskActivity,
    taskCustomFieldValues,
    taskDependencies,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/:id/dependencies` (§12 #1).
 *
 * Private DB `tms_taskdeps_test` (jest.taskdeps.config.cjs), truncate-per-test.
 * 🔐 any member. Returns `{ blocks, blocked_by }`; each edge carries the OTHER
 * end as a fully-hydrated wire `Task`. `blocks` = edges where this task is the
 * blocker (other end = related_task_id); `blocked_by` = the computed reverse.
 */

const url = (taskId: string) => `/api/v1/tasks/${taskId}/dependencies`;

/** Insert a raw `blocks` edge (no factory exists). Returns the dep id. */
const makeDep = async (
    taskId: string,
    relatedTaskId: string,
    createdBy: string,
): Promise<string> => {
    const id = fakeId("dep");
    await getDb()
        .insert(taskDependencies)
        .values({ id, taskId, relatedTaskId, depType: "blocks", createdBy });
    return id;
};

const getActivity = async (taskId: string) => {
    const db = getDb();
    return db.select().from(taskActivity).where(eq(taskActivity.taskId, taskId));
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

/** An owner + a logged-in client + a "focus" task in their workspace. */
const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    const focus = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    return { u, client, focus };
};

const mkTask = (workspaceId: string, createdBy: string) =>
    makeTask({ workspaceId, createdBy });

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/:id/dependencies", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns empty arrays when the task has no dependencies", async () => {
            const { focus, client } = await setup();

            const res = await client.get(url(focus.id));

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ blocks: [], blocked_by: [] });
        });

        it("returns an outgoing edge under `blocks` with the other end hydrated", async () => {
            const { u, focus, client } = await setup();
            const other = await mkTask(u.workspaceId, u.id);
            const depId = await makeDep(focus.id, other.id, u.id);

            const res = await client.get(url(focus.id));

            expect(res.status).toBe(200);
            expect(res.body.blocked_by).toEqual([]);
            expect(res.body.blocks).toHaveLength(1);
            const edge = res.body.blocks[0];
            expect(edge.id).toBe(depId);
            expect(edge.type).toBe("blocks");
            expect(edge.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
            expect(edge.task.id).toBe(other.id); // the OTHER end
        });

        it("returns an incoming edge under `blocked_by` (computed reverse)", async () => {
            const { u, focus, client } = await setup();
            const blocker = await mkTask(u.workspaceId, u.id);
            const depId = await makeDep(blocker.id, focus.id, u.id);

            const res = await client.get(url(focus.id));

            expect(res.body.blocks).toEqual([]);
            expect(res.body.blocked_by).toHaveLength(1);
            const edge = res.body.blocked_by[0];
            expect(edge.id).toBe(depId);
            expect(edge.type).toBe("blocked_by");
            expect(edge.task.id).toBe(blocker.id); // the blocker, hydrated
        });

        it("returns both directions in one payload", async () => {
            const { u, focus, client } = await setup();
            const downstream = await mkTask(u.workspaceId, u.id);
            const upstream = await mkTask(u.workspaceId, u.id);
            await makeDep(focus.id, downstream.id, u.id); // focus blocks downstream
            await makeDep(upstream.id, focus.id, u.id); // upstream blocks focus

            const res = await client.get(url(focus.id));

            expect(res.body.blocks.map((e: { task: { id: string } }) => e.task.id)).toEqual([
                downstream.id,
            ]);
            expect(
                res.body.blocked_by.map((e: { task: { id: string } }) => e.task.id),
            ).toEqual([upstream.id]);
        });

        it("fully hydrates the other-end Task (wire shape with inline collections)", async () => {
            const { u, focus, client } = await setup();
            const other = await mkTask(u.workspaceId, u.id);
            await makeDep(focus.id, other.id, u.id);

            const { task } = (await client.get(url(focus.id))).body.blocks[0];

            expect(task.id).toBe(other.id);
            expect(typeof task.name).toBe("string");
            expect(task.status_id).toBeTruthy();
            expect(task.task_type_id).toBeTruthy();
            expect(Array.isArray(task.assignees)).toBe(true);
            expect(Array.isArray(task.watchers)).toBe(true);
            expect(Array.isArray(task.tags)).toBe(true);
            expect(task.custom_field_values).toEqual({});
            expect(task).not.toHaveProperty("internal_id");
        });

        it("orders multiple `blocks` edges by created_at then id (stable)", async () => {
            const { u, focus, client } = await setup();
            const a = await mkTask(u.workspaceId, u.id);
            const b = await mkTask(u.workspaceId, u.id);
            const c = await mkTask(u.workspaceId, u.id);
            await makeDep(focus.id, a.id, u.id);
            await makeDep(focus.id, b.id, u.id);
            await makeDep(focus.id, c.id, u.id);

            const ids1 = (await client.get(url(focus.id))).body.blocks.map(
                (e: { task: { id: string } }) => e.task.id,
            );
            const ids2 = (await client.get(url(focus.id))).body.blocks.map(
                (e: { task: { id: string } }) => e.task.id,
            );

            expect(ids1).toHaveLength(3);
            expect(ids2).toEqual(ids1); // stable across calls
        });

        it("hydrates a task that is BOTH a blocks and blocked_by neighbour, once", async () => {
            // X both downstream (focus→X) and upstream (X→focus): the `otherIds`
            // Set must dedup X, hydrate it once, and toView must resolve it for
            // BOTH directions with identical bodies. (Inserted raw — the cycle
            // guard only runs on POST.)
            const { u, focus, client } = await setup();
            const x = await mkTask(u.workspaceId, u.id);
            await makeDep(focus.id, x.id, u.id);
            await makeDep(x.id, focus.id, u.id);

            const res = await client.get(url(focus.id));

            expect(res.body.blocks).toHaveLength(1);
            expect(res.body.blocked_by).toHaveLength(1);
            expect(res.body.blocks[0].task.id).toBe(x.id);
            expect(res.body.blocked_by[0].task.id).toBe(x.id);
            expect(res.body.blocks[0].task).toEqual(res.body.blocked_by[0].task);
        });
    });

    // ─── Guest redaction of the hydrated other-end Task ─────────────────────
    describe("Guest custom-field redaction", () => {
        const seedHiddenField = async (
            workspaceId: string,
            listId: string,
            taskId: string,
            createdBy: string,
        ): Promise<string> => {
            const db = getDb();
            const fieldId = fakeId("cf");
            await db.insert(customFields).values({
                id: fieldId,
                workspaceId,
                scopeType: "list",
                scopeId: listId,
                name: "Secret",
                type: "text",
                hiddenFromGuests: true,
                createdBy,
            });
            await db
                .insert(taskCustomFieldValues)
                .values({ taskId, customFieldId: fieldId, value: { text: "hidden" } });
            return fieldId;
        };

        it("redacts a guest-hidden custom field from the hydrated task for a guest", async () => {
            const u = await makeUser({ role: "guest" });
            const client = await makeLoggedInClient(u);
            const focus = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            const other = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            await makeDep(focus.id, other.id, u.id);
            await seedHiddenField(u.workspaceId, other.listId, other.id, u.id);

            const res = await client.get(url(focus.id));

            expect(res.body.blocks[0].task.custom_field_values).toEqual({});
        });

        it("includes a guest-hidden custom field for a non-guest reader", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const focus = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            const other = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
            await makeDep(focus.id, other.id, u.id);
            const fieldId = await seedHiddenField(
                u.workspaceId,
                other.listId,
                other.id,
                u.id,
            );

            const res = await client.get(url(focus.id));

            expect(res.body.blocks[0].task.custom_field_values[fieldId]).toEqual({
                text: "hidden",
            });
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an id over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.get(url("t".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { focus } = await setup();
            const http = await oneOff();

            const res = await http.get(url(focus.id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, focus } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .get(url(focus.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any role) ─────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to read dependencies (200)`, async () => {
                const { focus, client } = await setup({ role });

                const res = await client.get(url(focus.id));

                expect(res.status).toBe(200);
            });
        }
    });

    // ─── e/f. Not found & isolation ─────────────────────────────────────────
    describe("Not found & isolation", () => {
        it("returns 404 task.not_found for a non-existent task id", async () => {
            const { client } = await setup();

            const res = await client.get(url("t-nope"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 404 for a task in another workspace [IDOR]", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const taskB = await makeTask({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(userA);

            const res = await client.get(url(taskB.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── g. Side effects (a read must mutate nothing) ───────────────────────
    describe("Side effects", () => {
        it("writes no task_activity rows", async () => {
            const { u, focus, client } = await setup();
            const other = await mkTask(u.workspaceId, u.id);
            await makeDep(focus.id, other.id, u.id);

            await client.get(url(focus.id));

            expect(await getActivity(focus.id)).toHaveLength(0);
            expect(await getActivity(other.id)).toHaveLength(0);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { focus, client } = await setup();

            const res = await client.get(url(focus.id));

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 404 route.not_found for POST on the dependencies path", async () => {
            const { focus, client } = await setup();

            const res = await client.post(url(focus.id)).send({});

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client.get(
                url(encodeURIComponent("t-1' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });
});
