process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §30 Health & diagnostics suite. A private DB so
 * other suites' DROP/CREATE can't race it. The readiness probe (`/health/ready`)
 * pings this DB, so it must exist. Mirrors the §8 / §19 / §26 pattern.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_health_test";
    await provisionTestDb();
};
