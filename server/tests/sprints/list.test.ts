import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { Role } from "../../src/constants";

/**
 * §20 #1 — GET /api/v1/sprints
 *
 * 🔐 any member. Returns a BARE `Sprint[]` (no pagination envelope — sprints are
 * a small per-workspace collection) ordered newest-first by `start_date`.
 * Optional `?status=` filter.
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

const setup = async (role: Role = "member") => {
    const u = await makeUser({ role });
    const client = await makeLoggedInClient(u);
    return { u, client, workspaceId: u.workspaceId };
};

describe("GET /api/v1/sprints", () => {
    describe("happy path", () => {
        it("returns all sprints in the workspace", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "Alpha" });
            await makeSprint({ workspaceId, name: "Beta" });

            const res = await client.get("/api/v1/sprints");

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).toHaveLength(2);
        });

        it("returns an empty array when there are no sprints", async () => {
            const { client } = await setup();
            const res = await client.get("/api/v1/sprints");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("orders sprints newest-first by start_date", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({
                workspaceId,
                name: "June",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
            });
            await makeSprint({
                workspaceId,
                name: "August",
                startDate: "2026-08-01",
                endDate: "2026-08-14",
            });
            await makeSprint({
                workspaceId,
                name: "July",
                startDate: "2026-07-01",
                endDate: "2026-07-14",
            });

            const res = await client.get("/api/v1/sprints");

            expect(res.body.map((s: { name: string }) => s.name)).toEqual([
                "August",
                "July",
                "June",
            ]);
        });
    });

    describe("wire shape", () => {
        it("serialises exactly the documented snake_case fields", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({
                workspaceId,
                name: "Sprint One",
                goal: "Ship the thing",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
                status: "planned",
                committedPoints: 21,
            });

            const res = await client.get("/api/v1/sprints");
            const sprint = res.body[0];

            expect(Object.keys(sprint).sort()).toEqual(WIRE_KEYS);
            expect(sprint.name).toBe("Sprint One");
            expect(sprint.goal).toBe("Ship the thing");
            expect(sprint.start_date).toBe("2026-06-01");
            expect(sprint.end_date).toBe("2026-06-14");
            expect(sprint.status).toBe("planned");
            expect(sprint.committed_points).toBe(21);
        });

        it("emits goal as null when unset (never leaks workspace_id/timestamps)", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, goal: null });

            const res = await client.get("/api/v1/sprints");
            const sprint = res.body[0];

            expect(sprint.goal).toBeNull();
            expect(sprint).not.toHaveProperty("workspace_id");
            expect(sprint).not.toHaveProperty("created_at");
            expect(sprint).not.toHaveProperty("updated_at");
        });
    });

    describe("status filter", () => {
        const seedOneOfEach = async (workspaceId: string) => {
            await makeSprint({ workspaceId, name: "P", status: "planned" });
            await makeSprint({ workspaceId, name: "A", status: "active" });
            await makeSprint({ workspaceId, name: "C", status: "closed" });
        };

        it("?status=active returns only active sprints", async () => {
            const { client, workspaceId } = await setup();
            await seedOneOfEach(workspaceId);

            const res = await client.get("/api/v1/sprints?status=active");

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].status).toBe("active");
        });

        it("?status=planned returns only planned sprints", async () => {
            const { client, workspaceId } = await setup();
            await seedOneOfEach(workspaceId);

            const res = await client.get("/api/v1/sprints?status=planned");

            expect(res.body).toHaveLength(1);
            expect(res.body[0].status).toBe("planned");
        });

        it("rejects an unknown status with 422 validation.failed", async () => {
            const { client } = await setup();
            const res = await client.get("/api/v1/sprints?status=bogus");
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects a duplicated status param (array) with 422", async () => {
            const { client } = await setup();
            const res = await client.get(
                "/api/v1/sprints?status=planned&status=active",
            );
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("authorization (🔐 any member)", () => {
        it.each<Role>(["owner", "admin", "member", "guest"])(
            "allows a %s to list",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                await makeSprint({ workspaceId });
                const res = await client.get("/api/v1/sprints");
                expect(res.status).toBe(200);
                expect(res.body).toHaveLength(1);
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const http = await oneOff();
            const res = await http.get("/api/v1/sprints");
            expect(res.status).toBe(401);
        });
    });

    describe("tenant isolation", () => {
        it("never returns sprints from another workspace", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "Mine" });

            const otherWs = await makeWorkspace();
            await makeSprint({ workspaceId: otherWs.id, name: "Theirs" });

            const res = await client.get("/api/v1/sprints");

            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("Mine");
        });

        it("filtered results stay workspace-scoped", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "MineActive", status: "active" });

            const otherWs = await makeWorkspace();
            await makeSprint({
                workspaceId: otherWs.id,
                name: "TheirsActive",
                status: "active",
            });

            const res = await client.get("/api/v1/sprints?status=active");

            expect(res.body).toHaveLength(1);
            expect(res.body[0].name).toBe("MineActive");
        });
    });
});
