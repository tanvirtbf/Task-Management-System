process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb, resetTables } from "./db";

/**
 * Per-file setup for the §14 Comments + §15 Checklists suites. TRUNCATEs the
 * tables these tests touch (FK checks off, so order is irrelevant). DB name is
 * pinned by `db-name-collab.ts` (loaded first in `setupFilesAfterEnv`).
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "comments",
    "checklist_items",
    "checklists",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_custom_field_values",
    "task_activity",
    "notifications",
    "tasks",
    "custom_fields",
    "statuses",
    "lists",
    "spaces",
    "task_types",
    "tags",
    "sessions",
    "users",
    "workspace_activity",
    "workspaces",
];

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    // KI-29 (§P13): DELETE + an AUTO_INCREMENT reset where the counter moved,
    // instead of TRUNCATE. Same observable state, 11× cheaper — see
    // `resetTables` in ./db for the measurement and why the counter still
    // has to be reset.
    await resetTables(TABLES);
});
