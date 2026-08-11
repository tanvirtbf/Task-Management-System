import { getDb } from "../../src/db/client";
import { resetPolicy } from "../../src/rbac/policy";
import { TaskActivityRepo } from "../../src/repositories/TaskActivityRepo";
import { TaskMembershipRepo } from "../../src/repositories/TaskMembershipRepo";
import { makeTask } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * Team-access P2 (scan G11) — `GET /tasks/:id/activity` now carries the
 * `task.view` gate, and its reach is EXACTLY the task read's reach:
 *
 *   - the route gate answers the verb ("do you hold task.view anywhere?"),
 *   - the service resolves the task through the scope-filtered TasksRepo
 *     WITH the own-escape, so:
 *       · a space-scoped viewer reads history only inside their space,
 *       · an out-of-scope task stays a 404 (no existence oracle),
 *       · a cross-team ASSIGNEE keeps their own task's history (the B1
 *         invariant — without it, "assigned across teams" would mean
 *         "cannot see who changed what on your own work").
 */

beforeAll(() => resetPolicy());

const PATH = (id: string) => `/api/v1/tasks/${id}/activity`;

const seedTwoSpaces = async () => {
    const ws = await rbacWorkspace();
    const owner = await userWithSystemRole(ws, "owner");
    const spaceA = await makeRbacSpace(ws.id, owner.id, "Team A");
    const spaceB = await makeRbacSpace(ws.id, owner.id, "Team B");
    const listA = await makeRbacList(ws.id, spaceA, owner.id);
    const listB = await makeRbacList(ws.id, spaceB, owner.id);
    const taskA = await makeTask({
        workspaceId: ws.id,
        listId: listA,
        createdBy: owner.id,
    });
    const taskB = await makeTask({
        workspaceId: ws.id,
        listId: listB,
        createdBy: owner.id,
    });
    const activity = new TaskActivityRepo(getDb());
    await activity.recordMany([
        { taskId: taskA.id, actorId: owner.id, action: "task_created" },
        { taskId: taskB.id, actorId: owner.id, action: "task_created" },
    ]);
    return { ws, owner, spaceA, spaceB, taskA, taskB };
};

describe("GET /tasks/:id/activity — task.view gate + task-read reach", () => {
    it("a space-scoped viewer reads history inside their space; outside is 404, not a leak", async () => {
        const { ws, spaceA, taskA, taskB } = await seedTwoSpaces();
        const viewer = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "space"],
            ],
            { spaceId: spaceA },
        );

        const inside = await viewer.client.get(PATH(taskA.id));
        expect(inside.status).toBe(200);
        expect(inside.body.data).toHaveLength(1);
        expect(inside.body.data[0].action).toBe("task_created");

        const outside = await viewer.client.get(PATH(taskB.id));
        expect(outside.status).toBe(404);
        expect(outside.body.error.code).toBe("task.not_found");
    });

    it("a cross-team ASSIGNEE reads their own task's history via the own-escape (B1)", async () => {
        const { ws, owner, spaceA, taskB } = await seedTwoSpaces();
        // The B1 team-role shape: sees their own team, task reach = `own`.
        const assignee = await userWithPermissions(
            ws,
            [
                ["space.view", "space"],
                ["task.view", "own"],
            ],
            { spaceId: spaceA },
        );

        // Not assigned yet → the Team B task is invisible.
        const before = await assignee.client.get(PATH(taskB.id));
        expect(before.status).toBe(404);

        // Team B assigns them → the escape turns their own task visible,
        // history included.
        await new TaskMembershipRepo(getDb()).addAssignees(
            taskB.id,
            [assignee.id],
            owner.id,
        );
        const after = await assignee.client.get(PATH(taskB.id));
        expect(after.status).toBe(200);
        expect(after.body.data).toHaveLength(1);
    });

    it("a role holding NO task.view is refused at the route (403), even for a task it could name", async () => {
        const { ws, taskA } = await seedTwoSpaces();
        const stripped = await userWithPermissions(ws, ["comment.create"]);

        const res = await stripped.client.get(PATH(taskA.id));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("auth.forbidden");
    });
});
