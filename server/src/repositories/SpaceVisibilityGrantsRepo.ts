import { and, asc, eq, inArray } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { spaceVisibilityGrants } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for `space_visibility_grants` — "team A can also SEE team B"
 * (team-access P4). The service layer owns the rules (same workspace, not
 * archived, viewer ≠ target, admin-only); this repo only moves rows.
 *
 * The read the PolicyService actor fold depends on is `targetsForViewers` —
 * one query against the `uq_svg_pair` prefix, cached with the fold by
 * `(userId, permissions_version)`, so grant/revoke MUST bump the version.
 */

export interface VisibilityGrantRecord {
    id: string;
    viewerSpaceId: string;
    targetSpaceId: string;
    grantedBy: string | null;
    createdAt: Date;
}

const grantColumns = {
    id: spaceVisibilityGrants.id,
    viewerSpaceId: spaceVisibilityGrants.viewerSpaceId,
    targetSpaceId: spaceVisibilityGrants.targetSpaceId,
    grantedBy: spaceVisibilityGrants.grantedBy,
    createdAt: spaceVisibilityGrants.createdAt,
};

export class SpaceVisibilityGrantsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * THE fold query: every target visible to any of `viewerSpaceIds`, one
     * indexed lookup. Distinct, order irrelevant (the caller unions into a
     * Set).
     */
    async targetsForViewers(
        viewerSpaceIds: readonly string[],
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<string[]> {
        if (viewerSpaceIds.length === 0) return [];
        const rows = await exec
            .selectDistinct({
                targetSpaceId: spaceVisibilityGrants.targetSpaceId,
            })
            .from(spaceVisibilityGrants)
            .where(
                and(
                    eq(spaceVisibilityGrants.workspaceId, workspaceId),
                    inArray(
                        spaceVisibilityGrants.viewerSpaceId,
                        [...viewerSpaceIds],
                    ),
                ),
            );
        return rows.map((r) => r.targetSpaceId);
    }

    /** Every grant in the workspace — the Teams directory's `can_also_see`. */
    async listByWorkspace(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<VisibilityGrantRecord[]> {
        return exec
            .select(grantColumns)
            .from(spaceVisibilityGrants)
            .where(eq(spaceVisibilityGrants.workspaceId, workspaceId))
            .orderBy(asc(spaceVisibilityGrants.createdAt));
    }

    /**
     * Grant sight. Idempotent: `uq_svg_pair` absorbs a repeat (no-op update),
     * so callers do not have to pre-check. Returns true when a NEW row landed
     * (callers bump the permissions version / write audit only then).
     */
    async grant(
        input: {
            workspaceId: string;
            viewerSpaceId: string;
            targetSpaceId: string;
            grantedBy?: string | null;
        },
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const existing = await exec
            .select({ id: spaceVisibilityGrants.id })
            .from(spaceVisibilityGrants)
            .where(
                and(
                    eq(
                        spaceVisibilityGrants.viewerSpaceId,
                        input.viewerSpaceId,
                    ),
                    eq(
                        spaceVisibilityGrants.targetSpaceId,
                        input.targetSpaceId,
                    ),
                ),
            )
            .limit(1);
        if (existing.length > 0) return false;
        await exec
            .insert(spaceVisibilityGrants)
            .values({
                id: fakeId("svg"),
                workspaceId: input.workspaceId,
                viewerSpaceId: input.viewerSpaceId,
                targetSpaceId: input.targetSpaceId,
                grantedBy: input.grantedBy ?? null,
            })
            .onDuplicateKeyUpdate({
                // A racing duplicate is absorbed rather than thrown.
                set: { workspaceId: input.workspaceId },
            });
        return true;
    }

    /** Revoke sight. Idempotent; returns true when a row was removed. */
    async revoke(
        input: {
            workspaceId: string;
            viewerSpaceId: string;
            targetSpaceId: string;
        },
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .delete(spaceVisibilityGrants)
            .where(
                and(
                    eq(spaceVisibilityGrants.workspaceId, input.workspaceId),
                    eq(
                        spaceVisibilityGrants.viewerSpaceId,
                        input.viewerSpaceId,
                    ),
                    eq(
                        spaceVisibilityGrants.targetSpaceId,
                        input.targetSpaceId,
                    ),
                ),
            );
        return result.affectedRows > 0;
    }
}
