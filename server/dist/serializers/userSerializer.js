"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireUser = void 0;
const toWireUser = (u) => ({
    id: u.id,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    role: u.role,
    avatar_url: u.avatarUrl,
    status: u.status,
    timezone: u.timezone,
    created_at: u.createdAt.toISOString(),
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});
exports.toWireUser = toWireUser;
