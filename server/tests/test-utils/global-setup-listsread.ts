process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §6 Lists READ suites (list-by-space / list-all
 * / get-by-id).
 *
 * These three were the only endpoint suites in the repo with no config of their
 * own: `jest.lists.config.cjs` deliberately claims the WRITE suites only, so the
 * reads stayed on the root `jest.config.js`. Nothing ever runs the root config
 * on purpose (it reports false failures across suites), which meant **no gate
 * had executed these files since F23** — and four asserts sat there encoding the
 * pre-F23 pagination contract, red and invisible, for seventeen days.
 *
 * They cannot simply join the write config: the write suites run on a
 * no-truncate private DB because they are id-scoped, whereas these reads assert
 * WORKSPACE-WIDE counts ("returns every list", "total_estimate") and need a
 * clean slate per test. So they get their own private database plus the
 * truncate-per-test reset, and `jest.listsread.config.cjs` puts them inside the
 * gate for good.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_listsread_test";
    await provisionTestDb();
};
