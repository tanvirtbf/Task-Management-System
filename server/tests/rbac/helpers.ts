import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { ListsRepo } from "../../src/repositories/ListsRepo";
import { PermissionsRepo } from "../../src/repositories/PermissionsRepo";
import { RolesRepo } from "../../src/repositories/RolesRepo";
import {
    UserRolesRepo,
    type EffectiveGrantRow,
} from "../../src/repositories/UserRolesRepo";
import { PolicyService } from "../../src/services/PolicyService";
import { bootstrapRbac } from "../../src/rbac/bootstrap";
import type { PermissionScope } from "../../src/rbac/catalog";
import type { Role } from "../../src/constants";
import {
    makeList,
    makeLoggedInClient,
    makeSpace,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import type { LoggedInClient } from "../test-utils/app";

/**
 * Dynamic RBAC test helpers (RBAC_DYNAMIC_PLAN.md P5).
 *
 * Built on the shared factories — every row is a real insert. The point of this
 * kit is to make a test read like the thing it is proving:
 *
 *   const ws = await rbacWorkspace();
 *   const { client } = await userWithPermissions(ws, ["task.edit"]);
 *
 * ── TWO RULES WORTH KNOWING ──────────────────────────────────────────────────
 * 1. `userWithPermissions` gives the user the LEGACY role `member` by default.
 *    That is deliberate: until P11 swaps the route gates, `canAccess` still
 *    reads `users.role`, so a test user must NOT be a legacy admin or you
 *    cannot tell whether the permission or the old gate let them through.
 * 2. Never build two logged-in clients for the SAME user — two JWTs minted in
 *    the same second are byte-identical and collide on `uq_sessions_token_hash`
 *    (documented gotcha). Each helper returns its client; reuse it.
 */

/** A grant: either a bare key (scope "all") or an explicit [key, scope] pair. */
export type GrantSpec = string | [string, PermissionScope];

const normalise = (
    grants: readonly GrantSpec[],
): { permissionKey: string; scope: PermissionScope }[] =>
    grants.map((g) =>
        typeof g === "string"
            ? { permissionKey: g, scope: "all" as PermissionScope }
            : { permissionKey: g[0], scope: g[1] },
    );

export const rbacRepos = () => {
    const db = getDb();
    return {
        db,
        permissions: new PermissionsRepo(db),
        roles: new RolesRepo(db),
        grants: new UserRolesRepo(db),
        lists: new ListsRepo(db),
    };
};

/**
 * A `PolicyService` wired to the test DB — resolution (P6), decision (P7) and
 * visibility (P8). Build a fresh one per test unless the test is specifically
 * about the cache.
 */
export const policyService = (): PolicyService => {
    const db = getDb();
    return new PolicyService(new UserRolesRepo(db), new ListsRepo(db));
};

export interface RbacWorkspace {
    id: string;
    /** roleKey → id for the four seeded system roles. */
    systemRoleIds: Record<string, string>;
}

/**
 * A workspace with the permission catalog synced and the four system roles
 * seeded — i.e. the state every real deployment is in after P3.
 */
export const rbacWorkspace = async (
    name?: string,
): Promise<RbacWorkspace> => {
    const ws = await makeWorkspace(name ? { name } : {});
    const { roles } = rbacRepos();
    await bootstrapRbac(getDb(), ws.id, { deriveSpaceMembership: false });
    const seeded = await roles.listByWorkspace(ws.id);
    const systemRoleIds: Record<string, string> = {};
    for (const r of seeded) systemRoleIds[r.roleKey] = r.id;
    return { id: ws.id, systemRoleIds };
};

/**
 * A workspace WITHOUT the system roles — only the catalog. Useful when a test
 * wants full control over which roles exist.
 */
export const bareRbacWorkspace = async (): Promise<string> => {
    const ws = await makeWorkspace();
    const { db, permissions } = rbacRepos();
    await permissions.syncCatalog();
    // `makeWorkspace` seeds the four system roles (that is what a real
    // deployment looks like — P11). This helper exists for tests that want
    // FULL control over which roles exist, so undo them here.
    await db.delete(schema.userRoleGrants).where(
        eq(schema.userRoleGrants.workspaceId, ws.id),
    );
    await db
        .delete(schema.roles)
        .where(eq(schema.roles.workspaceId, ws.id));
    return ws.id;
};

let roleSeq = 0;

/** Create a custom role and set its grants in one call. Returns the role id. */
export const makeRole = async (
    workspaceId: string,
    input: {
        key?: string;
        name?: string;
        rankOrder?: number;
        grants?: readonly GrantSpec[];
    } = {},
): Promise<string> => {
    const { roles } = rbacRepos();
    const key = input.key ?? `custom-${++roleSeq}`;
    const id = await roles.create(workspaceId, {
        roleKey: key,
        name: input.name ?? `Role ${key}`,
        rankOrder: input.rankOrder ?? 60,
    });
    if (input.grants?.length) {
        await roles.replacePermissions(id, normalise(input.grants));
    }
    return id;
};

/** Replace a role's grant set (the same operation the permission grid does). */
export const setGrants = async (
    roleId: string,
    grants: readonly GrantSpec[],
): Promise<void> => {
    await rbacRepos().roles.replacePermissions(roleId, normalise(grants));
};

/**
 * Assign a role to a user. Pass `spaceId` for a space-scoped assignment (which
 * is also that user's membership of the space).
 */
export const assignRole = async (input: {
    workspaceId: string;
    userId: string;
    roleId: string;
    spaceId?: string;
}): Promise<string> =>
    rbacRepos().grants.assign({
        workspaceId: input.workspaceId,
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.spaceId ? "space" : "workspace",
        scopeId: input.spaceId ?? null,
    });

export interface RbacUser {
    id: string;
    email: string;
    workspaceId: string;
    /** The bespoke role created to carry the requested permissions. */
    roleId: string;
    client: LoggedInClient;
}

/**
 * A user who holds EXACTLY the given permissions, via a purpose-built role.
 *
 * `spaceId` makes the assignment space-scoped, which is how you test the
 * narrowing rule ("a space-scoped assignment can never reach outside its
 * space"). `legacyRole` defaults to `member` — see rule 1 in the file header.
 */
export const userWithPermissions = async (
    workspace: RbacWorkspace | string,
    grants: readonly GrantSpec[],
    opts: {
        spaceId?: string;
        legacyRole?: Role;
        rankOrder?: number;
    } = {},
): Promise<RbacUser> => {
    const workspaceId =
        typeof workspace === "string" ? workspace : workspace.id;
    const legacyRole: Role = opts.legacyRole ?? "member";
    const user = await makeUser({ workspaceId, role: legacyRole });
    // `makeUser` assigns the SYSTEM role matching `legacyRole` (that is what a
    // real deployment looks like). Drop it, or this helper would mean "these
    // permissions PLUS everything a member holds" and no test could prove an
    // absence. `legacyRole` stays on the user row so the pre-RBAC gates still
    // see what they expect.
    await rbacRepos().grants.revokeAllForUser(user.id, workspaceId);
    const roleId = await makeRole(workspaceId, {
        grants,
        rankOrder: opts.rankOrder,
    });
    await assignRole({
        workspaceId,
        userId: user.id,
        roleId,
        spaceId: opts.spaceId,
    });
    const client = await makeLoggedInClient({
        id: user.id,
        workspaceId,
        role: legacyRole,
    });
    return { ...user, workspaceId, roleId, client };
};

/**
 * A user holding one of the four SEEDED system roles — the "as shipped"
 * situation. `legacyRole` follows the system role by default so the user is
 * consistent across both the old and new authorization paths.
 */
export const userWithSystemRole = async (
    workspace: RbacWorkspace,
    roleKey: "owner" | "admin" | "member" | "guest",
): Promise<RbacUser> => {
    const user = await makeUser({
        workspaceId: workspace.id,
        role: roleKey,
    });
    const roleId = workspace.systemRoleIds[roleKey];
    await assignRole({ workspaceId: workspace.id, userId: user.id, roleId });
    const client = await makeLoggedInClient({
        id: user.id,
        workspaceId: workspace.id,
        role: roleKey,
    });
    return { ...user, workspaceId: workspace.id, roleId, client };
};

/** A space in the workspace (thin wrapper so tests read consistently). */
export const makeRbacSpace = async (
    workspaceId: string,
    createdBy: string,
    name?: string,
): Promise<string> => {
    const sp = await makeSpace({
        workspaceId,
        createdBy,
        ...(name ? { name } : {}),
    });
    return sp.id;
};

/** A list inside a space — the `listIds` half of a visibility scope (P8). */
export const makeRbacList = async (
    workspaceId: string,
    spaceId: string,
    createdBy: string,
    name?: string,
): Promise<string> => {
    const l = await makeList({
        workspaceId,
        spaceId,
        createdBy,
        ...(name ? { name } : {}),
    });
    return l.id;
};

/** The raw effective-grant rows for a user — what the P6 resolver folds. */
export const effectiveGrants = async (
    userId: string,
    workspaceId: string,
): Promise<EffectiveGrantRow[]> =>
    rbacRepos().grants.listEffectiveGrants(userId, workspaceId);

/** Sorted `key:grantScope@assignmentScope` strings — readable assertions. */
export const grantSignatures = async (
    userId: string,
    workspaceId: string,
): Promise<string[]> => {
    const rows = await effectiveGrants(userId, workspaceId);
    return rows
        .map(
            (r) =>
                `${r.permissionKey}:${r.grantScope}@${
                    r.assignmentScopeType === "space"
                        ? `space(${r.assignmentScopeId ?? "?"})`
                        : "workspace"
                }`,
        )
        .sort();
};
