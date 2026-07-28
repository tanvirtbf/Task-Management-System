import type { EffectiveGrantRow } from "../../src/repositories/UserRolesRepo";
import { foldGrants } from "../../src/services/PolicyService";
import { PERMISSION_KEYS } from "../../src/rbac/catalog";
import { SYSTEM_ROLE_GRANTS } from "../../src/rbac/bootstrap";
import {
    assignRole,
    makeRbacSpace,
    makeRole,
    policyService,
    rbacRepos,
    rbacWorkspace,
    setGrants,
    userWithPermissions,
    userWithSystemRole,
} from "./helpers";

/**
 * P6 — actor resolution + the version-keyed cache.
 *
 * The folding rules live in `PolicyService`; the narrowing table they implement
 * is spelled out in `src/rbac/bootstrap.ts`. These tests are the executable
 * version of that table.
 */

const policy = policyService;

const row = (
    permissionKey: string,
    grantScope: EffectiveGrantRow["grantScope"],
    assignment: "workspace" | string,
): EffectiveGrantRow => ({
    permissionKey,
    grantScope,
    assignmentScopeType: assignment === "workspace" ? "workspace" : "space",
    assignmentScopeId: assignment === "workspace" ? null : assignment,
});

describe("foldGrants — the narrowing table (pure)", () => {
    it("workspace assignment + 'all' grant → everywhere", () => {
        const e = foldGrants([row("task.edit", "all", "workspace")]).get(
            "task.edit",
        );
        expect(e).toMatchObject({ all: true, own: false });
        expect(e?.spaceIds.size).toBe(0);
    });

    it("workspace assignment + 'own' grant → own items anywhere", () => {
        const e = foldGrants([row("task.edit", "own", "workspace")]).get(
            "task.edit",
        );
        expect(e).toMatchObject({ all: false, own: true });
    });

    it("workspace assignment + 'space' grant → NOTHING (no space to reach)", () => {
        const m = foldGrants([row("task.edit", "space", "workspace")]);
        expect(m.has("task.edit")).toBe(false);
    });

    it("space assignment + 'all' grant → DOWNGRADED to that space", () => {
        const e = foldGrants([row("task.edit", "all", "sp-1")]).get("task.edit");
        expect(e?.all).toBe(false);
        expect([...(e?.spaceIds ?? [])]).toEqual(["sp-1"]);
    });

    it("space assignment + 'space' grant → that space", () => {
        const e = foldGrants([row("task.edit", "space", "sp-1")]).get(
            "task.edit",
        );
        expect([...(e?.spaceIds ?? [])]).toEqual(["sp-1"]);
    });

    it("space assignment + 'own' grant → own items inside that space only", () => {
        const e = foldGrants([row("task.edit", "own", "sp-1")]).get("task.edit");
        expect(e).toMatchObject({ all: false, own: false });
        expect([...(e?.ownSpaceIds ?? [])]).toEqual(["sp-1"]);
        expect(e?.spaceIds.size).toBe(0);
    });

    it("a 'space' assignment with no space id grants nothing (defensive)", () => {
        const m = foldGrants([
            {
                permissionKey: "task.edit",
                grantScope: "all",
                assignmentScopeType: "space",
                assignmentScopeId: null,
            },
        ]);
        expect(m.has("task.edit")).toBe(false);
    });
});

describe("foldGrants — unioning several roles", () => {
    it("space grants from different assignments accumulate", () => {
        const e = foldGrants([
            row("task.edit", "all", "sp-1"),
            row("task.edit", "space", "sp-2"),
        ]).get("task.edit");
        expect([...(e?.spaceIds ?? [])].sort()).toEqual(["sp-1", "sp-2"]);
    });

    it("'all' absorbs every narrower contribution", () => {
        const e = foldGrants([
            row("task.edit", "all", "sp-1"),
            row("task.edit", "own", "workspace"),
            row("task.edit", "all", "workspace"),
        ]).get("task.edit");
        expect(e?.all).toBe(true);
        expect(e?.spaceIds.size).toBe(0);
        expect(e?.ownSpaceIds.size).toBe(0);
    });

    it("workspace-wide 'own' absorbs space-limited 'own'", () => {
        const e = foldGrants([
            row("task.edit", "own", "sp-1"),
            row("task.edit", "own", "workspace"),
        ]).get("task.edit");
        expect(e?.own).toBe(true);
        expect(e?.ownSpaceIds.size).toBe(0);
    });

    it("different permissions stay independent", () => {
        const m = foldGrants([
            row("task.view", "all", "workspace"),
            row("task.edit", "own", "sp-9"),
        ]);
        expect(m.get("task.view")?.all).toBe(true);
        expect(m.get("task.edit")?.all).toBe(false);
        expect([...(m.get("task.edit")?.ownSpaceIds ?? [])]).toEqual(["sp-9"]);
    });
});

describe("PolicyService.resolveActor — against the database", () => {
    it("resolves a seeded system role to its full grant set", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");

        const actor = await policy().resolveActor(admin.id, ws.id);
        expect(actor).not.toBeNull();
        expect(actor?.perms.size).toBe(SYSTEM_ROLE_GRANTS.admin.length);
        expect(actor?.perms.get("workspace.settings")?.all).toBe(true);
        expect(actor?.perms.has("space.delete")).toBe(false); // owner-only
        expect(actor?.isOwner).toBe(false);
    });

    it("the OWNER is the hard-wired floor: every permission, always", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const svc = policy();

        const actor = await svc.resolveActor(owner.id, ws.id);
        expect(actor?.isOwner).toBe(true);
        for (const key of PERMISSION_KEYS) {
            expect(svc.entryFor(actor!, key).all).toBe(true);
        }
    });

    it("the owner keeps every permission even with ZERO grant rows", async () => {
        const ws = await rbacWorkspace();
        const owner = await userWithSystemRole(ws, "owner");
        const svc = policy();

        // Simulate the lockout scenario: the owner's assignment is deleted.
        await rbacRepos().grants.revokeAllForUser(owner.id, ws.id);
        const actor = await svc.resolveActor(owner.id, ws.id);
        expect(actor?.perms.size).toBe(0);
        expect(actor?.isOwner).toBe(true);
        expect(svc.entryFor(actor!, "role.manage").all).toBe(true);
    });

    it("a user with no roles resolves to an empty actor, not an error", async () => {
        const ws = await rbacWorkspace();
        const nobody = await userWithPermissions(ws, []);

        const actor = await policy().resolveActor(nobody.id, ws.id);
        expect(actor).not.toBeNull();
        expect(actor?.perms.size).toBe(0);
        expect(actor?.isOwner).toBe(false);
    });

    it("returns null for a user who is not in that workspace", async () => {
        const a = await rbacWorkspace();
        const b = await rbacWorkspace();
        const u = await userWithSystemRole(a, "admin");

        expect(await policy().resolveActor(u.id, b.id)).toBeNull();
        expect(await policy().resolveActor("u-nope", a.id)).toBeNull();
    });

    it("applies the narrowing table end-to-end via a space-scoped assignment", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const marketing = await makeRbacSpace(ws.id, admin.id, "Marketing");
        const support = await makeRbacSpace(ws.id, admin.id, "Support");

        // Role grants 'all', but assigned only inside Marketing → downgraded.
        const u = await userWithPermissions(ws, ["task.edit"], {
            spaceId: marketing,
        });
        const actor = await policy().resolveActor(u.id, ws.id);
        const entry = actor!.perms.get("task.edit")!;

        expect(entry.all).toBe(false);
        expect(entry.spaceIds.has(marketing)).toBe(true);
        expect(entry.spaceIds.has(support)).toBe(false);
    });

    it("unions several roles held by one person", async () => {
        const ws = await rbacWorkspace();
        const admin = await userWithSystemRole(ws, "admin");
        const spaceId = await makeRbacSpace(ws.id, admin.id);

        const u = await userWithPermissions(ws, ["task.view"]);
        const extra = await makeRole(ws.id, {
            grants: [["report.view", "space"], "comment.create"],
        });
        await assignRole({
            workspaceId: ws.id,
            userId: u.id,
            roleId: extra,
            spaceId,
        });

        const actor = await policy().resolveActor(u.id, ws.id);
        expect(actor?.perms.get("task.view")?.all).toBe(true);
        expect([...(actor?.perms.get("report.view")?.spaceIds ?? [])]).toEqual([
            spaceId,
        ]);
        // 'comment.create' is granted 'all' by the role, but the assignment is
        // space-scoped → clamped to that space, not workspace-wide.
        expect(actor?.perms.get("comment.create")?.all).toBe(false);
        expect(
            actor?.perms.get("comment.create")?.spaceIds.has(spaceId),
        ).toBe(true);
    });
});

describe("PolicyService — the cache and instant revocation", () => {
    it("serves a second resolve from cache (no re-read of grants)", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.view"]);
        const svc = policy();

        const first = await svc.resolveActor(u.id, ws.id);
        const second = await svc.resolveActor(u.id, ws.id);
        expect(second).toBe(first); // same object identity = cache hit
        expect(svc.cacheSize).toBe(1);
    });

    it("a grant change WITHOUT a version bump is (correctly) not seen", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.view"]);
        const svc = policy();
        await svc.resolveActor(u.id, ws.id);

        // Change grants but forget to bump — the cache legitimately holds.
        await setGrants(u.roleId, ["task.view", "task.edit"]);
        const stale = await svc.resolveActor(u.id, ws.id);
        expect(stale?.perms.has("task.edit")).toBe(false);
    });

    it("bumping permissions_version makes a change visible on the NEXT call", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.view"]);
        const svc = policy();
        const before = await svc.resolveActor(u.id, ws.id);
        expect(before?.perms.has("task.edit")).toBe(false);

        await setGrants(u.roleId, ["task.view", "task.edit"]);
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        const after = await svc.resolveActor(u.id, ws.id);
        expect(after).not.toBe(before);
        expect(after?.perms.has("task.edit")).toBe(true);
        expect(after?.version).toBe((before?.version ?? 0) + 1);
    });

    it("REVOCATION is instant once the version is bumped", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["workspace.settings"]);
        const svc = policy();
        expect(
            (await svc.resolveActor(u.id, ws.id))?.perms.has(
                "workspace.settings",
            ),
        ).toBe(true);

        await setGrants(u.roleId, []);
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        expect(
            (await svc.resolveActor(u.id, ws.id))?.perms.has(
                "workspace.settings",
            ),
        ).toBe(false);
    });

    it("archiving a role revokes it too (after the bump)", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.edit"]);
        const svc = policy();
        expect((await svc.resolveActor(u.id, ws.id))?.perms.size).toBe(1);

        await rbacRepos().roles.update(u.roleId, { archivedAt: new Date() });
        await rbacRepos().roles.bumpPermissionsVersion(ws.id);

        expect((await svc.resolveActor(u.id, ws.id))?.perms.size).toBe(0);
    });

    it("the version bump of one workspace does not disturb another", async () => {
        const a = await rbacWorkspace();
        const b = await rbacWorkspace();
        const ua = await userWithPermissions(a, ["task.view"]);
        const ub = await userWithPermissions(b, ["task.view"]);
        const svc = policy();

        const beforeB = await svc.resolveActor(ub.id, b.id);
        await rbacRepos().roles.bumpPermissionsVersion(a.id);
        await svc.resolveActor(ua.id, a.id);

        expect(await svc.resolveActor(ub.id, b.id)).toBe(beforeB);
    });

    it("invalidate() and clearCache() drop entries", async () => {
        const ws = await rbacWorkspace();
        const u = await userWithPermissions(ws, ["task.view"]);
        const svc = policy();

        const first = await svc.resolveActor(u.id, ws.id);
        svc.invalidate(u.id, ws.id);
        expect(svc.cacheSize).toBe(0);
        const second = await svc.resolveActor(u.id, ws.id);
        expect(second).not.toBe(first);
        expect(second?.perms.size).toBe(first?.perms.size);

        svc.clearCache();
        expect(svc.cacheSize).toBe(0);
    });

    it("caches per (workspace, user) — two people never share an entry", async () => {
        const ws = await rbacWorkspace();
        const a = await userWithPermissions(ws, ["task.view"]);
        const b = await userWithPermissions(ws, ["workspace.settings"]);
        const svc = policy();

        const ra = await svc.resolveActor(a.id, ws.id);
        const rb = await svc.resolveActor(b.id, ws.id);
        expect(svc.cacheSize).toBe(2);
        expect(ra?.perms.has("task.view")).toBe(true);
        expect(rb?.perms.has("task.view")).toBe(false);
        expect(rb?.perms.has("workspace.settings")).toBe(true);
    });
});
