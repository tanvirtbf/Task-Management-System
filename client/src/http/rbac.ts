import type {
    CatalogGroup,
    MyPermissions,
    Role,
    RoleAssignment,
    RolePermission,
} from "../types/rbac";
import { api } from "./client";

/** §34 RBAC endpoints. */
export const rbacApi = {
    /** The caller's own resolved permissions + visible spaces. */
    async me(): Promise<MyPermissions> {
        const { data } = await api.get<MyPermissions>("/me/permissions");
        return data;
    },

    async listRoles(): Promise<Role[]> {
        const { data } = await api.get<{ data: Role[] }>("/roles");
        return data.data;
    },

    async catalog(): Promise<CatalogGroup[]> {
        const { data } = await api.get<{ groups: CatalogGroup[] }>(
            "/roles/catalog",
        );
        return data.groups;
    },

    async createRole(input: {
        name: string;
        description?: string | null;
        color?: string;
        permissions?: RolePermission[];
    }): Promise<Role> {
        const { data } = await api.post<Role>("/roles", input);
        return data;
    },

    async updateRole(
        id: string,
        input: { name?: string; description?: string | null; color?: string },
    ): Promise<Role> {
        const { data } = await api.patch<Role>(`/roles/${id}`, input);
        return data;
    },

    async setPermissions(
        id: string,
        permissions: RolePermission[],
    ): Promise<RolePermission[]> {
        const { data } = await api.put<{ permissions: RolePermission[] }>(
            `/roles/${id}/permissions`,
            { permissions },
        );
        return data.permissions;
    },

    async deleteRole(id: string): Promise<void> {
        await api.delete(`/roles/${id}`);
    },

    async holders(
        id: string,
    ): Promise<{ user_id: string; scope_type: string; space_id: string | null }[]> {
        const { data } = await api.get<{
            data: { user_id: string; scope_type: string; space_id: string | null }[];
        }>(`/roles/${id}/holders`);
        return data.data;
    },

    async assignmentsFor(userId: string): Promise<RoleAssignment[]> {
        const { data } = await api.get<{ data: RoleAssignment[] }>(
            `/users/${userId}/roles`,
        );
        return data.data;
    },

    async assign(
        userId: string,
        input: { role_id: string; space_id?: string | null },
    ): Promise<RoleAssignment[]> {
        const { data } = await api.post<{ data: RoleAssignment[] }>(
            `/users/${userId}/roles`,
            input,
        );
        return data.data;
    },

    async revoke(
        userId: string,
        assignmentId: string,
    ): Promise<RoleAssignment[]> {
        const { data } = await api.delete<{ data: RoleAssignment[] }>(
            `/users/${userId}/roles/${assignmentId}`,
        );
        return data.data;
    },

    async spaceMembers(spaceId: string): Promise<RoleAssignment[]> {
        const { data } = await api.get<{ data: RoleAssignment[] }>(
            `/spaces/${spaceId}/members`,
        );
        return data.data;
    },
};
