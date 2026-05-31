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
 * Tests for `GET /api/v1/on-call/current` (§21 #1).
 *
 * Private DB `tms_oncall_test`. 🔐 any member. Returns the shift covering today
 * (`week_start <= CURDATE() <= week_end`), picking the most-recent `week_start`
 * when several straddle today; `200` with `null` when nobody is on call this
 * week. `engineer` is a full hydrated `User`.
 */

const URL = "/api/v1/on-call/current";

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

/**
 * Local-midnight date `offsetDays` from today — matches the factory's date
 * convention and the DB's `CURDATE()` (Node + MySQL share this machine's tz, so
 * `localDate(0)` equals `CURDATE()` with no skew).
 */
const localDate = (offsetDays: number): Date => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
};

const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    return { u, client };
};

describe("GET /api/v1/on-call/current", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the current shift and a fully-hydrated engineer", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({
                workspaceId: u.workspaceId,
                role: "member",
                firstName: "On",
                lastName: "Caller",
            });
            const shift = await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
                createdBy: u.id,
            });

            const res = await client.get(URL);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(shift.id);
            expect(res.body.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(res.body.week_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(res.body.engineer.id).toBe(eng.id);
            expect(res.body.engineer.first_name).toBe("On");
            expect(res.body.engineer.last_name).toBe("Caller");
            expect(res.body.engineer.email).toBe(eng.email);
        });

        it("returns 200 with null when nobody is on call this week", async () => {
            const { client } = await setup();
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });

        it("ignores a shift entirely in the past", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: localDate(-14), // week_end = localDate(-8), before today
            });
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });

        it("ignores a shift entirely in the future", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: localDate(7), // starts next week
            });
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });

        it("includes a shift whose week_end is exactly today (inclusive boundary)", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
                weekStart: localDate(-6), // week_end = today
            });
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body?.engineer.id).toBe(eng.id);
        });

        it("includes a shift whose week_start is exactly today (inclusive boundary)", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
                weekStart: localDate(0), // starts today
            });
            const res = await client.get(URL);
            expect(res.status).toBe(200);
            expect(res.body?.engineer.id).toBe(eng.id);
        });

        it("picks the shift with the most recent week_start when several straddle today", async () => {
            const { u, client } = await setup();
            const engOld = await makeUser({ workspaceId: u.workspaceId });
            const engNew = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: engOld.id,
                weekStart: localDate(-5), // -5..+1 covers today
            });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: engNew.id,
                weekStart: localDate(-1), // -1..+5 covers today, later week_start
            });

            const res = await client.get(URL);

            expect(res.status).toBe(200);
            expect(res.body.engineer.id).toBe(engNew.id);
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
            it(`allows a ${role} to read current on-call (200)`, async () => {
                const { client } = await setup({ role });
                const res = await client.get(URL);
                expect(res.status).toBe(200);
            });
        }
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("does not return another workspace's current shift", async () => {
            const { client } = await setup(); // workspace A, no shift
            const wsB = await makeWorkspace();
            await makeOnCallShift({ workspaceId: wsB.id }); // current shift in B

            const res = await client.get(URL);

            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });
    });

    // ─── Engineer hydration / no-leak ─────────────────────────────────────────
    describe("Engineer hydration", () => {
        it("returns the engineer as a full User and leaks no internal fields", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
            });

            const res = await client.get(URL);

            const e = res.body.engineer;
            expect(Object.keys(e).sort()).toEqual(
                [
                    "avatar_url",
                    "created_at",
                    "email",
                    "first_name",
                    "id",
                    "last_login_at",
                    "last_name",
                    "role",
                    "status",
                    "timezone",
                ].sort(),
            );
            expect(e).not.toHaveProperty("password_hash");
            expect(e).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("created_by");
        });
    });

    // ─── Engineer state (deactivated after assignment) ────────────────────────
    describe("Engineer state", () => {
        it("still returns the shift when the engineer was deactivated after assignment", async () => {
            const { u, client } = await setup();
            const eng = await makeUser({ workspaceId: u.workspaceId });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                engineerId: eng.id,
            });
            // Deactivate the engineer AFTER they were assigned to the week.
            await getDb()
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, eng.id));

            const res = await client.get(URL);

            // The rotation still names them — read endpoints do not filter by
            // engineer status (assignment-time validation only).
            expect(res.status).toBe(200);
            expect(res.body.engineer.id).toBe(eng.id);
            expect(res.body.engineer.status).toBe("deactivated");
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
