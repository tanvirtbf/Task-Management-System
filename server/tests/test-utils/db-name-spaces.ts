import { Config } from "../../src/config";

/**
 * Pin the §5 Spaces suite to its private database in the test runtime.
 *
 * Listed in `jest.spaces.config.cjs` BEFORE `setup-each-spaces.ts`, so the pool
 * (`connectTestDb` → `initDb`) and the per-test truncation both target this
 * run's isolated DB rather than the contended shared one. See
 * `global-setup-spaces.ts` for the rationale.
 */
Config.DB_NAME = "tms_spaces_test";
