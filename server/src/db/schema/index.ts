// =============================================================================
// Drizzle schema — single re-export surface used by `drizzle.config.ts` and
// the rest of the server.  Mirrors `database/schema.sql` 1:1.
//
// File layout:
//   _shared.ts         — ENUM tuples + mysqlSet customType + common lengths
//   auth.ts            — workspaces, users, sessions, password_reset_tokens,
//                        invitations
//   hierarchy.ts       — spaces, lists, task_types, statuses, tags
//   sprints.ts         — sprints, on_call_shifts
//   tasks.ts           — tasks, task_assignees, task_watchers, task_tags,
//                        task_dependencies, task_activity
//   task-content.ts    — comments, checklists, checklist_items, attachments
//   custom-fields.ts   — custom_fields, custom_field_options,
//                        task_custom_field_values
//   forms.ts           — forms, form_fields, form_submissions
//   notifications.ts   — notifications, user_notification_prefs,
//                        push_subscriptions (§29c Web Push devices)
//   audit.ts           — workspace_activity
//   templates.ts       — templates (reusable task structures)
//   reviews.ts         — task_reviews (Dept Review V1 — head-verdict ledger)
//   reports.ts         — department_reports (Dept Review V1 — weekly HR reports)
//   rbac.ts            — permissions, roles, role_permissions, user_roles
//                        (Dynamic RBAC — RBAC_DYNAMIC_PLAN.md)
//   assignment-requests.ts — task_assignment_requests + its events ledger
//                        (team-access P8 — cross-team assignment approval)
//   views.ts           — v_open_tasks, v_open_bugs, v_active_sprint,
//                        v_current_on_call, v_breached_sla
//   relations.ts       — relations() for the Drizzle query API
//
// Triggers + the view DDL itself live in `db/migrations/_post.sql` and are
// applied after `drizzle-kit push` / `drizzle-kit migrate`.
// =============================================================================

export * from "./_shared";
export * from "./auth";
export * from "./hierarchy";
export * from "./sprints";
export * from "./tasks";
export * from "./task-content";
export * from "./custom-fields";
export * from "./forms";
export * from "./notifications";
export * from "./audit";
export * from "./templates";
export * from "./chat";
export * from "./reviews";
export * from "./reports";
export * from "./rbac";
export * from "./assignment-requests";
export * from "./views";
export * from "./relations";
