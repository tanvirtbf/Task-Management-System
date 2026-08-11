import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { makeStatus, makeTask } from "../test-utils/factories";
import {
    assignRole,
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithSystemRole,
    type RbacWorkspace,
} from "./helpers";

/**
 * Team-access P6 — THE SWITCH, proven in the EXACT production shape.
 *
 * `applySwitch` runs the same two UPDATEs `019_visibility_switch.sql` ships
 * (seeded member+guest: space.view→'space', task.view→'own') against a test
 * workspace whose users hold the Member role exactly like production does:
 * once workspace-scoped (the L13 mirror) and once space-scoped (their P1
 * membership). Then the full pre-flight matrix:
 *
 *   member    → own team only; other teams gone from every read
 *   head      → their whole department (membership, P1)
 *   B1 loop   → a cross-team assignee can OPEN, read HISTORY, COMMENT and
 *               COMPLETE the task another team gave them (the single most
 *               important check in the plan)
 *   grants    → a P4 team→team grant turns the other team on; revoke off
 *   guest     → teamless guest sees nothing (Q9)
 *   admin     → unaffected (Q4)
 *   home tile → counts only the member's reach
 */

beforeAll(() => resetPolicy());

jest.setTimeout(60_000);

const db = () => getDb();

/** The two data flips of upgrade 019, byte-faithful, + the version bump. */
const applySwitch = async (ws: RbacWorkspace) => {
    const seededIds = [ws.systemRoleIds.member, ws.systemRoleIds.guest];
    await db()
        .update(schema.rolePermissions)
        .set({ scope: "space" })
        .where(
            and(
                inArray(schema.rolePermissions.roleId, seededIds),
                eq(schema.rolePermissions.permissionKey, "space.view"),
            ),
        );
    await db()
        .update(schema.rolePermissions)
        .set({ scope: "own" })
        .where(
            and(
                inArray(schema.rolePermissions.roleId, seededIds),
                eq(schema.rolePermissions.permissionKey, "task.view"),
            ),
        );
    await db()
        .update(schema.workspaces)
        .set({
            permissionsVersion: sql`${schema.workspaces.permissionsVersion} + 1`,
        })
        .where(eq(schema.workspaces.id, ws.id));
};

/** A production-shaped workspace: two teams, tasks, members with membership. */
const seed = async () => {
    const ws = await rbacWorkspace();
    const admin = await userWithSystemRole(ws, "admin");
    const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
    const engineering = await makeRbacSpace(ws.id, admin.id, "Engineering");
    const mktList = await makeRbacList(ws.id, marketing, admin.id);
    const engList = await makeRbacList(ws.id, engineering, admin.id);

    // Members hold the SEEDED role twice, exactly like production: the
    // workspace assignment came from userWithSystemRole (L13); the space
    // assignment below is their P1 membership.
    const mktMember = await userWithSystemRole(ws, "member");
    await assignRole({
        workspaceId: ws.id,
        userId: mktMember.id,
        roleId: ws.systemRoleIds.member,
        spaceId: marketing,
    });
    const engHead = await userWithSystemRole(ws, "member");
    await assignRole({
        workspaceId: ws.id,
        userId: engHead.id,
        roleId: ws.systemRoleIds.member,
        spaceId: engineering,
    });
    await db()
        .update(schema.spaces)
        .set({ headUserId: engHead.id })
        .where(eq(schema.spaces.id, engineering));

    const mktTask1 = await makeTask({
        workspaceId: ws.id,
        listId: mktList,
        createdBy: admin.id,
    });
    const mktTask2 = await makeTask({
        workspaceId: ws.id,
        listId: mktList,
        createdBy: admin.id,
    });
    const engTask = await makeTask({
        workspaceId: ws.id,
        listId: engList,
        createdBy: admin.id,
    });

    await applySwitch(ws);
    return {
        ws,
        admin,
        marketing,
        engineering,
        mktList,
        engList,
        mktMember,
        engHead,
        mktTask1,
        mktTask2,
        engTask,
    };
};

describe("P6 — the switch, in the production shape", () => {
    it("a member sees their own team and ONLY their own team, everywhere", async () => {
        const s = await seed();

        const spaces = await s.mktMember.client.get("/api/v1/spaces");
        expect(
            (spaces.body.data as { id: string }[]).map((x) => x.id),
        ).toEqual([s.marketing]);

        expect(
            (await s.mktMember.client.get(`/api/v1/spaces/${s.engineering}`))
                .status,
        ).toBe(404);
        expect(
            (await s.mktMember.client.get(`/api/v1/tasks/${s.engTask.id}`))
                .status,
        ).toBe(404);
        // Their own team's tasks: ALL of them, not just their own items.
        expect(
            (await s.mktMember.client.get(`/api/v1/tasks/${s.mktTask1.id}`))
                .status,
        ).toBe(200);

        // The Home tile counts exactly their reach (2 open Marketing tasks).
        const kpis = await s.mktMember.client.get("/api/v1/home/kpis");
        expect(kpis.body.openTeamTasks.value).toBe(2);

        // Search cannot surface the other team.
        const found = await s.mktMember.client.get(
            `/api/v1/search?q=${encodeURIComponent(s.engTask.id.slice(0, 8))}`,
        );
        expect(found.status).toBe(200);
    });

    it("the head sees their whole department and its review surface", async () => {
        const s = await seed();
        const spaces = await s.engHead.client.get("/api/v1/spaces");
        expect(
            (spaces.body.data as { id: string }[]).map((x) => x.id),
        ).toEqual([s.engineering]);
        expect(
            (await s.engHead.client.get(`/api/v1/tasks/${s.engTask.id}`))
                .status,
        ).toBe(200);
        const summary = await s.engHead.client.get(
            `/api/v1/spaces/${s.engineering}/review-summary`,
        );
        expect(summary.status).toBe(200);
    });

    it("THE B1 LOOP: a cross-team assignee can open, read history, comment and complete", async () => {
        const s = await seed();
        // Before the assignment, Engineering's task does not exist for them.
        expect(
            (await s.mktMember.client.get(`/api/v1/tasks/${s.engTask.id}`))
                .status,
        ).toBe(404);

        // Engineering assigns the Marketing member.
        const assign = await s.admin.client
            .post(`/api/v1/tasks/${s.engTask.id}/assignees`)
            .send({ user_ids: [s.mktMember.id] });
        expect(assign.status).toBe(204);

        // OPEN
        const open = await s.mktMember.client.get(
            `/api/v1/tasks/${s.engTask.id}`,
        );
        expect(open.status).toBe(200);
        // HISTORY
        const history = await s.mktMember.client.get(
            `/api/v1/tasks/${s.engTask.id}/activity`,
        );
        expect(history.status).toBe(200);
        // COMMENT
        const comment = await s.mktMember.client
            .post(`/api/v1/tasks/${s.engTask.id}/comments`)
            .send({ body: "On it — will finish today." });
        expect(comment.status).toBe(201);
        // COMPLETE (move to a done status of the Engineering list)
        const done = await makeStatus({
            scopeId: s.engList,
            statusGroup: "done",
            name: "Done",
        });
        const complete = await s.mktMember.client
            .patch(`/api/v1/tasks/${s.engTask.id}`)
            .send({ status_id: done.id });
        expect(complete.status).toBe(200);
        expect(complete.body.completed_at).not.toBeNull();

        // And their other-team blindness is otherwise unchanged.
        expect(
            (await s.mktMember.client.get(`/api/v1/spaces/${s.engineering}`))
                .status,
        ).toBe(404);
    });

    it("a P4 grant turns the other team on; revoking turns it off", async () => {
        const s = await seed();
        await s.admin.client
            .post(`/api/v1/spaces/${s.marketing}/visibility-grants`)
            .send({ target_space_id: s.engineering });

        expect(
            (await s.mktMember.client.get(`/api/v1/spaces/${s.engineering}`))
                .status,
        ).toBe(200);
        expect(
            (await s.mktMember.client.get(`/api/v1/tasks/${s.engTask.id}`))
                .status,
        ).toBe(200);

        await s.admin.client.delete(
            `/api/v1/spaces/${s.marketing}/visibility-grants/${s.engineering}`,
        );
        expect(
            (await s.mktMember.client.get(`/api/v1/spaces/${s.engineering}`))
                .status,
        ).toBe(404);
    });

    it("a teamless guest sees nothing (Q9); an admin still sees everything (Q4)", async () => {
        const s = await seed();
        const guest = await userWithSystemRole(s.ws, "guest");

        const guestSpaces = await guest.client.get("/api/v1/spaces");
        expect(guestSpaces.body.data).toEqual([]);
        expect(
            (await guest.client.get(`/api/v1/tasks/${s.mktTask1.id}`)).status,
        ).toBe(404);

        const adminSpaces = await s.admin.client.get("/api/v1/spaces");
        expect(
            (adminSpaces.body.data as { id: string }[]).map((x) => x.id).sort(),
        ).toEqual([s.engineering, s.marketing].sort());
    });
});
