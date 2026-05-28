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

export const notificationTypes = [
    "assigned",
    "mentioned",
    "comment",
    "status_change",
    "due_soon",
    "overdue",
    "form_submitted",
    "automation_failed",
    "pr_review",
    "incident_alert",
] as const;
export const notificationEntityTypes = [
    "task",
    "comment",
    "form",
    "automation",
    "incident",
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
