import { Config } from "../../src/config";

/**
 * Pin the AI Help Assistant suite to its private database in the test runtime.
 * Listed in `jest.assistant.config.cjs` BEFORE `setup-each-assistant.ts`, so the
 * pool targets this run's isolated DB rather than the contended shared one.
 */
Config.DB_NAME = "tms_assistant_test";
