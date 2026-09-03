import { eq } from "drizzle-orm";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeStatus,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks } from "../../src/db/schema";

/**
 * KI-17 — two people editing one task at the same time.
 *
 * The plan asks P7 to PROBE this, not fix it: there is no `If-Match` / ETag
 * anywhere, so `PATCH /tasks/:id` is last-write-wins. Optimistic concurrency is
 * a feature, and features are the user's call — but the decision should be made
 * knowing exactly what disappears and how quietly. That is what this file
 * records.
 *
 * The answer, measured: a whole field can vanish with both callers seeing 200
 * and no trace anywhere that a value was overwritten. Not a corrupted row, not
 * a partial write — the second writer's payload simply replaces what it did not
 * mention having ever read.
 *
 * These tests PIN the current behaviour rather than assert it is right. If
 * `If-Match` is ever added, they should fail and be rewritten — that is the
 * point of writing them down.
 */

jest.setTimeout(60_000);

const scene = async () => {
    const ws = await makeWorkspace();
    const alice = await makeUser({ workspaceId: ws.id, role: "admin" });
    const bob = await makeUser({ workspaceId: ws.id, role: "admin" });
    const aliceClient = await makeLoggedInClient(alice);
    const bobClient = await makeLoggedInClient(bob);
    const space = await makeSpace({ workspaceId: ws.id, createdBy: alice.id });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: alice.id,
    });
    const status = await makeStatus({ scopeId: list.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });

    const created = await aliceClient.post("/api/v1/tasks").send({
        name: "Shoot the Eid campaign",
        description: "Original brief, written by Alice",
        primary_list_id: list.id,
        status_id: status.id,
        task_type_id: taskType.id,
    });
    expect(created.status).toBe(201);

    return {
        ws,
        alice,
        bob,
        aliceClient,
        bobClient,
        taskId: created.body.id as string,
    };
};

const rowOf = async (id: string) =>
    (await getDb().select().from(tasks).where(eq(tasks.id, id)))[0];

describe("KI-17 — concurrent edits to one task", () => {
    it("sequential edits to DIFFERENT fields both survive", async () => {
        const s = await scene();

        const a = await s.aliceClient
            .patch(`/api/v1/tasks/${s.taskId}`)
            .send({ name: "Shoot the Eid campaign (v2)" });
        const b = await s.bobClient
            .patch(`/api/v1/tasks/${s.taskId}`)
            .send({ priority: 1 });

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        const row = await rowOf(s.taskId);
        // A partial PATCH only touches what it names, so this much is safe.
        expect(row.name).toBe("Shoot the Eid campaign (v2)");
        expect(row.priority).toBe(1);
    });

    it("the LAST write to the SAME field wins, and the first is gone", async () => {
        const s = await scene();

        // Both open the task, both start typing a description. Neither is told
        // the other exists.
        const aliceEdit = await s.aliceClient
            .patch(`/api/v1/tasks/${s.taskId}`)
            .send({ description: "Alice: shoot on the 12th, studio booked" });
        const bobEdit = await s.bobClient
            .patch(`/api/v1/tasks/${s.taskId}`)
            .send({ description: "Bob: moved to the 15th, outdoor location" });

        // Both are told they succeeded.
        expect(aliceEdit.status).toBe(200);
        expect(bobEdit.status).toBe(200);

        const row = await rowOf(s.taskId);
        expect(row.description).toBe("Bob: moved to the 15th, outdoor location");
        // Alice's sentence is not merged, not flagged, not recoverable from the
        // task row. She was told 200 and has no way to know.
        expect(row.description).not.toContain("Alice");
    });

    it("TRUE concurrency: simultaneous PATCHes both return 200", async () => {
        const s = await scene();

        const [a, b] = await Promise.all([
            s.aliceClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .send({ description: "Alice wrote this" }),
            s.bobClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .send({ description: "Bob wrote this" }),
        ]);

        expect([a.status, b.status]).toEqual([200, 200]);
        const row = await rowOf(s.taskId);
        // Exactly one of them survives — which one is a race, so this asserts
        // only that the row is one of the two and never a mixture.
        expect(["Alice wrote this", "Bob wrote this"]).toContain(
            row.description,
        );
    });

    /**
     * KI-17 recorded "no `If-Match` anywhere — task PATCH is last-write-wins".
     * That is WRONG, and finding out took one read: `GET /tasks/:id` sets an
     * `ETag` (the task's `updated_at`), `TaskWriteController` forwards an
     * `If-Match` header, and `TaskWriteService.update` throws
     * `409 task.conflict` when it does not match. Optimistic concurrency is
     * built. What is missing is only that nothing MAKES a client use it — which
     * is a different, smaller finding than the ledger claimed.
     */
    describe("the optimistic lock that KI-17 said did not exist", () => {
        it("GET returns an ETag a client can echo back", async () => {
            const s = await scene();
            const read = await s.aliceClient.get(`/api/v1/tasks/${s.taskId}`);
            expect(read.status).toBe(200);
            expect(read.headers.etag).toBeDefined();
        });

        it("a MATCHING If-Match is accepted", async () => {
            const s = await scene();
            const read = await s.aliceClient.get(`/api/v1/tasks/${s.taskId}`);

            const res = await s.aliceClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .set("If-Match", read.headers.etag as string)
                .send({ description: "Alice, holding a fresh ETag" });

            expect(res.status).toBe(200);
        });

        it("a STALE If-Match is REFUSED — 409 task.conflict", async () => {
            const s = await scene();
            // Alice reads.
            const read = await s.aliceClient.get(`/api/v1/tasks/${s.taskId}`);
            const aliceEtag = read.headers.etag as string;

            // Bob writes in the meantime, without a precondition.
            await new Promise((r) => setTimeout(r, 1100)); // second-resolution
            const bob = await s.bobClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .send({ description: "Bob got there first" });
            expect(bob.status).toBe(200);

            // Alice now submits with the ETag she read before Bob's write.
            const alice = await s.aliceClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .set("If-Match", aliceEtag)
                .send({ description: "Alice, unaware of Bob" });

            expect(alice.status).toBe(409);
            expect(alice.body.error.code).toBe("task.conflict");
            // And Bob's text is untouched — the refusal is real, not cosmetic.
            expect((await rowOf(s.taskId)).description).toBe(
                "Bob got there first",
            );
        });

        it("**the gap**: omitting If-Match silently opts out of the protection", async () => {
            const s = await scene();
            await s.aliceClient.get(`/api/v1/tasks/${s.taskId}`);

            // No header at all — and the write lands. This is the whole of
            // KI-17 as it actually stands: the lock exists and is correct, but
            // it is opt-in, so a client that never learned about it (and the
            // web client does not send one) gets last-write-wins by default.
            const res = await s.bobClient
                .patch(`/api/v1/tasks/${s.taskId}`)
                .send({ description: "No precondition, no protection" });

            expect(res.status).toBe(200);
            expect((await rowOf(s.taskId)).description).toBe(
                "No precondition, no protection",
            );
        });
    });

    it("`updated_at` moves, so a client COULD build a precondition on it", async () => {
        const s = await scene();
        const before = (await rowOf(s.taskId)).updatedAt;

        await new Promise((r) => setTimeout(r, 1100)); // second-resolution column
        await s.bobClient
            .patch(`/api/v1/tasks/${s.taskId}`)
            .send({ description: "Bob edited" });

        const after = (await rowOf(s.taskId)).updatedAt;
        // Recorded for whoever implements the feature: the raw material for an
        // ETag already exists and is maintained on every write.
        expect(after.getTime()).toBeGreaterThan(before.getTime());
    });
});
