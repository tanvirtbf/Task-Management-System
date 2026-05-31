import { Config } from "../../src/config";

/**
 * Pin the Templates suite (§23) to its private database in the test runtime.
 *
 * Listed in `jest.templates.config.cjs` BEFORE `setup-each-templates.ts`, so the
 * pool (`connectTestDb` → `initDb`) targets this run's isolated DB rather than
 * the contended shared one. See `global-setup-templates.ts` for the rationale.
 */
Config.DB_NAME = "tms_templates_test";
