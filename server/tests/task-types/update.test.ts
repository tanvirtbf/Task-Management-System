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
 * Tests for `PATCH /api/v1/task-types/:id` (§8).
 *
 * Patterns mirror `tests/task-types/create.test.ts`:
 *   - Real DB writes via factories (no mocks); `oneOff()` for unauthenticated /
 *     crafted-token cases, `makeLoggedInClient` for authed calls.
 *   - `beforeEach` (setup-each.ts) truncates every table — tests are order-free.
 *
 * The endpoint is 👑 owner/admin. It applies a partial update (only the keys
 * the client sent), writes a `workspace_activity` row in the same transaction,
 * and returns 200 with the updated `TaskType`. System (`is_system`) types allow
 * only icon/color/description changes (else 403 `task_type.system`); a rename
 * collision is 409 `task_type.duplicate`.
 */

const TASK_TYPES = "/api/v1/task-types";
const url = (id: string) => `${TASK_TYPES}/${id}`;

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

interface SeedTaskType {
    name: string;
    isSystem?: boolean;
    isMilestoneType?: boolean;
    isDevType?: boolean;
    icon?: string;
    color?: string;
    description?: string | null;
    position?: number;
}

// ─── DB inspection / seeding helpers ──────────────────────────────────────────
const rowsIn = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(taskTypes)
        .where(eq(taskTypes.workspaceId, workspaceId));
};

const rowById = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select()
        .from(taskTypes)
        .where(eq(taskTypes.id, id))
        .limit(1);
    return row;
};

const activityIn = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

const setUpdatedAt = async (id: string, when: Date) => {
    const db = getDb();
    await db.update(taskTypes).set({ updatedAt: when }).where(eq(taskTypes.id, id));
};

/** Seed one task type with full control over flags / position / id. */
const seedType = async (
    workspaceId: string,
    opts: SeedTaskType,
): Promise<{ id: string }> => {
    const db = getDb();
    const id = fakeId("tt");
    await db.insert(taskTypes).values({
        id,
        workspaceId,
        name: opts.name,
        isSystem: opts.isSystem ?? false,
        isMilestoneType: opts.isMilestoneType ?? false,
        isDevType: opts.isDevType ?? false,
        position: opts.position ?? 0,
        ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
        ...(opts.color !== undefined ? { color: opts.color } : {}),
        ...(opts.description !== undefined
            ? { description: opts.description }
            : {}),
    });
    return { id };
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

/** Workspace + an owner/admin actor (logged in), ready to patch. */
const setup = async (role: Role = "admin") => {
    const ws = await makeWorkspace();
    const actor = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, client };
};

const OLD = new Date("2020-01-01T00:00:00Z");

// This suite shares a MySQL server with other suites; the per-test TRUNCATEs in
// setup-each.ts can queue behind concurrent DDL. Raise the hook timeout so a
// busy-but-not-deadlocked server doesn't spuriously fail setup.
jest.setTimeout(30000);

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/task-types/:id", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("renames a type (200) and persists the change", async () => {
            const { ws, client } = await setup("admin");
            const { id } = await seedType(ws.id, { name: "Order" });

            const res = await client.patch(url(id)).send({ name: "Sales Order" });

            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).name).toBe("Sales Order");
            expect((await rowById(id)).name).toBe("Sales Order");
        });

        it("updates icon, color, and description together", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Bug" });

            const res = await client.patch(url(id)).send({
                icon: "Flame",
                color: "#E11D48",
                description: "Defect report",
            });

            expect(res.status).toBe(200);
            const body = res.body as WireTaskType;
            expect(body.icon).toBe("Flame");
            expect(body.color).toBe("#E11D48");
            expect(body.description).toBe("Defect report");
        });

        it("allows an owner to update a single field", async () => {
            const { ws, client } = await setup("owner");
            const { id } = await seedType(ws.id, { name: "C", color: "#000000" });

            const res = await client.patch(url(id)).send({ color: "#abcdef" });

            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).color).toBe("#abcdef");
        });

        it("flips is_milestone_type and is_dev_type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Feature" });

            const res = await client
                .patch(url(id))
                .send({ is_milestone_type: true, is_dev_type: true });

            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).is_milestone_type).toBe(true);
            expect((res.body as WireTaskType).is_dev_type).toBe(true);
        });

        it("leaves untouched fields unchanged", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "Keep",
                icon: "Star",
                color: "#123456",
                description: "orig",
                position: 4,
            });

            const res = await client.patch(url(id)).send({ color: "#654321" });

            expect(res.status).toBe(200);
            const body = res.body as WireTaskType;
            expect(body.color).toBe("#654321");
            expect(body.name).toBe("Keep");
            expect(body.icon).toBe("Star");
            expect(body.description).toBe("orig");
            expect(body.position).toBe(4);
        });

        it("renames a type to a case-variant of its own name (no self-conflict)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Bug" });

            const res = await client.patch(url(id)).send({ name: "bug" });

            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).name).toBe("bug");
        });
    });

    // ─── b. Validation (422 validation.failed) ────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["name empty", { name: "" }],
            ["name whitespace-only", { name: "   " }],
            ["name too long (81)", { name: "x".repeat(81) }],
            ["name not a string", { name: 123 }],
            ["color not hex", { color: "red" }],
            ["color is 3-digit shorthand", { color: "#fff" }],
            ["icon too long (65)", { icon: "x".repeat(65) }],
            ["description too long (301)", { description: "x".repeat(301) }],
            ["is_dev_type not boolean", { is_dev_type: "yes" }],
            ["is_milestone_type not boolean", { is_milestone_type: 1 }],
        ];
        for (const [label, payload] of cases) {
            it(`422 when ${label}`, async () => {
                const { ws, client } = await setup();
                const { id } = await seedType(ws.id, { name: "Target" });
                const res = await client.patch(url(id)).send(payload);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }

        it("422 when the body is empty (no updatable field)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Target" });
            const res = await client.patch(url(id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when only unknown fields are sent (still no updatable field)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Target" });
            const res = await client
                .patch(url(id))
                .send({ is_system: true, position: 9, foo: "bar" });
            expect(res.status).toBe(422);
        });

        it("422 when the :id param exceeds 64 characters", async () => {
            const { client } = await setup();
            const res = await client
                .patch(url("tt-" + "x".repeat(64)))
                .send({ name: "X" });
            expect(res.status).toBe(422);
        });

        it("422 carries a details[] array", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Target" });
            const res = await client.patch(url(id)).send({ name: "" });
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
        });

        it("writes nothing on a validation failure", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Untouched" });
            await client.patch(url(id)).send({ color: "nope" });
            expect((await rowById(id)).name).toBe("Untouched");
            expect(await activityIn(ws.id)).toHaveLength(0);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.patch(url("tt-x")).send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .patch(url("tt-x"))
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
                .patch(url("tt-x"))
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "X" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin only) ───────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to update (200)`, async () => {
                const { ws, client } = await setup(role);
                const { id } = await seedType(ws.id, { name: "T" });
                const res = await client.patch(url(id)).send({ name: "T2" });
                expect(res.status).toBe(200);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} with 403 auth.forbidden and writes nothing`, async () => {
                const { ws, client } = await setup(role);
                const { id } = await seedType(ws.id, { name: "Locked" });
                const res = await client.patch(url(id)).send({ name: "Hacked" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await rowById(id)).name).toBe("Locked");
            });
        }

        it("rejects a member BEFORE validating the body (403, not 422)", async () => {
            const { ws, client } = await setup("member");
            const { id } = await seedType(ws.id, { name: "T" });
            const res = await client.patch(url(id)).send({ name: "" });
            expect(res.status).toBe(403);
        });

        it("returns 403 (not 404) for a member targeting a nonexistent id", async () => {
            const { client } = await setup("member");
            const res = await client
                .patch(url("tt-nonexistent"))
                .send({ name: "X" });
            expect(res.status).toBe(403);
        });
    });

    // ─── e. Not-found / system / conflict ─────────────────────────────────────
    describe("Not-found / system / conflict", () => {
        it("404 task_type.not_found for a nonexistent id", async () => {
            const { client } = await setup();
            const res = await client
                .patch(url("tt-nope"))
                .send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task_type.not_found");
        });

        it("403 task_type.system when changing a system type's name", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Task", isSystem: true });

            const res = await client.patch(url(id)).send({ name: "Renamed" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
            expect((await rowById(id)).name).toBe("Task");
        });

        it("403 task_type.system when changing a system type's is_milestone_type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Task", isSystem: true });
            const res = await client
                .patch(url(id))
                .send({ is_milestone_type: true });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
        });

        it("403 task_type.system when changing a system type's is_dev_type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Task", isSystem: true });
            const res = await client.patch(url(id)).send({ is_dev_type: true });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
        });

        it("200 when changing only icon/color/description on a system type", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "Task",
                isSystem: true,
                color: "#000000",
            });

            const res = await client
                .patch(url(id))
                .send({ icon: "Sparkle", color: "#10B981", description: "core" });

            expect(res.status).toBe(200);
            const body = res.body as WireTaskType;
            expect(body.icon).toBe("Sparkle");
            expect(body.color).toBe("#10B981");
            expect(body.description).toBe("core");
            expect(body.is_system).toBe(true);
        });

        it("403 and applies nothing for a system type's mixed locked+cosmetic patch", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "Task",
                isSystem: true,
                color: "#111111",
            });

            const res = await client
                .patch(url(id))
                .send({ color: "#222222", name: "X" });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("task_type.system");
            const row = await rowById(id);
            expect(row.color).toBe("#111111"); // cosmetic change NOT applied
            expect(row.name).toBe("Task");
        });

        it("409 task_type.duplicate when renaming onto an existing sibling", async () => {
            const { ws, client } = await setup();
            await seedType(ws.id, { name: "Bug" });
            const { id: orderId } = await seedType(ws.id, { name: "Order" });

            const res = await client.patch(url(orderId)).send({ name: "Bug" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.duplicate");
            expect((await rowById(orderId)).name).toBe("Order");
        });

        it("409 (case-insensitive) when renaming onto a sibling differing only in case", async () => {
            const { ws, client } = await setup();
            await seedType(ws.id, { name: "Bug" });
            const { id: orderId } = await seedType(ws.id, { name: "Order" });

            const res = await client.patch(url(orderId)).send({ name: "bug" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task_type.duplicate");
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 task_type.not_found when the type is in another workspace", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const adminA = await makeUser({ workspaceId: wsA.id, role: "admin" });
            const { id: bId } = await seedType(wsB.id, { name: "B-type" });
            const client = await makeLoggedInClient(adminA);

            const res = await client.patch(url(bId)).send({ name: "Hijack" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task_type.not_found");
            expect((await rowById(bId)).name).toBe("B-type");
        });

        it("a name taken in another workspace does not block the rename", async () => {
            const other = await makeWorkspace();
            await seedType(other.id, { name: "Shared" });
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Mine" });

            const res = await client.patch(url(id)).send({ name: "Shared" });

            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).name).toBe("Shared");
        });
    });

    // ─── h. Mass assignment / security ────────────────────────────────────────
    describe("Mass assignment", () => {
        it("ignores client-supplied is_system, position, id, and workspace_id", async () => {
            const other = await makeWorkspace();
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Orig", position: 3 });

            const res = await client.patch(url(id)).send({
                name: "Renamed",
                is_system: true,
                position: 99,
                id: "tt-hacker",
                workspace_id: other.id,
            });

            expect(res.status).toBe(200);
            const row = await rowById(id);
            expect(row.name).toBe("Renamed");
            expect(row.isSystem).toBe(false);
            expect(row.position).toBe(3);
            expect(row.workspaceId).toBe(ws.id);
            // The original row id is unchanged; no "tt-hacker" row was created.
            expect(await rowById("tt-hacker")).toBeUndefined();
        });
    });

    // ─── h. Idempotency / concurrency ─────────────────────────────────────────
    describe("Idempotency / concurrency", () => {
        it("a repeated identical rename is a 200 no-op (one row, same name)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Stable" });

            const first = await client.patch(url(id)).send({ name: "Renamed" });
            const second = await client.patch(url(id)).send({ name: "Renamed" });

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(await rowsIn(ws.id)).toHaveLength(1);
            expect((await rowById(id)).name).toBe("Renamed");
        });

        it("10 parallel identical colour updates all succeed; the row stays consistent", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Race", color: "#000000" });

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    client.patch(url(id)).send({ color: "#abcdef" }),
                ),
            );

            for (const r of results) expect(r.status).toBe(200);
            expect(await rowsIn(ws.id)).toHaveLength(1);
            expect((await rowById(id)).color).toBe("#abcdef");
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a max-length (80-char) name", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Short" });
            const name = "x".repeat(80);
            const res = await client.patch(url(id)).send({ name });
            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).name).toBe(name);
        });

        it("round-trips a unicode name (Bangla + emoji)", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Plain" });
            const res = await client
                .patch(url(id))
                .send({ name: "ঈদ অর্ডার 🎉" });
            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).name).toBe("ঈদ অর্ডার 🎉");
        });

        it("clears description when sent as null", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "HadDesc",
                description: "remove me",
            });
            const res = await client.patch(url(id)).send({ description: null });
            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).description).toBeNull();
        });

        it("clears description when sent as a blank string", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "HadDesc2",
                description: "remove me",
            });
            const res = await client.patch(url(id)).send({ description: "   " });
            expect(res.status).toBe(200);
            expect((res.body as WireTaskType).description).toBeNull();
        });

        it("clearing description is a valid single-field update", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, {
                name: "OnlyDesc",
                description: "x",
            });
            const res = await client.patch(url(id)).send({ description: null });
            expect(res.status).toBe(200);
            expect((await rowById(id)).description).toBeNull();
        });

        it("trims surrounding whitespace from the stored name", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Spacey" });
            const res = await client.patch(url(id)).send({ name: "  Trimmed  " });
            expect(res.status).toBe(200);
            expect((await rowById(id)).name).toBe("Trimmed");
        });
    });

    // ─── l. Side effects (activity log + updated_at) ──────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row describing the update", async () => {
            const { ws, actor, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Logged" });

            await client.patch(url(id)).send({ name: "Logged2", color: "#abcdef" });

            const acts = await activityIn(ws.id);
            expect(acts).toHaveLength(1);
            const [act] = acts;
            expect(act.entityType).toBe("task_type");
            expect(act.entityId).toBe(id);
            expect(act.action).toBe("updated");
            expect(act.actorId).toBe(actor.id);
            expect(act.context).toEqual({ fields: ["name", "color"] });
        });

        it("writes no activity row on a 403 system-lock rejection", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Task", isSystem: true });
            await client.patch(url(id)).send({ name: "X" });
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("writes no activity row on a 409 duplicate rejection", async () => {
            const { ws, client } = await setup();
            await seedType(ws.id, { name: "Bug" });
            const { id } = await seedType(ws.id, { name: "Order" });
            await client.patch(url(id)).send({ name: "Bug" });
            expect(await activityIn(ws.id)).toHaveLength(0);
        });

        it("bumps updated_at on a real change", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Stamp" });
            await setUpdatedAt(id, OLD);

            await client.patch(url(id)).send({ name: "Stamped" });

            expect((await rowById(id)).updatedAt.getTime()).toBeGreaterThan(
                OLD.getTime(),
            );
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { ws, client } = await setup();
            const { id } = await seedType(ws.id, { name: "Hdr" });
            const res = await client.patch(url(id)).send({ name: "Hdr2" });
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope with matching request_id on 401", async () => {
            const http = await oneOff();
            const res = await http.patch(url("tt-x")).send({ name: "X" });
            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("404 route.not_found for PATCH on the collection root (no id)", async () => {
            const http = await oneOff();
            const res = await http.patch(TASK_TYPES).send({ name: "X" });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("404 route.not_found for a bogus deep path under an id", async () => {
            const http = await oneOff();
            const res = await http.patch(`${url("tt-x")}/extra/bogus`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});
