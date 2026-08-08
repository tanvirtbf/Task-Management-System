import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { workspaceActivity, workspaces } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/workspace` (§3 #2).
 *
 * 👑 admin/owner partial update of the caller's own workspace (id always from
 * the JWT `workspaceId` claim). Validates each supplied field (422
 * `validation.failed`); enforces `business_hours_start < business_hours_end`
 * against the MERGED pair in the service (422 `workspace.invalid_business_hours`);
 * writes ONE `workspace_activity` row (`entity_type: "workspace"`,
 * `action: "updated"`, `context.changed_fields`) on a non-empty patch; an empty
 * patch is a 200 no-op with no activity. Returns the bare snake_case Workspace.
 *
 * NOTE on isolation: the workspace suite truncates only [sessions, users,
 * workspaces] between tests — NOT workspace_activity — so every activity
 * assertion here is scoped to the test's own (fresh) workspace id.
 */

const PATH = "/api/v1/workspace";

const WIRE_KEYS = [
    "business_hours_end",
    "business_hours_start",
    "default_locale",
    "id",
    "logo_url",
    "name",
    "timezone",
    "week_starts_on",
    "working_days",
];

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", issuer: "task-management-server", expiresIn: "15m", ...opts },
    );

/** Direct Drizzle update to seed non-default starting state the factory omits. */
const setWorkspace = async (
    id: string,
    patch: Partial<typeof workspaces.$inferInsert>,
): Promise<void> => {
    await getDb().update(workspaces).set(patch).where(eq(workspaces.id, id));
};

/** Activity rows for ONE workspace (the table is not truncated between tests). */
const activityFor = async (workspaceId: string) =>
    getDb()
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));

const rowOf = async (workspaceId: string) => {
    const [row] = await getDb()
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
    return row;
};

/** Workspace + a logged-in actor of the given role (default admin). */
const setup = async (role: Role = "admin") => {
    const ws = await makeWorkspace({ name: "BeautyBooth" });
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, client };
};

const ctxOf = (row: { context: unknown }): { changed_fields?: string[] } =>
    typeof row.context === "string"
        ? JSON.parse(row.context)
        : (row.context as { changed_fields?: string[] });

describe("PATCH /api/v1/workspace", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("updates a single field, returns 200 + the bare wire Workspace, persists, logs activity", async () => {
            const { ws, actor, client } = await setup();

            const res = await client.patch(PATH).send({ name: "New Name" });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(WIRE_KEYS);
            expect(res.body.name).toBe("New Name");
            expect((await rowOf(ws.id)).name).toBe("New Name");

            const acts = await activityFor(ws.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].entityType).toBe("workspace");
            expect(acts[0].entityId).toBe(ws.id);
            expect(acts[0].action).toBe("updated");
            expect(acts[0].actorId).toBe(actor.id);
            expect(ctxOf(acts[0]).changed_fields).toEqual(["name"]);
        });

        it("updates multiple fields and records them in changed_fields", async () => {
            const { ws, client } = await setup();

            // F28 (D12.2) — this used to pair `name` with
            // `fiscal_year_start_month`, which no longer exists.
            // `week_starts_on` is the equivalent subject: a numeric setting that
            // is still editable AND still read (the client calendar consumes
            // it), so the pairing stays meaningful.
            const res = await client
                .patch(PATH)
                .send({ name: "Multi", week_starts_on: 3 });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Multi");
            expect(res.body.week_starts_on).toBe(3);
            const row = await rowOf(ws.id);
            expect(row.weekStartsOn).toBe(3);

            const [act] = await activityFor(ws.id);
            expect(ctxOf(act).changed_fields).toEqual([
                "name",
                "week_starts_on",
            ]);
        });

        it("sets logo_url to a URL and clears it with null", async () => {
            const { ws, client } = await setup();

            const set = await client
                .patch(PATH)
                .send({ logo_url: "https://cdn.example.com/logo.png" });
            expect(set.status).toBe(200);
            expect(set.body.logo_url).toBe("https://cdn.example.com/logo.png");

            const cleared = await client.patch(PATH).send({ logo_url: null });
            expect(cleared.status).toBe(200);
            expect(cleared.body.logo_url).toBeNull();
            expect((await rowOf(ws.id)).logoUrl).toBeNull();
        });

        it("updates working_days (SET column round-trips as day literals)", async () => {
            const { ws, client } = await setup();

            const res = await client
                .patch(PATH)
                .send({ working_days: ["mon", "fri", "sat"] });

            expect(res.status).toBe(200);
            expect(res.body.working_days).toEqual(["mon", "fri", "sat"]);
            expect((await rowOf(ws.id)).workingDays).toEqual([
                "mon",
                "fri",
                "sat",
            ]);
        });

        it("updates a valid business-hours pair", async () => {
            const { client } = await setup();
            const res = await client.patch(PATH).send({
                business_hours_start: "08:00:00",
                business_hours_end: "17:30:00",
            });
            expect(res.status).toBe(200);
            expect(res.body.business_hours_start).toBe("08:00:00");
            expect(res.body.business_hours_end).toBe("17:30:00");
        });

        it("accepts a valid IANA timezone", async () => {
            const { client } = await setup();
            const res = await client
                .patch(PATH)
                .send({ timezone: "America/New_York" });
            expect(res.status).toBe(200);
            expect(res.body.timezone).toBe("America/New_York");
        });

        it("coerces a numeric-string week_starts_on", async () => {
            const { client } = await setup();
            const res = await client.patch(PATH).send({ week_starts_on: "3" });
            expect(res.status).toBe(200);
            expect(res.body.week_starts_on).toBe(3);
        });
    });

    // ─── Empty patch (no-op) ──────────────────────────────────────────────────
    describe("Empty patch", () => {
        it("200 no-op with no activity row when no recognized field is sent", async () => {
            const { ws, client } = await setup();

            const res = await client.patch(PATH).send({});

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("BeautyBooth");
            expect(await activityFor(ws.id)).toHaveLength(0);
        });

        it("ignores unknown body fields (no error, no change)", async () => {
            const { ws, client } = await setup();
            const res = await client
                .patch(PATH)
                .send({ totally_unknown: "x", id: "ws-hacker" });
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
            expect(await activityFor(ws.id)).toHaveLength(0);
        });
    });

    // ─── Business-hours merged guard (422 workspace.invalid_business_hours) ─────
    describe("Business-hours guard", () => {
        it("422 when a partial start makes start >= the stored end", async () => {
            const { ws, client } = await setup();
            // default end is 18:00:00; pushing start to 19:00 inverts the pair
            const res = await client
                .patch(PATH)
                .send({ business_hours_start: "19:00:00" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("workspace.invalid_business_hours");
            expect(await activityFor(ws.id)).toHaveLength(0);
        });

        it("422 when both supplied with start == end (strict less-than)", async () => {
            const { client } = await setup();
            const res = await client.patch(PATH).send({
                business_hours_start: "10:00:00",
                business_hours_end: "10:00:00",
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("workspace.invalid_business_hours");
        });

        it("422 when both supplied inverted", async () => {
            const { client } = await setup();
            const res = await client.patch(PATH).send({
                business_hours_start: "18:00:00",
                business_hours_end: "09:00:00",
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("workspace.invalid_business_hours");
        });
    });

    // ─── Validation (422 validation.failed) ────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["name empty", { name: "" }],
            ["name whitespace", { name: "   " }],
            ["name too long (121)", { name: "x".repeat(121) }],
            ["timezone invalid", { timezone: "Mars/Phobos" }],
            ["timezone empty", { timezone: "" }],
            ["week_starts_on too high", { week_starts_on: 7 }],
            ["week_starts_on negative", { week_starts_on: -1 }],
            ["working_days junk member", { working_days: ["funday"] }],
            ["working_days not array", { working_days: "mon" }],
            ["logo_url not a url", { logo_url: "not-a-url" }],
            ["business_hours_start bad format", { business_hours_start: "9am" }],
            ["business_hours_end bad format", { business_hours_end: "25:00:00" }],
            ["default_locale present (read-only)", { default_locale: "bn-BD" }],
        ];
        for (const [label, body] of cases) {
            it(`422 validation.failed when ${label}`, async () => {
                const { client } = await setup();
                const res = await client.patch(PATH).send(body);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("carries a details[] array and writes nothing on a validation failure", async () => {
            const { ws, client } = await setup();
            const res = await client.patch(PATH).send({ name: "" });
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(await activityFor(ws.id)).toHaveLength(0);
            expect((await rowOf(ws.id)).name).toBe("BeautyBooth");
        });
    });

    // ─── Authorization (👑 admin/owner) ────────────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to update (200)`, async () => {
                const { client } = await setup(role);
                const res = await client.patch(PATH).send({ name: "By-" + role });
                expect(res.status).toBe(200);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 auth.forbidden and writes nothing`, async () => {
                const { ws, client } = await setup(role);
                const res = await client.patch(PATH).send({ name: "Nope" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await rowOf(ws.id)).name).toBe("BeautyBooth");
                expect(await activityFor(ws.id)).toHaveLength(0);
            });
        }

        it("rejects a member BEFORE validating the body (403, not 422)", async () => {
            const { client } = await setup("member");
            const res = await client.patch(PATH).send({ week_starts_on: 99 });
            expect(res.status).toBe(403);
        });
    });

    // ─── Authentication ─────────────────────────────────────────────────────--
    describe("Authentication", () => {
        it("401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.patch(PATH).send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .patch(PATH)
                .set("Authorization", "Bearer not.a.jwt")
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const u = await makeUser({ role: "admin" });
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .patch(PATH)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── Not found ──────────────────────────────────────────────────────────--
    describe("Not found", () => {
        it("404 workspace.not_found when the JWT workspaceId has no row", async () => {
            const token = signAccess(
                { id: "u-ghost", workspaceId: "ws-ghost", role: "admin" },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: "15m" },
            );
            const http = await oneOff();
            const res = await http
                .patch(PATH)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "Ghost" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("workspace.not_found");
        });
    });

    // ─── Boundary values ────────────────────────────────────────────────────--
    describe("Boundary values", () => {
        it("round-trips a unicode + emoji name", async () => {
            const { client } = await setup();
            const res = await client
                .patch(PATH)
                .send({ name: "বিউটিবুথ 🛍️" });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe("বিউটিবুথ 🛍️");
        });

        it("accepts a 120-char name", async () => {
            const { client } = await setup();
            const name = "x".repeat(120);
            const res = await client.patch(PATH).send({ name });
            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });

        it("accepts week_starts_on boundaries 0 and 6", async () => {
            const { client } = await setup();
            expect(
                (await client.patch(PATH).send({ week_starts_on: 0 })).status,
            ).toBe(200);
            expect(
                (await client.patch(PATH).send({ week_starts_on: 6 })).status,
            ).toBe(200);
        });

        /**
         * F28 (ISS-029, D12.2): `fiscal_year_start_month` was DROPPED — stored,
         * validated 1–12, and read by nothing, with no financial-reporting
         * surface anywhere in the product to read it.
         *
         * This endpoint picks known keys rather than rejecting unknown ones, so
         * the field is now simply ignored. Asserted as it actually behaves: it
         * does not reach the response, and it does not reach `changed_fields`
         * (which is what the activity feed shows a human).
         */
        it("ignores fiscal_year_start_month — the column no longer exists", async () => {
            const { ws, client } = await setup();
            const res = await client
                .patch(PATH)
                .send({ name: "Still fine", fiscal_year_start_month: 7 });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Still fine");
            expect(res.body).not.toHaveProperty("fiscal_year_start_month");

            const [act] = await activityFor(ws.id);
            expect(ctxOf(act).changed_fields).toEqual(["name"]);
        });

        it("allows updating only business_hours_end higher (valid against stored start)", async () => {
            const { client } = await setup();
            const res = await client
                .patch(PATH)
                .send({ business_hours_end: "20:00:00" });
            expect(res.status).toBe(200);
            expect(res.body.business_hours_end).toBe("20:00:00");
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────--
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();
            const res = await client.patch(PATH).send({ name: "Hdr" });
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
