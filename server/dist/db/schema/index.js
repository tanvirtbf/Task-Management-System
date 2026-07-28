"use strict";
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
//   notifications.ts   — notifications
//   audit.ts           — workspace_activity
//   templates.ts       — templates (reusable task structures)
//   reviews.ts         — task_reviews (Dept Review V1 — head-verdict ledger)
//   reports.ts         — department_reports (Dept Review V1 — weekly HR reports)
//   rbac.ts            — permissions, roles, role_permissions, user_roles
//                        (Dynamic RBAC — RBAC_DYNAMIC_PLAN.md)
//   views.ts           — v_open_tasks, v_open_bugs, v_active_sprint,
//                        v_current_on_call, v_breached_sla
//   relations.ts       — relations() for the Drizzle query API
//
// Triggers + the view DDL itself live in `db/migrations/_post.sql` and are
// applied after `drizzle-kit push` / `drizzle-kit migrate`.
// =============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./_shared"), exports);
__exportStar(require("./auth"), exports);
__exportStar(require("./hierarchy"), exports);
__exportStar(require("./sprints"), exports);
__exportStar(require("./tasks"), exports);
__exportStar(require("./task-content"), exports);
__exportStar(require("./custom-fields"), exports);
__exportStar(require("./forms"), exports);
__exportStar(require("./notifications"), exports);
__exportStar(require("./audit"), exports);
__exportStar(require("./templates"), exports);
__exportStar(require("./chat"), exports);
__exportStar(require("./reviews"), exports);
__exportStar(require("./reports"), exports);
__exportStar(require("./rbac"), exports);
__exportStar(require("./views"), exports);
__exportStar(require("./relations"), exports);
