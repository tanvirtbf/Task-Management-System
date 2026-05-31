import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { sprints, workspaceActivity } from "../../src/db/schema";
import type { Role } from "../../src/constants";

/**
 * §20 #6 — POST /api/v1/sprints/:id/start  (planned → active)
 *
 * 👑 Owner/Admin. At most ONE active sprint per workspace (enforced in a
 * workspace-serialised transaction). Already-active is an idempotent 200; a
 * closed sprint cannot start (409); another active sprint blocks it (422).
 */

const setup = async (role: Role = "owner") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    return { u, client, workspaceId: u.workspaceId };
};

const activitiesFor = async (workspaceId: string, entityId: string) =>
    getDb()
        .select()
        .from(workspaceActivity)
        .where(
            and(
                eq(workspaceActivity.workspaceId, workspaceId),
                eq(workspaceActivity.entityId, entityId),
            ),
        );

const statusOf = async (id: string): Promise<string> => {
    const [row] = await getDb().select().from(sprints).where(eq(sprints.id, id));
    return row.status;
};

describe("POST /api/v1/sprints/:id/start", () => {
    describe("happy path", () => {
        it("transitions planned → active and returns 200", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "planned" });

            const res = await client.post(`/api/v1/sprints/${s.id}/start`);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("active");
            expect(await statusOf(s.id)).toBe("active");
        });

        it("records a 'started' workspace_activity row", async () => {
            const { client, workspaceId, u } = await setup();
            const s = await makeSprint({ workspaceId, status: "planned" });

            await client.post(`/api/v1/sprints/${s.id}/start`);

            const rows = await activitiesFor(workspaceId, s.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe("started");
            expect(rows[0].actorId).toBe(u.id);
        });
    });

    describe("idempotency", () => {
        it("starting an already-active sprint is a 200 no-op (no new activity)", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "active" });

            const res = await client.post(`/api/v1/sprints/${s.id}/start`);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("active");
            expect(await activitiesFor(workspaceId, s.id)).toHaveLength(0);
        });
    });

    describe("invalid transition", () => {
        it("409 sprint.invalid_status when starting a closed sprint", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "closed" });

            const res = await client.post(`/api/v1/sprints/${s.id}/start`);

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.invalid_status");
            expect(await statusOf(s.id)).toBe("closed");
        });
    });

    describe("single-active invariant", () => {
        it("422 sprint.another_active when another sprint is already active", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "Running", status: "active" });
            const planned = await makeSprint({
                workspaceId,
                name: "Next",
                status: "planned",
            });

            const res = await client.post(`/api/v1/sprints/${planned.id}/start`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("sprint.another_active");
            expect(await statusOf(planned.id)).toBe("planned");
        });

        it("an active sprint in ANOTHER workspace does not block starting", async () => {
            const { client, workspaceId } = await setup();
            const otherWs = await makeWorkspace();
            await makeSprint({ workspaceId: otherWs.id, status: "active" });
            const mine = await makeSprint({ workspaceId, status: "planned" });

            const res = await client.post(`/api/v1/sprints/${mine.id}/start`);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("active");
        });

        it("two concurrent starts of different planned sprints leave exactly one active", async () => {
            const { client, workspaceId } = await setup();
            const p1 = await makeSprint({
                workspaceId,
                name: "P1",
                status: "planned",
            });
            const p2 = await makeSprint({
                workspaceId,
                name: "P2",
                status: "planned",
            });

            const [r1, r2] = await Promise.all([
                client.post(`/api/v1/sprints/${p1.id}/start`),
                client.post(`/api/v1/sprints/${p2.id}/start`),
            ]);

            expect([r1.status, r2.status].sort()).toEqual([200, 422]);

            const actives = await getDb()
                .select()
                .from(sprints)
                .where(
                    and(
                        eq(sprints.workspaceId, workspaceId),
                        eq(sprints.status, "active"),
                    ),
                );
            expect(actives).toHaveLength(1);
        });
    });

    describe("not found", () => {
        it("404 for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints/spr-nope/start");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 for a sprint in another workspace", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            const theirs = await makeSprint({
                workspaceId: otherWs.id,
                status: "planned",
            });

            const res = await client.post(`/api/v1/sprints/${theirs.id}/start`);

            expect(res.status).toBe(404);
            expect(await statusOf(theirs.id)).toBe("planned");
        });
    });

    describe("authorization (👑 owner/admin)", () => {
        it.each<Role>(["owner", "admin"])("allows a %s (200)", async (role) => {
            const { client, workspaceId } = await setup(role);
            const s = await makeSprint({ workspaceId, status: "planned" });
            const res = await client.post(`/api/v1/sprints/${s.id}/start`);
            expect(res.status).toBe(200);
        });

        it.each<Role>(["member", "guest"])(
            "forbids a %s (403)",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId, status: "planned" });
                const res = await client.post(`/api/v1/sprints/${s.id}/start`);
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await statusOf(s.id)).toBe("planned");
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status: "planned" });
            const http = await oneOff();
            const res = await http.post(`/api/v1/sprints/${s.id}/start`);
            expect(res.status).toBe(401);
        });
    });
});
