import { getTableConfig } from "drizzle-orm/mysql-core";
import {
    permissions,
    rolePermissions,
    roles,
    userRoleGrants,
} from "../../src/db/schema/rbac";
import { workspaces } from "../../src/db/schema/auth";
import {
    permissionScopes,
    roleScopeTypes,
} from "../../src/db/schema/_shared";
import { PERMISSION_SCOPES } from "../../src/rbac/catalog";

/**
 * P2 — Drizzle ⇄ SQL schema guards. DB-free (introspects the Drizzle table
 * objects), so it runs in the fast `jest.rbac` config; the real database
 * assertions arrive with the P5 harness.
 *
 * The important one is the FIRST test: `role_permissions.scope` is a DB ENUM
 * declared in `db/schema/_shared.ts`, while the rbac layer owns its own ordered
 * `PERMISSION_SCOPES` (weakest → strongest, used by `strongerScope`). Two
 * sources for one set is a drift risk, so it is pinned here.
 */

const columnNames = (t: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(t).columns.map((c) => c.name);

describe("RBAC schema — enum parity with the permission catalog", () => {
    it("DB scope ENUM and the catalog's scope list are the same SET", () => {
        expect([...permissionScopes].sort()).toEqual(
            [...PERMISSION_SCOPES].sort(),
        );
    });

    it("role assignment scope types are workspace | space", () => {
        expect([...roleScopeTypes]).toEqual(["workspace", "space"]);
    });
});

describe("RBAC schema — table + column names match the SQL", () => {
    it("maps the four expected table names", () => {
        expect(getTableConfig(permissions).name).toBe("permissions");
        expect(getTableConfig(roles).name).toBe("roles");
        expect(getTableConfig(rolePermissions).name).toBe("role_permissions");
        expect(getTableConfig(userRoleGrants).name).toBe("user_roles");
    });

    it("permissions has the catalog columns", () => {
        expect(columnNames(permissions).sort()).toEqual(
            [
                "permission_key",
                "group_key",
                "label",
                "description",
                "scopes",
                "is_dangerous",
                "position",
            ].sort(),
        );
    });

    it("roles uses the reserved-word-safe column names", () => {
        const cols = columnNames(roles);
        // `key` and `rank` are MySQL reserved words — we must not use them.
        expect(cols).toContain("role_key");
        expect(cols).toContain("rank_order");
        expect(cols).not.toContain("key");
        expect(cols).not.toContain("rank");
        for (const c of [
            "id",
            "workspace_id",
            "name",
            "is_system",
            "created_by",
            "archived_at",
        ]) {
            expect(cols).toContain(c);
        }
    });

    it("role_permissions is keyed by (role_id, permission_key) with a scope", () => {
        expect(columnNames(rolePermissions).sort()).toEqual(
            ["role_id", "permission_key", "scope", "created_at"].sort(),
        );
    });

    it("user_roles carries the scope pair and NOT the generated scope_key", () => {
        const cols = columnNames(userRoleGrants);
        for (const c of [
            "id",
            "workspace_id",
            "user_id",
            "role_id",
            "scope_type",
            "scope_id",
            "granted_by",
        ]) {
            expect(cols).toContain(c);
        }
        // `scope_key` is a VIRTUAL generated column that exists only to make the
        // grant UNIQUE key NULL-safe. The app never touches it, and modelling it
        // would make Drizzle try to select/insert it.
        expect(cols).not.toContain("scope_key");
    });

    it("workspaces gained the permissions_version cache stamp", () => {
        expect(columnNames(workspaces)).toContain("permissions_version");
    });
});
