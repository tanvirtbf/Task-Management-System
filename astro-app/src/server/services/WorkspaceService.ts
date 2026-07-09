import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    WorkspaceRepo,
    type WorkspaceRecord,
    type WorkspaceUpdateColumns,
} from "../repositories/WorkspaceRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";

/**
 * §3 Workspace domain logic.
 *
 * V1 is single-tenant: every read/write is scoped to the caller's workspace,
 * taken from the verified JWT `workspaceId` claim (never client input).
 */

export interface UpdateWorkspaceInput {
    workspaceId: string;
    actorId: string;
    /** Whitelisted column updates (camelCase), already validated upstream. */
    patch: WorkspaceUpdateColumns;
    /** snake_case names of the fields the client supplied, for the audit log. */
    changedFields: string[];
}

export class WorkspaceService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private workspaces: WorkspaceRepo,
        private activity: WorkspaceActivityRepo,
    ) {}

    /**
     * Return the workspace identified by `workspaceId`. Throws a 404 when the
     * row is missing — a valid token pointing at a non-existent workspace is a
     * (near-impossible) data-integrity case, surfaced as `workspace.not_found`
     * rather than a generic 500 so it stays debuggable.
     */
    async getWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
        const workspace = await this.workspaces.findById(workspaceId);
        if (!workspace) {
            throw AppError.notFound(
                "workspace.not_found",
                `Workspace ${workspaceId} does not exist`,
            );
        }
        return workspace;
    }

    /**
     * Partial-update the caller's workspace and append a `workspace_activity`
     * row, atomically. An empty patch (no recognised fields) is a no-op: the
     * current workspace is returned unchanged and no activity is written.
     */
    async updateWorkspace(
        input: UpdateWorkspaceInput,
    ): Promise<WorkspaceRecord> {
        const { workspaceId, actorId, patch, changedFields } = input;

        if (changedFields.length === 0) {
            return this.getWorkspace(workspaceId);
        }

        return this.db.transaction(async (tx) => {
            // Locked read: the 404 guard plus the values the business-hours
            // merge needs, race-free against a concurrent writer.
            const current = await this.workspaces.findByIdForUpdate(
                workspaceId,
                tx,
            );
            if (!current) {
                throw AppError.notFound(
                    "workspace.not_found",
                    `Workspace ${workspaceId} does not exist`,
                );
            }

            // Enforce the DB CHECK (`business_hours_start < business_hours_end`)
            // against the MERGED pair, so a partial update can't slip an
            // inconsistent pair past it and surface as a 500. Times are
            // zero-padded "HH:MM:SS", so a lexical compare is correct.
            const start =
                patch.businessHoursStart ?? current.businessHoursStart;
            const end = patch.businessHoursEnd ?? current.businessHoursEnd;
            if (start >= end) {
                throw AppError.unprocessable(
                    "workspace.invalid_business_hours",
                    "business_hours_start must be earlier than business_hours_end",
                );
            }

            const updated = await this.workspaces.update(
                workspaceId,
                patch,
                tx,
            );
            await this.activity.record(
                {
                    workspaceId,
                    actorId,
                    entityType: "workspace",
                    entityId: workspaceId,
                    action: "updated",
                    context: { changed_fields: changedFields },
                },
                tx,
            );
            return updated;
        });
    }
}
