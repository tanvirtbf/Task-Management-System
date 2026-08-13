import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeList,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    invitations,
    notifications,
    sessions,
    users,
    workspaceActivity,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";

/**
 * `DELETE /api/v1/users/:id` — PERMANENT member deletion (2026-08-12).
 *
 * The office's case is "added by mistake": deactivation keeps the row for
 * ever, which is right for someone who did work and wrong for a typo. The
 * rule that makes this safe on a lived-in workspace is that a member is
 * deletable ONLY while they have left nothing behind — thirteen relations are
 * ON DELETE RESTRICT, so anything else would either destroy real history or
 * blow up as a raw 1451. These tests pin both halves: the clean delete really
 * removes the row and its personal state, and the moment the person owns
 * anything the endpoint refuses with a readable 409 instead.
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/users/${id}`;
const PREFLIGHT = (id: string) => `/api/v1/users/${id}/deletion-preflight`;

const db = () => getDb();

/** An admin caller + a fresh member in the same workspace. */
const seed = async () => {
    const ws = await makeWorkspace();
    const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
    const client = await makeLoggedInClient(admin);
    const target = await makeUser({ workspaceId: ws.id, role: "member" });
    return { ws, admin, client, target };
};

const userRows = async (id: string) =>
    db().select().from(users).where(eq(users.id, id));

describe("DELETE /api/v1/users/:id — permanent member deletion", () => {
    // ─── a. The mistake case: a clean account really goes ────────────────────
    describe("Happy path", () => {
        it("deletes a member who owns nothing (204) and the row is gone", async () => {
            const { client, target } = await seed();

            const res = await client.delete(PATH(target.id));

            expect(res.status).toBe(204);
            expect(await userRows(target.id)).toHaveLength(0);
        });

        it("takes their personal state with them (sessions, notifications)", async () => {
            const { client, target } = await seed();
            // A live session + an inbox row — both CASCADE by schema.
            await makeLoggedInClient(target);
            await db()
                .insert(notifications)
                .values({
                    id: fakeId("ntf"),
                    userId: target.id,
                    type: "assigned",
                    entityType: "task",
                    entityId: fakeId("t"),
                    actorId: null,
                    title: "You were assigned to something",
                });

            expect(
                await db()
                    .select()
                    .from(sessions)
                    .where(eq(sessions.userId, target.id)),
            ).not.toHaveLength(0);

            expect((await client.delete(PATH(target.id))).status).toBe(204);

            expect(
                await db()
                    .select()
                    .from(sessions)
                    .where(eq(sessions.userId, target.id)),
            ).toHaveLength(0);
            expect(
                await db()
                    .select()
                    .from(notifications)
                    .where(eq(notifications.userId, target.id)),
            ).toHaveLength(0);
        });

        it("writes the audit trail BEFORE the row disappears", async () => {
            const { ws, admin, client, target } = await seed();

            await client.delete(PATH(target.id));

            const rows = await db()
                .select()
                .from(workspaceActivity)
                .where(eq(workspaceActivity.entityId, target.id));
            const deleted = rows.find((r) => r.action === "deleted");
            expect(deleted).toBeDefined();
            expect(deleted!.workspaceId).toBe(ws.id);
            expect(deleted!.actorId).toBe(admin.id);
            expect(deleted!.entityType).toBe("user");
            // The email/name ride in the context — the row they name is gone.
            expect(JSON.stringify(deleted!.context)).toContain(target.email);
        });

        it("clears a pending invitation for that address (no orphan link)", async () => {
            const { ws, admin, client, target } = await seed();
            await db()
                .insert(invitations)
                .values({
                    id: fakeId("inv"),
                    workspaceId: ws.id,
                    email: target.email,
                    role: "member",
                    tokenHash: "a".repeat(64),
                    invitedBy: admin.id,
                    expiresAt: new Date(Date.now() + 86_400_000),
                });

            expect((await client.delete(PATH(target.id))).status).toBe(204);

            expect(
                await db()
                    .select()
                    .from(invitations)
                    .where(eq(invitations.email, target.email)),
            ).toHaveLength(0);
        });
    });

    // ─── b. The guard that protects a lived-in workspace ─────────────────────
    describe("Refuses anyone who has left work behind", () => {
        it("409 user.has_content when they created a task — and the row survives", async () => {
            const { ws, client, target } = await seed();
            await makeTask({ workspaceId: ws.id, createdBy: target.id });

            const res = await client.delete(PATH(target.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.has_content");
            // The message names what holds them, and points at deactivate.
            expect(res.body.error.message).toContain("1 tasks created");
            expect(res.body.error.message).toContain("deactivate");
            expect(await userRows(target.id)).toHaveLength(1);
        });

        it("409 for content that is not a task either (a list they created)", async () => {
            const { ws, client, target } = await seed();
            await makeList({ workspaceId: ws.id, createdBy: target.id });

            const res = await client.delete(PATH(target.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("user.has_content");
            expect(await userRows(target.id)).toHaveLength(1);
        });
    });

    // ─── c. Lockout guards ───────────────────────────────────────────────────
    describe("Guards", () => {
        it("403 on the workspace owner", async () => {
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
            const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
            const client = await makeLoggedInClient(admin);

            const res = await client.delete(PATH(owner.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_delete_owner");
            expect(await userRows(owner.id)).toHaveLength(1);
        });

        it("403 on yourself", async () => {
            const { admin, client } = await seed();

            const res = await client.delete(PATH(admin.id));

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("user.cannot_self_delete");
            expect(await userRows(admin.id)).toHaveLength(1);
        });

        it("409 role.last_admin rather than emptying the workspace of admins", async () => {
            // Two admins, no owner: deleting the OTHER one must still leave an
            // admin behind — here the caller is the only other admin-capable
            // account, so removing the last one is refused.
            const ws = await makeWorkspace();
            const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
            const other = await makeUser({
                workspaceId: ws.id,
                role: "admin",
                status: "deactivated",
            });
            const client = await makeLoggedInClient(other);
            // `other` is deactivated, so `admin` is the last ACTIVE admin.
            const res = await client.delete(PATH(admin.id));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("role.last_admin");
            expect(await userRows(admin.id)).toHaveLength(1);
        });

        it("403 for a plain member (no member.deactivate)", async () => {
            const { ws, target } = await seed();
            const member = await makeUser({
                workspaceId: ws.id,
                role: "member",
            });
            const client = await makeLoggedInClient(member);

            const res = await client.delete(PATH(target.id));

            expect(res.status).toBe(403);
            expect(await userRows(target.id)).toHaveLength(1);
        });

        it("401 without a token", async () => {
            const { target } = await seed();
            const res = await (await oneOff()).delete(PATH(target.id));
            expect(res.status).toBe(401);
            expect(await userRows(target.id)).toHaveLength(1);
        });

        it("404 across workspaces — never a cross-tenant delete", async () => {
            const { client } = await seed();
            const ws2 = await makeWorkspace();
            const foreign = await makeUser({
                workspaceId: ws2.id,
                role: "member",
            });

            const res = await client.delete(PATH(foreign.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            expect(await userRows(foreign.id)).toHaveLength(1);
        });
    });

    // ─── d. The preflight the UI asks first ──────────────────────────────────
    describe("GET /users/:id/deletion-preflight", () => {
        it("says deletable with no blockers for a clean account", async () => {
            const { client, target } = await seed();

            const res = await client.get(PREFLIGHT(target.id));

            expect(res.status).toBe(200);
            expect(res.body.deletable).toBe(true);
            expect(res.body.reason).toBeNull();
            expect(res.body.blockers).toEqual([]);
            expect(res.body.user.email).toBe(target.email);
        });

        it("lists the blockers as an ARRAY of {kind,count} once they own things", async () => {
            const { ws, client, target } = await seed();
            await makeTask({ workspaceId: ws.id, createdBy: target.id });
            await makeTask({ workspaceId: ws.id, createdBy: target.id });

            const res = await client.get(PREFLIGHT(target.id));

            expect(res.status).toBe(200);
            expect(res.body.deletable).toBe(false);
            expect(res.body.reason).toContain("deactivate");
            expect(res.body.blockers).toEqual(
                expect.arrayContaining([
                    { kind: "tasks_created", count: 2 },
                ]),
            );
        });

        it("explains the owner and self cases without touching anything", async () => {
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
            const admin = await makeUser({ workspaceId: ws.id, role: "admin" });
            const client = await makeLoggedInClient(admin);

            const ownerRes = await client.get(PREFLIGHT(owner.id));
            expect(ownerRes.body.deletable).toBe(false);
            expect(ownerRes.body.reason).toContain("owner");

            const selfRes = await client.get(PREFLIGHT(admin.id));
            expect(selfRes.body.deletable).toBe(false);
            expect(selfRes.body.reason).toContain("your own");
        });
    });
});
