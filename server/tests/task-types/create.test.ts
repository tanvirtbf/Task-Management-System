import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskTypes, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/task-types` (§8).
 *
 * Patterns mirror `tests/task-types/list.test.ts` and
 * `tests/tasks/assignees.add.test.ts`:
 *   - Real DB writes via factories (no mocks); `oneOff()` for unauthenticated /
 *     crafted-token cases, `makeLoggedInClient` for authed calls.
 *   - `beforeEach` (setup-each.ts) truncates every table — tests are order-free.
 *
 * The endpoint is 👑 owner/admin. It creates one workspace-scoped task type
 * (appended at `position = max + 1`, `is_system` always false), writes a
 * `workspace_activity` row in the same transaction, and returns 201 with the
 * created `TaskType`. `(workspace_id, name)` is UNIQUE (case-insensitive) → a
 * duplicate name is 409 `task_type.duplicate`.
 */

const TASK_TYPES = "/api/v1/task-types";

interface WireTaskType {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    is_milestone_type: boolean;
    is_system: boolean;
    is_dev_type: boolean;
    position: number;
}

// ─── DB inspection helpers ────────────────────────────────────────────────────
const rowsIn = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(taskTypes)
        .where(eq(taskTypes.workspaceId, workspaceId));
};

const activityIn = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

/** Seed a task type at an explicit position (factory always uses position 0). */
const seedAt = async (
    workspaceId: string,
    name: string,
    position: number,
): Promise<void> => {
    const db = getDb();
    await db
        .insert(taskTypes)
        .values({ id: fakeId("tt"), workspaceId, name, position });
};

/** Mint a raw access token for the negative-auth cases. */
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

/** Workspace + an owner/admin actor (logged in), ready to create. */
const setup = async (role: Role = "admin") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, client };
};

// This suite shares a MySQL server with other suites; the per-test TRUNCATEs in
// setup-each.ts can queue behind concurrent DDL. Raise the hook timeout so a
// busy-but-not-deadlocked server doesn't spuriously fail setup.
jest.setTimeout(30000);

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/task-types", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a type from just a name, applying schema defaults (201)", async () => {
            const { ws, client } = await setup("admin");

            const res = await client.post(TASK_TYPES).send({ name: "Promo" });

            expect(res.status).toBe(201);
            const body = res.body as WireTaskType;
            expect(body).toEqual({
                id: expect.stringMatching(/^tt-/),
                name: "Promo",
                description: null,
                icon: "CheckSquare",
                color: "#6B7280",
                is_milestone_type: false,
                is_system: false,
                is_dev_type: false,
                position: 0,
            });
            const rows = await rowsIn(ws.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(body.id);
            expect(rows[0].workspaceId).toBe(ws.id);
        });

        it("echoes a full body verbatim, but never lets is_system be set true", async () => {
            const { client } = await setup("owner");

            const res = await client.post(TASK_TYPES).send({
                name: "Hotfix",
                icon: "Flame",
                color: "#E11D48",
                is_milestone_type: true,
                is_dev_type: true,
                description: "Urgent production fix",
            });

            expect(res.status).toBe(201);
            const body = res.body as WireTaskType;
            expect(body.name).toBe("Hotfix");
            expect(body.icon).toBe("Flame");
            expect(body.color).toBe("#E11D48");
            expect(body.is_milestone_type).toBe(true);
            expect(body.is_dev_type).toBe(true);
            expect(body.description).toBe("Urgent production fix");
            expect(body.is_system).toBe(false);
        });

        it("appends the new type at position = max + 1", async () => {
            const { ws, client } = await setup();
            await seedAt(ws.id, "First", 0);
            await seedAt(ws.id, "Second", 5);

            const res = await client.post(TASK_TYPES).send({ name: "Third" });

            expect(res.status).toBe(201);
            expect((res.body as WireTaskType).position).toBe(6);
        });

        it("never leaks workspace_id, timestamps, or internal_id", async () => {
            const { client } = await setup();

            const res = await client.post(TASK_TYPES).send({ name: "Clean" });

            expect(Object.keys(res.body).sort()).toEqual([
                "color",
                "description",
                "icon",
                "id",
                "is_dev_type",
                "is_milestone_type",
                "is_system",
                "name",
                "position",
            ]);
        });

        it("accepts a lowercase hex colour", async () => {
            const { client } = await setup();

            const res = await client
                .post(TASK_TYPES)
                .send({ name: "Lower", color: "#abcdef" });

            expect(res.status).toBe(201);
            expect((res.body as WireTaskType).color).toBe("#abcdef");
        });
    });

    // ─── b. Validation (422 validation.failed) ────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["name missing", {}],
            ["name empty", { name: "" }],
            ["name whitespace-only", { name: "   " }],
            ["name too long (81)", { name: "x".repeat(81) }],
            ["name not a string", { name: 123 }],
            ["color not hex", { name: "C", color: "red" }],
            ["color is 3-digit shorthand", { name: "C", color: "#fff" }],
            ["color too short", { name: "C", color: "#12345" }],
            ["icon too long (65)", { name: "C", icon: "x".repeat(65) }],
            ["description too long (301)", { name: "C", description: "x".repeat(301) }],
            ["is_dev_type not boolean", { name: "C", is_dev_type: "yes" }],
            ["is_milestone_type not boolean", { name: "C", is_milestone_type: 1 }],
        ];
        for (const [label, payload] of cases) {
            it(`422 when ${label}`, async () => {
                const { client } = await setup();
                const res = await client.post(TASK_TYPES).send(payload);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("422 carries a details[] array naming the offending field", async () => {
            const { client } = await setup();
            const res = await client.post(TASK_TYPES).send({ name: "" });
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
            expect(res.body.error.details[0].field).toBe("name");
        });

        it("writes nothing on a validation failure", async () => {
            const { ws, client } = await setup();
            await client.post(TASK_TYPES).send({ name: "" });
            expect(await rowsIn(ws.id)).toHaveLength(0);
            expect(await activityIn(ws.id)).toHaveLength(0);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.post(TASK_TYPES).send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .post(TASK_TYPES)
                .set("Authorization", "Bearer not.a.real.jwt")
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
                .post(TASK_TYPES)
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin only) ───────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to create (201)`, async () => {
                const { client } = await setup(role);
                const res = await client
                    .post(TASK_TYPES)
                    .send({ name: `By-${role}` });
                expect(res.status).toBe(201);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 auth.forbidden and writes nothing`, async () => {
                const { ws, client } = await setup(role);
                const res = await client
                    .post(TASK_TYPES)
                    .send({ name: "Nope" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect(await rowsIn(ws.id)).toHaveLength(0);
            });
        }

        it("rejects a member BEFORE validating the body (403, not 422)", async () => {
            const { client } = await setup("member");
            // Body is invalid too; authz must win.
            const res = await client.post(TASK_TYPES).send({ name: "" });
            expect(res.status).toBe(403);
        });
    });

    // ─── e. Conflict (duplicate name) ─────────────────────────────────────────
    describe("Conflict", () => {
        it("409 task_type.duplicate when the name already exists", async () => {
            const { ws, client } = await setup();
            await makeTaskType({ workspaceId: ws.id, name: "Bug" });

            const res = await client.post(TASK_TYPES).send({ name: "Bug" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.duplicate");
            // No second row, and the rejected create logged no activity.
            expect(await rowsIn(ws.id)).toHaveLength(1);
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("409 on a case-insensitive duplicate (collation utf8mb4_unicode_ci)", async () => {
            const { ws, client } = await setup();
            await makeTaskType({ workspaceId: ws.id, name: "Bug" });

            const res = await client.post(TASK_TYPES).send({ name: "bug" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.duplicate");
        });

        it("409 on a trim-equal duplicate (surrounding whitespace ignored)", async () => {
            const { ws, client } = await setup();
            await makeTaskType({ workspaceId: ws.id, name: "Order" });

            const res = await client.post(TASK_TYPES).send({ name: "  Order  " });

            expect(res.status).toBe(409);
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("a name taken in another workspace does not collide", async () => {
            const wsA = await makeWorkspace();
            await makeTaskType({ workspaceId: wsA.id, name: "Order" });
            const { ws: wsB, client } = await setup(); // admin in a fresh ws

            const res = await client.post(TASK_TYPES).send({ name: "Order" });

            expect(res.status).toBe(201);
            expect(await rowsIn(wsA.id)).toHaveLength(1); // A untouched
            const bRows = await rowsIn(wsB.id);
            expect(bRows).toHaveLength(1);
            expect(bRows[0].workspaceId).toBe(wsB.id);
        });

        it("creates in the caller's workspace, ignoring a body workspace_id", async () => {
            const other = await makeWorkspace();
            const { ws, client } = await setup();

            const res = await client
                .post(TASK_TYPES)
                .send({ name: "Scoped", workspace_id: other.id });

            expect(res.status).toBe(201);
            expect(await rowsIn(ws.id)).toHaveLength(1);
            expect(await rowsIn(other.id)).toHaveLength(0);
        });
    });

    // ─── h. Mass-assignment / security ────────────────────────────────────────
    describe("Mass assignment", () => {
        it("ignores client-supplied id, is_system, and position", async () => {
            const { ws, client } = await setup();
            await seedAt(ws.id, "Existing", 3);

            const res = await client.post(TASK_TYPES).send({
                name: "Crafted",
                id: "tt-hacker",
                is_system: true,
                position: 99,
            });

            expect(res.status).toBe(201);
            const body = res.body as WireTaskType;
            expect(body.id).toMatch(/^tt-/);
            expect(body.id).not.toBe("tt-hacker");
            expect(body.is_system).toBe(false);
            expect(body.position).toBe(4); // max(3) + 1, not 99
        });
    });

    // ─── h. Idempotency (no Idempotency-Key infra; unique index protects) ─────
    describe("Idempotency", () => {
        it("a repeated identical create is rejected (one row only)", async () => {
            const { ws, client } = await setup();

            const first = await client.post(TASK_TYPES).send({ name: "Once" });
            const second = await client.post(TASK_TYPES).send({ name: "Once" });

            expect(first.status).toBe(201);
            expect(second.status).toBe(409);
            expect(await rowsIn(ws.id)).toHaveLength(1);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a max-length (80-char) name", async () => {
            const { client } = await setup();
            const name = "x".repeat(80);
            const res = await client.post(TASK_TYPES).send({ name });
            expect(res.status).toBe(201);
            expect((res.body as WireTaskType).name).toBe(name);
        });

        it("round-trips a unicode name (Bangla + emoji)", async () => {
            const { client } = await setup();
            const res = await client
                .post(TASK_TYPES)
                .send({ name: "ঈদ অর্ডার 🎉" });
            expect(res.status).toBe(201);
            expect((res.body as WireTaskType).name).toBe("ঈদ অর্ডার 🎉");
        });

        it("normalises a blank description to null", async () => {
            const { client } = await setup();
            const res = await client
                .post(TASK_TYPES)
                .send({ name: "Blank", description: "   " });
            expect(res.status).toBe(201);
            expect((res.body as WireTaskType).description).toBeNull();
        });

        it("trims surrounding whitespace from the stored name", async () => {
            const { ws, client } = await setup();
            const res = await client
                .post(TASK_TYPES)
                .send({ name: "  Spacey  " });
            expect(res.status).toBe(201);
            const [row] = await rowsIn(ws.id);
            expect(row.name).toBe("Spacey");
        });
    });

    // ─── l. Side effects (activity log) ───────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row describing the create", async () => {
            const { ws, actor, client } = await setup();

            const res = await client.post(TASK_TYPES).send({ name: "Logged" });

            const acts = await activityIn(ws.id);
            expect(acts).toHaveLength(1);
            const [act] = acts;
            expect(act.entityType).toBe("task_type");
            expect(act.entityId).toBe((res.body as WireTaskType).id);
            expect(act.action).toBe("created");
            expect(act.actorId).toBe(actor.id);
            expect(act.context).toEqual({ name: "Logged" });
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client } = await setup();
            const res = await client.post(TASK_TYPES).send({ name: "Hdr" });
            expect(res.status).toBe(201);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope with matching request_id on 401", async () => {
            const http = await oneOff();
            const res = await http.post(TASK_TYPES).send({ name: "X" });
            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("404 route.not_found for a bogus deep path under /task-types", async () => {
            const http = await oneOff();
            const res = await http.post(`${TASK_TYPES}/deep/bogus`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});
