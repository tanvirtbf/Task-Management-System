"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitations = exports.passwordResetTokens = exports.sessions = exports.users = exports.workspaces = void 0;
// =============================================================================
// Auth / Identity domain — 5 tables
//   workspaces, users, sessions, password_reset_tokens, invitations
//
// Mirrors `database/schema.sql §1-5` 1:1. Every column, constraint, default,
// index and FK action is preserved.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
// ─── workspaces ───────────────────────────────────────────────────────────────
exports.workspaces = (0, mysql_core_1.mysqlTable)("workspaces", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.NAME_LENGTH }).notNull(),
    logoUrl: (0, mysql_core_1.varchar)("logo_url", { length: _shared_1.URL_LENGTH }),
    timezone: (0, mysql_core_1.varchar)("timezone", { length: _shared_1.TIMEZONE_LENGTH })
        .notNull()
        .default("Asia/Dhaka"),
    defaultLocale: (0, mysql_core_1.varchar)("default_locale", { length: 16 })
        .notNull()
        .default("en-US"),
    weekStartsOn: (0, mysql_core_1.tinyint)("week_starts_on", { unsigned: true })
        .notNull()
        .default(6),
    // The customType's toDriver returns a bare comma-joined string;
    // Drizzle pastes it into the DDL unquoted, so we use raw SQL for the
    // literal default.
    workingDays: (0, _shared_1.mysqlSet)("working_days", _shared_1.weekDays)
        .notNull()
        .default((0, drizzle_orm_1.sql) `'sun,mon,tue,wed,thu'`),
    businessHoursStart: (0, mysql_core_1.time)("business_hours_start")
        .notNull()
        .default("09:00:00"),
    businessHoursEnd: (0, mysql_core_1.time)("business_hours_end")
        .notNull()
        .default("18:00:00"),
    /**
     * Dynamic RBAC cache stamp. Bumped on ANY role / grant / assignment
     * change so the per-request permission cache (keyed by
     * `(userId, permissionsVersion)`) invalidates instantly — this is what
     * removes the ~15-minute stale-role window of the JWT-carried role.
     */
    permissionsVersion: (0, mysql_core_1.int)("permissions_version", { unsigned: true })
        .notNull()
        .default(1),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    weekStartsOnCk: (0, mysql_core_1.check)("ck_workspaces_week_starts_on", (0, drizzle_orm_1.sql) `${t.weekStartsOn} BETWEEN 0 AND 6`),
    hoursCk: (0, mysql_core_1.check)("ck_workspaces_hours", (0, drizzle_orm_1.sql) `${t.businessHoursStart} < ${t.businessHoursEnd}`),
}));
// ─── users ────────────────────────────────────────────────────────────────────
exports.users = (0, mysql_core_1.mysqlTable)("users", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.workspaces.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    firstName: (0, mysql_core_1.varchar)("first_name", { length: _shared_1.SHORT_NAME_LENGTH }).notNull(),
    lastName: (0, mysql_core_1.varchar)("last_name", { length: _shared_1.SHORT_NAME_LENGTH }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: _shared_1.EMAIL_LENGTH }).notNull(),
    passwordHash: (0, mysql_core_1.varchar)("password_hash", { length: 255 }).notNull(),
    role: (0, mysql_core_1.mysqlEnum)("role", _shared_1.userRoles).notNull().default("member"),
    avatarUrl: (0, mysql_core_1.varchar)("avatar_url", { length: _shared_1.URL_LENGTH }),
    status: (0, mysql_core_1.mysqlEnum)("status", _shared_1.userStatuses).notNull().default("invited"),
    timezone: (0, mysql_core_1.varchar)("timezone", { length: _shared_1.TIMEZONE_LENGTH })
        .notNull()
        .default("Asia/Dhaka"),
    /**
     * Home team (team-access P1, upgrades/016). Space MEMBERSHIP itself is
     * the `user_roles` rows with scope_type='space'; this only records
     * which of those is HOME. The FK to `spaces` lives in SQL only
     * (schema.sql §6 post-hoc ALTER — declaring it here would import
     * `hierarchy.ts` circularly; same treatment as `uq_user_roles_grant`).
     */
    primarySpaceId: (0, mysql_core_1.varchar)("primary_space_id", { length: _shared_1.ID_LENGTH }),
    lastLoginAt: (0, mysql_core_1.timestamp)("last_login_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    workspaceEmailUq: (0, mysql_core_1.uniqueIndex)("uq_users_workspace_email").on(t.workspaceId, t.email),
    workspaceStatusIdx: (0, mysql_core_1.index)("idx_users_workspace_status").on(t.workspaceId, t.status),
    emailIdx: (0, mysql_core_1.index)("idx_users_email").on(t.email),
    primarySpaceIdx: (0, mysql_core_1.index)("idx_users_primary_space").on(t.primarySpaceId),
}));
// ─── sessions ─ refresh-token jar (token_hash never raw) ──────────────────────
exports.sessions = (0, mysql_core_1.mysqlTable)("sessions", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    tokenHash: (0, mysql_core_1.char)("token_hash", { length: _shared_1.TOKEN_HASH_LENGTH }).notNull(),
    userAgent: (0, mysql_core_1.varchar)("user_agent", { length: _shared_1.URL_LENGTH }),
    ipAddress: (0, mysql_core_1.varchar)("ip_address", { length: _shared_1.IP_LENGTH }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    lastSeenAt: (0, mysql_core_1.timestamp)("last_seen_at").notNull().defaultNow(),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    revokedAt: (0, mysql_core_1.timestamp)("revoked_at"),
}, (t) => ({
    tokenHashUq: (0, mysql_core_1.uniqueIndex)("uq_sessions_token_hash").on(t.tokenHash),
    userActiveIdx: (0, mysql_core_1.index)("idx_sessions_user_active").on(t.userId, t.revokedAt, t.expiresAt),
    expiresIdx: (0, mysql_core_1.index)("idx_sessions_expires").on(t.expiresAt),
}));
// ─── password_reset_tokens ────────────────────────────────────────────────────
exports.passwordResetTokens = (0, mysql_core_1.mysqlTable)("password_reset_tokens", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    tokenHash: (0, mysql_core_1.char)("token_hash", { length: _shared_1.TOKEN_HASH_LENGTH }).notNull(),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    consumedAt: (0, mysql_core_1.timestamp)("consumed_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    tokenHashUq: (0, mysql_core_1.uniqueIndex)("uq_password_reset_token_hash").on(t.tokenHash),
    userIdx: (0, mysql_core_1.index)("idx_password_reset_user").on(t.userId),
    expiresIdx: (0, mysql_core_1.index)("idx_password_reset_expires").on(t.expiresAt),
}));
// ─── invitations ──────────────────────────────────────────────────────────────
exports.invitations = (0, mysql_core_1.mysqlTable)("invitations", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    email: (0, mysql_core_1.varchar)("email", { length: _shared_1.EMAIL_LENGTH }).notNull(),
    role: (0, mysql_core_1.mysqlEnum)("role", _shared_1.invitationRoles).notNull().default("member"),
    tokenHash: (0, mysql_core_1.char)("token_hash", { length: _shared_1.TOKEN_HASH_LENGTH }).notNull(),
    invitedBy: (0, mysql_core_1.varchar)("invited_by", { length: _shared_1.ID_LENGTH }).notNull(),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    acceptedAt: (0, mysql_core_1.timestamp)("accepted_at"),
    acceptedBy: (0, mysql_core_1.varchar)("accepted_by", { length: _shared_1.ID_LENGTH }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    tokenHashUq: (0, mysql_core_1.uniqueIndex)("uq_invitations_token_hash").on(t.tokenHash),
    invitedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.invitedBy],
        foreignColumns: [exports.users.id],
        name: "fk_invitations_invited_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    acceptedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.acceptedBy],
        foreignColumns: [exports.users.id],
        name: "fk_invitations_accepted_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    workspaceEmailIdx: (0, mysql_core_1.index)("idx_invitations_workspace_email").on(t.workspaceId, t.email),
    expiresIdx: (0, mysql_core_1.index)("idx_invitations_expires").on(t.expiresAt),
}));
