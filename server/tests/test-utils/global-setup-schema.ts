process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Global setup for the schema-parity suite (TEST PLAN KI-12).
 *
 * `provisionTestDb` builds the database from the canonical SQL, which is
 * precisely what makes this suite meaningful: it compares Drizzle against a
 * database created the same way a real one is, not against a hand-maintained
 * fixture that could drift in its own direction.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_schema_test";
    await provisionTestDb();
};
