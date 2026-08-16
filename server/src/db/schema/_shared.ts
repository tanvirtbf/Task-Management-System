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
import { customType } from "drizzle-orm/mysql-core";

// ─── MySQL SET column ─────────────────────────────────────────────────────────
// Stores up to 64 named members as a bitmask in 1-8 bytes.  Driver returns it
// as a comma-separated string ("mon,wed"); we expose it as an array of the
// member literals for type-safe application code.
//
// Usage:
//   working_days: mysqlSet("working_days", weekDays)
//     .notNull()
//     .default(["sun","mon","tue","wed","thu"])
export const mysqlSet = <TValues extends readonly [string, ...string[]]>(
    name: string,
    values: TValues,
) =>
    customType<{ data: TValues[number][]; driverData: string | null }>({
        dataType() {
            return `set(${values.map((v) => `'${v}'`).join(",")})`;
        },
        fromDriver(value): TValues[number][] {
            if (value === null || value === "") return [];
            return String(value).split(",") as TValues[number][];
        },
        toDriver(value: TValues[number][]): string {
            return value.join(",");
        },
    })(name);


// ─── Shared ENUM tuples ───────────────────────────────────────────────────────
// Keep these `as const` so the TS literal types are preserved.

export const userRoles = ["owner", "admin", "member", "guest"] as const;
export const userStatuses = ["active", "invited", "deactivated"] as const;
export const invitationRoles = ["admin", "member", "guest"] as const;

export const statusGroups = ["not_started", "active", "done", "closed"] as const;
/**
 * Status groups that count as "completed" (drive `tasks.completed_at` and the
 * Dept Review D-4 done-authority). Hoisted for NEW code (Dept Review V1); the
 * four pre-existing private copies (TaskWriteService, TemplateApplyService,
 * SprintsRepo, EngineeringRepo) deliberately stay untouched — no-refactor rule.
 */
export const DONE_STATUS_GROUPS: ReadonlySet<string> = new Set([
    "done",
    "closed",
]);
export const scopeTypes = ["list", "space"] as const;
export const customFieldScopeTypes = ["workspace", "space", "list"] as const;
export const customFieldTypes = [
    "text",
    "phone",
    "money",
    "date",
    "dropdown",
    "files",
] as const;

/** §16 attachment lifecycle: created at /uploads/sign, finalised at /finalize. */
export const uploadStatuses = ["pending", "complete"] as const;

export const sprintStatuses = ["planned", "active", "closed"] as const;
export const prStatuses = ["open", "merged", "closed", "draft"] as const;
export const bugSeverities = ["S0", "S1", "S2", "S3"] as const;
export const bugReproducibilities = ["always", "sometimes", "once", "cannot"] as const;
export const bugEnvironments = ["production", "staging", "local"] as const;
export const reporterTeams = [
    "ops",
    "cs",
    "inventory",
    "listing",
    "marketing",
    "internal",
] as const;
export const recurrencePatterns = ["none", "daily", "weekly"] as const;
export const dependencyTypes = ["blocks"] as const;
export const templateTypes = ["task", "list", "space"] as const;

/** Dept Review V1 — a head's verdict on a completed task (`task_reviews.status`). */
export const reviewStatuses = ["approved", "flagged"] as const;

/**
 * Dynamic RBAC — how widely one granted permission applies
 * (`role_permissions.scope`). MUST stay set-equal to `PERMISSION_SCOPES` in
 * `src/rbac/catalog.ts`; a test asserts it (the DB layer owns the ENUM, the
 * rbac layer owns the ordering used for "widest grant wins").
 */
export const permissionScopes = ["all", "space", "own"] as const;

/** Dynamic RBAC — where a role assignment applies (`user_roles.scope_type`). */
export const roleScopeTypes = ["workspace", "space"] as const;

// F19 (D6 / ISS-072): 12 → 7. The five removed values — due_soon, overdue,
// automation_failed, pr_review, incident_alert — had NO producer anywhere and
// no triggering surface to build one from (no scheduler, no automations, no
// review-request flow). A declared type nothing can ever produce is the lie
// ISS-072 documents; `comment` and `status_change` stayed and got REAL
// producers instead. Mirrors database/schema.sql §29/§29b + upgrades/009.
// upgrades/014 (2026-08-08): `overdue` RETURNS — the F19 test was "no
// producer", and the overdue-alert job now IS its producer.
export const notificationTypes = [
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
    // upgrades/021 (team-access P8) — the assignment-approval flow. Append-only.
    "assignment_request",
    "assignment_request_decided",
    "assignment_query",
    // upgrades/023 — permanent-delete approval. Append-only.
    "delete_request",
    "delete_request_decided",
] as const;

// Team-access P8 (upgrades/021) — cross-team assignment approval.
export const assignmentRequestStatuses = [
    "pending",
    "accepted",
    "declined",
    "expired",
    "cancelled",
] as const;
// upgrades/023 — permanent-delete approval. No `expired`: a pending delete
// simply waits (nothing is hidden meanwhile), so nothing has to time out.
export const deleteRequestStatuses = [
    "pending",
    "approved",
    "rejected",
    "cancelled",
] as const;
export const assignmentRequestEventActions = [
    "created",
    "accepted",
    "declined",
    "queried",
    "answered",
    "cancelled",
    "expired",
] as const;
export const notificationEntityTypes = [
    "task",
    "comment",
    "form",
    "automation",
    "incident",
    // Dept Review V1 — appended at the END.
    "report",
    // upgrades/023 — a decided delete request. Deliberately NOT "task": once
    // the delete is approved the task is destroyed, so a notification pointing
    // at it would navigate to a 404 (ISS-073). This notification is about the
    // REQUEST, and says so.
    "delete_request",
] as const;

export const workspaceActivityEntityTypes = [
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
] as const;

export const weekDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const formFieldKinds = ["task_attr", "custom_field"] as const;


// ─── Common column lengths ────────────────────────────────────────────────────
export const ID_LENGTH = 64;        // VARCHAR(64) primary keys
export const HEX_COLOR_LENGTH = 7;  // "#RRGGBB"
export const NAME_LENGTH = 120;
export const SHORT_NAME_LENGTH = 80;
export const URL_LENGTH = 500;
export const EMAIL_LENGTH = 255;
export const TOKEN_HASH_LENGTH = 64;   // SHA-256 hex
export const IP_LENGTH = 45;           // IPv6-safe
export const TIMEZONE_LENGTH = 64;
