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

/**
 * Tests for `DELETE /api/v1/on-call/:weekStart` (§21 #4).
 *
 * Private DB `tms_oncall_test`. 👑 admin/owner. Clears the shift for a
 * Monday-keyed week → 204; a missing / cross-workspace week → 404
 * `on_call.not_found`.
 */

const url = (weekStart: string) => `/api/v1/on-call/${weekStart}`;
const MON = "2026-06-01"; // a Monday
const MON_DATE = new Date(2026, 5, 1); // local-midnight 2026-06-01

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

const shiftRows = async (workspaceId: string) =>
    getDb()
        .select()
        .from(onCallShifts)
        .where(eq(onCallShifts.workspaceId, workspaceId));

const setup = async (opts: { role?: Role } = {}) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const client = await makeLoggedInClient(u);
    return { u, client };
};

describe("DELETE /api/v1/on-call/:weekStart", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("deletes the week's shift and returns 204 with an empty body", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });

            const res = await client.delete(url(MON));

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
            expect(await shiftRows(u.workspaceId)).toHaveLength(0);
        });

        it("deletes only the targeted week, leaving other weeks intact", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: new Date(2026, 5, 8), // 2026-06-08
            });

            const res = await client.delete(url(MON));

            expect(res.status).toBe(204);
            const rows = await shiftRows(u.workspaceId);
            expect(rows).toHaveLength(1);
            expect(rows[0].weekStart).not.toBe(null);
        });
    });

    // ─── e. Not found ─────────────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 on_call.not_found when no shift exists for the week", async () => {
            const { client } = await setup();
            const res = await client.delete(url(MON));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("on_call.not_found");
        });

        it("returns 404 on the second delete of the same week (idempotent-ish)", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });

            const first = await client.delete(url(MON));
            const second = await client.delete(url(MON));

            expect(first.status).toBe(204);
            expect(second.status).toBe(404);
            expect(second.body.error.code).toBe("on_call.not_found");
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        const badWeeks: Array<[string, string]> = [
            ["non-Monday", "2026-06-02"],
            ["malformed shape", "2026-6-1"],
            ["impossible date", "2026-13-99"],
        ];
        for (const [label, week] of badWeeks) {
            it(`422 validation.failed for ${label}`, async () => {
                const { client } = await setup();
                const res = await client.delete(url(week));
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === "weekStart",
                    ),
                ).toBe(true);
            });
        }
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.delete(url(MON));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { u } = await setup();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(url(MON))
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 admin/owner) ────────────────────────────────────
    describe("Authorization", () => {
        it("allows an owner (204)", async () => {
            const { u, client } = await setup({ role: "owner" });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });
            const res = await client.delete(url(MON));
            expect(res.status).toBe(204);
        });

        it("allows an admin (204)", async () => {
            const { u, client } = await setup({ role: "admin" });
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });
            const res = await client.delete(url(MON));
            expect(res.status).toBe(204);
        });

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and leaves the shift intact`, async () => {
                const { u, client } = await setup({ role });
                await makeOnCallShift({
                    workspaceId: u.workspaceId,
                    weekStart: MON_DATE,
                });
                const res = await client.delete(url(MON));
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await shiftRows(u.workspaceId)).toHaveLength(1);
            });
        }
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("cannot delete another workspace's shift (404, B untouched)", async () => {
            const { client } = await setup(); // workspace A, no shift
            const wsB = await makeWorkspace();
            await makeOnCallShift({
                workspaceId: wsB.id,
                weekStart: MON_DATE,
            });

            const res = await client.delete(url(MON));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("on_call.not_found");
            expect(await shiftRows(wsB.id)).toHaveLength(1); // B untouched
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("carries an X-Request-Id header on the 204", async () => {
            const { u, client } = await setup();
            await makeOnCallShift({
                workspaceId: u.workspaceId,
                weekStart: MON_DATE,
            });
            const res = await client.delete(url(MON));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
