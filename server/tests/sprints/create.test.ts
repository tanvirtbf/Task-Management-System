import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeUser,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { sprints, workspaceActivity } from "../../src/db/schema";
import type { Role } from "../../src/constants";

/**
 * §20 #4 — POST /api/v1/sprints
 *
 * 👑 Owner/Admin. Creates a `planned` sprint, returns 201 + the bare `Sprint`.
 * Records a `workspace_activity` (entity_type `sprint`, action `created`).
 */

const WIRE_KEYS = [
    "id",
    "name",
    "goal",
    "start_date",
    "end_date",
    "status",
    "committed_points",
].sort();

const valid = {
    name: "Sprint 1",
    goal: "Ship MVP",
    start_date: "2026-06-01",
    end_date: "2026-06-14",
    committed_points: 21,
};

const setup = async (role: Role = "owner") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    return { u, client, workspaceId: u.workspaceId };
};

const wsActivityRows = async (workspaceId: string, entityId: string) =>
    getDb()
        .select()
        .from(workspaceActivity)
        .where(
            and(
                eq(workspaceActivity.workspaceId, workspaceId),
                eq(workspaceActivity.entityId, entityId),
            ),
        );

describe("POST /api/v1/sprints", () => {
    describe("happy path", () => {
        it("creates a planned sprint and returns 201 + bare Sprint", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints").send(valid);

            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(WIRE_KEYS);
            expect(res.body.name).toBe("Sprint 1");
            expect(res.body.goal).toBe("Ship MVP");
            expect(res.body.start_date).toBe("2026-06-01");
            expect(res.body.end_date).toBe("2026-06-14");
            expect(res.body.committed_points).toBe(21);
            expect(res.body.status).toBe("planned");
        });

        it("persists the row in the database", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints").send(valid);

            const [row] = await getDb()
                .select()
                .from(sprints)
                .where(eq(sprints.id, res.body.id));
            expect(row).toBeTruthy();
            expect(row.name).toBe("Sprint 1");
            expect(row.status).toBe("planned");
        });

        it("defaults committed_points to 0 when omitted", async () => {
            const { client } = await setup();
            const res = await client
                .post("/api/v1/sprints")
                .send({
                    name: "No points",
                    start_date: "2026-06-01",
                    end_date: "2026-06-14",
                });
            expect(res.status).toBe(201);
            expect(res.body.committed_points).toBe(0);
        });

        it("accepts an omitted goal as null", async () => {
            const { client } = await setup();
            const res = await client
                .post("/api/v1/sprints")
                .send({
                    name: "No goal",
                    start_date: "2026-06-01",
                    end_date: "2026-06-14",
                });
            expect(res.status).toBe(201);
            expect(res.body.goal).toBeNull();
        });

        it("allows start_date == end_date (CHECK is <=)", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints").send({
                name: "One day",
                start_date: "2026-06-10",
                end_date: "2026-06-10",
            });
            expect(res.status).toBe(201);
        });
    });

    describe("side effects", () => {
        it("records exactly one workspace_activity 'created' row", async () => {
            const { client, u, workspaceId } = await setup();
            const res = await client.post("/api/v1/sprints").send(valid);

            const rows = await wsActivityRows(workspaceId, res.body.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("sprint");
            expect(rows[0].action).toBe("created");
            expect(rows[0].actorId).toBe(u.id);
        });
    });

    describe("validation (422)", () => {
        const post = async (body: Record<string, unknown>) => {
            const { client } = await setup();
            return client.post("/api/v1/sprints").send(body);
        };

        it("rejects a missing name", async () => {
            const res = await post({
                start_date: "2026-06-01",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects a missing start_date", async () => {
            const res = await post({ name: "X", end_date: "2026-06-14" });
            expect(res.status).toBe(422);
        });

        it("rejects a missing end_date", async () => {
            const res = await post({ name: "X", start_date: "2026-06-14" });
            expect(res.status).toBe(422);
        });

        it("rejects a name longer than 80 chars", async () => {
            const res = await post({
                name: "x".repeat(81),
                start_date: "2026-06-01",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(422);
        });

        it("rejects a goal longer than 300 chars", async () => {
            const res = await post({
                name: "X",
                goal: "g".repeat(301),
                start_date: "2026-06-01",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(422);
        });

        it("rejects a malformed date", async () => {
            const res = await post({
                name: "X",
                start_date: "06/01/2026",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(422);
        });

        it("rejects negative committed_points", async () => {
            const res = await post({
                name: "X",
                start_date: "2026-06-01",
                end_date: "2026-06-14",
                committed_points: -5,
            });
            expect(res.status).toBe(422);
        });

        it("rejects end_date before start_date with validation.failed", async () => {
            const res = await post({
                name: "Backwards",
                start_date: "2026-06-20",
                end_date: "2026-06-10",
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("boundary / unicode", () => {
        it("accepts a name of exactly 80 chars", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints").send({
                name: "x".repeat(80),
                start_date: "2026-06-01",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(201);
        });

        it("accepts a Bangla name", async () => {
            const { client } = await setup();
            const res = await client.post("/api/v1/sprints").send({
                name: "স্প্রিন্ট এক",
                start_date: "2026-06-01",
                end_date: "2026-06-14",
            });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe("স্প্রিন্ট এক");
        });
    });

    describe("authorization (👑 owner/admin)", () => {
        it.each<Role>(["owner", "admin"])("allows a %s (201)", async (role) => {
            const { client } = await setup(role);
            const res = await client.post("/api/v1/sprints").send(valid);
            expect(res.status).toBe(201);
        });

        it.each<Role>(["member", "guest"])(
            "forbids a %s (403 auth.forbidden)",
            async (role) => {
                const { client } = await setup(role);
                const res = await client.post("/api/v1/sprints").send(valid);
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            },
        );

        it("a forbidden member does not create a row", async () => {
            const { client, workspaceId } = await setup("member");
            await client.post("/api/v1/sprints").send(valid);
            const rows = await getDb()
                .select()
                .from(sprints)
                .where(eq(sprints.workspaceId, workspaceId));
            expect(rows).toHaveLength(0);
        });
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const http = await oneOff();
            const res = await http.post("/api/v1/sprints").send(valid);
            expect(res.status).toBe(401);
        });
    });

    describe("conflict / isolation", () => {
        it("409 sprint.duplicate on a duplicate name in the same workspace", async () => {
            const { client } = await setup();
            await client.post("/api/v1/sprints").send(valid);
            const res = await client.post("/api/v1/sprints").send(valid);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.duplicate");
        });

        it("allows the same name in a different workspace", async () => {
            const a = await setup();
            const b = await setup();
            const r1 = await a.client.post("/api/v1/sprints").send(valid);
            const r2 = await b.client.post("/api/v1/sprints").send(valid);
            expect(r1.status).toBe(201);
            expect(r2.status).toBe(201);
        });

        it("ignores a workspace_id in the body (scope comes from the token)", async () => {
            const { client, workspaceId } = await setup();
            const other = await makeSprint({
                workspaceId: (await makeUser()).workspaceId,
            });
            const res = await client
                .post("/api/v1/sprints")
                .send({ ...valid, workspace_id: "ws-evil", id: other.id });

            expect(res.status).toBe(201);
            const [row] = await getDb()
                .select()
                .from(sprints)
                .where(eq(sprints.id, res.body.id));
            expect(row.workspaceId).toBe(workspaceId);
        });
    });
});
