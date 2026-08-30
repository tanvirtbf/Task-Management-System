import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeLoggedInClient,
    makeSprint,
    makeStatus,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { sprints, tasks, workspaceActivity } from "../../src/db/schema";
import type { Role } from "../../src/constants";

/**
 * §20 #10 — DELETE /api/v1/sprints/:id   (F28, ISS-013, decision D12.6)
 *
 * There was no way to remove a sprint at all: `DELETE /sprints/:id` answered
 * `404 route.not_found`, so a sprint created with wrong dates or a typo'd name
 * was permanent and cleaning it up meant direct SQL. ISS-013 was filed after
 * hitting exactly that while clearing test data.
 *
 * Two things this suite pins, because they are the whole design:
 *   1. **Tasks are detached, never deleted.** `tasks.sprint_id` is declared
 *      `ON DELETE SET NULL`, so the blast radius is the sprint row alone. That
 *      is why the fix is a route rather than a migration.
 *   2. **An ACTIVE sprint is refused** (409 `sprint.active_immutable`). The
 *      cleanup story is about a mistake noticed early — a planned sprint — and
 *      the guard is what stops one click silently un-sprinting a sprint the
 *      team is currently working.
 */
jest.setTimeout(30000);

const PATH = (id: string) => `/api/v1/sprints/${id}`;

const setup = async (role: Role = "owner") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    const workspaceId = u.workspaceId;
    const list = await makeList({ workspaceId, createdBy: u.id });
    const todo = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    return { u, client, workspaceId, list, todo };
};

/** Put a fresh task into a sprint and hand back its id. */
const placeTask = async (opts: {
    workspaceId: string;
    listId: string;
    statusId: string;
    sprintId: string;
}) => {
    const t = await makeTask({
        workspaceId: opts.workspaceId,
        listId: opts.listId,
        statusId: opts.statusId,
    });
    await getDb()
        .update(tasks)
        .set({ sprintId: opts.sprintId })
        .where(eq(tasks.id, t.id));
    return t.id;
};

const rowOf = async (id: string) => {
    const [r] = await getDb().select().from(sprints).where(eq(sprints.id, id));
    return r ?? null;
};

const taskRow = async (id: string) => {
    const [r] = await getDb().select().from(tasks).where(eq(tasks.id, id));
    return r ?? null;
};

describe("DELETE /api/v1/sprints/:id", () => {
    describe("Happy path", () => {
        it("deletes a PLANNED sprint and returns 204 with no body", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "planned",
            });

            const res = await client.delete(PATH(s.id));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(await rowOf(s.id)).toBeNull();
        });

        it("deletes a CLOSED sprint too — history can be cleaned up", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "closed",
            });

            expect((await client.delete(PATH(s.id))).status).toBe(204);
            expect(await rowOf(s.id)).toBeNull();
        });

        /**
         * The point of the whole endpoint: the schema's `ON DELETE SET NULL`
         * means removing a sprint costs the sprint row and nothing else.
         */
        it("DETACHES its tasks instead of deleting them", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "planned",
            });
            const a = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: s.id,
            });
            const b = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: s.id,
            });

            expect((await client.delete(PATH(s.id))).status).toBe(204);

            for (const id of [a, b]) {
                const t = await taskRow(id);
                expect(t).not.toBeNull(); // the task SURVIVES
                expect(t!.sprintId).toBeNull(); // …with no sprint
                expect(t!.archivedAt).toBeNull(); // …and is not archived
            }
        });

        it("records a workspace-activity row naming what was detached", async () => {
            const { client, workspaceId, list, todo, u } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "planned",
                name: "Sprint 12 — Checkout",
            });
            await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: s.id,
            });

            await client.delete(PATH(s.id));

            const rows = await getDb()
                .select()
                .from(workspaceActivity)
                .where(eq(workspaceActivity.entityId, s.id));
            const del = rows.find((r) => r.action === "deleted");
            expect(del).toBeDefined();
            expect(del!.entityType).toBe("sprint");
            expect(del!.actorId).toBe(u.id);
            const ctx = del!.context as Record<string, unknown>;
            expect(ctx.name).toBe("Sprint 12 — Checkout");
            expect(ctx.status).toBe("planned");
            expect(ctx.detached_tasks).toBe(1);
        });
    });

    describe("The active-sprint guard", () => {
        it("REFUSES an active sprint with 409 sprint.active_immutable", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "active",
            });

            const res = await client.delete(PATH(s.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.active_immutable");
            expect(await rowOf(s.id)).not.toBeNull(); // still there
        });

        it("leaves an active sprint's tasks attached when the delete is refused", async () => {
            const { client, workspaceId, list, todo } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "active",
            });
            const t = await placeTask({
                workspaceId,
                listId: list.id,
                statusId: todo.id,
                sprintId: s.id,
            });

            await client.delete(PATH(s.id));

            expect((await taskRow(t))!.sprintId).toBe(s.id);
        });

        it("allows the delete once the sprint is no longer active", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "active",
            });
            expect((await client.delete(PATH(s.id))).status).toBe(409);

            await getDb()
                .update(sprints)
                .set({ status: "closed" })
                .where(eq(sprints.id, s.id));

            expect((await client.delete(PATH(s.id))).status).toBe(204);
        });
    });

    describe("Not found / isolation", () => {
        it("404 sprint.not_found for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.delete(PATH("spr-nope"));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 for a sprint in ANOTHER workspace (no existence oracle)", async () => {
            const { client } = await setup();
            const other = await makeWorkspace();
            const _otherOwner = await makeUser({
                workspaceId: other.id,
                role: "owner",
            });
            const s = await makeSprint({
                workspaceId: other.id,
                status: "planned",
            });

            const res = await client.delete(PATH(s.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
            expect(await rowOf(s.id)).not.toBeNull(); // untouched
        });
    });

    describe("Authentication + authorization", () => {
        it("401 without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(PATH("spr-x"));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("allows an admin (sprint.manage)", async () => {
            const { client, workspaceId } = await setup("admin");
            const s = await makeSprint({
                workspaceId,
                status: "planned",
            });
            expect((await client.delete(PATH(s.id))).status).toBe(204);
        });

        /**
         * `sprint.manage` is the same grant that creates and updates a sprint,
         * so no new permission is introduced — and a member/guest who cannot
         * create one cannot delete one either.
         */
        it.each<Role>(["member", "guest"])(
            "refuses a %s with 403 (sprint.manage)",
            async (role) => {
                const owner = await makeUser({ role: "owner" });
                const s = await makeSprint({
                    workspaceId: owner.workspaceId,
                    status: "planned",
                });
                const actor = await makeUser({
                    workspaceId: owner.workspaceId,
                    role,
                });
                const client = await makeLoggedInClient(actor);

                const res = await client.delete(PATH(s.id));

                expect(res.status).toBe(403);
                expect(await rowOf(s.id)).not.toBeNull();
            },
        );
    });

    describe("Cross-cutting", () => {
        it("responds with an X-Request-Id header", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                status: "planned",
            });
            const res = await client.delete(PATH(s.id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
