import { Config } from "../../src/config";

/**
 * Pin the §19 Notifications suite to its private database in the test runtime.
 * Listed in `jest.notifications.config.cjs` BEFORE `setup-each-notifications.ts`,
 * so the pool targets this run's isolated DB. See `global-setup-notifications.ts`.
 */
Config.DB_NAME = "tms_notifications_test";
