import { Config } from "../../src/config";

/**
 * Pin the §26 Workspace-activity suite to its private database in the test
 * runtime. Listed in `jest.workspaceActivity.config.cjs` BEFORE
 * `setup-each-workspace-activity.ts`, so the pool targets this run's isolated DB.
 */
Config.DB_NAME = "tms_workspace_activity_test";
