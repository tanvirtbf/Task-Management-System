import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSprint,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { Role } from "../../src/constants";

/**
 * §20 #3 — GET /api/v1/sprints/:id
 *
 * 🔐 any member. Returns one sprint (bare object) resolved within the caller's
 * workspace; 404 `sprint.not_found` for a missing OR cross-tenant id.
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

describe("GET /api/v1/sprints/:id", () => {
    describe("happy path", () => {
        it("returns the sprint by id as a bare object", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                name: "Readable",
                goal: "Do work",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
                committedPoints: 13,
            });

            const res = await client.get(`/api/v1/sprints/${s.id}`);

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(WIRE_KEYS);
            expect(res.body.id).toBe(s.id);
            expect(res.body.name).toBe("Readable");
            expect(res.body.goal).toBe("Do work");
            expect(res.body.start_date).toBe("2026-06-01");
            expect(res.body.end_date).toBe("2026-06-14");
            expect(res.body.committed_points).toBe(13);
        });

        it.each<"planned" | "active" | "closed">([
            "planned",
            "active",
            "closed",
        ])("returns a %s sprint", async (status) => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, status });
            const res = await client.get(`/api/v1/sprints/${s.id}`);
            expect(res.status).toBe(200);
            expect(res.body.status).toBe(status);
        });
    });

    describe("not found", () => {
        it("404 sprint.not_found for an unknown id", async () => {
            const { client } = await setup();
            const res = await client.get("/api/v1/sprints/spr-does-not-exist");
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 for a sprint that belongs to another workspace (no cross-tenant oracle)", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            const theirs = await makeSprint({ workspaceId: otherWs.id });

            const res = await client.get(`/api/v1/sprints/${theirs.id}`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });
    });

    describe("validation", () => {
        it("422 when the id exceeds the column width", async () => {
            const { client } = await setup();
            const res = await client.get(`/api/v1/sprints/${"x".repeat(65)}`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("authorization (🔐 any member)", () => {
        it.each<Role>(["owner", "admin", "member", "guest"])(
            "allows a %s to read",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId });
                const res = await client.get(`/api/v1/sprints/${s.id}`);
                expect(res.status).toBe(200);
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const http = await oneOff();
            const res = await http.get(`/api/v1/sprints/${s.id}`);
            expect(res.status).toBe(401);
        });
    });
});
