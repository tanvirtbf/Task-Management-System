import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { Role } from "../../src/constants";

/**
 * §20 #2 — GET /api/v1/sprints/active
 *
 * 🔐 any member. Returns the single active sprint as a BARE object, or
 * 404 `sprint.not_found` when none is active.
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

describe("GET /api/v1/sprints/active", () => {
    describe("happy path", () => {
        it("returns the active sprint as a bare object", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                name: "Current",
                status: "active",
            });

            const res = await client.get("/api/v1/sprints/active");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(s.id);
            expect(res.body.status).toBe("active");
            expect(Object.keys(res.body).sort()).toEqual(WIRE_KEYS);
        });

        it("returns the active sprint even when planned/closed sprints exist", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "P", status: "planned" });
            await makeSprint({ workspaceId, name: "C", status: "closed" });
            const active = await makeSprint({
                workspaceId,
                name: "A",
                status: "active",
            });

            const res = await client.get("/api/v1/sprints/active");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(active.id);
        });
    });

    describe("not found", () => {
        it("404 sprint.not_found when there is no active sprint", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, status: "planned" });

            const res = await client.get("/api/v1/sprints/active");

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 when the workspace has no sprints at all", async () => {
            const { client } = await setup();
            const res = await client.get("/api/v1/sprints/active");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });
    });

    describe("authorization (🔐 any member)", () => {
        it.each<Role>(["owner", "admin", "member", "guest"])(
            "allows a %s to read the active sprint",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                await makeSprint({ workspaceId, status: "active" });
                const res = await client.get("/api/v1/sprints/active");
                expect(res.status).toBe(200);
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const http = await oneOff();
            const res = await http.get("/api/v1/sprints/active");
            expect(res.status).toBe(401);
        });
    });

    describe("tenant isolation", () => {
        it("does not see another workspace's active sprint", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            await makeSprint({ workspaceId: otherWs.id, status: "active" });

            const res = await client.get("/api/v1/sprints/active");

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("returns only its OWN active sprint when both workspaces have one", async () => {
            const { client, workspaceId } = await setup();
            const mine = await makeSprint({
                workspaceId,
                name: "Mine",
                status: "active",
            });
            const otherWs = await makeWorkspace();
            await makeSprint({
                workspaceId: otherWs.id,
                name: "Theirs",
                status: "active",
            });

            const res = await client.get("/api/v1/sprints/active");

            expect(res.body.id).toBe(mine.id);
            expect(res.body.name).toBe("Mine");
        });
    });
});
