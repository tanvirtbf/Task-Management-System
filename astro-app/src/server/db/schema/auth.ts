// =============================================================================
// Auth / Identity domain — 5 tables
//   workspaces, users, sessions, password_reset_tokens, invitations
//
// Mirrors `database/schema.sql §1-5` 1:1. Every column, constraint, default,
// index and FK action is preserved.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    ciText,
    invitationRoles,
    mysqlSet,
    timestampMs,
    userRoles,
    userStatuses,
    weekDays,
} from "./_shared";

// ─── workspaces ───────────────────────────────────────────────────────────────
export const workspaces = sqliteTable(
    "workspaces",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        logoUrl: text("logo_url"),
        timezone: text("timezone")
            .notNull()
            .default("Asia/Dhaka"),
        defaultLocale: text("default_locale")
            .notNull()
            .default("en-US"),
        weekStartsOn: integer("week_starts_on")
            .notNull()
            .default(6),
        // The customType's toDriver returns a bare comma-joined string;
        // Drizzle pastes it into the DDL unquoted, so we use raw SQL for the
        // literal default.
        workingDays: mysqlSet("working_days", weekDays)
            .notNull()
            .default(sql`'sun,mon,tue,wed,thu'`),
        businessHoursStart: text("business_hours_start")
            .notNull()
            .default("09:00:00"),
        businessHoursEnd: text("business_hours_end")
            .notNull()
            .default("18:00:00"),
        fiscalYearStartMonth: integer("fiscal_year_start_month")
            .notNull()
            .default(7),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
    },
    (t) => ({
        weekStartsOnCk: check(
            "ck_workspaces_week_starts_on",
            sql`${t.weekStartsOn} BETWEEN 0 AND 6`,
        ),
        fiscalMonthCk: check(
            "ck_workspaces_fiscal_month",
            sql`${t.fiscalYearStartMonth} BETWEEN 1 AND 12`,
        ),
        hoursCk: check(
            "ck_workspaces_hours",
            sql`${t.businessHoursStart} < ${t.businessHoursEnd}`,
        ),
    }),
);

// ─── users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable(
    "users",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        firstName: text("first_name").notNull(),
        lastName: text("last_name").notNull(),
        email: ciText("email").notNull(),
        passwordHash: text("password_hash").notNull(),
        role: text("role", { enum: userRoles }).notNull().default("member"),
        avatarUrl: text("avatar_url"),
        status: text("status", { enum: userStatuses }).notNull().default("invited"),
        timezone: text("timezone")
            .notNull()
            .default("Asia/Dhaka"),
        lastLoginAt: timestampMs("last_login_at"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
    }),
);

// ─── sessions ─ refresh-token jar (token_hash never raw) ──────────────────────
export const sessions = sqliteTable(
    "sessions",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tokenHash: text("token_hash").notNull(),
        userAgent: text("user_agent"),
        ipAddress: text("ip_address"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        lastSeenAt: timestampMs("last_seen_at").notNull().default(NOW_MS),
        expiresAt: timestampMs("expires_at").notNull(),
        revokedAt: timestampMs("revoked_at"),
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
export const passwordResetTokens = sqliteTable(
    "password_reset_tokens",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        tokenHash: text("token_hash").notNull(),
        expiresAt: timestampMs("expires_at").notNull(),
        consumedAt: timestampMs("consumed_at"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    },
    (t) => ({
        tokenHashUq: uniqueIndex("uq_password_reset_token_hash").on(t.tokenHash),
        userIdx: index("idx_password_reset_user").on(t.userId),
        expiresIdx: index("idx_password_reset_expires").on(t.expiresAt),
    }),
);

// ─── invitations ──────────────────────────────────────────────────────────────
export const invitations = sqliteTable(
    "invitations",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        email: ciText("email").notNull(),
        role: text("role", { enum: invitationRoles }).notNull().default("member"),
        tokenHash: text("token_hash").notNull(),
        invitedBy: text("invited_by").notNull(),
        expiresAt: timestampMs("expires_at").notNull(),
        acceptedAt: timestampMs("accepted_at"),
        acceptedBy: text("accepted_by"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
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
