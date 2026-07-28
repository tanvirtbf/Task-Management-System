"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvitationsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
class InvitationsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Insert an invitation row. Takes an optional `exec` so the invite flow can
     * run it in the same transaction as the invited-user insert (all-or-nothing).
     * The caller supplies the id, the token hash and the expiry — this repo only
     * persists what it is given.
     */
    async create(values, exec = this.db) {
        await exec.insert(schema_1.invitations).values(values);
    }
    /**
     * Look up an invitation by its `sha256` token hash and take a `FOR UPDATE`
     * row lock so concurrent accepts of the same token serialize (a replay sees
     * `accepted_at` already set). Must run inside a transaction; pass `exec`.
     */
    async findByTokenHashForUpdate(tokenHash, exec) {
        const [row] = await exec
            .select({
            id: schema_1.invitations.id,
            workspaceId: schema_1.invitations.workspaceId,
            email: schema_1.invitations.email,
            role: schema_1.invitations.role,
            expiresAt: schema_1.invitations.expiresAt,
            acceptedAt: schema_1.invitations.acceptedAt,
        })
            .from(schema_1.invitations)
            .where((0, drizzle_orm_1.eq)(schema_1.invitations.tokenHash, tokenHash))
            .limit(1)
            .for("update");
        return row ?? null;
    }
    /**
     * Read-only invitation summary (joined to the workspace name) for the public
     * accept landing page. No lock — the page only displays who is invited.
     */
    async findDetailByTokenHash(tokenHash) {
        const [row] = await this.db
            .select({
            email: schema_1.invitations.email,
            role: schema_1.invitations.role,
            expiresAt: schema_1.invitations.expiresAt,
            acceptedAt: schema_1.invitations.acceptedAt,
            workspaceName: schema_1.workspaces.name,
        })
            .from(schema_1.invitations)
            .innerJoin(schema_1.workspaces, (0, drizzle_orm_1.eq)(schema_1.invitations.workspaceId, schema_1.workspaces.id))
            .where((0, drizzle_orm_1.eq)(schema_1.invitations.tokenHash, tokenHash))
            .limit(1);
        return row ?? null;
    }
    /** Mark an invitation accepted (single-use): stamp `accepted_at` + `accepted_by`. */
    async markAccepted(id, acceptedBy, exec = this.db) {
        await exec
            .update(schema_1.invitations)
            .set({ acceptedAt: new Date(), acceptedBy })
            .where((0, drizzle_orm_1.eq)(schema_1.invitations.id, id));
    }
}
exports.InvitationsRepo = InvitationsRepo;
