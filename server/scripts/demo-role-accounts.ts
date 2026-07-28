/* eslint-disable no-console */
/**
 * DEMO ROLE ACCOUNTS — one sign-in per kind of access, so the RBAC work can be
 * seen rather than described.
 *
 *   NODE_ENV=dev npx tsx scripts/demo-role-accounts.ts
 *
 * ADDITIVE ONLY. It creates accounts and one custom role; it never edits or
 * deletes anything that already exists — in particular it does NOT touch the
 * seeded Member role, because narrowing that would change what all 22 existing
 * members see. Safe to re-run: every step is idempotent.
 *
 * The interesting account is the space-scoped one. Until an admin narrows
 * `space.view`, everybody sees everything (the "dormant until configured"
 * default), so a plain Member cannot demonstrate departmental restriction. A
 * custom role with `space.view = space`, assigned inside ONE space, can.
 */
import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import { getDb, initDb } from "../src/db/client";
import { spaces, users, workspaces } from "../src/db/schema";
import { RolesRepo } from "../src/repositories/RolesRepo";
import { UserRolesRepo } from "../src/repositories/UserRolesRepo";
import { syncUserSystemRole } from "../src/rbac/bootstrap";
import { fakeId } from "../src/utils";

const PASSWORD = "Owner@12345";

/** The role every demo account below shares, so one password fits all. */
const ensureUser = async (input: {
    workspaceId: string;
    email: string;
    firstName: string;
    lastName: string;
    legacyRole: "owner" | "admin" | "member" | "guest";
}): Promise<string> => {
    const db = getDb();
    const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
    if (existing[0]) return existing[0].id;

    const id = fakeId("u");
    await db.insert(users).values({
        id,
        workspaceId: input.workspaceId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        role: input.legacyRole,
        status: "active",
        timezone: "Asia/Dhaka",
    });
    await syncUserSystemRole(db, input.workspaceId, id, input.legacyRole);
    return id;
};

(async () => {
    await initDb();
    const db = getDb();
    const roles = new RolesRepo(db);
    const grants = new UserRolesRepo(db);

    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) throw new Error("no workspace");

    const spaceByName = async (name: string) => {
        const [row] = await db
            .select({ id: spaces.id, name: spaces.name })
            .from(spaces)
            .where(and(eq(spaces.workspaceId, ws.id), eq(spaces.name, name)))
            .limit(1);
        if (!row) throw new Error(`space not found: ${name}`);
        return row;
    };

    const marketing = await spaceByName("Marketing");
    const cs = await spaceByName("Customer Service");

    // ── 1. a Guest (there was none) ──────────────────────────────────────────
    const guest = await ensureUser({
        workspaceId: ws.id,
        email: "guest@beautybooth.com.bd",
        firstName: "Guest",
        lastName: "Collaborator",
        legacyRole: "guest",
    });

    // ── 2. a custom, space-scoped role — the RBAC showcase ───────────────────
    // `space.view = space` is the master switch: hold it only inside Marketing
    // and Marketing is all you can see — sidebar, lists, tasks, search, KPIs.
    let deptOnly = await roles.findByKeyInWorkspace("department-only", ws.id);
    if (!deptOnly) {
        const id = await roles.create(ws.id, {
            roleKey: "department-only",
            name: "Department Only",
            description:
                "Sees and works in only the space(s) they are assigned to. Can edit only their own tasks.",
            color: "#EC4899",
            rankOrder: 100,
        });
        deptOnly = await roles.findByIdInWorkspace(id, ws.id);
    }
    await roles.replacePermissions(deptOnly!.id, [
        { permissionKey: "space.view", scope: "space" },
        { permissionKey: "task.view", scope: "space" },
        { permissionKey: "task.create", scope: "space" },
        { permissionKey: "task.edit", scope: "own" },
        { permissionKey: "comment.create", scope: "space" },
        { permissionKey: "checklist.manage", scope: "own" },
        { permissionKey: "member.view", scope: "all" },
        { permissionKey: "assistant.use", scope: "all" },
    ]);

    const scopedTo = async (
        email: string,
        first: string,
        space: { id: string; name: string },
    ) => {
        const userId = await ensureUser({
            workspaceId: ws.id,
            email,
            firstName: first,
            lastName: "Demo",
            legacyRole: "member",
        });
        // Drop the seeded workspace-wide Member grant, or its `space.view=all`
        // would union with the scoped role and undo the whole point.
        await grants.revokeAllForUser(userId, ws.id);
        await grants.assign({
            workspaceId: ws.id,
            userId,
            roleId: deptOnly!.id,
            scopeType: "space",
            scopeId: space.id,
        });
        return userId;
    };

    await scopedTo("marketing.only@beautybooth.com.bd", "Mim", marketing);
    await scopedTo("cs.only@beautybooth.com.bd", "Shuvo", cs);

    await roles.bumpPermissionsVersion(ws.id);

    console.log("done:", {
        guest,
        role: deptOnly!.roleKey,
        spaces: [marketing.name, cs.name],
    });
    process.exit(0);
})().catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
});
