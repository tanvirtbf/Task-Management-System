import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { resetPolicy } from "../../src/rbac/policy";
import { fakeId } from "../../src/utils";
import { makeSprint, makeTask, makeTaskType } from "../test-utils/factories";
import {
    makeRbacList,
    makeRbacSpace,
    rbacWorkspace,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * Team-access P5 — the leak-closure walkthrough. One narrow-scoped user (all
 * the VERBS, reach clamped to their own team) probes every surface the P5
 * audit found OPEN. Each probe must answer 404/not-found — never the other
 * team's data, never a write landing there. And the SLA tile must agree with
 * the SLA queue (G7), and a @mention of someone who cannot see the task must
 * not notify them.
 *
 * All of this is DORMANT today (seeded roles see everything) — the full
 * module regressions are the no-behavior-change proof; THIS file proves the
 * closures actually close.
 */

beforeAll(() => resetPolicy());

jest.setTimeout(60_000);

const db = () => getDb();

const seed = async () => {
    const ws = await rbacWorkspace();
    const admin = await userWithSystemRole(ws, "admin");
    const teamA = await makeRbacSpace(ws.id, admin.id, "Mine");
    const teamB = await makeRbacSpace(ws.id, admin.id, "Theirs");
    const listA = await makeRbacList(ws.id, teamA, admin.id);
    const listB = await makeRbacList(ws.id, teamB, admin.id);
    const taskA = await makeTask({
        workspaceId: ws.id,
        listId: listA,
        createdBy: admin.id,
    });
    const taskB = await makeTask({
        workspaceId: ws.id,
        listId: listB,
        createdBy: admin.id,
    });
    // Every verb, clamped to team A by the space-scoped assignment.
    const viewer = await userWithPermissions(
        ws,
        [
            ["space.view", "space"],
            ["task.view", "own"],
            ["task.edit", "own"],
            ["comment.create", "all"],
            ["status.manage", "all"],
            ["form.manage", "all"],
            ["sprint.assign_tasks", "all"],
            ["attachment.upload", "all"],
            ["dependency.manage", "all"],
        ],
        { spaceId: teamA },
    );
    return { ws, admin, teamA, teamB, listA, listB, taskA, taskB, viewer };
};

describe("P5 — a narrow-scoped user cannot reach the other team through ANY side door", () => {
    it("SLA queue lists only their reach, and the Home tile agrees (G7)", async () => {
        const { viewer, taskA, taskB } = await seed();
        const past = new Date(Date.now() - 60 * 60 * 1000);
        for (const t of [taskA, taskB]) {
            await db()
                .update(schema.tasks)
                .set({ slaDueAt: past })
                .where(eq(schema.tasks.id, t.id));
        }

        const queue = await viewer.client.get("/api/v1/sla/breached");
        expect(queue.status).toBe(200);
        // §29: a BARE SLABreach[] (no {data} envelope).
        const ids = (queue.body as { task_id: string }[]).map(
            (r) => r.task_id,
        );
        expect(ids).toContain(taskA.id);
        expect(ids).not.toContain(taskB.id);

        const kpis = await viewer.client.get("/api/v1/home/kpis");
        expect(kpis.status).toBe(200);
        expect(kpis.body.slaBreaches.value).toBe(ids.length); // tile == queue
    });

    it("statuses on another team's board resolve as 404 for PATCH and DELETE", async () => {
        const { viewer, listA, listB } = await seed();
        const [statusB] = await db()
            .select({ id: schema.statuses.id })
            .from(schema.statuses)
            .where(eq(schema.statuses.scopeId, listB));
        const [statusA] = await db()
            .select({ id: schema.statuses.id })
            .from(schema.statuses)
            .where(eq(schema.statuses.scopeId, listA));

        const patchB = await viewer.client
            .patch(`/api/v1/statuses/${statusB.id}`)
            .send({ name: "Hijacked" });
        expect(patchB.status).toBe(404);
        const deleteB = await viewer.client.delete(
            `/api/v1/statuses/${statusB.id}`,
        );
        expect(deleteB.status).toBe(404);

        // Sanity: the SAME verbs work inside their own team.
        const patchA = await viewer.client
            .patch(`/api/v1/statuses/${statusA.id}`)
            .send({ name: "Renamed by owner team" });
        expect(patchA.status).toBe(200);
    });

    it("another team's form fields resolve as 404", async () => {
        const { admin, viewer, listB } = await seed();
        const formId = fakeId("form");
        await db().insert(schema.forms).values({
            id: formId,
            listId: listB,
            title: "Theirs form",
            publicSlug: `slug-${formId}`,
            createdBy: admin.id,
        });
        const fieldId = fakeId("ff");
        await db().insert(schema.formFields).values({
            id: fieldId,
            formId,
            fieldKind: "task_attr",
            fieldKey: "name",
            label: "Name",
        });

        const res = await viewer.client.delete(
            `/api/v1/form-fields/${fieldId}`,
        );
        expect(res.status).toBe(404);
        const still = await db()
            .select({ id: schema.formFields.id })
            .from(schema.formFields)
            .where(eq(schema.formFields.id, fieldId));
        expect(still).toHaveLength(1);
    });

    it("another team's attachments: download, finalize and delete all 404", async () => {
        const { admin, viewer, taskB } = await seed();
        const attId = fakeId("att");
        await db().insert(schema.attachments).values({
            id: attId,
            taskId: taskB.id,
            name: "secret.pdf",
            storageKey: `k/${attId}`,
            mimeType: "application/pdf",
            sizeBytes: BigInt(1000),
            uploadedBy: admin.id,
            uploadStatus: "complete",
        });

        expect(
            (
                await viewer.client.get(
                    `/api/v1/attachments/${attId}/download`,
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await viewer.client
                    .post(`/api/v1/attachments/${attId}/finalize`)
                    .send({})
            ).status,
        ).toBe(404);
        expect(
            (await viewer.client.delete(`/api/v1/attachments/${attId}`))
                .status,
        ).toBe(404);
    });

    it("a dependency edge on an invisible task cannot be deleted", async () => {
        const { admin, viewer, ws, teamB, listB, taskB } = await seed();
        const otherB = await makeTask({
            workspaceId: ws.id,
            listId: listB,
            createdBy: admin.id,
        });
        const edgeId = fakeId("dep");
        await db().insert(schema.taskDependencies).values({
            id: edgeId,
            taskId: taskB.id,
            relatedTaskId: otherB.id,
            createdBy: admin.id,
        });

        const res = await viewer.client.delete(
            `/api/v1/task-dependencies/${edgeId}`,
        );
        expect(res.status).toBe(404);
        const still = await db()
            .select({ id: schema.taskDependencies.id })
            .from(schema.taskDependencies)
            .where(eq(schema.taskDependencies.id, edgeId));
        expect(still).toHaveLength(1);
        void teamB;
    });

    it("an invisible task cannot be pulled into a sprint", async () => {
        const { ws, viewer, taskB } = await seed();
        const sprint = await makeSprint({ workspaceId: ws.id });

        const res = await viewer.client
            .post(`/api/v1/sprints/${sprint.id}/tasks`)
            .send({ task_ids: [taskB.id] });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);

        const [row] = await db()
            .select({ sprintId: schema.tasks.sprintId })
            .from(schema.tasks)
            .where(eq(schema.tasks.id, taskB.id));
        expect(row.sprintId).toBeNull(); // the write never landed
    });

    it("@mentioning someone who cannot see the task does NOT notify them; a teammate is notified", async () => {
        const { ws, teamA, teamB, taskA, viewer } = await seed();
        // Outsider: scoped to team B — cannot see taskA.
        const outsider = await userWithPermissions(
            ws,
            [["space.view", "space"]],
            { spaceId: teamB },
        );
        // Teammate: scoped to team A — sees taskA.
        const teammate = await userWithPermissions(
            ws,
            [["space.view", "space"]],
            { spaceId: teamA },
        );
        const outsiderHandle = outsider.email.split("@")[0];
        const teammateHandle = teammate.email.split("@")[0];

        const res = await viewer.client
            .post(`/api/v1/tasks/${taskA.id}/comments`)
            .send({
                body: `@${outsiderHandle} @${teammateHandle} please review`,
            });
        expect(res.status).toBe(201);

        const notifsFor = async (userId: string) =>
            db()
                .select({ id: schema.notifications.id })
                .from(schema.notifications)
                .where(
                    and(
                        eq(schema.notifications.userId, userId),
                        eq(schema.notifications.type, "mentioned"),
                    ),
                );
        expect(await notifsFor(outsider.id)).toHaveLength(0); // leak closed
        expect(await notifsFor(teammate.id)).toHaveLength(1); // still works
    });

    /**
     * KI-14, opened by the 2026-07-29 scan and carried through three of them.
     *
     * `/eng/home` counts open bugs and incidents with a query that filters on
     * workspace and task type and nothing else, while the PREVIEW ids beside
     * the count are hydrated through a scoped read. So a narrow-scoped user
     * got the whole workspace's number next to an empty list — the count is
     * the leak, and the disagreement is how you notice it.
     */
    describe("KI-14 — /eng/home counts only what the caller can see", () => {
        const engHome = "/api/v1/eng/home";

        const seedBugs = async () => {
            const s = await seed();
            const bugType = await makeTaskType({
                workspaceId: s.ws.id,
                name: "Bug",
            });
            const incidentType = await makeTaskType({
                workspaceId: s.ws.id,
                name: "Incident",
            });
            const mine = await makeTask({
                workspaceId: s.ws.id,
                listId: s.listA,
                createdBy: s.admin.id,
                taskTypeId: bugType.id,
                name: "My team's bug",
            });
            const theirs = await makeTask({
                workspaceId: s.ws.id,
                listId: s.listB,
                createdBy: s.admin.id,
                taskTypeId: bugType.id,
                name: "Other team's bug",
            });
            const theirIncident = await makeTask({
                workspaceId: s.ws.id,
                listId: s.listB,
                createdBy: s.admin.id,
                taskTypeId: incidentType.id,
                name: "Other team's incident",
            });
            return { ...s, mine, theirs, theirIncident };
        };

        it("does not count another team's open bugs", async () => {
            const { viewer, mine, theirs } = await seedBugs();

            const res = await viewer.client.get(engHome);

            expect(res.status).toBe(200);
            expect(res.body.open_bugs.count).toBe(1);
            const ids = res.body.open_bugs.top.map((t: { id: string }) => t.id);
            expect(ids).toContain(mine.id);
            expect(ids).not.toContain(theirs.id);
        });

        it("the count AGREES with the preview it sits next to", async () => {
            const { viewer } = await seedBugs();

            const res = await viewer.client.get(engHome);

            // The whole tile is one claim. A count of 2 over an empty list is
            // what this bug looked like from the browser.
            expect(res.body.open_bugs.count).toBe(res.body.open_bugs.top.length);
            expect(res.body.open_incidents.count).toBe(
                res.body.open_incidents.top.length,
            );
        });

        it("does not count another team's open incidents", async () => {
            const { viewer } = await seedBugs();

            const res = await viewer.client.get(engHome);

            expect(res.body.open_incidents.count).toBe(0);
            expect(res.body.open_incidents.top).toEqual([]);
        });

        it("an unrestricted admin still sees the whole workspace", async () => {
            const { admin, mine, theirs } = await seedBugs();

            const res = await admin.client.get(engHome);

            expect(res.status).toBe(200);
            expect(res.body.open_bugs.count).toBe(2);
            const ids = res.body.open_bugs.top.map((t: { id: string }) => t.id);
            expect(ids).toEqual(expect.arrayContaining([mine.id, theirs.id]));
            expect(res.body.open_incidents.count).toBe(1);
        });

        it("stale_tickets shows MY stale ticket even when the other team has more", async () => {
            const s = await seedBugs();
            const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
            // Their team's are older, so a limit applied BEFORE scoping would
            // spend the whole budget on rows the caller cannot see and hand
            // back an empty list.
            for (const t of [s.theirs, s.theirIncident]) {
                await db()
                    .update(schema.tasks)
                    .set({ updatedAt: old })
                    .where(eq(schema.tasks.id, t.id));
            }
            await db()
                .update(schema.tasks)
                .set({ updatedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000) })
                .where(eq(schema.tasks.id, s.mine.id));

            const res = await s.viewer.client.get(engHome);

            const ids = res.body.stale_tickets.map((t: { id: string }) => t.id);
            expect(ids).toContain(s.mine.id);
            expect(ids).not.toContain(s.theirs.id);
        });
    });
});
