import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeOnCallShift,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/on-call/schedule` (§21 #2).
 *
 * Private DB `tms_oncall_test`. 🔐 any member. Returns every shift in the
 * workspace, chronological by `week_start`, in the `{ data, pagination }`
 * envelope; optional inclusive `?from=&to=` (YYYY-MM-DD) window on `week_start`.
 * Uses fixed Monday dates (filtering is on `week_start`, independent of today).
 */

const URL = "/api/v1/on-call/schedule";

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

/** Local-midnight Date for a fixed calendar day (matches the factory's convention). */
const day = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);

const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    return { u, client };
};

// 4 distinct Mondays in June 2026.
const seedFour = async (workspaceId: string) => {
    await makeOnCallShift({ workspaceId, weekStart: day(2026, 6, 1) });
    await makeOnCallShift({ workspaceId, weekStart: day(2026, 6, 8) });
    await makeOnCallShift({ workspaceId, weekStart: day(2026, 6, 15) });
    await makeOnCallShift({ workspaceId, weekStart: day(2026, 6, 22) });
};

const weekStarts = (body: { data: Array<{ week_start: string }> }): string[] =>
    body.data.map((s) => s.week_start);

describe("GET /api/v1/on-call/schedule", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns all shifts in week_start ascending order, enveloped", async () => {
            const { u, client } = await setup();
            // Insert out of chronological order to prove the sort.
            const s2 = await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: day(2026, 6, 8),
            });
            const s1 = await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: day(2026, 6, 1),
            });
            const s3 = await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: day(2026, 6, 15),
            });

            const res = await client.get(URL);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(3);
            expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([
                s1.id,
                s2.id,
                s3.id,
            ]);
            expect(res.body.data[0].week_start).toBe("2026-06-01");
            expect(res.body.data[0].week_end).toBe("2026-06-07");
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 3,
            });
        });

        it("returns an empty list when the workspace has no shifts", async () => {
            const { client } = await setup();
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
        });

        it("hydrates each shift's engineer as a full User (no leak)", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({
                workspaceId: u.workspaceId,
                firstName: "Sched",
                lastName: "Eng",
            });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
                weekStart: day(2026, 7, 6),
            });

            const res = await client.get(URL);

            expect(res.body.data[0].engineer.id).toBe(eng.id);
            expect(res.body.data[0].engineer.first_name).toBe("Sched");
            expect(res.body.data[0].engineer).not.toHaveProperty(
                "password_hash",
            );
            expect(res.body.data[0]).not.toHaveProperty("workspace_id");
            expect(res.body.data[0]).not.toHaveProperty("created_by");
        });
    });

    // ─── Date-range filter ────────────────────────────────────────────────────
    describe("Date-range filter", () => {
        it("filters by `from` (inclusive)", async () => {
            const { u, client } = await setup();
            await seedFour(u.workspaceId);
            const res = await client.get(`${URL}?from=2026-06-08`);
            expect(weekStarts(res.body)).toEqual([
                "2026-06-08",
                "2026-06-15",
                "2026-06-22",
            ]);
        });

        it("filters by `to` (inclusive)", async () => {
            const { u, client } = await setup();
            await seedFour(u.workspaceId);
            const res = await client.get(`${URL}?to=2026-06-08`);
            expect(weekStarts(res.body)).toEqual(["2026-06-01", "2026-06-08"]);
        });

        it("filters by a `from`+`to` window", async () => {
            const { u, client } = await setup();
            await seedFour(u.workspaceId);
            const res = await client.get(
                `${URL}?from=2026-06-08&to=2026-06-15`,
            );
            expect(weekStarts(res.body)).toEqual(["2026-06-08", "2026-06-15"]);
        });

        it("returns an empty list for an inverted range (from > to)", async () => {
            const { u, client } = await setup();
            await seedFour(u.workspaceId);
            const res = await client.get(
                `${URL}?from=2026-07-01&to=2026-06-01`,
            );
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, string, string]> = [
            ["from with slashes", "from=2026/06/01", "from"],
            ["from non-date text", "from=June2026", "from"],
            ["to wrong order", "to=06-01-2026", "to"],
            ["from one-digit parts", "from=2026-6-1", "from"],
        ];
        for (const [label, qs, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { client } = await setup();
                const res = await client.get(`${URL}?${qs}`);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }

        it("returns 422 for a repeated (array) from param", async () => {
            const { client } = await setup();
            const res = await client.get(
                `${URL}?from=2026-06-01&from=2026-06-08`,
            );
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a present-but-empty from param", async () => {
            const { client } = await setup();
            const res = await client.get(`${URL}?from=`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.get(URL);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(URL)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any member) ─────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin", "member", "guest"] as Role[]) {
            it(`allows a ${role} to read the schedule (200)`, async () => {
                const { client } = await setup({ role });
                const res = await client.get(URL);
                expect(res.status).toBe(200);
            });
        }
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns only the caller's workspace shifts", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: day(2026, 6, 1),
            });
            const wsB = await makeWorkspace();
            await makeOnCallShift({
                workspaceId: wsB.id,
                weekStart: day(2026, 6, 1),
            });
            await makeOnCallShift({
                workspaceId: wsB.id,
                weekStart: day(2026, 6, 8),
            });

            const res = await client.get(URL);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].week_start).toBe("2026-06-01");
        });
    });

    // ─── Engineer state (deactivated after assignment) ────────────────────────
    describe("Engineer state", () => {
        it("still lists a shift whose engineer was deactivated after assignment", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
                weekStart: day(2026, 6, 1),
            });
            await getDb()
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, eng.id));

            const res = await client.get(URL);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].engineer.id).toBe(eng.id);
            expect(res.body.data[0].engineer.status).toBe("deactivated");
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();
            const res = await client.get(URL);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
