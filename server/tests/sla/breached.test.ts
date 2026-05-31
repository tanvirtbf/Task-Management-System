import { getDb } from "../../src/db/client";
import { tasks, taskTypes, taskAssignees } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import {
    makeUser,
    makeLoggedInClient,
    makeSpace,
    makeList,
    makeStatus,
} from "../test-utils/factories";
import { oneOff, type LoggedInClient } from "../test-utils/app";

/**
 * §29 #1 — GET /api/v1/sla/breached
 *
 * Workspace-scoped list of tasks past their SLA window that aren't done; a bare
 * SLABreach[] array (no pagination), most-overdue first, assignees hydrated to
 * full User objects. Optional ?team= / ?severity= filters. 🔐 any member.
 */

const ENDPOINT = "/api/v1/sla/breached";
const HOUR = 3600 * 1000;

type Sev = "S0" | "S1" | "S2" | "S3";
type Team = "ops" | "cs" | "inventory" | "listing" | "marketing" | "internal";

let seq = 0;

interface InsertTaskOpts {
    ws: string;
    listId: string;
    statusId: string;
    taskTypeId: string;
    createdBy: string;
    name?: string;
    slaDueAt?: Date | null;
    completedAt?: Date | null;
    bugSeverity?: Sev | null;
    reporterTeam?: Team | null;
    archivedAt?: Date | null;
}

const insertTask = async (opts: InsertTaskOpts): Promise<string> => {
    const db = getDb();
    const id = fakeId("t");
    const values: typeof tasks.$inferInsert = {
        id,
        workspaceId: opts.ws,
        primaryListId: opts.listId,
        taskNumber: ++seq,
        name: opts.name ?? `Task ${seq}`,
        statusId: opts.statusId,
        taskTypeId: opts.taskTypeId,
        createdBy: opts.createdBy,
        slaDueAt: opts.slaDueAt ?? null,
        completedAt: opts.completedAt ?? null,
        bugSeverity: opts.bugSeverity ?? null,
        reporterTeam: opts.reporterTeam ?? null,
        archivedAt: opts.archivedAt ?? null,
    };
    await db.insert(tasks).values(values);
    return id;
};

/** Insert a task type with optional is_dev_type (the factory can't set it). */
const makeType = async (
    ws: string,
    name: string,
    isDevType = false,
): Promise<string> => {
    const id = fakeId("tt");
    await getDb()
        .insert(taskTypes)
        .values({ id, workspaceId: ws, name, isDevType });
    return id;
};

const assign = async (taskId: string, userId: string): Promise<void> => {
    await getDb()
        .insert(taskAssignees)
        .values({ taskId, userId, assignedBy: userId });
};

interface Fixture {
    ws: string;
    ownerId: string;
    listId: string;
    statusId: string;
    typeId: string;
    client: LoggedInClient;
}

const setup = async (): Promise<Fixture> => {
    const owner = await makeUser({ role: "member" });
    const ws = owner.workspaceId;
    const space = await makeSpace({ workspaceId: ws, createdBy: owner.id });
    const list = await makeList({
        workspaceId: ws,
        spaceId: space.id,
        createdBy: owner.id,
    });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "active",
    });
    const typeId = await makeType(ws, `Type ${++seq}`);
    const client = await makeLoggedInClient({
        id: owner.id,
        workspaceId: ws,
        role: owner.role,
    });
    return {
        ws,
        ownerId: owner.id,
        listId: list.id,
        statusId: status.id,
        typeId,
        client,
    };
};

/** Shorthand: a breached task (sla N hours in the past). */
const breach = (
    f: Fixture,
    hoursAgo: number,
    over: Partial<InsertTaskOpts> = {},
) => ({
    ws: f.ws,
    listId: f.listId,
    statusId: f.statusId,
    taskTypeId: f.typeId,
    createdBy: f.ownerId,
    slaDueAt: new Date(Date.now() - hoursAgo * HOUR),
    ...over,
});

describe("GET /api/v1/sla/breached", () => {
    describe("Auth", () => {
        it("401 without a token", async () => {
            const res = await (await oneOff()).get(ENDPOINT);
            expect(res.status).toBe(401);
        });
    });

    describe("Breach predicate", () => {
        it("returns 200 + [] when nothing is breached", async () => {
            const f = await setup();
            const res = await f.client.get(ENDPOINT);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("includes a past-due, not-done, not-archived task with the SLABreach shape", async () => {
            const f = await setup();
            const id = await insertTask(breach(f, 2, { name: "Late task" }));

            const res = await f.client.get(ENDPOINT);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            const item = res.body[0];
            expect(item.task_id).toBe(id);
            expect(item.name).toBe("Late task");
            expect(item.task_type_id).toBe(f.typeId);
            expect(typeof item.sla_due_at).toBe("string");
            expect(item.minutes_breached).toBeGreaterThanOrEqual(115);
            expect(item.minutes_breached).toBeLessThan(135);
            expect(Array.isArray(item.assignees)).toBe(true);
        });

        it("excludes a future SLA, a completed task, an archived task, and a null SLA", async () => {
            const f = await setup();
            const base = {
                ws: f.ws,
                listId: f.listId,
                statusId: f.statusId,
                taskTypeId: f.typeId,
                createdBy: f.ownerId,
            };
            await insertTask({
                ...base,
                slaDueAt: new Date(Date.now() + 2 * HOUR),
            }); // future
            await insertTask({
                ...base,
                slaDueAt: new Date(Date.now() - 2 * HOUR),
                completedAt: new Date(),
            }); // done
            await insertTask({
                ...base,
                slaDueAt: new Date(Date.now() - 2 * HOUR),
                archivedAt: new Date(),
            }); // archived
            await insertTask({ ...base, slaDueAt: null }); // no SLA

            const res = await f.client.get(ENDPOINT);
            expect(res.body).toEqual([]);
        });

        it("orders most-overdue first (oldest sla_due_at)", async () => {
            const f = await setup();
            const newer = await insertTask(breach(f, 1)); // 1h overdue
            const older = await insertTask(breach(f, 5)); // 5h overdue

            const res = await f.client.get(ENDPOINT);
            const ids = res.body.map((b: { task_id: string }) => b.task_id);
            expect(ids).toEqual([older, newer]);
        });
    });

    describe("Assignee hydration (User[])", () => {
        it("hydrates assignees to full User objects, not id strings", async () => {
            const f = await setup();
            const assignee = await makeUser({ workspaceId: f.ws });
            const id = await insertTask(breach(f, 2));
            await assign(id, assignee.id);

            const res = await f.client.get(ENDPOINT);
            const item = res.body.find(
                (b: { task_id: string }) => b.task_id === id,
            );
            expect(item.assignees).toHaveLength(1);
            expect(typeof item.assignees[0]).toBe("object");
            expect(item.assignees[0].id).toBe(assignee.id);
            expect(typeof item.assignees[0].first_name).toBe("string");
            expect(item.assignees[0]).not.toHaveProperty("password_hash");
        });
    });

    describe("?severity= filter", () => {
        it("returns only the requested bug severities", async () => {
            const f = await setup();
            const s0 = await insertTask(breach(f, 2, { bugSeverity: "S0" }));
            const s1 = await insertTask(breach(f, 2, { bugSeverity: "S1" }));
            await insertTask(breach(f, 2, { bugSeverity: "S2" })); // excluded

            const res = await f.client.get(`${ENDPOINT}?severity=S0,S1`);
            const ids = res.body
                .map((b: { task_id: string }) => b.task_id)
                .sort();
            expect(ids).toEqual([s0, s1].sort());
        });
    });

    describe("?team= filter", () => {
        it("filters by reporter_team", async () => {
            const f = await setup();
            const cs = await insertTask(breach(f, 2, { reporterTeam: "cs" }));
            await insertTask(breach(f, 2, { reporterTeam: "ops" })); // excluded

            const res = await f.client.get(`${ENDPOINT}?team=cs`);
            const ids = res.body.map((b: { task_id: string }) => b.task_id);
            expect(ids).toEqual([cs]);
        });

        it("team=engineering resolves to dev-type tasks", async () => {
            const f = await setup();
            const devType = await makeType(f.ws, "Bug", true);
            const eng = await insertTask(breach(f, 2, { taskTypeId: devType }));
            await insertTask(breach(f, 2)); // non-dev type → excluded

            const res = await f.client.get(`${ENDPOINT}?team=engineering`);
            const ids = res.body.map((b: { task_id: string }) => b.task_id);
            expect(ids).toEqual([eng]);
        });
    });

    describe("Validation (422)", () => {
        it("rejects an unknown severity value", async () => {
            const f = await setup();
            const res = await f.client.get(`${ENDPOINT}?severity=S9`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects an unknown team value", async () => {
            const f = await setup();
            const res = await f.client.get(`${ENDPOINT}?team=marketingX`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Workspace isolation", () => {
        it("does not surface another workspace's breaches", async () => {
            const a = await setup();
            await insertTask(breach(a, 2));

            const bOwner = await makeUser({ role: "member" });
            const bClient = await makeLoggedInClient({
                id: bOwner.id,
                workspaceId: bOwner.workspaceId,
                role: bOwner.role,
            });
            const res = await bClient.get(ENDPOINT);
            expect(res.body).toEqual([]);
        });
    });
});
