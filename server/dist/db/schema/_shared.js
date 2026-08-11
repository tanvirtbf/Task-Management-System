"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIMEZONE_LENGTH = exports.IP_LENGTH = exports.TOKEN_HASH_LENGTH = exports.EMAIL_LENGTH = exports.URL_LENGTH = exports.SHORT_NAME_LENGTH = exports.NAME_LENGTH = exports.HEX_COLOR_LENGTH = exports.ID_LENGTH = exports.formFieldKinds = exports.weekDays = exports.workspaceActivityEntityTypes = exports.notificationEntityTypes = exports.notificationTypes = exports.roleScopeTypes = exports.permissionScopes = exports.reviewStatuses = exports.templateTypes = exports.dependencyTypes = exports.recurrencePatterns = exports.reporterTeams = exports.bugEnvironments = exports.bugReproducibilities = exports.bugSeverities = exports.prStatuses = exports.sprintStatuses = exports.uploadStatuses = exports.customFieldTypes = exports.customFieldScopeTypes = exports.scopeTypes = exports.DONE_STATUS_GROUPS = exports.statusGroups = exports.invitationRoles = exports.userStatuses = exports.userRoles = exports.mysqlSet = void 0;
// =============================================================================
// Shared helpers for the Drizzle schema.
//
// Two things live here that aren't first-class in Drizzle MySQL out of the box:
//   1.  mysqlSet — MySQL's SET column type (used by `workspaces.working_days`
//       and `tasks.recurrence_days`).
//   2.  Shared ENUM value tuples — so application code can import them and
//       narrow types (e.g. status_group, priority, severity).
//
// Keeping the ENUM values here also makes them easy to keep in sync between
// the database, the API contract (API_DESIGN.md), and the frontend types.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
// ─── MySQL SET column ─────────────────────────────────────────────────────────
// Stores up to 64 named members as a bitmask in 1-8 bytes.  Driver returns it
// as a comma-separated string ("mon,wed"); we expose it as an array of the
// member literals for type-safe application code.
//
// Usage:
//   working_days: mysqlSet("working_days", weekDays)
//     .notNull()
//     .default(["sun","mon","tue","wed","thu"])
const mysqlSet = (name, values) => (0, mysql_core_1.customType)({
    dataType() {
        return `set(${values.map((v) => `'${v}'`).join(",")})`;
    },
    fromDriver(value) {
        if (value === null || value === "")
            return [];
        return String(value).split(",");
    },
    toDriver(value) {
        return value.join(",");
    },
})(name);
exports.mysqlSet = mysqlSet;
// ─── Shared ENUM tuples ───────────────────────────────────────────────────────
// Keep these `as const` so the TS literal types are preserved.
exports.userRoles = ["owner", "admin", "member", "guest"];
exports.userStatuses = ["active", "invited", "deactivated"];
exports.invitationRoles = ["admin", "member", "guest"];
exports.statusGroups = ["not_started", "active", "done", "closed"];
/**
 * Status groups that count as "completed" (drive `tasks.completed_at` and the
 * Dept Review D-4 done-authority). Hoisted for NEW code (Dept Review V1); the
 * four pre-existing private copies (TaskWriteService, TemplateApplyService,
 * SprintsRepo, EngineeringRepo) deliberately stay untouched — no-refactor rule.
 */
exports.DONE_STATUS_GROUPS = new Set([
    "done",
    "closed",
]);
exports.scopeTypes = ["list", "space"];
exports.customFieldScopeTypes = ["workspace", "space", "list"];
exports.customFieldTypes = [
    "text",
    "phone",
    "money",
    "date",
    "dropdown",
    "files",
];
/** §16 attachment lifecycle: created at /uploads/sign, finalised at /finalize. */
exports.uploadStatuses = ["pending", "complete"];
exports.sprintStatuses = ["planned", "active", "closed"];
exports.prStatuses = ["open", "merged", "closed", "draft"];
exports.bugSeverities = ["S0", "S1", "S2", "S3"];
exports.bugReproducibilities = ["always", "sometimes", "once", "cannot"];
exports.bugEnvironments = ["production", "staging", "local"];
exports.reporterTeams = [
    "ops",
    "cs",
    "inventory",
    "listing",
    "marketing",
    "internal",
];
exports.recurrencePatterns = ["none", "daily", "weekly"];
exports.dependencyTypes = ["blocks"];
exports.templateTypes = ["task", "list", "space"];
/** Dept Review V1 — a head's verdict on a completed task (`task_reviews.status`). */
exports.reviewStatuses = ["approved", "flagged"];
/**
 * Dynamic RBAC — how widely one granted permission applies
 * (`role_permissions.scope`). MUST stay set-equal to `PERMISSION_SCOPES` in
 * `src/rbac/catalog.ts`; a test asserts it (the DB layer owns the ENUM, the
 * rbac layer owns the ordering used for "widest grant wins").
 */
exports.permissionScopes = ["all", "space", "own"];
/** Dynamic RBAC — where a role assignment applies (`user_roles.scope_type`). */
exports.roleScopeTypes = ["workspace", "space"];
// F19 (D6 / ISS-072): 12 → 7. The five removed values — due_soon, overdue,
// automation_failed, pr_review, incident_alert — had NO producer anywhere and
// no triggering surface to build one from (no scheduler, no automations, no
// review-request flow). A declared type nothing can ever produce is the lie
// ISS-072 documents; `comment` and `status_change` stayed and got REAL
// producers instead. Mirrors database/schema.sql §29/§29b + upgrades/009.
// upgrades/014 (2026-08-08): `overdue` RETURNS — the F19 test was "no
// producer", and the overdue-alert job now IS its producer.
exports.notificationTypes = [
    "assigned",
    "mentioned",
    "comment",
    "status_change",
    "form_submitted",
    // Dept Review V1 — appended at the END (ENUM order = INSTANT DDL + parity).
    "task_reviewed",
    "report_ready",
    // upgrades/014 — produced by the overdue-alert job. Append-only.
    "overdue",
];
exports.notificationEntityTypes = [
    "task",
    "comment",
    "form",
    "automation",
    "incident",
    // Dept Review V1 — appended at the END.
    "report",
];
exports.workspaceActivityEntityTypes = [
    "workspace",
    "space",
    "list",
    "task_type",
    "tag",
    "custom_field",
    "user",
    "role",
    "sprint",
    // Appended LAST (ordinal parity with the SQL ENUM — the 014 rule).
    // Team-access P3 (upgrades/017): a hard-deleted task's trail lives here,
    // because its own task_activity rows die in the FK cascade.
    "task",
];
exports.weekDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
exports.formFieldKinds = ["task_attr", "custom_field"];
// ─── Common column lengths ────────────────────────────────────────────────────
exports.ID_LENGTH = 64; // VARCHAR(64) primary keys
exports.HEX_COLOR_LENGTH = 7; // "#RRGGBB"
exports.NAME_LENGTH = 120;
exports.SHORT_NAME_LENGTH = 80;
exports.URL_LENGTH = 500;
exports.EMAIL_LENGTH = 255;
exports.TOKEN_HASH_LENGTH = 64; // SHA-256 hex
exports.IP_LENGTH = 45; // IPv6-safe
exports.TIMEZONE_LENGTH = 64;
