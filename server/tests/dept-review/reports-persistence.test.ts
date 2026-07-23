import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { departmentReports, spaces } from "../../src/db/schema";
import { DepartmentReportsRepo } from "../../src/repositories/DepartmentReportsRepo";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import { makeReport, makeSpaceWithHead } from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P19: department_reports persistence + A-6/A-7 reads.
 *
 * The load-bearing invariant: the generation UPSERT refreshes ONLY the
 * payload, the generated_* columns and the head snapshot — never head_note /
 * acknowledged_* / notified_at. Plus: composite (week DESC, internal_id DESC)
 * ordering + cursor paging, the head-visibility rules (current OR snapshot),
 * serializer shapes (list = totals preview; detail = full payload;
 * notified_at/internal_id never on the wire), and the 403/404 matrix.
 */

const LIST_ITEM_KEYS = [
    "id",
    "space_id",
    "week_start",
    "week_end",
    "head_user_id",
    "head",
    "head_note",
    "generated_by",
    "generated_at",
    "acknowledged_by",
    "acknowledged_at",
    "totals",
].sort();

const repo = () => new DepartmentReportsRepo(getDb());

const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const ws = owner.workspaceId;
    const head = await makeUser({ workspaceId: ws, role: "member" });
    const spA = await makeSpaceWithHead({
        workspaceId: ws,
        headUserId: head.id,
        createdBy: owner.id,
        name: "Dept A",
    });
    const spB = await makeSpaceWithHead({
        workspaceId: ws,
        createdBy: owner.id,
        name: "Dept B",
    });
    return { owner, ws, head, spA, spB };
};

describe("DepartmentReportsRepo.upsert (the §2.5 invariant)", () => {
    it("second upsert refreshes payload/generated_*/head snapshot but PRESERVES note, ack and the notification claim", async () => {
        const { ws, head, spA } = await seed();
        const first = await repo().upsert({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            headUserId: head.id,
            payload: { totals: { completed: 1 } },
            generatedBy: null,
            generatedAt: new Date("2026-07-20T03:00:00.000Z"),
        });

        // Simulate the other writers (P20 claim, P21 note/ack).
        await getDb()
            .update(departmentReports)
            .set({
                headNote: "keep me",
                notifiedAt: new Date("2026-07-20T03:00:05.000Z"),
                acknowledgedBy: head.id,
                acknowledgedAt: new Date("2026-07-20T04:00:00.000Z"),
            })
            .where(eq(departmentReports.id, first.id));

        const second = await repo().upsert({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            headUserId: null, // head left mid-week — snapshot refreshes
            payload: { totals: { completed: 7 } },
            generatedBy: head.id,
            generatedAt: new Date("2026-07-21T09:00:00.000Z"),
        });

        expect(second.id).toBe(first.id); // same row, refreshed
        expect(
            (second.payload as { totals: { completed: number } }).totals
                .completed,
        ).toBe(7);
        expect(second.headUserId).toBeNull();
        expect(second.generatedBy).toBe(head.id);
        // The invariant: untouched by the upsert.
        expect(second.headNote).toBe("keep me");
        expect(second.notifiedAt?.toISOString()).toBe(
            "2026-07-20T03:00:05.000Z",
        );
        expect(second.acknowledgedBy).toBe(head.id);
        expect(second.acknowledgedAt).not.toBeNull();
    });
});

describe("GET /api/v1/reports (A-6) + /:id (A-7)", () => {
    it("owner lists all, newest week first with internal_id tie-break; list rows carry totals + hydrated head, never payload/notified_at", async () => {
        const { owner, ws, head, spA, spB } = await seed();
        await makeReport({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-06",
            weekEnd: "2026-07-12",
            headUserId: head.id,
            payload: { totals: { completed: 1 } },
        });
        await makeReport({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            headUserId: head.id,
            payload: { totals: { completed: 2 } },
        });
        await makeReport({
            workspaceId: ws,
            spaceId: spB.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            payload: { totals: { completed: 3 } },
        });
        const client = await makeLoggedInClient({ ...owner, role: "owner" });

        const res = await client.get("/api/v1/reports");
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        // Same week: spB inserted later → higher internal_id → first.
        expect(res.body.data[0].space_id).toBe(spB.id);
        expect(res.body.data[1].space_id).toBe(spA.id);
        expect(res.body.data[2].week_start).toBe("2026-07-06");

        const row = res.body.data[1];
        expect(Object.keys(row).sort()).toEqual(LIST_ITEM_KEYS);
        expect(row.totals).toEqual({ completed: 2 });
        expect(row.head.id).toBe(head.id);
        expect(row.head).not.toHaveProperty("password_hash");
        expect(row).not.toHaveProperty("payload");
        expect(row).not.toHaveProperty("notified_at");
        expect(row).not.toHaveProperty("internal_id");

        // space_id filter.
        const filtered = await client.get(
            `/api/v1/reports?space_id=${spA.id}`,
        );
        expect(filtered.body.data).toHaveLength(2);
        expect(filtered.body.pagination.total_estimate).toBe(2);
    });

    it("cursor paging walks weeks without overlap", async () => {
        const { owner, ws, spA } = await seed();
        for (const [ws1, we] of [
            ["2026-06-29", "2026-07-05"],
            ["2026-07-06", "2026-07-12"],
            ["2026-07-13", "2026-07-19"],
        ] as const) {
            await makeReport({
                workspaceId: ws,
                spaceId: spA.id,
                weekStart: ws1,
                weekEnd: we,
            });
        }
        const client = await makeLoggedInClient({ ...owner, role: "owner" });

        const p1 = await client.get("/api/v1/reports?limit=2");
        expect(p1.body.data).toHaveLength(2);
        expect(p1.body.pagination.has_more).toBe(true);
        expect(p1.body.pagination.total_estimate).toBe(3);

        const p2 = await client.get(
            `/api/v1/reports?limit=2&cursor=${encodeURIComponent(
                p1.body.pagination.next_cursor,
            )}`,
        );
        expect(p2.body.data).toHaveLength(1);
        expect(p2.body.pagination.has_more).toBe(false);
        const weeks = [
            ...p1.body.data.map((r: { week_start: string }) => r.week_start),
            ...p2.body.data.map((r: { week_start: string }) => r.week_start),
        ];
        expect(weeks).toEqual(["2026-07-13", "2026-07-06", "2026-06-29"]);
    });

    it("head visibility: current headship + SNAPSHOT rows; plain members get an empty list; detail gate 403s outsiders", async () => {
        const { owner, ws, head, spA, spB } = await seed();
        // Report in currently-headed A + an OLD row in B where head was the
        // snapshot head (headship since moved — spB.head is null now).
        const inA = await makeReport({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
        });
        const snapshotInB = await makeReport({
            workspaceId: ws,
            spaceId: spB.id,
            weekStart: "2026-07-06",
            weekEnd: "2026-07-12",
            headUserId: head.id, // snapshot!
        });
        const otherInB = await makeReport({
            workspaceId: ws,
            spaceId: spB.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
        });

        const headClient = await makeLoggedInClient({
            ...head,
            role: "member",
        });
        const res = await headClient.get("/api/v1/reports");
        const ids = res.body.data.map((r: { id: string }) => r.id);
        expect(ids).toContain(inA.id); // current headship
        expect(ids).toContain(snapshotInB.id); // snapshot visibility
        expect(ids).not.toContain(otherInB.id);
        expect(res.body.pagination.total_estimate).toBe(2);

        // Detail: current-head OK, snapshot OK, other row 403.
        expect((await headClient.get(`/api/v1/reports/${inA.id}`)).status).toBe(
            200,
        );
        expect(
            (await headClient.get(`/api/v1/reports/${snapshotInB.id}`))
                .status,
        ).toBe(200);
        const forbidden = await headClient.get(
            `/api/v1/reports/${otherInB.id}`,
        );
        expect(forbidden.status).toBe(403);
        expect(forbidden.body.error.code).toBe("report.forbidden");

        // A plain member: empty list, 403 on any direct read.
        const member = await makeUser({ workspaceId: ws, role: "member" });
        const memberClient = await makeLoggedInClient({
            ...member,
            role: "member",
        });
        const empty = await memberClient.get("/api/v1/reports");
        expect(empty.body.data).toEqual([]);
        expect(
            (await memberClient.get(`/api/v1/reports/${inA.id}`)).status,
        ).toBe(403);
        void owner;
    });

    it("detail carries the full payload; 404 for unknown/foreign; 400 for a malformed cursor; 401 unauthenticated", async () => {
        const { owner, ws, head, spA } = await seed();
        const rep = await makeReport({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-13",
            weekEnd: "2026-07-19",
            headUserId: head.id,
            payload: {
                members: [],
                totals: { completed: 5 },
                head_accountability: { reviews_done: 4 },
                prev_week: null,
            },
        });
        const client = await makeLoggedInClient({ ...owner, role: "owner" });

        const detail = await client.get(`/api/v1/reports/${rep.id}`);
        expect(detail.status).toBe(200);
        expect(detail.body.payload.totals.completed).toBe(5);
        expect(detail.body.payload.head_accountability.reviews_done).toBe(4);
        expect(detail.body).not.toHaveProperty("notified_at");
        expect(detail.body.head.id).toBe(head.id);

        expect(
            (await client.get(`/api/v1/reports/${fakeId("rep")}`)).status,
        ).toBe(404);

        const foreignOwner = await makeUser({ role: "owner" });
        const foreignClient = await makeLoggedInClient({
            ...foreignOwner,
            role: "owner",
        });
        expect(
            (await foreignClient.get(`/api/v1/reports/${rep.id}`)).status,
        ).toBe(404);

        const badCursor = await client.get(
            "/api/v1/reports?cursor=%24%24bad",
        );
        expect(badCursor.status).toBe(400);
        expect(badCursor.body.error.code).toBe("pagination.invalid_cursor");

        const http = await oneOff();
        expect((await http.get("/api/v1/reports")).status).toBe(401);
    });

    it("an EX-head keeps snapshot rows even after the headship moves (H-12 amendment)", async () => {
        const { ws, owner, head, spA } = await seed();
        const oldRow = await makeReport({
            workspaceId: ws,
            spaceId: spA.id,
            weekStart: "2026-07-06",
            weekEnd: "2026-07-12",
            headUserId: head.id, // snapshot while they were head
        });
        // Headship moves to someone new.
        const newHead = await makeUser({ workspaceId: ws, role: "member" });
        await getDb()
            .update(spaces)
            .set({ headUserId: newHead.id })
            .where(eq(spaces.id, spA.id));

        const exHeadClient = await makeLoggedInClient({
            ...head,
            role: "member",
        });
        const res = await exHeadClient.get("/api/v1/reports");
        expect(
            res.body.data.map((r: { id: string }) => r.id),
        ).toContain(oldRow.id);
        expect(
            (await exHeadClient.get(`/api/v1/reports/${oldRow.id}`)).status,
        ).toBe(200);

        // The NEW head sees the department's history too (current headship).
        const newHeadClient = await makeLoggedInClient({
            ...newHead,
            role: "member",
        });
        expect(
            (await newHeadClient.get(`/api/v1/reports/${oldRow.id}`)).status,
        ).toBe(200);
        void owner;
    });
});
