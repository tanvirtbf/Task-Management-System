import { getDb } from "../../src/db/client";
import { tasks, taskAssignees } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    makeUser,
    makeLoggedInClient,
    makeTaskType,
    makeSpace,
    makeList,
    makeStatus,
    makeSprint,
    makeOnCallShift,
} from "../test-utils/factories";
import { oneOff, type LoggedInClient } from "../test-utils/app";

/**
 * §22 #2 — GET /api/v1/eng/home
 *
 * The Engineering dashboard rollup. Buckets are workspace-scoped; Bug / Incident
 * types are resolved BY NAME (the literal-id `_post.sql` views are bypassed).
 */

const ENDPOINT = "/api/v1/eng/home";
const DAY = 24 * 3600 * 1000;

type PrStatus = "open" | "merged" | "closed" | "draft";
type Sev = "S0" | "S1" | "S2" | "S3";

let taskSeq = 0;

interface InsertTaskOpts {
    workspaceId: string;
    listId: string;
    statusId: string;
    taskTypeId: string;
    createdBy: string;
    name?: string;
    sprintId?: string | null;
    reviewerId?: string | null;
    prStatus?: PrStatus | null;
    bugSeverity?: Sev | null;
    archivedAt?: Date | null;
    updatedAt?: Date;
}

/** Insert a task row directly so the test controls the eng fields the factory omits. */
const insertTask = async (opts: InsertTaskOpts): Promise<string> => {
    const db = getDb();
    const id = fakeId("t");
    const values: typeof tasks.$inferInsert = {
        id,
        workspaceId: opts.workspaceId,
        primaryListId: opts.listId,
        taskNumber: ++taskSeq,
        name: opts.name ?? `Task ${taskSeq}`,
        statusId: opts.statusId,
        taskTypeId: opts.taskTypeId,
        createdBy: opts.createdBy,
        sprintId: opts.sprintId ?? null,
        reviewerId: opts.reviewerId ?? null,
        prStatus: opts.prStatus ?? null,
        bugSeverity: opts.bugSeverity ?? null,
        archivedAt: opts.archivedAt ?? null,
    };
    if (opts.updatedAt) values.updatedAt = opts.updatedAt;
    await db.insert(tasks).values(values);
    return id;
};

const assign = async (taskId: string, userId: string): Promise<void> => {
    await getDb()
        .insert(taskAssignees)
        .values({ taskId, userId, assignedBy: userId });
};

interface HomeFixture {
    ws: string;
    ownerId: string;
    bugTypeId: string;
    incidentTypeId: string;
    listId: string;
    openStatusId: string;
    doneStatusId: string;
    client: LoggedInClient;
}

/** A workspace with Bug + Incident types and a list carrying open & done statuses. */
const setupHome = async (): Promise<HomeFixture> => {
    const owner = await makeUser({ role: "member" });
    const ws = owner.workspaceId;
    const bugType = await makeTaskType({ workspaceId: ws, name: "Bug" });
    const incidentType = await makeTaskType({
        workspaceId: ws,
        name: "Incident",
    });
    const space = await makeSpace({ workspaceId: ws, createdBy: owner.id });
    const list = await makeList({
        workspaceId: ws,
        spaceId: space.id,
        createdBy: owner.id,
        name: "Bug Triage",
    });
    const openStatus = await makeStatus({
        scopeId: list.id,
        statusGroup: "active",
        name: "Open",
    });
    const doneStatus = await makeStatus({
        scopeId: list.id,
        statusGroup: "done",
        name: "Done",
    });
    const client = await makeLoggedInClient({
        id: owner.id,
        workspaceId: ws,
        role: owner.role,
    });
    return {
        ws,
        ownerId: owner.id,
        bugTypeId: bugType.id,
        incidentTypeId: incidentType.id,
        listId: list.id,
        openStatusId: openStatus.id,
        doneStatusId: doneStatus.id,
        client,
    };
};

describe("GET /api/v1/eng/home", () => {
    describe("Auth", () => {
        it("401 without a token", async () => {
            const res = await (await oneOff()).get(ENDPOINT);
            expect(res.status).toBe(401);
        });
    });

    describe("Empty / unconfigured workspace", () => {
        it("returns 200 with every bucket empty and nullable fields null", async () => {
            const owner = await makeUser({ role: "member" });
            const client = await makeLoggedInClient({
                id: owner.id,
                workspaceId: owner.workspaceId,
                role: owner.role,
            });

            const res = await client.get(ENDPOINT);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                open_bugs: { count: 0, top: [] },
                my_sprint_tasks: [],
                prs_awaiting_me: [],
                open_incidents: { count: 0, top: [] },
                stale_tickets: [],
                current_on_call: null,
                active_sprint: null,
            });
        });
    });

    describe("open_bugs", () => {
        it("counts open Bug-type tasks and previews them (excludes done + archived)", async () => {
            const f = await setupHome();
            const base = {
                workspaceId: f.ws,
                listId: f.listId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            };
            await insertTask({ ...base, statusId: f.openStatusId });
            await insertTask({ ...base, statusId: f.openStatusId });
            await insertTask({ ...base, statusId: f.openStatusId });
            await insertTask({ ...base, statusId: f.doneStatusId }); // done → excluded
            await insertTask({
                ...base,
                statusId: f.openStatusId,
                archivedAt: new Date(), // archived → excluded
            });

            const res = await f.client.get(ENDPOINT);
            expect(res.status).toBe(200);
            expect(res.body.open_bugs.count).toBe(3);
            expect(res.body.open_bugs.top).toHaveLength(3);
            for (const t of res.body.open_bugs.top) {
                expect(t.task_type_id).toBe(f.bugTypeId);
                expect(t.archived_at).toBeNull();
            }
        });

        it("caps the preview at 5 while count reflects the full total", async () => {
            const f = await setupHome();
            for (let i = 0; i < 7; i += 1) {
                await insertTask({
                    workspaceId: f.ws,
                    listId: f.listId,
                    statusId: f.openStatusId,
                    taskTypeId: f.bugTypeId,
                    createdBy: f.ownerId,
                });
            }
            const res = await f.client.get(ENDPOINT);
            expect(res.body.open_bugs.count).toBe(7);
            expect(res.body.open_bugs.top).toHaveLength(5);
        });

        it("hydrates assignees onto the preview tasks", async () => {
            const f = await setupHome();
            const assignee = await makeUser({ workspaceId: f.ws });
            const bugId = await insertTask({
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            });
            await assign(bugId, assignee.id);

            const res = await f.client.get(ENDPOINT);
            const top = res.body.open_bugs.top.find(
                (t: { id: string }) => t.id === bugId,
            );
            expect(top).toBeDefined();
            expect(top.assignees).toContain(assignee.id);
        });
    });

    describe("open_incidents", () => {
        it("counts open Incident-type tasks separately from bugs", async () => {
            const f = await setupHome();
            await insertTask({
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.incidentTypeId,
                createdBy: f.ownerId,
            });
            await insertTask({
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.incidentTypeId,
                createdBy: f.ownerId,
            });
            // a bug should NOT count as an incident
            await insertTask({
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            });

            const res = await f.client.get(ENDPOINT);
            expect(res.body.open_incidents.count).toBe(2);
            expect(res.body.open_incidents.top).toHaveLength(2);
            expect(res.body.open_bugs.count).toBe(1);
        });
    });

    describe("my_sprint_tasks", () => {
        it("returns the caller's tasks in the active sprint only", async () => {
            const f = await setupHome();
            const sprint = await makeSprint({
                workspaceId: f.ws,
                status: "active",
            });
            const base = {
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            };
            const mine = await insertTask({ ...base, sprintId: sprint.id });
            await assign(mine, f.ownerId);
            // in sprint but assigned to someone else → excluded
            const other = await makeUser({ workspaceId: f.ws });
            const notMine = await insertTask({ ...base, sprintId: sprint.id });
            await assign(notMine, other.id);
            // assigned to me but no sprint → excluded
            const noSprint = await insertTask({ ...base, sprintId: null });
            await assign(noSprint, f.ownerId);

            const res = await f.client.get(ENDPOINT);
            const ids = res.body.my_sprint_tasks.map(
                (t: { id: string }) => t.id,
            );
            expect(ids).toEqual([mine]);
        });

        it("is empty when there is no active sprint", async () => {
            const f = await setupHome();
            const planned = await makeSprint({
                workspaceId: f.ws,
                status: "planned",
            });
            const mine = await insertTask({
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
                sprintId: planned.id,
            });
            await assign(mine, f.ownerId);

            const res = await f.client.get(ENDPOINT);
            expect(res.body.my_sprint_tasks).toEqual([]);
        });
    });

    describe("prs_awaiting_me", () => {
        it("returns tasks I review whose PR is open/draft, not merged/closed/null", async () => {
            const f = await setupHome();
            const base = {
                workspaceId: f.ws,
                listId: f.listId,
                statusId: f.openStatusId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            };
            const open = await insertTask({
                ...base,
                reviewerId: f.ownerId,
                prStatus: "open",
            });
            const draft = await insertTask({
                ...base,
                reviewerId: f.ownerId,
                prStatus: "draft",
            });
            await insertTask({
                ...base,
                reviewerId: f.ownerId,
                prStatus: "merged",
            }); // excluded
            await insertTask({
                ...base,
                reviewerId: f.ownerId,
                prStatus: null,
            }); // excluded
            const other = await makeUser({ workspaceId: f.ws });
            await insertTask({
                ...base,
                reviewerId: other.id,
                prStatus: "open",
            }); // someone else's review → excluded

            const res = await f.client.get(ENDPOINT);
            const ids = res.body.prs_awaiting_me
                .map((t: { id: string }) => t.id)
                .sort();
            expect(ids).toEqual([open, draft].sort());
        });
    });

    describe("stale_tickets", () => {
        it("returns OPEN tasks untouched for > 14 days (not done, not archived)", async () => {
            const f = await setupHome();
            const old = new Date(Date.now() - 20 * DAY);
            const base = {
                workspaceId: f.ws,
                listId: f.listId,
                taskTypeId: f.bugTypeId,
                createdBy: f.ownerId,
            };
            const stale = await insertTask({
                ...base,
                statusId: f.openStatusId,
                updatedAt: old,
            });
            await insertTask({ ...base, statusId: f.openStatusId }); // fresh → excluded
            await insertTask({
                ...base,
                statusId: f.doneStatusId,
                updatedAt: old,
            }); // done → excluded
            await insertTask({
                ...base,
                statusId: f.openStatusId,
                updatedAt: old,
                archivedAt: new Date(),
            }); // archived → excluded

            const res = await f.client.get(ENDPOINT);
            const ids = res.body.stale_tickets.map((t: { id: string }) => t.id);
            expect(ids).toEqual([stale]);
        });
    });

    describe("current_on_call", () => {
        it("returns the active engineer on call this week as a User", async () => {
            const f = await setupHome();
            const shift = await makeOnCallShift({ workspaceId: f.ws });

            const res = await f.client.get(ENDPOINT);
            expect(res.body.current_on_call).not.toBeNull();
            expect(res.body.current_on_call.id).toBe(shift.engineerId);
            expect(typeof res.body.current_on_call.first_name).toBe("string");
            expect(res.body.current_on_call).not.toHaveProperty(
                "password_hash",
            );
        });

        it("is null when nobody is on call", async () => {
            const f = await setupHome();
            const res = await f.client.get(ENDPOINT);
            expect(res.body.current_on_call).toBeNull();
        });

        it("is null when the on-call engineer is deactivated", async () => {
            const f = await setupHome();
            const deactivated = await makeUser({
                workspaceId: f.ws,
                status: "deactivated",
            });
            await makeOnCallShift({
                workspaceId: f.ws,
                engineerId: deactivated.id,
                createdBy: f.ownerId,
            });
            const res = await f.client.get(ENDPOINT);
            expect(res.body.current_on_call).toBeNull();
        });
    });

    describe("active_sprint", () => {
        it("returns the active sprint as a wire Sprint", async () => {
            const f = await setupHome();
            const sprint = await makeSprint({
                workspaceId: f.ws,
                name: "Sprint Alpha",
                status: "active",
                startDate: "2026-06-01",
                endDate: "2026-06-14",
                committedPoints: 21,
            });

            const res = await f.client.get(ENDPOINT);
            expect(res.body.active_sprint).not.toBeNull();
            expect(res.body.active_sprint.id).toBe(sprint.id);
            expect(res.body.active_sprint.status).toBe("active");
            expect(res.body.active_sprint.name).toBe("Sprint Alpha");
            expect(res.body.active_sprint.start_date).toBe("2026-06-01");
            expect(res.body.active_sprint.end_date).toBe("2026-06-14");
            expect(res.body.active_sprint.committed_points).toBe(21);
            expect(res.body.active_sprint).not.toHaveProperty("workspace_id");
        });

        it("is null when only planned/closed sprints exist", async () => {
            const f = await setupHome();
            await makeSprint({ workspaceId: f.ws, status: "planned" });
            await makeSprint({ workspaceId: f.ws, status: "closed" });
            const res = await f.client.get(ENDPOINT);
            expect(res.body.active_sprint).toBeNull();
        });
    });

    describe("Workspace isolation", () => {
        it("does not leak another workspace's bugs / sprint / on-call", async () => {
            // Workspace A — fully populated.
            const a = await setupHome();
            await insertTask({
                workspaceId: a.ws,
                listId: a.listId,
                statusId: a.openStatusId,
                taskTypeId: a.bugTypeId,
                createdBy: a.ownerId,
            });
            await makeSprint({ workspaceId: a.ws, status: "active" });
            await makeOnCallShift({ workspaceId: a.ws });

            // Workspace B — its own home must be empty.
            const bOwner = await makeUser({ role: "member" });
            const bClient = await makeLoggedInClient({
                id: bOwner.id,
                workspaceId: bOwner.workspaceId,
                role: bOwner.role,
            });
            const res = await bClient.get(ENDPOINT);
            expect(res.body.open_bugs.count).toBe(0);
            expect(res.body.open_bugs.top).toHaveLength(0);
            expect(res.body.active_sprint).toBeNull();
            expect(res.body.current_on_call).toBeNull();
        });
    });
});
