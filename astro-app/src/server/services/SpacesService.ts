import { MySql2Database } from "../db/client";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    SpacesRepo,
    type SpaceRecord,
    type SpaceUpdateFields,
} from "../repositories/SpacesRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";

export interface ListSpacesInput {
    workspaceId: string;
    includeArchived: boolean;
}

export interface GetSpaceInput {
    spaceId: string;
    workspaceId: string;
}

export interface CreateSpaceInput {
    workspaceId: string;
    actorId: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isPrivate: boolean;
    position: number;
}

export interface UpdateSpaceInput {
    spaceId: string;
    workspaceId: string;
    actorId: string;
    fields: SpaceUpdateFields;
}

export interface ArchiveSpaceInput {
    spaceId: string;
    workspaceId: string;
    actorId: string;
}

/**
 * §5 Spaces business logic. The read paths are single workspace-scoped reads;
 * `create` owns the transaction that pairs the space insert with its
 * `workspace_activity` audit row.
 */
export class SpacesService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private spaces: SpacesRepo,
        private lists: ListsRepo,
        private activity: WorkspaceActivityRepo,
        private logger: Logger,
    ) {}

    /**
     * List the spaces in a workspace. The `workspaceId` always comes from the
     * caller's verified JWT (`req.auth.workspaceId`) — never from client input
     * — so there is no cross-tenant read path.
     */
    async listSpaces(input: ListSpacesInput): Promise<SpaceRecord[]> {
        return this.spaces.listByWorkspace(input.workspaceId, {
            includeArchived: input.includeArchived,
        });
    }

    /**
     * Read a single space within the caller's workspace. A missing or
     * cross-workspace id both resolve to `404 space.not_found` — the repo
     * scopes by `workspace_id`, so there is no cross-tenant existence oracle.
     * An archived space still exists and is returned (200), not 404.
     */
    async getSpace(input: GetSpaceInput): Promise<SpaceRecord> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        return space;
    }

    /**
     * Create a space and record the `created` activity in the same transaction
     * (all-or-nothing). The workspace and actor come from the caller's verified
     * token (`req.auth`), never the body, so the space always lands in the
     * caller's own workspace. `spaces` has no unique constraint, so there is no
     * duplicate-name conflict — two spaces may share a name.
     *
     * The just-inserted row is re-read inside the transaction so the response
     * carries the authoritative DB `created_at`, identical to a later GET.
     */
    async create(input: CreateSpaceInput): Promise<SpaceRecord> {
        return this.db.transaction(async (tx) => {
            const id = await this.spaces.insert(
                {
                    workspaceId: input.workspaceId,
                    name: input.name,
                    description: input.description,
                    icon: input.icon,
                    color: input.color,
                    isPrivate: input.isPrivate,
                    position: input.position,
                    createdBy: input.actorId,
                },
                tx,
            );
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: id,
                    action: "created",
                    context: { name: input.name },
                },
                tx,
            );
            const space = await this.spaces.findByIdInWorkspace(
                id,
                input.workspaceId,
                tx,
            );
            if (!space) {
                // Unreachable: the row was just inserted in this transaction.
                // The guard only satisfies the `SpaceRecord | null` return type.
                throw AppError.internal();
            }
            return space;
        });
    }

    /**
     * Update a space within the caller's workspace. A missing or cross-workspace
     * id is `404 space.not_found` (the repo scopes by `workspace_id`). An empty
     * patch (no updatable fields supplied) is an idempotent no-op: the current
     * row is returned unchanged and no `workspace_activity` row is written.
     * Otherwise the row is locked, the supplied fields are written, an `updated`
     * activity row (listing the changed field names) is appended, and the
     * authoritative post-update row is re-read — all in one transaction. An
     * archived space remains editable (it still exists).
     */
    async update(input: UpdateSpaceInput): Promise<SpaceRecord> {
        const existing = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }

        const changedFields = Object.keys(input.fields);
        if (changedFields.length === 0) {
            return existing;
        }

        return this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            await this.spaces.updateFields(input.spaceId, input.fields, tx);
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "updated",
                    context: { fields: changedFields },
                },
                tx,
            );
            const updated = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
                tx,
            );
            if (!updated) {
                // Unreachable: the row was locked in this transaction.
                throw AppError.internal();
            }
            return updated;
        });
    }

    /**
     * Archive (soft-delete) a space within the caller's workspace. A missing or
     * cross-workspace id is `404 space.not_found`. Archiving is idempotent: an
     * already-archived space is a no-op (no re-cascade, no activity row).
     * Otherwise, in one transaction, the space row is locked, re-checked under
     * the lock (so concurrent archives don't double-apply), its `archived_at`
     * is stamped, and the cascade archives every still-live list in the space
     * with the SAME instant (API_DESIGN.md §5: "Cascades to its lists"). An
     * `archived` activity row records the name and how many lists were cascaded.
     * Tasks are NOT cascaded here — only the space's direct lists, per the spec.
     */
    async archive(input: ArchiveSpaceInput): Promise<void> {
        const existing = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (existing.archivedAt) {
            return; // already archived — idempotent no-op
        }

        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
                tx,
            );
            if (!locked || locked.archivedAt) {
                return; // raced with another archive/delete — nothing to do
            }
            const now = new Date();
            const listsArchived = await this.lists.countNonArchivedBySpace(
                input.spaceId,
                tx,
            );
            await this.spaces.setArchivedAt(input.spaceId, now, tx);
            await this.lists.archiveAllBySpace(input.spaceId, now, tx);
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "archived",
                    context: {
                        name: locked.name,
                        lists_archived: listsArchived,
                    },
                },
                tx,
            );
        });
    }

    /**
     * Unarchive (restore) a space within the caller's workspace. A missing or
     * cross-workspace id is `404 space.not_found`. Idempotent: a space that is
     * not archived is a no-op (no activity row). Otherwise the row is locked,
     * re-checked under the lock, its `archived_at` cleared, and an `unarchived`
     * activity row appended — in one transaction.
     *
     * NOTE: per API_DESIGN.md §5 unarchive only "Clears archived_at" on the
     * SPACE; it deliberately does NOT restore the lists the matching archive
     * cascaded. The spec defines no cascade reversal, and blindly un-archiving
     * every archived list would wrongly resurrect lists a user had archived
     * independently before the space was archived. Lists are restored via the
     * §6 list endpoints.
     */
    async unarchive(input: ArchiveSpaceInput): Promise<void> {
        const existing = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (!existing.archivedAt) {
            return; // not archived — idempotent no-op
        }

        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
                tx,
            );
            if (!locked || !locked.archivedAt) {
                return; // raced with another unarchive — already restored
            }
            await this.spaces.setArchivedAt(input.spaceId, null, tx);
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "unarchived",
                    context: { name: locked.name },
                },
                tx,
            );
        });
    }

    /**
     * Hard-delete a space within the caller's workspace (🛡️ owner-only at the
     * route). Preconditions, each with its own status:
     *   - absent / cross-workspace id → `404 space.not_found`.
     *   - not archived → `409 space.not_archived` (05-spaces.md: "must be archived").
     *   - still holds ANY list → `409 space.not_empty`.
     *
     * NOTE on "empty": 05-spaces.md refuses only on a NON-archived list, implying
     * a delete cascades archived lists. The DB cannot do that safely — `lists`
     * cascade from `spaces`, but a list's `tasks` are `ON DELETE RESTRICT` (would
     * block) and its `statuses` are FK-less (would orphan). So we require the
     * space to hold NO lists at all; archived lists must first be removed via the
     * §6 list-delete endpoint (which tears a list down correctly). This is
     * stricter than the literal wording but preserves the `409 space.not_empty`
     * contract and avoids silent data loss / orphans. With no lists the space has
     * no children, so the row delete is clean.
     *
     * Runs under a row lock and re-verifies the preconditions inside the
     * transaction so a concurrent unarchive / list-create cannot slip past.
     */
    async remove(input: ArchiveSpaceInput): Promise<void> {
        const existing = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (!existing.archivedAt) {
            throw AppError.conflict(
                "space.not_archived",
                "Space must be archived before it can be deleted",
            );
        }
        if ((await this.lists.countBySpace(input.spaceId)) > 0) {
            throw AppError.conflict(
                "space.not_empty",
                "Space still has lists; delete them before deleting the space",
            );
        }

        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
                tx,
            );
            if (!locked) {
                return; // concurrently deleted — idempotent
            }
            if (!locked.archivedAt) {
                throw AppError.conflict(
                    "space.not_archived",
                    "Space must be archived before it can be deleted",
                );
            }
            if ((await this.lists.countBySpace(input.spaceId, tx)) > 0) {
                throw AppError.conflict(
                    "space.not_empty",
                    "Space still has lists; delete them before deleting the space",
                );
            }
            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "space",
                    entityId: input.spaceId,
                    action: "deleted",
                    context: { name: locked.name },
                },
                tx,
            );
            await this.spaces.deleteById(input.spaceId, tx);
        });
    }
}
