import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeSpace,
    makeTaskType,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { lists, statuses, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `PATCH /api/v1/lists/:id` (§6 Lists #5).
 *
 * Runs on the private no-truncate `tms_lists_test` DB (see
 * `jest.lists.config.cjs`): every test mints a fresh workspace/space/list and
 * asserts side effects scoped to those ids, so no per-test reset is needed.
 *
 * The endpoint is 👑 (owner/admin), partial-updates name / description / icon /
 * color / default_task_type_id, blocks archived lists, and records one `updated`
 * activity row. It returns the bare wire `List` with 200.
 */

const url = (id: string): string => `/api/v1/lists/${id}`;

interface WireList {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    default_task_type_id: string | null;
    is_private: boolean;
    archived_at: string | null;
    created_by: string;
    created_at: string;
}

const WIRE_LIST_KEYS = [
    "archived_at",
    "color",
    "created_at",
    "created_by",
    "default_task_type_id",
    "description",
    "icon",
    "id",
    "is_private",
    "name",
    "position",
    "space_id",
].sort();

/** Insert a list row directly so its fields / archived state are controllable. */
const insertList = async (input: {
    spaceId: string;
    createdBy: string;
    name?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    isPrivate?: boolean;
    position?: number;
    defaultTaskTypeId?: string | null;
    archivedAt?: Date | null;
}): Promise<string> => {
    const db = getDb();
    const id = fakeId("l");
    await db.insert(lists).values({
        id,
        spaceId: input.spaceId,
        createdBy: input.createdBy,
        name: input.name ?? "Original",
        description: input.description ?? null,
        icon: input.icon ?? "ListChecks",
        color: input.color ?? "#4F46E5",
        isPrivate: input.isPrivate ?? false,
        position: input.position ?? 0,
        defaultTaskTypeId: input.defaultTaskTypeId ?? null,
        archivedAt: input.archivedAt ?? null,
    });
    return id;
};

const listRow = async (id: string) => {
    const db = getDb();
    const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
    return row;
};

const statusCount = async (listId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: statuses.id })
            .from(statuses)
            .where(and(eq(statuses.scopeType, "list"), eq(statuses.scopeId, listId)))
    ).length;
};

const activityRows = async (workspaceId: string) => {
    const db = getDb();
    return db
        .select()
        .from(workspaceActivity)
        .where(eq(workspaceActivity.workspaceId, workspaceId));
};

/** A user (default owner) + space + a list in it + a logged-in client. */
const setup = async (
    opts: {
        role?: Role;
        archived?: boolean;
        list?: Partial<Parameters<typeof insertList>[0]>;
    } = {},
) => {
    const u = await makeUser({ role: opts.role ?? "owner" });
    const space = await makeSpace({ workspaceId: u.workspaceId, createdBy: u.id });
    const listId = await insertList({
        spaceId: space.id,
        createdBy: u.id,
        archivedAt: opts.archived ? new Date() : null,
        ...opts.list,
    });
    const client = await makeLoggedInClient(u);
    return { u, space, listId, client };
};

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

// ════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/v1/lists/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("updates the name and returns 200 with the bare wire List", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({ name: "Renamed" });

            expect(res.status).toBe(200);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.id).toBe(listId);
            expect(res.body.name).toBe("Renamed");
        });

        it("shapes the response as exactly the 12 wire fields — no extras", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({ name: "Renamed" });

            expect(Object.keys(res.body as WireList).sort()).toEqual(WIRE_LIST_KEYS);
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("leaves untouched fields unchanged when updating one field", async () => {
            const { listId, client } = await setup({
                list: { name: "Original", icon: "Inbox", color: "#010203", isPrivate: true, position: 4 },
            });

            const res = await client.patch(url(listId)).send({ name: "Renamed" });

            expect(res.body.name).toBe("Renamed");
            expect(res.body.icon).toBe("Inbox");
            expect(res.body.color).toBe("#010203");
            expect(res.body.is_private).toBe(true);
            expect(res.body.position).toBe(4);
        });

        it("updates description, icon, and color together", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({
                description: "Now described",
                icon: "Bug",
                color: "#aabbcc",
            });

            expect(res.body.description).toBe("Now described");
            expect(res.body.icon).toBe("Bug");
            expect(res.body.color).toBe("#aabbcc");
        });

        it("clears the description with an explicit null", async () => {
            const { listId, client } = await setup({ list: { description: "had text" } });

            const res = await client.patch(url(listId)).send({ description: null });

            expect(res.status).toBe(200);
            expect(res.body.description).toBeNull();
        });

        it("sets a valid default_task_type_id", async () => {
            const { u, listId, client } = await setup();
            const tt = await makeTaskType({ workspaceId: u.workspaceId });

            const res = await client
                .patch(url(listId))
                .send({ default_task_type_id: tt.id });

            expect(res.status).toBe(200);
            expect(res.body.default_task_type_id).toBe(tt.id);
        });

        it("clears default_task_type_id with an explicit null", async () => {
            const { u, listId, client } = await setup();
            const tt = await makeTaskType({ workspaceId: u.workspaceId });
            await client.patch(url(listId)).send({ default_task_type_id: tt.id });

            const res = await client
                .patch(url(listId))
                .send({ default_task_type_id: null });

            expect(res.status).toBe(200);
            expect(res.body.default_task_type_id).toBeNull();
        });

        it("persists the change so a follow-up GET reflects it", async () => {
            const { listId, client } = await setup();

            await client.patch(url(listId)).send({ name: "Persisted" });
            const fetched = await client.get(url(listId));

            expect(fetched.body.name).toBe("Persisted");
        });
    });

    // ─── Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes exactly one workspace_activity row (list/updated) with the changed fields", async () => {
            const { u, listId, client } = await setup();

            await client.patch(url(listId)).send({ name: "X", color: "#123456" });
            const rows = await activityRows(u.workspaceId);

            expect(rows).toHaveLength(1);
            expect(rows[0].entityType).toBe("list");
            expect(rows[0].entityId).toBe(listId);
            expect(rows[0].action).toBe("updated");
            expect(rows[0].actorId).toBe(u.id);
            expect(rows[0].context).toMatchObject({ fields: ["name", "color"] });
        });

        it("does not add or remove the list's statuses", async () => {
            const { listId, client } = await setup();
            const before = await statusCount(listId);

            await client.patch(url(listId)).send({ name: "X" });

            expect(await statusCount(listId)).toBe(before);
        });
    });

    // ─── b. Validation ──────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an empty body (no updatable field)", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({});

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a body with only unknown fields", async () => {
            const { listId, client } = await setup();

            const res = await client
                .patch(url(listId))
                .send({ is_private: true, position: 9, space_id: "sp-x" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        const cases: Array<[string, Record<string, unknown>, string]> = [
            ["empty name", { name: "" }, "name"],
            ["whitespace-only name", { name: "   " }, "name"],
            ["name over 120", { name: "x".repeat(121) }, "name"],
            ["non-string name", { name: 7 }, "name"],
            ["description over 500", { description: "d".repeat(501) }, "description"],
            ["non-string/non-null description", { description: 7 }, "description"],
            ["empty icon", { icon: "" }, "icon"],
            ["icon over 64", { icon: "i".repeat(65) }, "icon"],
            ["bad color", { color: "blue" }, "color"],
            ["empty default_task_type_id", { default_task_type_id: "" }, "default_task_type_id"],
            [
                "default_task_type_id over 64",
                { default_task_type_id: "t".repeat(65) },
                "default_task_type_id",
            ],
        ];

        for (const [label, body, field] of cases) {
            it(`returns 422 validation.failed for ${label}`, async () => {
                const { listId, client } = await setup();

                const res = await client.patch(url(listId)).send(body);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === field,
                    ),
                ).toBe(true);
            });
        }

        it("returns 422 for an id path param over 64 chars", async () => {
            const { client } = await setup();

            const res = await client.patch(url("l".repeat(65))).send({ name: "x" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a 120-char name (boundary)", async () => {
            const { listId, client } = await setup();
            const name = "x".repeat(120);

            const res = await client.patch(url(listId)).send({ name });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
        });

        it("accepts a description:null-only patch as a valid update", async () => {
            const { listId, client } = await setup({ list: { description: "x" } });

            const res = await client.patch(url(listId)).send({ description: null });

            expect(res.status).toBe(200);
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http.patch(url(listId)).send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const { listId } = await setup();
            const http = await oneOff();

            const res = await http
                .patch(url(listId))
                .set("Authorization", "Bearer not.a.real.jwt")
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { u, listId } = await setup();
            const token = signAccess(
                { id: u.id, workspaceId: u.workspaceId, role: u.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .patch(url(listId))
                .set("Authorization", `Bearer ${token}`)
                .send({ name: "x" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (👑 owner/admin) ──────────────────────────────────
    describe("Authorization", () => {
        for (const role of ["owner", "admin"] as Role[]) {
            it(`allows a ${role} to update (200)`, async () => {
                const { listId, client } = await setup({ role });

                const res = await client.patch(url(listId)).send({ name: "x" });

                expect(res.status).toBe(200);
            });
        }

        for (const role of ["member", "guest"] as Role[]) {
            it(`forbids a ${role} (403 auth.forbidden) and writes nothing`, async () => {
                const { u, listId, client } = await setup({ role });

                const res = await client.patch(url(listId)).send({ name: "Hacked" });

                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
                expect((await listRow(listId)).name).toBe("Original");
                expect(await activityRows(u.workspaceId)).toHaveLength(0);
            });
        }

        it("checks the role BEFORE body validation (403, not 422, for a member with an empty body)", async () => {
            const { listId, client } = await setup({ role: "member" });

            const res = await client.patch(url(listId)).send({});

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
        });

        it("checks the role BEFORE resource existence (403, not 404, for a member on a missing id)", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.patch(url("l-nope")).send({ name: "x" });

            expect(res.status).toBe(403);
        });
    });

    // ─── e. Resource lifecycle ──────────────────────────────────────────────
    describe("Not found & archived", () => {
        it("returns 404 list.not_found for a non-existent id", async () => {
            const { client } = await setup();

            const res = await client.patch(url("l-nope")).send({ name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 409 list.archived for an archived list and changes nothing", async () => {
            const { u, listId, client } = await setup({ archived: true });

            const res = await client.patch(url(listId)).send({ name: "x" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.archived");
            expect((await listRow(listId)).name).toBe("Original");
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── f. References & conflict ───────────────────────────────────────────
    describe("References & conflict", () => {
        it("allows renaming to a sibling list's name (no unique constraint)", async () => {
            const { u, space, listId, client } = await setup();
            await insertList({ spaceId: space.id, createdBy: u.id, name: "Sibling" });

            const res = await client.patch(url(listId)).send({ name: "Sibling" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Sibling");
        });

        it("returns 422 list.invalid_task_type for an unknown default_task_type_id", async () => {
            const { listId, client } = await setup();

            const res = await client
                .patch(url(listId))
                .send({ default_task_type_id: "tt-nope" });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("list.invalid_task_type");
        });

        it("rolls back fully when default_task_type_id is invalid (name + activity untouched)", async () => {
            const { u, listId, client } = await setup();

            await client
                .patch(url(listId))
                .send({ name: "ShouldNotStick", default_task_type_id: "tt-nope" });

            expect((await listRow(listId)).name).toBe("Original");
            expect(await activityRows(u.workspaceId)).toHaveLength(0);
        });
    });

    // ─── g. Tenant / workspace isolation ────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 for a list in another workspace [IDOR] and changes nothing", async () => {
            const userA = await makeUser({ role: "owner" });
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });
            const listB = await insertList({
                spaceId: spaceB.id,
                createdBy: spaceB.createdBy,
                name: "B-list",
            });
            const client = await makeLoggedInClient(userA);

            const res = await client.patch(url(listB)).send({ name: "Hacked" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
            expect((await listRow(listB)).name).toBe("B-list");
        });

        it("rejects a default_task_type_id from another workspace (422)", async () => {
            const { listId, client } = await setup();
            const wsB = await makeWorkspace();
            const ttB = await makeTaskType({ workspaceId: wsB.id });

            const res = await client
                .patch(url(listId))
                .send({ default_task_type_id: ttB.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("list.invalid_task_type");
        });

        it("ignores body space_id / created_by / is_private / position (mass-assignment)", async () => {
            const { u, space, listId, client } = await setup();
            const wsB = await makeWorkspace();
            const spaceB = await makeSpace({ workspaceId: wsB.id });

            const res = await client.patch(url(listId)).send({
                name: "Legit",
                space_id: spaceB.id,
                created_by: "u-attacker",
                is_private: true,
                position: 999,
            });

            expect(res.status).toBe(200);
            expect(res.body.space_id).toBe(space.id);
            expect(res.body.created_by).toBe(u.id);
            expect(res.body.is_private).toBe(false);
            expect(res.body.position).toBe(0);
        });
    });

    // ─── h. Idempotency ─────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("patching to the same value twice both return 200 with the same result", async () => {
            const { listId, client } = await setup();

            const a = await client.patch(url(listId)).send({ name: "Same" });
            const b = await client.patch(url(listId)).send({ name: "Same" });

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect(b.body.name).toBe("Same");
        });
    });

    // ─── i. Concurrency ─────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel patches on different fields both apply", async () => {
            const { listId, client } = await setup();

            const [a, b] = await Promise.all([
                client.patch(url(listId)).send({ name: "ConcurrentName" }),
                client.patch(url(listId)).send({ color: "#0f0f0f" }),
            ]);

            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            const row = await listRow(listId);
            expect(row.name).toBe("ConcurrentName");
            expect(row.color).toBe("#0f0f0f");
        });
    });

    // ─── k. Boundary values ─────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts unicode names (Bangla, emoji, RTL)", async () => {
            const { listId, client } = await setup();

            for (const name of ["ক্রয়", "🔥", "قائمة"]) {
                const res = await client.patch(url(listId)).send({ name });
                expect(res.status).toBe(200);
                expect(res.body.name).toBe(name);
            }
        });

        it("trims surrounding whitespace in the name", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({ name: "  Trim  " });

            expect(res.body.name).toBe("Trim");
        });

        it("accepts a 500-char description (boundary)", async () => {
            const { listId, client } = await setup();
            const description = "d".repeat(500);

            const res = await client.patch(url(listId)).send({ description });

            expect(res.status).toBe(200);
            expect(res.body.description).toBe(description);
        });
    });

    // ─── Cross-cutting & exploratory ────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { listId, client } = await setup();

            const res = await client.patch(url(listId)).send({ name: "x" });

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("returns 400 for a malformed JSON body", async () => {
            const { listId, client } = await setup();

            const res = await client
                .patch(url(listId))
                .set("Content-Type", "application/json")
                .send('{"name": ');

            expect(res.status).toBe(400);
        });

        it("treats an injection-shaped id as a literal id → 404", async () => {
            const { client } = await setup();

            const res = await client
                .patch(url(encodeURIComponent("l-1' OR '1'='1")))
                .send({ name: "x" });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("stores an injection-shaped name verbatim", async () => {
            const { listId, client } = await setup();
            const name = "x'); DROP TABLE lists;--";

            const res = await client.patch(url(listId)).send({ name });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe(name);
            expect((await listRow(listId)).name).toBe(name);
        });
    });
});
