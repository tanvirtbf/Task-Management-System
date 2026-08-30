import { Config } from "../../src/config";

/**
 * Pin the schema-parity suite to its private database.
 *
 * Listed in `jest.schema.config.cjs` BEFORE `setup-each-schema.ts`, so the pool
 * targets the database this run provisioned rather than a contended one — and,
 * more to the point, so the introspection reads a database built by the CURRENT
 * `db:setup`, which is the whole basis of the comparison.
 */
Config.DB_NAME = "tms_schema_test";
