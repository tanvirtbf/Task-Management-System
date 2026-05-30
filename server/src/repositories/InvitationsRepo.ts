import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { invitations } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for the `invitations` table (§2 invitation flow / §4 invite).
 *
 * Owns the Drizzle writes; services compose them with the matching `users` and
 * `workspace_activity` rows inside one transaction. Only `sha256(token)` is ever
 * stored in `token_hash` — the raw token lives only in the emailed link.
 */
export class InvitationsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Insert an invitation row. Takes an optional `exec` so the invite flow can
     * run it in the same transaction as the invited-user insert (all-or-nothing).
     * The caller supplies the id, the token hash and the expiry — this repo only
     * persists what it is given.
     */
    async create(
        values: typeof invitations.$inferInsert,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(invitations).values(values);
    }
}
