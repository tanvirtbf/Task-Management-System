// =============================================================================
// PERMISSION CATALOG — the single source of truth for what can be granted.
//   Plan: RBAC_DYNAMIC_PLAN.md Part 2.2 / Part 5 (P1)
//
// This file is DATA ONLY. It enforces nothing on its own; later phases wire it
// up (P2 seeds it into the `permissions` table, P6-P8 resolve grants against
// it, P11-P22 enforce, P26 renders it as the admin permission grid).
//
// ── INVARIANTS (asserted by tests/rbac/catalog.test.ts) ──────────────────────
//  1. Every key maps to at least one REAL enforcement point in the app. A key
//     that gates nothing is a lie to the admin who ticks its checkbox — so we
//     do not add "future" keys here (e.g. there is no `workspace.delete`
//     because no such endpoint exists; the UI button is inert).
//  2. Every permission supports the `all` scope. `space` is offered only where
//     the resource actually resolves to a space; `own` only where "created by
//     me / assigned to me" is meaningful.
//  3. Keys are stable, lowercase `group.action` strings. They become rows in
//     `role_permissions` — renaming one is a data migration, so treat them as
//     a persisted contract.
//  4. The catalog must be able to express TODAY's behaviour exactly, because
//     P3 seeds the four system roles from it and RBAC_BUILD_LOG.md §0.4 is the
//     pass/fail contract for that.
//
// Labels/descriptions are English on purpose — every on-screen label in this
// product is English (the Bangla admin guide in P35 explains them in Bangla).
// =============================================================================

/** How widely a granted permission applies. Ordered weakest → strongest. */
export const PERMISSION_SCOPES = ["own", "space", "all"] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * Scope semantics:
 *  - `all`   — everywhere in the workspace.
 *  - `space` — only inside spaces where the holder holds THIS role
 *              (i.e. a space-scoped assignment in `user_roles`).
 *  - `own`   — only items the holder created or is assigned to.
 */
export interface PermissionDef {
    key: string;
    group: PermissionGroup;
    label: string;
    description: string;
    /** Scopes an admin may choose for this permission. Always includes "all". */
    scopes: readonly PermissionScope[];
    /** Destructive or privilege-affecting — highlighted in the admin UI. */
    dangerous?: boolean;
}

export const PERMISSION_GROUPS = [
    "workspace",
    "members",
    "spaces",
    "structure",
    "tasks",
    "content",
    "catalog",
    "forms",
    "engineering",
    "review",
    "insights",
    "rbac",
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/** Human labels for the group headers in the admin permission grid. */
export const PERMISSION_GROUP_LABELS: Record<PermissionGroup, string> = {
    workspace: "Workspace",
    members: "Members",
    spaces: "Spaces (departments)",
    structure: "Lists & statuses",
    tasks: "Tasks",
    content: "Task content",
    catalog: "Catalog & settings",
    forms: "Forms",
    engineering: "Engineering",
    review: "Department review & reports",
    insights: "Insights & assistant",
    rbac: "Roles & permissions",
};

const ALL = ["all"] as const;
const ALL_SPACE = ["all", "space"] as const;
const ALL_SPACE_OWN = ["all", "space", "own"] as const;

/**
 * THE CATALOG. Order here is the display order inside each group.
 *
 * Declared with `satisfies` and no type annotation so the literal `key`
 * strings survive: that is what makes `PermissionKey` (below) a real union,
 * and a mistyped `can(actor, "task.editt")` a COMPILE error at all ~100
 * enforcement call sites of P11-P22 — the cheapest possible guarantee that a
 * typo can never become a silent 403. Consumers use the widened `PERMISSIONS`
 * below; this binding exists only to carry the literals into the type.
 */
const PERMISSION_DEFS = [
    // ── workspace ───────────────────────────────────────────────────────────
    {
        key: "workspace.settings",
        group: "workspace",
        label: "Edit workspace settings",
        description:
            "Change the workspace name, timezone, working days and business hours.",
        scopes: ALL,
    },

    // ── members ─────────────────────────────────────────────────────────────
    {
        key: "member.view",
        group: "members",
        label: "View the member directory",
        description:
            "See the list of people in the workspace (needed for assignee and @mention pickers).",
        scopes: ALL,
    },
    {
        key: "member.invite",
        group: "members",
        label: "Invite people",
        description: "Send an invitation email to add someone to the workspace.",
        scopes: ALL,
    },
    {
        key: "member.role_change",
        group: "members",
        label: "Change someone's role",
        description:
            "Assign a different workspace role to another member. The owner's role can never be changed.",
        scopes: ALL,
        dangerous: true,
    },
    {
        key: "member.deactivate",
        group: "members",
        label: "Deactivate / reactivate people",
        description:
            "Disable or restore a member's access. The owner cannot be deactivated, and nobody can deactivate themselves.",
        scopes: ALL,
        dangerous: true,
    },
    {
        key: "member.reset_password",
        group: "members",
        label: "Send a password reset",
        description: "Trigger a password-reset email for another member.",
        scopes: ALL,
        dangerous: true,
    },
    {
        key: "member.edit_profile",
        group: "members",
        label: "Edit someone else's profile",
        description:
            "Change another member's name, email or timezone. Editing your own profile never needs a permission.",
        scopes: ALL,
    },

    // ── spaces ──────────────────────────────────────────────────────────────
    {
        key: "space.view",
        group: "spaces",
        label: "See spaces",
        description:
            "The main visibility switch. With scope 'all' a person sees every space; with 'space' they see only the spaces they are assigned to. Lists, tasks and everything inside follow this.",
        scopes: ALL_SPACE,
    },
    {
        key: "space.create",
        group: "spaces",
        label: "Create a space",
        description: "Add a new space (department) to the workspace.",
        scopes: ALL,
    },
    {
        key: "space.edit",
        group: "spaces",
        label: "Edit a space",
        description: "Rename a space or change its icon, colour and description.",
        scopes: ALL_SPACE,
    },
    {
        key: "space.archive",
        group: "spaces",
        label: "Archive / restore a space",
        description: "Hide a space and its lists without deleting anything.",
        scopes: ALL_SPACE,
    },
    {
        key: "space.delete",
        group: "spaces",
        label: "Delete a space",
        description:
            "Permanently remove an archived, empty space. Cannot be undone.",
        scopes: ALL_SPACE,
        dangerous: true,
    },
    {
        key: "space.head_assign",
        group: "spaces",
        label: "Set the department head",
        description:
            "Choose which person reviews the work of a space and receives its weekly report.",
        scopes: ALL_SPACE,
    },
    {
        key: "space.members_manage",
        group: "spaces",
        label: "Manage who is in a space",
        description:
            "Add or remove people from a space and choose the role they hold there.",
        scopes: ALL_SPACE,
        dangerous: true,
    },

    // ── structure (lists + statuses) ────────────────────────────────────────
    {
        key: "list.create",
        group: "structure",
        label: "Create a list",
        description: "Add a new list inside a space.",
        scopes: ALL_SPACE,
    },
    {
        key: "list.edit",
        group: "structure",
        label: "Edit a list",
        description: "Rename a list or change its icon and colour.",
        scopes: ALL_SPACE,
    },
    {
        key: "list.archive",
        group: "structure",
        label: "Archive / restore a list",
        description: "Hide a list and its tasks without deleting anything.",
        scopes: ALL_SPACE,
    },
    {
        key: "list.delete",
        group: "structure",
        label: "Delete a list",
        description: "Permanently remove an archived, empty list. Cannot be undone.",
        scopes: ALL_SPACE,
        dangerous: true,
    },
    {
        key: "status.manage",
        group: "structure",
        label: "Manage a list's statuses",
        description:
            "Create, rename, reorder and delete the workflow columns of a list.",
        scopes: ALL_SPACE,
    },

    // ── tasks ───────────────────────────────────────────────────────────────
    {
        key: "task.view",
        group: "tasks",
        label: "See tasks",
        description:
            "With scope 'own', a person still sees tasks they created or are assigned to even outside their spaces — this keeps cross-department work (like a reported bug) visible to its reporter.",
        scopes: ALL_SPACE_OWN,
    },
    {
        key: "task.create",
        group: "tasks",
        label: "Create tasks",
        description: "Add new tasks to a list.",
        scopes: ALL_SPACE,
    },
    {
        key: "task.edit",
        group: "tasks",
        label: "Edit tasks",
        description:
            "Change a task's name, description, status, priority, dates, tags and other fields.",
        scopes: ALL_SPACE_OWN,
    },
    {
        key: "task.assign",
        group: "tasks",
        label: "Assign tasks to people",
        description:
            "Add or remove assignees on a task. Without this, a person can still work on tasks assigned to them.",
        scopes: ALL_SPACE,
    },
    {
        key: "task.archive",
        group: "tasks",
        label: "Archive / restore tasks",
        description: "Hide a task without deleting it.",
        scopes: ALL_SPACE_OWN,
    },
    {
        key: "task.delete",
        group: "tasks",
        label: "Delete tasks",
        description: "Remove a task (recoverable by an admin).",
        scopes: ALL_SPACE_OWN,
        dangerous: true,
    },
    {
        key: "task.delete_hard",
        group: "tasks",
        label: "Permanently delete tasks",
        description:
            "Erase a task and all of its comments, checklists and attachments. Cannot be undone.",
        scopes: ALL_SPACE,
        dangerous: true,
    },
    {
        key: "task.sla_override",
        group: "tasks",
        label: "Override a task's SLA",
        description: "Set or clear the service-level deadline on a task.",
        scopes: ALL_SPACE,
    },

    // ── content ─────────────────────────────────────────────────────────────
    {
        key: "comment.create",
        group: "content",
        label: "Comment on tasks",
        description:
            "Post comments and @mention teammates. Editing or deleting your OWN comment never needs a permission.",
        scopes: ALL_SPACE,
    },
    {
        key: "comment.delete_any",
        group: "content",
        label: "Delete anyone's comment",
        description: "Moderate the discussion by removing another person's comment.",
        scopes: ALL_SPACE,
        dangerous: true,
    },
    {
        key: "checklist.manage",
        group: "content",
        label: "Manage checklists",
        description: "Add, edit, tick off and remove checklists and their items.",
        scopes: ALL_SPACE_OWN,
    },
    {
        key: "attachment.upload",
        group: "content",
        label: "Upload attachments",
        description: "Attach files to a task.",
        scopes: ALL_SPACE,
    },
    {
        key: "attachment.delete_any",
        group: "content",
        label: "Delete anyone's attachment",
        description:
            "Remove a file uploaded by someone else. Deleting your own upload never needs a permission.",
        scopes: ALL_SPACE,
        dangerous: true,
    },
    {
        key: "dependency.manage",
        group: "content",
        label: "Link tasks (dependencies)",
        description: "Mark that a task blocks, or is blocked by, another task.",
        scopes: ALL_SPACE,
    },
    {
        key: "customfield.set_value",
        group: "content",
        label: "Fill in custom fields",
        description:
            "Write values into the extra fields on a task. Creating the fields themselves is a separate permission.",
        scopes: ALL_SPACE_OWN,
    },

    // ── catalog ─────────────────────────────────────────────────────────────
    {
        key: "catalog.task_types",
        group: "catalog",
        label: "Manage task types",
        description: "Create, edit and remove the workspace's task types.",
        scopes: ALL,
    },
    {
        key: "catalog.tags",
        group: "catalog",
        label: "Manage tags",
        description: "Create, edit and remove the workspace's tags.",
        scopes: ALL,
    },
    {
        key: "catalog.custom_fields",
        group: "catalog",
        label: "Manage custom fields",
        description:
            "Define the extra fields available on tasks, and which of them are hidden from guests.",
        scopes: ALL,
    },
    {
        key: "catalog.templates",
        group: "catalog",
        label: "Manage templates",
        description: "Create and edit reusable task structures.",
        scopes: ALL,
    },
    {
        key: "template.apply",
        group: "catalog",
        label: "Apply a template",
        description: "Use a saved template to create tasks in a list.",
        scopes: ALL_SPACE,
    },

    // ── forms ───────────────────────────────────────────────────────────────
    {
        key: "form.manage",
        group: "forms",
        label: "Build and publish forms",
        description:
            "Create, edit, publish and delete public intake forms and their fields.",
        scopes: ALL_SPACE,
    },
    {
        key: "form.view_submissions",
        group: "forms",
        label: "View form submissions",
        description:
            "Read what people submitted through a public form (may contain personal data).",
        scopes: ALL_SPACE,
    },

    // ── engineering ─────────────────────────────────────────────────────────
    {
        key: "sprint.manage",
        group: "engineering",
        label: "Manage sprints",
        description:
            "Create, edit, start and close sprints. Sprints are workspace-wide, so this cannot be limited to one space.",
        scopes: ALL,
    },
    {
        key: "sprint.assign_tasks",
        group: "engineering",
        label: "Put tasks in a sprint",
        description: "Add or remove tasks from a sprint.",
        scopes: ALL_SPACE,
    },
    {
        key: "oncall.manage",
        group: "engineering",
        label: "Manage the on-call rotation",
        description:
            "Choose which engineer is on call each week. On-call is workspace-wide.",
        scopes: ALL,
    },
    {
        key: "bug.report",
        group: "engineering",
        label: "Report a bug",
        description:
            "File a bug from anywhere in the app; it lands in the engineering Bug Triage list.",
        scopes: ALL,
    },
    {
        key: "postmortem.manage",
        group: "engineering",
        label: "Fill in incident postmortems",
        description: "Complete the postmortem checklist on a resolved incident.",
        scopes: ALL_SPACE,
    },

    // ── department review & reports ─────────────────────────────────────────
    {
        key: "review.perform",
        group: "review",
        label: "Review completed work (approve / flag)",
        description:
            "Approve a finished task or flag it with a note asking for another pass. Normally given to a department head with scope 'space'.",
        scopes: ALL_SPACE,
    },
    {
        key: "review.read",
        group: "review",
        label: "See review history and queues",
        description:
            "Open the Department page and read the approve/flag history of tasks. Scope 'own' lets a person see the verdicts on their own tasks.",
        scopes: ALL_SPACE_OWN,
    },
    {
        key: "report.view",
        group: "review",
        label: "See weekly department reports",
        description: "Open the Reports page and read a department's weekly report.",
        scopes: ALL_SPACE,
    },
    {
        key: "report.generate",
        group: "review",
        label: "Generate / regenerate a report",
        description:
            "Build a department's weekly report on demand instead of waiting for Monday.",
        scopes: ALL_SPACE,
    },
    {
        key: "report.note",
        group: "review",
        label: "Write the head's note on a report",
        description:
            "Add the department head's written context to a weekly report for HR.",
        scopes: ALL_SPACE,
    },
    {
        key: "report.ack",
        group: "review",
        label: "Mark a report as seen",
        description:
            "Acknowledge on behalf of HR/management that a weekly report has been read.",
        scopes: ALL_SPACE,
    },

    // ── insights ────────────────────────────────────────────────────────────
    {
        key: "activity.view",
        group: "insights",
        label: "See the workspace activity feed",
        description:
            "Read the audit trail of changes across the workspace. This feed is workspace-wide, so it cannot be limited to one space.",
        scopes: ALL,
    },
    {
        key: "assistant.use",
        group: "insights",
        label: "Use the AI help assistant",
        description:
            "Ask the in-app assistant questions. It can only ever show what the person is already allowed to see.",
        scopes: ALL,
    },

    // ── rbac ────────────────────────────────────────────────────────────────
    {
        key: "role.manage",
        group: "rbac",
        label: "Create and edit roles",
        description:
            "Define roles and choose the permissions each one grants. Whoever holds this controls the whole permission system.",
        scopes: ALL,
        dangerous: true,
    },
    {
        key: "role.assign",
        group: "rbac",
        label: "Give people roles",
        description:
            "Assign or remove a role for a person, workspace-wide or inside one space.",
        scopes: ALL,
        dangerous: true,
    },
] as const satisfies readonly PermissionDef[];

/** Compile-time union of every valid permission key. */
export type PermissionKey = (typeof PERMISSION_DEFS)[number]["key"];

/** THE CATALOG, as consumers see it. Same array, widened to `PermissionDef`. */
export const PERMISSIONS: readonly PermissionDef[] = PERMISSION_DEFS;

/**
 * Every key, typed as `PermissionKey`. Iterate this (not `PERMISSIONS`) when
 * the keys are going to be passed to `can()` / `assertCan()`, whose parameter
 * is the literal union — `PERMISSIONS[i].key` is the widened `string`.
 */
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_DEFS.map(
    (p) => p.key,
);

const BY_KEY = new Map<string, PermissionDef>(
    PERMISSIONS.map((p) => [p.key, p]),
);

/** Look up one permission definition, or undefined for an unknown key. */
export const getPermission = (key: string): PermissionDef | undefined =>
    BY_KEY.get(key);

/** True when `key` exists in the catalog. */
export const isPermissionKey = (key: string): boolean => BY_KEY.has(key);

/** True when `scope` may be granted for `key` (unknown key → false). */
export const supportsScope = (key: string, scope: string): boolean => {
    const def = BY_KEY.get(key);
    if (!def) return false;
    return (def.scopes as readonly string[]).includes(scope);
};

/**
 * Catalog grouped for the admin UI, in group order then definition order.
 * Groups with no permissions are omitted.
 */
export const permissionsByGroup = (): {
    group: PermissionGroup;
    label: string;
    permissions: PermissionDef[];
}[] =>
    PERMISSION_GROUPS.map((group) => ({
        group,
        label: PERMISSION_GROUP_LABELS[group],
        permissions: PERMISSIONS.filter((p) => p.group === group),
    })).filter((g) => g.permissions.length > 0);

/**
 * Strongest of two scopes ("all" beats "space" beats "own"). Used when a user
 * holds several roles that grant the same permission at different scopes —
 * grants union, the widest wins (RBAC_DYNAMIC_PLAN.md D-4).
 */
export const strongerScope = (
    a: PermissionScope,
    b: PermissionScope,
): PermissionScope =>
    PERMISSION_SCOPES.indexOf(a) >= PERMISSION_SCOPES.indexOf(b) ? a : b;
