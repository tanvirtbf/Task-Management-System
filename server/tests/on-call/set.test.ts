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
import { onCallShifts } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";
import { utcYmd } from "../test-utils/dates";

/**
 * Tests for `PUT /api/v1/on-call/:weekStart` (§21 #3).
 *
 * Private DB `tms_oncall_test`. 👑 admin/owner. Idempotent upsert keyed on
 * (workspace_id, week_start). `:weekStart` must be a real Monday; `engineer_id`
 * must be an active workspace member. `week_end` is derived (Sunday).
 */

const url = (weekStart: string) => `/api/v1/on-call/${weekStart}`;
const MON = "2026-06-01"; // a Monday

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

const shiftRows = async (workspaceId: string) =>
    getDb()
        .select()
        .from(onCallShifts)
        .where(eq(onCallShifts.workspaceId, workspaceId));

/** An owner (default) + client + an active engineer user in their workspace. */
const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    const eng = await makeUser({ workspaceId: u.workspaceId, role: "member" });
    return { u, client, eng };
};

describe("PUT /api/v1/on-call/:weekStart", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a shift (insert path), 200 with hydrated engineer + Sunday week_end", async () => {
            const { u, client, eng } = await setup();

            const res = await client.put(url(MON)).send({ engineer_id: eng.id });

            expect(res.status).toBe(200);
            expect(res.body.id).toMatch(/^ocs-/);
            expect(res.body.week_start).toBe("2026-06-01");
            expect(res.body.week_end).toBe("2026-06-07"); // week_start + 6 = Sunday
            expect(res.body.engineer.id).toBe(eng.id);

            const rows = await shiftRows(u.workspaceId);
            expect(rows).toHaveLength(1);
            expect(rows[0].engineerId).toBe(eng.id);
            expect(rows[0].createdBy).toBe(u.id);
        });

        it("overwrites the engineer for an existing week (update path): one row, id + creator preserved", async () => {
            const { u, client, eng } = await setup();
            const eng2 = await makeUser({ workspaceId: u.workspaceId });
            const admin2 = await makeUser({
                workspaceId: u.workspaceId,
                role: "admin",
            });
            const client2 = await makeLoggedInClient(admin2);

            const first = await client.put(url(MON)).send({ engineer_id: eng.id });
            const firstId = first.body.id;

            // A DIFFERENT admin overwrites the same week with a different engineer.
            const res = await client2
                .put(url(MON))
                .send({ engineer_id: eng2.id });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(firstId); // same row
            expect(res.body.engineer.id).toBe(eng2.id);

            const rows = await shiftRows(u.workspaceId);
            expect(rows).toHaveLength(1);
            expect(rows[0].engineerId).toBe(eng2.id);
            expect(rows[0].createdBy).toBe(u.id); // original creator preserved
        });

        it("is idempotent — same engineer twice → 200 both, one row", async () => {
            const { u, client, eng } = await setup();
            await client.put(url(MON)).send({ engineer_id: eng.id });
            const res = await client.put(url(MON)).send({ engineer_id: eng.id });
            expect(res.status).toBe(200);
            expect(res.body.engineer.id).toBe(eng.id);
            expect(await shiftRows(u.workspaceId)).toHaveLength(1);
        });

        it("derives week_end across a month boundary (2026-06-29 → 2026-07-05)", async () => {
            const { client, eng } = await setup();
            const res = await client
                .put(url("2026-06-29")) // a Monday
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(200);
            expect(res.body.week_start).toBe("2026-06-29");
            expect(res.body.week_end).toBe("2026-07-05"); // Sunday, next month
        });

        it("derives week_end across a year boundary (2026-12-28 → 2027-01-03)", async () => {
            const { client, eng } = await setup();
            const res = await client
                .put(url("2026-12-28")) // a Monday
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(200);
            expect(res.body.week_start).toBe("2026-12-28");
            expect(res.body.week_end).toBe("2027-01-03"); // Sunday, next year
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 validation.failed for a non-Monday weekStart", async () => {
            const { client, eng } = await setup();
            const res = await client
                .put(url("2026-06-02")) // Tuesday
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "weekStart",
                ),
            ).toBe(true);
        });

        it("422 for a malformed weekStart shape", async () => {
            const { client, eng } = await setup();
            const res = await client
                .put(url("2026-6-1"))
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for an impossible (shaped) date", async () => {
            const { client, eng } = await setup();
            const res = await client
                .put(url("2026-13-99"))
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        const badBody: Array<[string, unknown]> = [
            ["missing engineer_id", undefined],
            ["empty engineer_id", ""],
            ["non-string engineer_id", 123],
            ["over-long engineer_id", "u".repeat(65)],
        ];
        for (const [label, value] of badBody) {
            it(`422 for ${label}`, async () => {
                const { client } = await setup();
                const body =
                    value === undefined ? {} : { engineer_id: value };
                const res = await client.put(url(MON)).send(body);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }
    });

    // ─── Engineer validation (422 on_call.invalid_engineer) ───────────────────
    describe("Engineer validation", () => {
        it("rejects a non-existent engineer and writes nothing", async () => {
            const { u, client } = await setup();
            const res = await client
                .put(url(MON))
                .send({ engineer_id: "u-does-not-exist" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("on_call.invalid_engineer");
            expect(await shiftRows(u.workspaceId)).toHaveLength(0);
        });

        it("rejects a deactivated user", async () => {
            const { u, client } = await setup();
            const dead = await makeUser({
                workspaceId: u.workspaceId,
                status: "deactivated",
            });
            const res = await client
                .put(url(MON))
                .send({ engineer_id: dead.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("on_call.invalid_engineer");
        });

        it("rejects an engineer from another workspace [IDOR]", async () => {
            const { u, client } = await setup();
            const other = await makeUser(); // its own (different) workspace
            const res = await client
                .put(url(MON))
                .send({ engineer_id: other.id });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("on_call.invalid_engineer");
            expect(await shiftRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── Engineer role policy (any active user, including a guest) ─────────────
    describe("Engineer role policy", () => {
        it("allows an ACTIVE guest to be assigned (no role restriction)", async () => {
            const { u, client } = await setup();
            const guest = await makeUser({
                workspaceId: u.workspaceId,
                role: "guest",
                status: "active",
            });
            const res = await client
                .put(url(MON))
                .send({ engineer_id: guest.id });
            expect(res.status).toBe(200);
            expect(res.body.engineer.id).toBe(guest.id);
            expect(res.body.engineer.role).toBe("guest");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token when no token is supplied", async () => {
            const { eng } = await setup();
            const http = await oneOff();
            const res = await http.put(url(MON)).send({ engineer_id: eng.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { u, eng } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .put(url(MON))
                .set("Authorization", `Bearer ${token}`)
                .send({ engineer_id: eng.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 admin/owner) ────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (200)", async () => {
            const { client, eng } = await setup({ role: "owner" });
            const res = await client.put(url(MON)).send({ engineer_id: eng.id });
            expect(res.status).toBe(200);
        });

        it("allows an admin (200)", async () => {
            const { client, eng } = await setup({ role: "admin" });
            const res = await client.put(url(MON)).send({ engineer_id: eng.id });
            expect(res.status).toBe(200);
        });

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and writes nothing`, async () => {
                const { u, client, eng } = await setup({ role });
                const res = await client
                    .put(url(MON))
                    .send({ engineer_id: eng.id });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await shiftRows(u.workspaceId)).toHaveLength(0);
            });
        }
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("scopes the upsert to the caller's workspace (same Monday in another workspace is independent)", async () => {
            const { u, client, eng } = await setup();
            const wsB = await makeWorkspace();
            await makeOnCallShift({
                workspaceId: wsB.id,
                weekStart: utcYmd(2026, 6, 1), // same Monday, other workspace
            });

            const res = await client.put(url(MON)).send({ engineer_id: eng.id });

            expect(res.status).toBe(200);
            expect(await shiftRows(u.workspaceId)).toHaveLength(1);
            expect(await shiftRows(wsB.id)).toHaveLength(1); // B untouched
        });
    });

    // ─── Mass-assignment ──────────────────────────────────────────────────────
    describe("Mass-assignment", () => {
        it("ignores a body id / created_by", async () => {
            const { u, client, eng } = await setup();
            const res = await client.put(url(MON)).send({
                engineer_id: eng.id,
                id: "ocs-forced",
                created_by: "u-attacker",
            });
            expect(res.status).toBe(200);
            expect(res.body.id).not.toBe("ocs-forced");
            const rows = await shiftRows(u.workspaceId);
            expect(rows[0].createdBy).toBe(u.id);
        });
    });

    // ─── i. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("5 parallel upserts of the SAME week → all 200, exactly one row", async () => {
            const { u, client, eng } = await setup();

            const results = await Promise.all(
                Array.from({ length: 5 }, () =>
                    client.put(url(MON)).send({ engineer_id: eng.id }),
                ),
            );

            expect(results.every((r) => r.status === 200)).toBe(true);
            expect(await shiftRows(u.workspaceId)).toHaveLength(1);
        });

        it("2 parallel upserts of the same week with DIFFERENT engineers → both 200, one row (last-writer-wins)", async () => {
            const { u, client, eng } = await setup();
            const eng2 = await makeUser({ workspaceId: u.workspaceId });

            const [r1, r2] = await Promise.all([
                client.put(url(MON)).send({ engineer_id: eng.id }),
                client.put(url(MON)).send({ engineer_id: eng2.id }),
            ]);

            expect(r1.status).toBe(200);
            expect(r2.status).toBe(200);
            const rows = await shiftRows(u.workspaceId);
            expect(rows).toHaveLength(1);
            expect([eng.id, eng2.id]).toContain(rows[0].engineerId);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client, eng } = await setup();
            const res = await client.put(url(MON)).send({ engineer_id: eng.id });
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
