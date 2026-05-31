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
 * §20 #5 — PATCH /api/v1/sprints/:id
 *
 * 👑 Owner/Admin. Partial update of name / goal / dates / committed_points.
 * Returns 200 + the bare updated `Sprint`; records `workspace_activity`
 * (action `updated`) only when something actually changed.
 */

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

describe("PATCH /api/v1/sprints/:id", () => {
    describe("happy path", () => {
        it("updates the name and returns 200", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, name: "Old" });

            const res = await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "New" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("New");
        });

        it("updates goal, dates and committed_points together", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });

            const res = await client.patch(`/api/v1/sprints/${s.id}`).send({
                goal: "Refined goal",
                start_date: "2026-07-01",
                end_date: "2026-07-20",
                committed_points: 34,
            });

            expect(res.status).toBe(200);
            expect(res.body.goal).toBe("Refined goal");
            expect(res.body.start_date).toBe("2026-07-01");
            expect(res.body.end_date).toBe("2026-07-20");
            expect(res.body.committed_points).toBe(34);
        });

        it("clears goal when null is sent", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, goal: "Has goal" });

            const res = await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ goal: null });

            expect(res.status).toBe(200);
            expect(res.body.goal).toBeNull();
        });

        it("can edit an active or closed sprint (no status restriction)", async () => {
            const { client, workspaceId } = await setup();
            const active = await makeSprint({ workspaceId, status: "active" });
            const closed = await makeSprint({ workspaceId, status: "closed" });

            const r1 = await client
                .patch(`/api/v1/sprints/${active.id}`)
                .send({ goal: "still editable" });
            const r2 = await client
                .patch(`/api/v1/sprints/${closed.id}`)
                .send({ committed_points: 5 });

            expect(r1.status).toBe(200);
            expect(r2.status).toBe(200);
        });
    });

    describe("no-op", () => {
        it("an empty body is a 200 no-op that writes no activity", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({ workspaceId, name: "Same" });

            const res = await client.patch(`/api/v1/sprints/${s.id}`).send({});

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Same");
            expect(await wsActivityRows(workspaceId, s.id)).toHaveLength(0);
        });

        it("sending identical values writes no activity", async () => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                name: "Keep",
                committedPoints: 8,
            });

            const res = await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "Keep", committed_points: 8 });

            expect(res.status).toBe(200);
            expect(await wsActivityRows(workspaceId, s.id)).toHaveLength(0);
        });
    });

    describe("side effects", () => {
        it("records one 'updated' activity row listing changed fields", async () => {
            const { client, workspaceId, u } = await setup();
            const s = await makeSprint({ workspaceId, name: "Before" });

            await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "After", committed_points: 13 });

            const rows = await wsActivityRows(workspaceId, s.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe("updated");
            expect(rows[0].actorId).toBe(u.id);
            expect(rows[0].context).toMatchObject({
                fields: expect.arrayContaining(["name", "committed_points"]),
            });
        });
    });

    describe("not found", () => {
        it("404 for an unknown id", async () => {
            const { client } = await setup();
            const res = await client
                .patch("/api/v1/sprints/spr-nope")
                .send({ name: "x" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("404 for a sprint in another workspace", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            const theirs = await makeSprint({ workspaceId: otherWs.id });

            const res = await client
                .patch(`/api/v1/sprints/${theirs.id}`)
                .send({ name: "hijack" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("sprint.not_found");
        });

        it("does not mutate a cross-tenant sprint on a 404", async () => {
            const { client } = await setup();
            const otherWs = await makeWorkspace();
            const theirs = await makeSprint({
                workspaceId: otherWs.id,
                name: "Untouched",
            });

            await client
                .patch(`/api/v1/sprints/${theirs.id}`)
                .send({ name: "hijack" });

            const [row] = await getDb()
                .select()
                .from(sprints)
                .where(eq(sprints.id, theirs.id));
            expect(row.name).toBe("Untouched");
        });
    });

    describe("validation (422)", () => {
        const patchSprint = async (body: Record<string, unknown>) => {
            const { client, workspaceId } = await setup();
            const s = await makeSprint({
                workspaceId,
                startDate: "2026-06-10",
                endDate: "2026-06-20",
            });
            const res = await client.patch(`/api/v1/sprints/${s.id}`).send(body);
            return res;
        };

        it("rejects a name longer than 80 chars", async () => {
            const res = await patchSprint({ name: "x".repeat(81) });
            expect(res.status).toBe(422);
        });

        it("rejects an empty name", async () => {
            const res = await patchSprint({ name: "" });
            expect(res.status).toBe(422);
        });

        it("rejects a malformed date", async () => {
            const res = await patchSprint({ start_date: "2026/06/01" });
            expect(res.status).toBe(422);
        });

        it("rejects negative committed_points", async () => {
            const res = await patchSprint({ committed_points: -1 });
            expect(res.status).toBe(422);
        });

        it("rejects start_date moved AFTER the stored end_date", async () => {
            const res = await patchSprint({ start_date: "2026-06-25" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects end_date moved BEFORE the stored start_date", async () => {
            const res = await patchSprint({ end_date: "2026-06-05" });
            expect(res.status).toBe(422);
        });
    });

    describe("conflict", () => {
        it("409 sprint.duplicate when renaming onto an existing name", async () => {
            const { client, workspaceId } = await setup();
            await makeSprint({ workspaceId, name: "Taken" });
            const s = await makeSprint({ workspaceId, name: "Free" });

            const res = await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "Taken" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("sprint.duplicate");
        });
    });

    describe("authorization (👑 owner/admin)", () => {
        it.each<Role>(["owner", "admin"])("allows a %s (200)", async (role) => {
            const { client, workspaceId } = await setup(role);
            const s = await makeSprint({ workspaceId });
            const res = await client
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "Renamed" });
            expect(res.status).toBe(200);
        });

        it.each<Role>(["member", "guest"])(
            "forbids a %s (403)",
            async (role) => {
                const { client, workspaceId } = await setup(role);
                const s = await makeSprint({ workspaceId });
                const res = await client
                    .patch(`/api/v1/sprints/${s.id}`)
                    .send({ name: "Renamed" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            },
        );
    });

    describe("authentication", () => {
        it("rejects a request with no token (401)", async () => {
            const { workspaceId } = await setup();
            const s = await makeSprint({ workspaceId });
            const http = await oneOff();
            const res = await http
                .patch(`/api/v1/sprints/${s.id}`)
                .send({ name: "x" });
            expect(res.status).toBe(401);
        });
    });
});
