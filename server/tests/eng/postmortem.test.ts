import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { taskPostmortems } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeTaskType,
    makeList,
    makeStatus,
    makeTask,
} from "../test-utils/factories";
import { oneOff, type LoggedInClient } from "../test-utils/app";

/**
 * §22 #3 — POST /api/v1/eng/incidents/:id/postmortem
 *
 * Upsert the postmortem checklist (`items: label → boolean`) on a RESOLVED
 * Incident task (type "Incident", status done/closed). 🔐 any member.
 */

const path = (id: string) => `/api/v1/eng/incidents/${id}/postmortem`;

type Grp = "not_started" | "active" | "done" | "closed";

const validItems = {
    "Timeline reconstructed": true,
    "Root cause identified": true,
    "Impact quantified (users / revenue / time)": false,
};

interface IncidentFixture {
    ws: string;
    ownerId: string;
    taskId: string;
    client: LoggedInClient;
}

/** A workspace with an Incident task in the requested state. */
const setupIncident = async (
    opts: { statusGroup?: Grp; typeName?: string } = {},
): Promise<IncidentFixture> => {
    const owner = await makeUser({ role: "member" });
    const ws = owner.workspaceId;
    const type = await makeTaskType({
        workspaceId: ws,
        name: opts.typeName ?? "Incident",
    });
    const list = await makeList({ workspaceId: ws, createdBy: owner.id });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: opts.statusGroup ?? "done",
        name: "Resolved",
    });
    const task = await makeTask({
        workspaceId: ws,
        listId: list.id,
        taskTypeId: type.id,
        statusId: status.id,
        createdBy: owner.id,
    });
    const client = await makeLoggedInClient({
        id: owner.id,
        workspaceId: ws,
        role: owner.role,
    });
    return { ws, ownerId: owner.id, taskId: task.id, client };
};

describe("POST /api/v1/eng/incidents/:id/postmortem", () => {
    describe("Happy path", () => {
        it("saves the checklist on a done Incident and returns 200 + the postmortem", async () => {
            const f = await setupIncident({ statusGroup: "done" });
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });

            expect(res.status).toBe(200);
            expect(res.body.task_id).toBe(f.taskId);
            expect(res.body.items).toEqual(validItems);
            expect(res.body.updated_by).toBe(f.ownerId);
            expect(typeof res.body.created_at).toBe("string");
            expect(typeof res.body.updated_at).toBe("string");
        });

        it("allows a closed Incident", async () => {
            const f = await setupIncident({ statusGroup: "closed" });
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(200);
        });

        it("matches the Incident type name case-insensitively", async () => {
            const f = await setupIncident({ typeName: "incident" });
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(200);
        });

        it("accepts an empty checklist ({})", async () => {
            const f = await setupIncident();
            const res = await f.client.post(path(f.taskId)).send({ items: {} });
            expect(res.status).toBe(200);
            expect(res.body.items).toEqual({});
        });

        it("persists exactly one row with the submitted items", async () => {
            const f = await setupIncident();
            await f.client.post(path(f.taskId)).send({ items: validItems });

            const db = getDb();
            const rows = await db
                .select()
                .from(taskPostmortems)
                .where(eq(taskPostmortems.taskId, f.taskId));
            expect(rows).toHaveLength(1);
            expect(rows[0].items).toEqual(validItems);
            expect(rows[0].updatedBy).toBe(f.ownerId);
        });
    });

    describe("Upsert (submit / update)", () => {
        it("a re-submit replaces the items on the SAME row (no duplicate)", async () => {
            const f = await setupIncident();
            await f.client
                .post(path(f.taskId))
                .send({ items: { "Root cause identified": false } });
            const second = await f.client
                .post(path(f.taskId))
                .send({
                    items: {
                        "Root cause identified": true,
                        "Comms sent": true,
                    },
                });

            expect(second.status).toBe(200);
            expect(second.body.items).toEqual({
                "Root cause identified": true,
                "Comms sent": true,
            });

            const db = getDb();
            const rows = await db
                .select()
                .from(taskPostmortems)
                .where(eq(taskPostmortems.taskId, f.taskId));
            expect(rows).toHaveLength(1);
            expect(rows[0].items).toEqual({
                "Root cause identified": true,
                "Comms sent": true,
            });
        });
    });

    describe("Domain rejections (409)", () => {
        it("409 incident.not_resolved when the Incident is still active", async () => {
            const f = await setupIncident({ statusGroup: "active" });
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("incident.not_resolved");
        });

        it("409 incident.not_resolved when the Incident is not_started", async () => {
            const f = await setupIncident({ statusGroup: "not_started" });
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("incident.not_resolved");
        });

        it("409 incident.not_incident when the task is not an Incident type", async () => {
            const f = await setupIncident({ typeName: "Bug" }); // done, but a Bug
            const res = await f.client
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("incident.not_incident");
        });
    });

    describe("Not found / isolation (404)", () => {
        it("404 task.not_found for an unknown id", async () => {
            const f = await setupIncident();
            const res = await f.client
                .post(path("t-does-not-exist"))
                .send({ items: validItems });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 for an Incident in another workspace (no cross-tenant access)", async () => {
            const a = await setupIncident();
            const bOwner = await makeUser({ role: "member" });
            const bClient = await makeLoggedInClient({
                id: bOwner.id,
                workspaceId: bOwner.workspaceId,
                role: bOwner.role,
            });
            const res = await bClient
                .post(path(a.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    describe("Validation (422)", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["missing items", {}],
            ["items is an array", { items: ["a", "b"] }],
            ["items is a string", { items: "done" }],
            ["items is null", { items: null }],
            ["item value is a string", { items: { "Root cause": "yes" } }],
            ["item value is a number", { items: { "Root cause": 1 } }],
        ];

        it.each(cases)("422 — %s", async (_label, body) => {
            const f = await setupIncident();
            const res = await f.client.post(path(f.taskId)).send(body);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Auth", () => {
        it("401 without a token", async () => {
            const f = await setupIncident();
            const res = await (await oneOff())
                .post(path(f.taskId))
                .send({ items: validItems });
            expect(res.status).toBe(401);
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/eng/incidents/:id/postmortem (gap-scan H5 companion read)", () => {
    it("nothing saved yet → 200 with EMPTY items + null timestamps (no 404 special-case)", async () => {
        const fx = await setupIncident();

        const res = await fx.client.get(path(fx.taskId));
        expect(res.status).toBe(200);
        expect(res.body.task_id).toBe(fx.taskId);
        expect(res.body.items).toEqual({});
        expect(res.body.updated_by).toBeNull();
        expect(res.body.created_at).toBeNull();
        expect(res.body.updated_at).toBeNull();
    });

    it("POST → GET round-trip: label keys survive VERBATIM (spaces, slashes, parens)", async () => {
        const fx = await setupIncident();
        const post = await fx.client.post(path(fx.taskId)).send({
            items: validItems,
        });
        expect(post.status).toBe(200);

        const res = await fx.client.get(path(fx.taskId));
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual(validItems);
        expect(res.body.updated_by).toBe(fx.ownerId);
        expect(typeof res.body.created_at).toBe("string");
    });

    it("readable regardless of type/status (the write-side gates don't apply to reads)", async () => {
        const fx = await setupIncident({ statusGroup: "active" });
        const res = await fx.client.get(path(fx.taskId));
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual({});
    });

    it("404 task.not_found for unknown and cross-workspace ids; 401 unauthenticated", async () => {
        const fx = await setupIncident();
        const other = await setupIncident(); // different workspace

        const cross = await fx.client.get(path(other.taskId));
        expect(cross.status).toBe(404);
        expect(cross.body.error.code).toBe("task.not_found");

        const unknown = await fx.client.get(path("t_nope123"));
        expect(unknown.status).toBe(404);

        const http = await oneOff();
        expect((await http.get(path(fx.taskId))).status).toBe(401);
    });
});
