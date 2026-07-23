import { getDb } from "../../src/db/client";
import { notifications } from "../../src/db/schema";
import {
    addDaysYmd,
    dhakaWeekOf,
    previousWeekStart,
    weekBoundsUtc,
} from "../../src/utils/dhakaTime";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P21: A-8 on-demand generate, A-9 head note, A-10 ack.
 *
 * Locks: the past-Dhaka-Monday rule (422 report.invalid_week), the A-8 gate
 * (current head or 👑; archived 409), no-re-notify through the shared path,
 * the STRICT snapshot-head-only note gate (admins excluded), note-survives-
 * regenerate through the real API, and first-ack-wins idempotency.
 */

const LAST_WEEK = previousWeekStart(dhakaWeekOf(new Date()).weekStart);
const CURRENT_MONDAY = dhakaWeekOf(new Date()).weekStart;

const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const head = await makeUser({ workspaceId: ws, role: "member" });
    const sp = await makeSpaceWithHead({
        workspaceId: ws,
        headUserId: head.id,
        createdBy: owner.id,
        name: "Dept Z",
    });
    const dl = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    await makeDoneTask({
        workspaceId: ws,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        createdBy: owner.id,
        completedAt: new Date(
            weekBoundsUtc(LAST_WEEK).fromUtc.getTime() + 3600_000,
        ),
    });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    const ownerClient = await makeLoggedInClient({ ...owner, role: "owner" });
    return { owner, ws, head, sp, dl, headClient, ownerClient };
};

const notificationCount = async () =>
    (
        await getDb()
            .select({ id: notifications.id })
            .from(notifications)
    ).length;

describe("POST /api/v1/reports/generate (A-8)", () => {
    it("head generates the default (last completed) week; fanout fires once; regenerate refreshes without re-notifying", async () => {
        const { sp, head, headClient } = await seed();

        const res = await headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: sp.id });

        expect(res.status).toBe(200);
        expect(res.body.week_start).toBe(LAST_WEEK);
        expect(res.body.week_end).toBe(addDaysYmd(LAST_WEEK, 6));
        expect(res.body.head_user_id).toBe(head.id);
        expect(res.body.head.id).toBe(head.id);
        expect(res.body.generated_by).toBe(head.id);
        expect(res.body.payload.totals.completed).toBe(1);
        const after = await notificationCount();
        expect(after).toBeGreaterThan(0);

        const again = await headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: sp.id, week_start: LAST_WEEK });
        expect(again.status).toBe(200);
        expect(again.body.id).toBe(res.body.id); // same (space, week) row
        expect(await notificationCount()).toBe(after); // no re-fanout
    });

    it("explicit past Monday OK; non-Monday, future Monday and the CURRENT Monday are 422 report.invalid_week", async () => {
        const { sp, headClient } = await seed();

        const okWeek = previousWeekStart(LAST_WEEK);
        const ok = await headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: sp.id, week_start: okWeek });
        expect(ok.status).toBe(200);
        expect(ok.body.week_start).toBe(okWeek);

        for (const bad of [
            addDaysYmd(LAST_WEEK, 1), // a Tuesday
            addDaysYmd(CURRENT_MONDAY, 7), // future Monday
            CURRENT_MONDAY, // current week — not PAST
        ]) {
            const res = await headClient
                .post("/api/v1/reports/generate")
                .send({ space_id: sp.id, week_start: bad });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("report.invalid_week");
        }

        const badFormat = await headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: sp.id, week_start: "13-07-2026" });
        expect(badFormat.status).toBe(422);
        expect(badFormat.body.error.code).toBe("validation.failed");
    });

    it("gate: admin OK; non-head member and guest 403; other-space head 403; unknown space 404; archived space 409", async () => {
        const { ws, owner, sp, ownerClient } = await seed();
        const adminClient = await makeLoggedInClient({
            ...(await makeUser({ workspaceId: ws, role: "admin" })),
            role: "admin",
        });
        expect(
            (
                await adminClient
                    .post("/api/v1/reports/generate")
                    .send({ space_id: sp.id })
            ).status,
        ).toBe(200);

        const outsider = await makeUser({ workspaceId: ws, role: "member" });
        const guest = await makeUser({ workspaceId: ws, role: "guest" });
        const otherHead = await makeUser({ workspaceId: ws, role: "member" });
        await makeSpaceWithHead({
            workspaceId: ws,
            headUserId: otherHead.id,
            createdBy: owner.id,
        });
        for (const u of [outsider, guest, otherHead]) {
            const client = await makeLoggedInClient({ ...u, role: u.role });
            const res = await client
                .post("/api/v1/reports/generate")
                .send({ space_id: sp.id });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("report.forbidden");
        }

        expect(
            (
                await ownerClient
                    .post("/api/v1/reports/generate")
                    .send({ space_id: fakeId("sp") })
            ).status,
        ).toBe(404);

        const archived = await makeSpaceWithHead({
            workspaceId: ws,
            createdBy: owner.id,
            archivedAt: new Date("2026-01-02T03:04:05.000Z"),
        });
        const arch = await ownerClient
            .post("/api/v1/reports/generate")
            .send({ space_id: archived.id });
        expect(arch.status).toBe(409);
        expect(arch.body.error.code).toBe("space.archived");
    });
});

describe("PATCH /api/v1/reports/:id (A-9) + POST /:id/ack (A-10)", () => {
    const generate = async (s: Awaited<ReturnType<typeof seed>>) => {
        const res = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(res.status).toBe(200);
        return res.body as { id: string };
    };

    it("SNAPSHOT head sets/clears the note; even an ADMIN is 403; the note survives regeneration via the API", async () => {
        const s = await seed();
        const rep = await generate(s);

        const set = await s.headClient
            .patch(`/api/v1/reports/${rep.id}`)
            .send({ head_note: "Team carried a heavy launch week." });
        expect(set.status).toBe(200);
        expect(set.body.head_note).toBe(
            "Team carried a heavy launch week.",
        );

        // Admins may NOT write the head's personal note (strict gate).
        const admin = await makeUser({ workspaceId: s.ws, role: "admin" });
        const adminClient = await makeLoggedInClient({
            ...admin,
            role: "admin",
        });
        const denied = await adminClient
            .patch(`/api/v1/reports/${rep.id}`)
            .send({ head_note: "override" });
        expect(denied.status).toBe(403);
        expect(denied.body.error.code).toBe("report.forbidden");

        // Regenerate through the API — the note must survive (§2.5).
        const regen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(regen.body.head_note).toBe(
            "Team carried a heavy launch week.",
        );

        // Null clears; over-long is 422.
        const cleared = await s.headClient
            .patch(`/api/v1/reports/${rep.id}`)
            .send({ head_note: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.head_note).toBeNull();
        const tooLong = await s.headClient
            .patch(`/api/v1/reports/${rep.id}`)
            .send({ head_note: "x".repeat(1001) });
        expect(tooLong.status).toBe(422);
    });

    it("ack: 👑 only, FIRST actor sticks, idempotent 200; members are 403; 404 unknown; 401 unauthenticated", async () => {
        const s = await seed();
        const rep = await generate(s);
        const admin = await makeUser({ workspaceId: s.ws, role: "admin" });
        const adminClient = await makeLoggedInClient({
            ...admin,
            role: "admin",
        });

        const first = await adminClient.post(
            `/api/v1/reports/${rep.id}/ack`,
        );
        expect(first.status).toBe(200);
        expect(first.body.acknowledged_by).toBe(admin.id);
        const firstAt = first.body.acknowledged_at as string;
        expect(firstAt).toBeTruthy();

        // A different admin acks again → 200, but the FIRST actor sticks.
        const second = await s.ownerClient.post(
            `/api/v1/reports/${rep.id}/ack`,
        );
        expect(second.status).toBe(200);
        expect(second.body.acknowledged_by).toBe(admin.id);
        expect(second.body.acknowledged_at).toBe(firstAt);

        // Role gate: the head (a member) may not ack.
        const denied = await s.headClient.post(
            `/api/v1/reports/${rep.id}/ack`,
        );
        expect(denied.status).toBe(403);
        expect(denied.body.error.code).toBe("auth.forbidden");

        expect(
            (
                await adminClient.post(
                    `/api/v1/reports/${fakeId("rep")}/ack`,
                )
            ).status,
        ).toBe(404);

        const http = await oneOff();
        expect(
            (await http.post(`/api/v1/reports/${rep.id}/ack`)).status,
        ).toBe(401);
    });
});
