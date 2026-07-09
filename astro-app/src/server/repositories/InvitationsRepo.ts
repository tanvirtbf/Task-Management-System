import { eq } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { invitations, workspaces } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for the `invitations` table (§2 invitation flow / §4 invite).
 *
 * Owns the Drizzle writes; services compose them with the matching `users` rows
 * inside one transaction. Only `sha256(token)` is ever stored in `token_hash` —
 * the raw token lives only in the emailed link.
 */

/** Row the accept flow locks + validates — the token is the capability. */
export interface InvitationRow {
    id: string;
    workspaceId: string;
    email: string;
    role: "admin" | "member" | "guest";
    expiresAt: Date;
    acceptedAt: Date | null;
}

/** Public-facing invitation summary for the accept landing page. */
export interface InvitationDetail {
    email: string;
    role: "admin" | "member" | "guest";
    expiresAt: Date;
    acceptedAt: Date | null;
    workspaceName: string;
}

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

    /**
     * Look up an invitation by its `sha256` token hash so concurrent accepts of
     * the same token serialize (a replay sees `accepted_at` already set). Must
     * run inside a transaction; pass `exec`. (conv: was a MySQL `FOR UPDATE`
     * row lock; SQLite has no FOR UPDATE — the write transaction's
     * single-writer serialization gives the same guarantee.)
     */
    async findByTokenHashForUpdate(
        tokenHash: string,
        exec: DbExecutor,
    ): Promise<InvitationRow | null> {
        const [row] = await exec
            .select({
                id: invitations.id,
                workspaceId: invitations.workspaceId,
                email: invitations.email,
                role: invitations.role,
                expiresAt: invitations.expiresAt,
                acceptedAt: invitations.acceptedAt,
            })
            .from(invitations)
            .where(eq(invitations.tokenHash, tokenHash))
            .limit(1);
        return row ?? null;
    }

    /**
     * Read-only invitation summary (joined to the workspace name) for the public
     * accept landing page. No lock — the page only displays who is invited.
     */
    async findDetailByTokenHash(
        tokenHash: string,
    ): Promise<InvitationDetail | null> {
        const [row] = await this.db
            .select({
                email: invitations.email,
                role: invitations.role,
                expiresAt: invitations.expiresAt,
                acceptedAt: invitations.acceptedAt,
                workspaceName: workspaces.name,
            })
            .from(invitations)
            .innerJoin(workspaces, eq(invitations.workspaceId, workspaces.id))
            .where(eq(invitations.tokenHash, tokenHash))
            .limit(1);
        return row ?? null;
    }

    /** Mark an invitation accepted (single-use): stamp `accepted_at` + `accepted_by`. */
    async markAccepted(
        id: string,
        acceptedBy: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(invitations)
            .set({ acceptedAt: new Date(), acceptedBy })
            .where(eq(invitations.id, id));
    }
}
