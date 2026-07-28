"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireCatalog = exports.toWireAssignment = exports.toWireRole = void 0;
const toWireRole = (r) => ({
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
exports.toWireRole = toWireRole;
const toWireAssignment = (a) => ({
    id: a.id,
    user_id: a.userId,
    role_id: a.roleId,
    role_key: a.roleKey,
    role_name: a.roleName,
    scope_type: a.scopeType,
    space_id: a.scopeId,
    created_at: a.createdAt.toISOString(),
});
exports.toWireAssignment = toWireAssignment;
const toWireCatalog = (groups) => groups.map((g) => ({
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
exports.toWireCatalog = toWireCatalog;
