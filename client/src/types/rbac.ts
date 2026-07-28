/**
 * RBAC wire types (server `src/types/rbac.ts` + `serializers/roleSerializer.ts`).
 * snake_case on the wire; the store converts nothing — these ARE the payloads.
 */

export interface PermissionEntry {
    all: boolean;
    space_ids: string[];
    own: boolean;
    own_space_ids: string[];
}

export interface MyPermissions {
    version: number;
    is_owner: boolean;
    role: string;
    /** `null` = every space. An empty array = none. */
    visible_space_ids: string[] | null;
    permissions: Record<string, PermissionEntry>;
}

export interface RolePermission {
    key: string;
    scope: "all" | "space" | "own";
}

export interface Role {
    id: string;
    key: string;
    name: string;
    description: string | null;
    color: string;
    is_system: boolean;
    rank: number;
    holders: number;
    permissions: RolePermission[];
    created_at: string;
}

export interface RoleAssignment {
    id: string;
    user_id: string;
    role_id: string;
    role_key: string;
    role_name: string;
    scope_type: "workspace" | "space";
    space_id: string | null;
    created_at: string;
}

export interface CatalogPermission {
    key: string;
    label: string;
    description: string;
    scopes: ("all" | "space" | "own")[];
    dangerous: boolean;
}

export interface CatalogGroup {
    group: string;
    label: string;
    permissions: CatalogPermission[];
}
