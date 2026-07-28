import type { PermissionDef, PermissionGroup } from "../rbac/catalog";
import type { AssignmentRecord } from "../repositories/UserRolesRepo";
import type { RoleWithGrants } from "../services/RolesAdminService";

/** §34 wire shapes — snake_case, like every other payload. */

export interface WireRole {
    id: string;
    key: string;
    name: string;
    description: string | null;
    color: string;
    is_system: boolean;
    /** Lower = more powerful. Owner 0, Admin 10, Member 50, Guest 90, custom 100. */
    rank: number;
    holders: number;
    permissions: { key: string; scope: string }[];
    created_at: string;
}

export const toWireRole = (r: RoleWithGrants): WireRole => ({
    id: r.id,
    key: r.roleKey,
    name: r.name,
    description: r.description,
    color: r.color,
    is_system: r.isSystem,
    rank: r.rankOrder,
    holders: r.holders,
    permissions: r.grants.map((g) => ({
        key: g.permissionKey,
        scope: g.scope,
    })),
    created_at: r.createdAt.toISOString(),
});

export interface WireAssignment {
    id: string;
    user_id: string;
    role_id: string;
    role_key: string;
    role_name: string;
    scope_type: "workspace" | "space";
    space_id: string | null;
    created_at: string;
}

export const toWireAssignment = (a: AssignmentRecord): WireAssignment => ({
    id: a.id,
    user_id: a.userId,
    role_id: a.roleId,
    role_key: a.roleKey,
    role_name: a.roleName,
    scope_type: a.scopeType,
    space_id: a.scopeId,
    created_at: a.createdAt.toISOString(),
});

export interface WireCatalogGroup {
    group: string;
    label: string;
    permissions: {
        key: string;
        label: string;
        description: string;
        scopes: string[];
        dangerous: boolean;
    }[];
}

export const toWireCatalog = (
    groups: {
        group: PermissionGroup;
        label: string;
        permissions: PermissionDef[];
    }[],
): WireCatalogGroup[] =>
    groups.map((g) => ({
        group: g.group,
        label: g.label,
        permissions: g.permissions.map((p) => ({
            key: p.key,
            label: p.label,
            description: p.description,
            scopes: [...p.scopes],
            dangerous: p.dangerous ?? false,
        })),
    }));
