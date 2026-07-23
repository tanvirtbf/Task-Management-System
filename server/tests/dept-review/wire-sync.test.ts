import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";

/**
 * Dept Review V1 — P12: the review trio on the wire `Task`.
 *
 * (a) every task read carries `review_status/reviewed_at/reviewed_by`
 * (null-defaulted), (b) a review surfaces the trio on GET, (c) a client
 * PATCH cannot smuggle the denorm fields in — the update path's matchedData
 * allowlist strips them silently (the `taskToWire` spread stays harmless).
 */

const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const head = await makeUser({
        workspaceId: owner.workspaceId,
        role: "member",
    });
    const sp = await makeSpaceWithHead({
        workspaceId: owner.workspaceId,
        headUserId: head.id,
        createdBy: owner.id,
    });
    const dl = await makeDeptList({
        workspaceId: owner.workspaceId,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const task = await makeDoneTask({
        workspaceId: owner.workspaceId,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        createdBy: owner.id,
    });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    return { owner, head, task, headClient };
};

describe("Wire contract sync — review trio on Task (Dept Review V1, P12)", () => {
    it("GET /tasks/:id carries the trio, null before any review", async () => {
        const { task, headClient } = await seed();

        const res = await headClient.get(`/api/v1/tasks/${task.id}`);

        expect(res.status).toBe(200);
        expect(res.body.review_status).toBeNull();
        expect(res.body.reviewed_at).toBeNull();
        expect(res.body.reviewed_by).toBeNull();
    });

    it("after a review, GET and the list read surface the trio", async () => {
        const { head, task, headClient } = await seed();
        await headClient
            .post(`/api/v1/tasks/${task.id}/review`)
            .send({ status: "approved" });

        const res = await headClient.get(`/api/v1/tasks/${task.id}`);
        expect(res.body.review_status).toBe("approved");
        expect(res.body.reviewed_by).toBe(head.id);
        expect(res.body.reviewed_at).not.toBeNull();

        const list = await headClient.get(
            `/api/v1/lists/${task.listId}/tasks`,
        );
        const row = list.body.data.find(
            (t: { id: string }) => t.id === task.id,
        );
        expect(row.review_status).toBe("approved");
    });

    it("PATCH cannot smuggle the denorm fields — matchedData strips them silently", async () => {
        const { head, task, headClient } = await seed();
        await headClient
            .post(`/api/v1/tasks/${task.id}/review`)
            .send({ status: "approved" });

        const res = await headClient.patch(`/api/v1/tasks/${task.id}`).send({
            name: "renamed but not re-verdicted",
            review_status: "flagged",
            reviewed_by: "u-hacker",
        });

        expect(res.status).toBe(200); // stray keys stripped, not 422
        expect(res.body.name).toBe("renamed but not re-verdicted");
        expect(res.body.review_status).toBe("approved"); // unchanged

        const [row] = await getDb()
            .select({
                reviewStatus: tasks.reviewStatus,
                reviewedBy: tasks.reviewedBy,
            })
            .from(tasks)
            .where(eq(tasks.id, task.id));
        expect(row.reviewStatus).toBe("approved");
        expect(row.reviewedBy).toBe(head.id);
    });
});
