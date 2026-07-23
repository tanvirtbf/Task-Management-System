import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { spaces, workspaceActivity } from "../../src/db/schema";
import {
    makeLoggedInClient,
    makeSpace,
    makeUser,
} from "../test-utils/factories";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P5: head assignment via `PATCH /api/v1/spaces/:id`
 * (`head_user_id`), the wire shape (`head_user_id` + hydrated `head` on every
 * space response incl. the LIST — the P13 sidebar derivation depends on it),
 * and the deactivation hook (headships nulled; reactivation does not restore).
 */

const spacePath = (id: string) => `/api/v1/spaces/${id}`;

const SPACE_KEYS = [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "is_private",
    "head_user_id",
    "head",
    "position",
    "archived_at",
    "created_by",
    "created_at",
].sort();

const fetchHeadColumn = async (spaceId: string) => {
    const db = getDb();
    const [row] = await db
        .select({ headUserId: spaces.headUserId })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .limit(1);
    return row?.headUserId ?? null;
};

const fetchActivityFor = async (entityId: string) => {
    const db = getDb();
    return db
        .select({
            entityType: workspaceActivity.entityType,
            action: workspaceActivity.action,
            context: workspaceActivity.context,
        })
        .from(workspaceActivity)
        .where(eq(workspaceActivity.entityId, entityId));
};

/** Owner + a space in their workspace, ready to receive a head. */
const seed = async () => {
    const owner = await makeUser({ role: "owner" });
    const space = await makeSpace({
        workspaceId: owner.workspaceId,
        createdBy: owner.id,
    });
    const client = await makeLoggedInClient(owner);
    return { owner, space, client };
};

describe("PATCH /api/v1/spaces/:id — head_user_id (Dept Review V1)", () => {
    describe("Happy path", () => {
        it("owner assigns an active member as head; response carries head_user_id + hydrated head", async () => {
            const { owner, space, client } = await seed();
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });

            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body.head_user_id).toBe(member.id);
            expect(res.body.head).toMatchObject({
                id: member.id,
                role: "member",
                status: "active",
            });
            expect(res.body.head).not.toHaveProperty("password_hash");
            expect(await fetchHeadColumn(space.id)).toBe(member.id);
        });

        it("admin caller may assign; admins and owners may themselves be heads", async () => {
            const { owner, space } = await seed();
            const admin = await makeUser({
                workspaceId: owner.workspaceId,
                role: "admin",
            });
            const adminClient = await makeLoggedInClient(admin);

            const res = await adminClient
                .patch(spacePath(space.id))
                .send({ head_user_id: admin.id });

            expect(res.status).toBe(200);
            expect(res.body.head_user_id).toBe(admin.id);
            expect(res.body.head.role).toBe("admin");

            const res2 = await adminClient
                .patch(spacePath(space.id))
                .send({ head_user_id: owner.id });
            expect(res2.status).toBe(200);
            expect(res2.body.head.role).toBe("owner");
        });

        it("changing the head replaces it; null clears it", async () => {
            const { owner, space, client } = await seed();
            const a = await makeUser({ workspaceId: owner.workspaceId });
            const b = await makeUser({ workspaceId: owner.workspaceId });

            await client.patch(spacePath(space.id)).send({ head_user_id: a.id });
            const swapped = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: b.id });
            expect(swapped.body.head_user_id).toBe(b.id);

            const cleared = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: null });
            expect(cleared.status).toBe(200);
            expect(cleared.body.head_user_id).toBeNull();
            expect(cleared.body.head).toBeNull();
            expect(await fetchHeadColumn(space.id)).toBeNull();
        });

        it("writes a workspace_activity row whose context names headUserId", async () => {
            const { owner, space, client } = await seed();
            const member = await makeUser({ workspaceId: owner.workspaceId });

            await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });

            const rows = await fetchActivityFor(space.id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                entityType: "space",
                action: "updated",
            });
            expect(
                (rows[0].context as { fields: string[] }).fields,
            ).toContain("headUserId");
        });

        it("an empty PATCH body still returns the full hydrated shape (no-op path)", async () => {
            const { owner, space, client } = await seed();
            const member = await makeUser({ workspaceId: owner.workspaceId });
            await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });

            const res = await client.patch(spacePath(space.id)).send({});

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body.head_user_id).toBe(member.id);
            expect(res.body.head.id).toBe(member.id);
        });
    });

    describe("Wire shape on reads (P13 sidebar dependency)", () => {
        it("GET /spaces (list) carries head_user_id + hydrated head on every row", async () => {
            const { owner, space, client } = await seed();
            const member = await makeUser({ workspaceId: owner.workspaceId });
            await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });

            const res = await client.get("/api/v1/spaces");

            expect(res.status).toBe(200);
            const row = res.body.data.find(
                (s: { id: string }) => s.id === space.id,
            );
            expect(Object.keys(row).sort()).toEqual(SPACE_KEYS);
            expect(row.head_user_id).toBe(member.id);
            expect(row.head.id).toBe(member.id);
        });

        it("GET /spaces/:id carries them too; headless space reads null/null", async () => {
            const { space, client } = await seed();

            const res = await client.get(spacePath(space.id));

            expect(res.status).toBe(200);
            expect(Object.keys(res.body).sort()).toEqual(SPACE_KEYS);
            expect(res.body.head_user_id).toBeNull();
            expect(res.body.head).toBeNull();
        });
    });

    describe("Rejections — 422 space.head_invalid", () => {
        const expectInvalid = async (
            res: { status: number; body: { error: { code: string } } },
            spaceId: string,
        ) => {
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("space.head_invalid");
            expect(await fetchHeadColumn(spaceId)).toBeNull();
        };

        it("rejects a guest", async () => {
            const { owner, space, client } = await seed();
            const guest = await makeUser({
                workspaceId: owner.workspaceId,
                role: "guest",
            });
            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: guest.id });
            await expectInvalid(res, space.id);
        });

        it("rejects a deactivated user", async () => {
            const { owner, space, client } = await seed();
            const gone = await makeUser({
                workspaceId: owner.workspaceId,
                status: "deactivated",
            });
            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: gone.id });
            await expectInvalid(res, space.id);
        });

        it("rejects an invited (not yet active) user", async () => {
            const { owner, space, client } = await seed();
            const invited = await makeUser({
                workspaceId: owner.workspaceId,
                status: "invited",
            });
            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: invited.id });
            await expectInvalid(res, space.id);
        });

        it("rejects a nonexistent user id", async () => {
            const { space, client } = await seed();
            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: fakeId("u") });
            await expectInvalid(res, space.id);
        });

        it("rejects another workspace's user (no cross-tenant oracle — same 422)", async () => {
            const { space, client } = await seed();
            const foreign = await makeUser({ role: "member" }); // own fresh workspace
            const res = await client
                .patch(spacePath(space.id))
                .send({ head_user_id: foreign.id });
            await expectInvalid(res, space.id);
        });
    });

    describe("Validation — 422 validation.failed", () => {
        for (const [label, value] of [
            ["a number", 42],
            ["an empty string", ""],
            ["an over-long id", "x".repeat(65)],
        ] as const) {
            it(`rejects ${label}`, async () => {
                const { space, client } = await seed();
                const res = await client
                    .patch(spacePath(space.id))
                    .send({ head_user_id: value });
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }
    });

    describe("Role gate (👑 admin/owner only)", () => {
        for (const role of ["member", "guest"] as const) {
            it(`returns 403 for a ${role} caller`, async () => {
                const { owner, space } = await seed();
                const caller = await makeUser({
                    workspaceId: owner.workspaceId,
                    role,
                });
                const client = await makeLoggedInClient(caller);
                const res = await client
                    .patch(spacePath(space.id))
                    .send({ head_user_id: caller.id });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("auth.forbidden");
            });
        }
    });

    describe("Deactivation hook", () => {
        it("deactivating the head nulls the headship; reactivation does NOT restore it", async () => {
            const { owner, space, client } = await seed();
            const member = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });

            const deact = await client.post(
                `/api/v1/users/${member.id}/deactivate`,
            );
            expect(deact.status).toBeLessThan(300);
            expect(await fetchHeadColumn(space.id)).toBeNull();

            const react = await client.post(
                `/api/v1/users/${member.id}/reactivate`,
            );
            expect(react.status).toBeLessThan(300);
            expect(await fetchHeadColumn(space.id)).toBeNull();

            const res = await client.get(spacePath(space.id));
            expect(res.body.head_user_id).toBeNull();
            expect(res.body.head).toBeNull();
        });

        it("deactivating a multi-space head clears every headship in one go", async () => {
            const { owner, space, client } = await seed();
            const other = await makeSpace({
                workspaceId: owner.workspaceId,
                createdBy: owner.id,
            });
            const member = await makeUser({ workspaceId: owner.workspaceId });
            await client
                .patch(spacePath(space.id))
                .send({ head_user_id: member.id });
            await client
                .patch(spacePath(other.id))
                .send({ head_user_id: member.id });

            await client.post(`/api/v1/users/${member.id}/deactivate`);

            expect(await fetchHeadColumn(space.id)).toBeNull();
            expect(await fetchHeadColumn(other.id)).toBeNull();
        });
    });
});
