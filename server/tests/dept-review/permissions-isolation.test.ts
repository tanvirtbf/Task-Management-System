import { getDb } from "../../src/db/client";
import { spaces } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import {
    addDaysYmd,
    dhakaWeekOf,
    previousWeekStart,
    weekBoundsUtc,
} from "../../src/utils/dhakaTime";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeReport,
    makeSpaceWithHead,
} from "./helpers";

/**
 * Dept Review V1 — P28: the permission + isolation SWEEP (plan §6 Stage G).
 *
 * The per-phase suites already lock their own role gates; this file locks the
 * cells they never crossed: the full cross-workspace fence (one 404-shaped
 * matrix over every new surface), the in-workspace deny matrix for readers,
 * snapshot-head-vs-current-head after a head CHANGE (H-12), the deactivated
 * head (headship cleared in the deactivate tx, live token per API_DESIGN
 * keeps only non-head powers), and the archived-space edges (history stays
 * readable + ack-able + notable; everything forward-looking is blocked).
 */

const LAST_WEEK = previousWeekStart(dhakaWeekOf(new Date()).weekStart);
const WEEK_BEFORE = previousWeekStart(LAST_WEEK);

/** Base fixture: ws A with owner + head + a dept that has one done task. */
const seedDept = async () => {
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const head = await makeUser({ workspaceId: ws, role: "member" });
    const sp = await makeSpaceWithHead({
        workspaceId: ws,
        headUserId: head.id,
        createdBy: owner.id,
        name: "Dept P28",
    });
    const dl = await makeDeptList({
        workspaceId: ws,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const task = await makeDoneTask({
        workspaceId: ws,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        createdBy: owner.id,
        completedAt: new Date(
            weekBoundsUtc(LAST_WEEK).fromUtc.getTime() + 3600_000,
        ),
    });
    const ownerClient = await makeLoggedInClient({ ...owner, role: "owner" });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    return { owner, ws, head, sp, dl, task, ownerClient, headClient };
};

describe("P28 sweep — cross-workspace fence", () => {
    it("every dept-review surface answers 404 (no cross-tenant oracle) — even for the OTHER workspace's owner", async () => {
        const s = await seedDept();
        const gen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(gen.status).toBe(200);
        const repId = gen.body.id as string;

        // Highest-privilege attacker: an OWNER of a different workspace.
        const ownerB = await makeUser({ role: "owner" });
        const clientB = await makeLoggedInClient({ ...ownerB, role: "owner" });

        const attempts: [
            "get" | "post" | "patch",
            string,
            Record<string, unknown> | undefined,
        ][] = [
            ["post", `/api/v1/tasks/${s.task.id}/review`, { status: "approved" }],
            ["get", `/api/v1/tasks/${s.task.id}/reviews`, undefined],
            ["get", `/api/v1/spaces/${s.sp.id}/review-summary`, undefined],
            [
                "get",
                `/api/v1/spaces/${s.sp.id}/review-queue?bucket=needs_review`,
                undefined,
            ],
            ["post", "/api/v1/reports/generate", { space_id: s.sp.id }],
            ["get", `/api/v1/reports/${repId}`, undefined],
            ["patch", `/api/v1/reports/${repId}`, { head_note: "intrusion" }],
            ["post", `/api/v1/reports/${repId}/ack`, undefined],
            ["patch", `/api/v1/spaces/${s.sp.id}`, { head_user_id: null }],
        ];
        for (const [method, path, body] of attempts) {
            const req = clientB[method](path);
            const res = await (body !== undefined ? req.send(body) : req);
            expect(`${method} ${path} → ${res.status}`).toBe(
                `${method} ${path} → 404`,
            );
            expect(res.body.error.code).toMatch(/\.not_found$/);
        }

        // And the list simply never leaks the other tenant's rows.
        const list = await clientB.get("/api/v1/reports");
        expect(list.status).toBe(200);
        expect(list.body.data).toEqual([]);
    });
});

describe("P28 sweep — in-workspace role matrix", () => {
    it("summary + queue: owner/admin/head 200; plain member and guest 403 review.not_head", async () => {
        const s = await seedDept();
        const admin = await makeUser({ workspaceId: s.ws, role: "admin" });
        const member = await makeUser({ workspaceId: s.ws, role: "member" });
        const guest = await makeUser({ workspaceId: s.ws, role: "guest" });
        const adminClient = await makeLoggedInClient({ ...admin, role: "admin" });
        const memberClient = await makeLoggedInClient({
            ...member,
            role: "member",
        });
        const guestClient = await makeLoggedInClient({ ...guest, role: "guest" });

        const surfaces = [
            `/api/v1/spaces/${s.sp.id}/review-summary`,
            `/api/v1/spaces/${s.sp.id}/review-queue?bucket=needs_review`,
        ];
        for (const path of surfaces) {
            for (const allowed of [s.ownerClient, adminClient, s.headClient]) {
                expect((await allowed.get(path)).status).toBe(200);
            }
            for (const denied of [memberClient, guestClient]) {
                const res = await denied.get(path);
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("review.not_head");
            }
        }
    });

    it("reports: list is an EMPTY 200 for member/guest (harmless), scoped for the head; direct read is 403 report.forbidden", async () => {
        const s = await seedDept();
        const rep = await makeReport({
            workspaceId: s.ws,
            spaceId: s.sp.id,
            headUserId: s.head.id,
            weekStart: LAST_WEEK,
            weekEnd: addDaysYmd(LAST_WEEK, 6),
        });
        const member = await makeUser({ workspaceId: s.ws, role: "member" });
        const guest = await makeUser({ workspaceId: s.ws, role: "guest" });
        const memberClient = await makeLoggedInClient({
            ...member,
            role: "member",
        });
        const guestClient = await makeLoggedInClient({ ...guest, role: "guest" });

        for (const c of [memberClient, guestClient]) {
            const list = await c.get("/api/v1/reports");
            expect(list.status).toBe(200);
            expect(list.body.data).toEqual([]);

            const direct = await c.get(`/api/v1/reports/${rep.id}`);
            expect(direct.status).toBe(403);
            expect(direct.body.error.code).toBe("report.forbidden");
        }

        const headList = await s.headClient.get("/api/v1/reports");
        expect(headList.status).toBe(200);
        expect(
            headList.body.data.map((r: { id: string }) => r.id),
        ).toContain(rep.id);
    });
});

describe("P28 sweep — snapshot head vs current head (H-12, after a head change)", () => {
    it("ex-head keeps snapshot rights (see + note) but loses head powers; the new head gains them but cannot touch the old note", async () => {
        const s = await seedDept();
        const gen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(gen.status).toBe(200);
        const repId = gen.body.id as string;

        // The owner hands the department to head2 through the real API.
        const head2 = await makeUser({ workspaceId: s.ws, role: "member" });
        const handover = await s.ownerClient
            .patch(`/api/v1/spaces/${s.sp.id}`)
            .send({ head_user_id: head2.id });
        expect(handover.status).toBe(200);
        const head2Client = await makeLoggedInClient({
            ...head2,
            role: "member",
        });

        // Ex-head (snapshot on repId): sees it, notes it…
        const exList = await s.headClient.get("/api/v1/reports");
        expect(
            exList.body.data.map((r: { id: string }) => r.id),
        ).toContain(repId);
        expect(
            (await s.headClient.get(`/api/v1/reports/${repId}`)).status,
        ).toBe(200);
        const exNote = await s.headClient
            .patch(`/api/v1/reports/${repId}`)
            .send({ head_note: "signed off before the handover" });
        expect(exNote.status).toBe(200);

        // …but head POWERS are gone (current-headship gates re-read the DB).
        const exGen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id, week_start: WEEK_BEFORE });
        expect(exGen.status).toBe(403);
        expect(exGen.body.error.code).toBe("report.forbidden");
        const exSummary = await s.headClient.get(
            `/api/v1/spaces/${s.sp.id}/review-summary`,
        );
        expect(exSummary.status).toBe(403);
        expect(exSummary.body.error.code).toBe("review.not_head");
        const exReview = await s.headClient
            .post(`/api/v1/tasks/${s.task.id}/review`)
            .send({ status: "approved" });
        expect(exReview.status).toBe(403);

        // New head: current-headship visibility + powers…
        const newList = await head2Client.get("/api/v1/reports");
        expect(
            newList.body.data.map((r: { id: string }) => r.id),
        ).toContain(repId);
        const newGen = await head2Client
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id, week_start: WEEK_BEFORE });
        expect(newGen.status).toBe(200);
        expect(newGen.body.head_user_id).toBe(head2.id);
        expect(
            (
                await head2Client.get(
                    `/api/v1/spaces/${s.sp.id}/review-summary`,
                )
            ).status,
        ).toBe(200);

        // …but the OLD report's note stays the ex-head's alone, and its
        // snapshot columns never rewrite to the new head.
        const newNote = await head2Client
            .patch(`/api/v1/reports/${repId}`)
            .send({ head_note: "not mine to write" });
        expect(newNote.status).toBe(403);
        expect(newNote.body.error.code).toBe("report.forbidden");
        const oldRep = await head2Client.get(`/api/v1/reports/${repId}`);
        expect(oldRep.body.head_user_id).toBe(s.head.id);
        expect(oldRep.body.head_note).toBe("signed off before the handover");
    });
});

describe("P28 sweep — deactivated head", () => {
    /**
     * ⚠️ Rewritten at F28's sweep — this spec pinned PRE-F22 behaviour and the
     * module had not run since (absent from every F22–F27 gate).
     *
     * F22 (ISS-019): the headship SURVIVES deactivation — the old in-tx
     * clearing silently orphaned the department. And the ≤15-min live access
     * token behaves for head powers exactly as it does for everything else:
     * `PolicyService` deliberately resolves a deactivated account's full
     * permission set until the token dies ("status enforced at refresh, not
     * here" — the documented auth-layer decision), so with the pointer intact
     * the head gates keep answering yes for that window. Deactivation revokes
     * every refresh session in the same transaction, which is what actually
     * ends the account's access.
     */
    it("deactivation KEEPS the headship; the ≤15-min live token keeps head powers; snapshots stay honest", async () => {
        const s = await seedDept();
        const gen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(gen.status).toBe(200);
        const repId = gen.body.id as string;

        const deact = await s.ownerClient.post(
            `/api/v1/users/${s.head.id}/deactivate`,
        );
        expect([200, 204]).toContain(deact.status);

        // F22: the pointer survives the status flip.
        const [row] = await getDb()
            .select({ headUserId: spaces.headUserId })
            .from(spaces)
            .where(eq(spaces.id, s.sp.id));
        expect(row.headUserId).toBe(s.head.id);

        // The ≤15-min live access token still passes the CURRENT-headship
        // gates — the documented window, same as every other grant.
        const exSummary = await s.headClient.get(
            `/api/v1/spaces/${s.sp.id}/review-summary`,
        );
        expect(exSummary.status).toBe(200);
        const exGen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id, week_start: WEEK_BEFORE });
        expect(exGen.status).toBe(200);
        // A fresh report snapshots the SURVIVING pointer — the department is
        // never headless, which is the point of F22.
        expect(exGen.body.head_user_id).toBe(s.head.id);

        // Admins keep the loop running regardless of the head's status…
        const adminRead = await s.ownerClient.get(`/api/v1/reports/${repId}`);
        expect(adminRead.status).toBe(200);

        // …and the OLD report's snapshot stays the deactivated user forever.
        expect(adminRead.body.head_user_id).toBe(s.head.id);
    });
});

describe("P28 sweep — archived-space edges", () => {
    it("archiving freezes the department, not its history: reports stay listed/readable/ack-able/notable; generate + review surfaces refuse", async () => {
        const s = await seedDept();
        const gen = await s.headClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id });
        expect(gen.status).toBe(200);
        const repId = gen.body.id as string;

        const arch = await s.ownerClient.post(
            `/api/v1/spaces/${s.sp.id}/archive`,
        );
        expect([200, 204]).toContain(arch.status);

        // History keeps flowing to HR…
        const list = await s.ownerClient.get("/api/v1/reports");
        expect(
            list.body.data.map((r: { id: string }) => r.id),
        ).toContain(repId);
        expect(
            (await s.ownerClient.get(`/api/v1/reports/${repId}`)).status,
        ).toBe(200);
        const ack = await s.ownerClient.post(`/api/v1/reports/${repId}/ack`);
        expect(ack.status).toBe(200);
        const note = await s.headClient
            .patch(`/api/v1/reports/${repId}`)
            .send({ head_note: "context filed after the dept closed" });
        expect(note.status).toBe(200); // snapshot-head right is history-scoped

        // …while every forward-looking surface refuses with 409.
        const newGen = await s.ownerClient
            .post("/api/v1/reports/generate")
            .send({ space_id: s.sp.id, week_start: WEEK_BEFORE });
        expect(newGen.status).toBe(409);
        expect(newGen.body.error.code).toBe("space.archived");
        for (const path of [
            `/api/v1/spaces/${s.sp.id}/review-summary`,
            `/api/v1/spaces/${s.sp.id}/review-queue?bucket=needs_review`,
        ]) {
            const res = await s.headClient.get(path);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.archived");
        }
        const rev = await s.headClient
            .post(`/api/v1/tasks/${s.task.id}/review`)
            .send({ status: "approved" });
        expect(rev.status).toBe(409);
        expect(rev.body.error.code).toBe("space.archived");
    });
});
