// =============================================================================
// Shared helpers for the Drizzle schema — SQLite/Turso edition.
//
// Converted from the MySQL original. Key storage decisions live here so every
// table file stays consistent:
//   1.  timestampMs()   — MySQL TIMESTAMP ⇢ INTEGER epoch-milliseconds with
//       drizzle mode "timestamp_ms" (JS Date in/out, same as mysql2 did).
//   2.  NOW_MS          — SQL default/comparison for "current time" in the
//       same epoch-ms unit: (cast(unixepoch('subsec') * 1000 as integer)).
//   3.  mysqlSet        — MySQL SET ⇢ TEXT storing the comma-joined members;
//       identical array-of-literals application semantics.
//   4.  Shared ENUM value tuples — unchanged; enum columns become
//       text("col", { enum: values }).
// =============================================================================
import { sql } from "drizzle-orm";
import { customType, integer } from "drizzle-orm/sqlite-core";

// ─── "now" in epoch milliseconds (SQLite) ────────────────────────────────────
// unixepoch('subsec') → float seconds; ×1000 + cast → integer ms. Used for
// column defaults and any raw-SQL comparison against timestampMs columns.
export const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

// ─── TIMESTAMP column (epoch ms ⇄ JS Date) ──────────────────────────────────
// Usage:
//   createdAt: timestampMs("created_at").notNull().default(NOW_MS)
//   updatedAt: timestampMs("updated_at").notNull().default(NOW_MS)
//                  .$onUpdate(() => new Date())   // replaces ON UPDATE NOW()
export const timestampMs = (name: string) =>
    integer(name, { mode: "timestamp_ms" });

// ─── Case-insensitive TEXT (MySQL collation parity) ─────────────────────────
// MySQL's utf8mb4_general_ci made string equality, UNIQUE constraints and
// ORDER BY case-insensitive. SQLite defaults to BINARY — identity/lookup
// columns (emails, slugs, unique names) use this type to keep the old
// behaviour (login with "Owner@X.com", duplicate-name rejection, ci sort).
export const ciText = (name: string) =>
    customType<{ data: string; driverData: string }>({
        dataType() {
            return "text COLLATE NOCASE";
        },
    })(name);

// ─── MySQL SET column ⇢ TEXT (comma-joined) ─────────────────────────────────
// Driver stores/returns "mon,wed"; app code sees an array of member literals —
// exactly the MySQL behaviour. `values` is kept for call-site compatibility
// and type narrowing.
export const mysqlSet = <TValues extends readonly [string, ...string[]]>(
    name: string,
    _values: TValues,
) =>
    customType<{ data: TValues[number][]; driverData: string | null }>({
        dataType() {
            return "text";
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
// SQLite TEXT has no length, but the constants stay: application code imports
// them for validation limits.
export const ID_LENGTH = 64;        // VARCHAR(64) primary keys
export const HEX_COLOR_LENGTH = 7;  // "#RRGGBB"
export const NAME_LENGTH = 120;
export const SHORT_NAME_LENGTH = 80;
export const URL_LENGTH = 500;
export const EMAIL_LENGTH = 255;
export const TOKEN_HASH_LENGTH = 64;   // SHA-256 hex
export const IP_LENGTH = 45;           // IPv6-safe
export const TIMEZONE_LENGTH = 64;
