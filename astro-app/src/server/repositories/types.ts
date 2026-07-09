import type { MySql2Database } from "../db/client";
import type * as schema from "../db/schema";

/**
 * A Drizzle executor that is EITHER the pooled `db` handle or a transaction
 * handle yielded by `db.transaction(...)`.
 *
 * Repository write-methods accept this as an optional trailing argument so a
 * service can compose several writes inside one transaction (pass `tx`) or
 * call a method standalone (defaults to the injected `db`).
 */
export type DbExecutor =
    | MySql2Database<typeof schema>
    | Parameters<
          Parameters<MySql2Database<typeof schema>["transaction"]>[0]
      >[0];
