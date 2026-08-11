import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { taskActivity } from "../../src/db/schema";
import {
    makeUser,
    makeLoggedInClient,
    makeTaskType,
    makeList,
    makeStatus,
    makeTask,
} from "../test-utils/factories";

/**
 * Team-access P3 (plan G13) — the postmortem save was invisible to the task's
 * audit log (a winston debug line was the only witness). Now:
 *   - the first submit writes `postmortem_submitted` {revised: false},
 *   - a re-submit writes another row with {revised: true}.
 */

jest.setTimeout(30_000);

const path = (id: string) => `/api/v1/eng/incidents/${id}/postmortem`;
const db = () => getDb();

const setupIncident = async () => {
    const owner = await makeUser({ role: "member" });
    const ws = owner.workspaceId;
    const type = await makeTaskType({ workspaceId: ws, name: "Incident" });
    const list = await makeList({ workspaceId: ws, createdBy: owner.id });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "done",
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

describe("P3 — postmortem submits are audited", () => {
    it("first submit logs {revised:false}; a re-submit logs {revised:true}", async () => {
        const f = await setupIncident();

        const first = await f.client
            .post(path(f.taskId))
            .send({ items: { "Timeline reconstructed": true } });
        expect(first.status).toBe(200);

        let rows = (
            await db()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, f.taskId))
        ).filter((a) => a.action === "postmortem_submitted");
        expect(rows).toHaveLength(1);
        expect(rows[0].actorId).toBe(f.ownerId);
        expect(rows[0].context).toMatchObject({ items: 1, revised: false });

        const second = await f.client
            .post(path(f.taskId))
            .send({
                items: {
                    "Timeline reconstructed": true,
                    "Root cause identified": true,
                },
            });
        expect(second.status).toBe(200);

        rows = (
            await db()
                .select()
                .from(taskActivity)
                .where(eq(taskActivity.taskId, f.taskId))
        ).filter((a) => a.action === "postmortem_submitted");
        expect(rows).toHaveLength(2);
        expect(
            rows.some(
                (r) =>
                    (r.context as { revised?: boolean }).revised === true &&
                    (r.context as { items?: number }).items === 2,
            ),
        ).toBe(true);
    });
});
