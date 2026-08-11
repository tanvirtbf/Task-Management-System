// =============================================================================
// Auth / Identity domain — 5 tables
//   workspaces, users, sessions, password_reset_tokens, invitations
//
// Mirrors `database/schema.sql §1-5` 1:1. Every column, constraint, default,
// index and FK action is preserved.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    char,
    check,
    foreignKey,
    index,
    int,
    mysqlEnum,
    mysqlTable,
    time,
    timestamp,
    tinyint,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    EMAIL_LENGTH,
    IP_LENGTH,
    ID_LENGTH,
    NAME_LENGTH,
    SHORT_NAME_LENGTH,
    TIMEZONE_LENGTH,
    TOKEN_HASH_LENGTH,
    URL_LENGTH,
    invitationRoles,
    mysqlSet,
    userRoles,
    userStatuses,
    weekDays,
} from "./_shared";

// ─── workspaces ───────────────────────────────────────────────────────────────
export const workspaces = mysqlTable(
    "workspaces",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        name: varchar("name", { length: NAME_LENGTH }).notNull(),
        logoUrl: varchar("logo_url", { length: URL_LENGTH }),
        timezone: varchar("timezone", { length: TIMEZONE_LENGTH })
            .notNull()
            .default("Asia/Dhaka"),
        defaultLocale: varchar("default_locale", { length: 16 })
            .notNull()
            .default("en-US"),
        weekStartsOn: tinyint("week_starts_on", { unsigned: true })
            .notNull()
            .default(6),
        // The customType's toDriver returns a bare comma-joined string;
        // Drizzle pastes it into the DDL unquoted, so we use raw SQL for the
        // literal default.
        workingDays: mysqlSet("working_days", weekDays)
            .notNull()
            .default(sql`'sun,mon,tue,wed,thu'`),
        businessHoursStart: time("business_hours_start")
            .notNull()
            .default("09:00:00"),
        businessHoursEnd: time("business_hours_end")
            .notNull()
            .default("18:00:00"),
        /**
         * Dynamic RBAC cache stamp. Bumped on ANY role / grant / assignment
         * change so the per-request permission cache (keyed by
         * `(userId, permissionsVersion)`) invalidates instantly — this is what
         * removes the ~15-minute stale-role window of the JWT-carried role.
         */
        permissionsVersion: int("permissions_version", { unsigned: true })
            .notNull()
            .default(1),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        weekStartsOnCk: check(
            "ck_workspaces_week_starts_on",
            sql`${t.weekStartsOn} BETWEEN 0 AND 6`,
        ),
        hoursCk: check(
            "ck_workspaces_hours",
            sql`${t.businessHoursStart} < ${t.businessHoursEnd}`,
        ),
    }),
);

// ─── users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable(
    "users",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        firstName: varchar("first_name", { length: SHORT_NAME_LENGTH }).notNull(),
        lastName: varchar("last_name", { length: SHORT_NAME_LENGTH }).notNull(),
        email: varchar("email", { length: EMAIL_LENGTH }).notNull(),
        passwordHash: varchar("password_hash", { length: 255 }).notNull(),
        role: mysqlEnum("role", userRoles).notNull().default("member"),
        avatarUrl: varchar("avatar_url", { length: URL_LENGTH }),
        status: mysqlEnum("status", userStatuses).notNull().default("invited"),
        timezone: varchar("timezone", { length: TIMEZONE_LENGTH })
            .notNull()
            .default("Asia/Dhaka"),
        /**
         * Home team (team-access P1, upgrades/016). Space MEMBERSHIP itself is
         * the `user_roles` rows with scope_type='space'; this only records
         * which of those is HOME. The FK to `spaces` lives in SQL only
         * (schema.sql §6 post-hoc ALTER — declaring it here would import
         * `hierarchy.ts` circularly; same treatment as `uq_user_roles_grant`).
         */
        primarySpaceId: varchar("primary_space_id", { length: ID_LENGTH }),
        lastLoginAt: timestamp("last_login_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        workspaceEmailUq: uniqueIndex("uq_users_workspace_email").on(
            t.workspaceId,
            t.email,
        ),
        workspaceStatusIdx: index("idx_users_workspace_status").on(
            t.workspaceId,
            t.status,
        ),
        emailIdx: index("idx_users_email").on(t.email),
        primarySpaceIdx: index("idx_users_primary_space").on(t.primarySpaceId),
    }),
);

// ─── sessions ─ refresh-token jar (token_hash never raw) ──────────────────────
export const sessions = mysqlTable(
    "sessions",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tokenHash: char("token_hash", { length: TOKEN_HASH_LENGTH }).notNull(),
        userAgent: varchar("user_agent", { length: URL_LENGTH }),
        ipAddress: varchar("ip_address", { length: IP_LENGTH }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
        expiresAt: timestamp("expires_at").notNull(),
        revokedAt: timestamp("revoked_at"),
    },
    (t) => ({
        tokenHashUq: uniqueIndex("uq_sessions_token_hash").on(t.tokenHash),
        userActiveIdx: index("idx_sessions_user_active").on(
            t.userId,
            t.revokedAt,
            t.expiresAt,
        ),
        expiresIdx: index("idx_sessions_expires").on(t.expiresAt),
    }),
);

// ─── password_reset_tokens ────────────────────────────────────────────────────
export const passwordResetTokens = mysqlTable(
    "password_reset_tokens",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tokenHash: char("token_hash", { length: TOKEN_HASH_LENGTH }).notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        consumedAt: timestamp("consumed_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        tokenHashUq: uniqueIndex("uq_password_reset_token_hash").on(t.tokenHash),
        userIdx: index("idx_password_reset_user").on(t.userId),
        expiresIdx: index("idx_password_reset_expires").on(t.expiresAt),
    }),
);

// ─── invitations ──────────────────────────────────────────────────────────────
export const invitations = mysqlTable(
    "invitations",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        email: varchar("email", { length: EMAIL_LENGTH }).notNull(),
        role: mysqlEnum("role", invitationRoles).notNull().default("member"),
        tokenHash: char("token_hash", { length: TOKEN_HASH_LENGTH }).notNull(),
        invitedBy: varchar("invited_by", { length: ID_LENGTH }).notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        acceptedAt: timestamp("accepted_at"),
        acceptedBy: varchar("accepted_by", { length: ID_LENGTH }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        tokenHashUq: uniqueIndex("uq_invitations_token_hash").on(t.tokenHash),
        invitedByFk: foreignKey({
            columns: [t.invitedBy],
            foreignColumns: [users.id],
            name: "fk_invitations_invited_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        acceptedByFk: foreignKey({
            columns: [t.acceptedBy],
            foreignColumns: [users.id],
            name: "fk_invitations_accepted_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        workspaceEmailIdx: index("idx_invitations_workspace_email").on(
            t.workspaceId,
            t.email,
        ),
        expiresIdx: index("idx_invitations_expires").on(t.expiresAt),
    }),
);


export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
