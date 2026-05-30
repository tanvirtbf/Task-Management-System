import type { Logger } from "winston";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { ListsRepo } from "../repositories/ListsRepo";
import { StatusesRepo, type StatusRecord } from "../repositories/StatusesRepo";

export interface ListStatusesInput {
    listId: string;
    workspaceId: string;
}

export interface CreateStatusInput {
    listId: string;
    workspaceId: string;
    name: string;
    statusGroup: StatusRecord["statusGroup"];
    color?: string;
    /** When omitted, the new status is appended to the end of the list. */
    position?: number;
}

export interface UpdateStatusInput {
    id: string;
    workspaceId: string;
    name?: string;
    color?: string;
    statusGroup?: StatusRecord["statusGroup"];
}

export interface DeleteStatusInput {
    id: string;
    workspaceId: string;
}

export interface ReorderStatusItem {
    id: string;
    position: number;
}

export interface ReorderStatusesInput {
    listId: string;
    workspaceId: string;
    /** Non-empty, duplicate-free `{ id, position }` pairs (validated upstream). */
    items: ReorderStatusItem[];
}

/**
 * True when a Drizzle/mysql2 error is a UNIQUE/PK violation (MySQL errno 1062 /
 * `ER_DUP_ENTRY`). Lets `createForList` translate a `uq_statuses_scope_name`
 * collision into `409 status.duplicate` without a TOCTOU pre-check — the insert
 * is the race-safe arbiter.
 */
const isDuplicateKeyError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ER_DUP_ENTRY";

/**
 * True when a mysql2 error is a foreign-key RESTRICT violation on the parent row
 * (errno 1451 / `ER_ROW_IS_REFERENCED_2`). Lets `deleteById` translate a
 * `fk_tasks_status` rejection — a task referencing the status raced in after the
 * `countTasksUsingStatus` pre-check — into `409 status.in_use`.
 */
const isReferencedError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ER_ROW_IS_REFERENCED_2";

/**
 * §7 Statuses domain logic. Controllers translate HTTP; this service owns the
 * read flow, the workspace-isolation guard, and the delete transaction.
 */
export class StatusesService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private lists: ListsRepo,
        private statuses: StatusesRepo,
        private logger: Logger,
    ) {}

    /**
     * Return every status configured for a list the caller's workspace owns.
     * The list is resolved within the workspace first: a missing or
     * cross-workspace id yields `404 list.not_found` — never another
     * workspace's data, and never a misleading empty `200`.
     */
    async listByList(input: ListStatusesInput): Promise<StatusRecord[]> {
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("statuses.list_by_list.list_not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        return this.statuses.listByList(input.listId);
    }

    /**
     * Add a status to a list the caller's workspace owns. The list is resolved
     * within the workspace first: a missing or cross-workspace id yields
     * `404 list.not_found` (no cross-tenant existence oracle). When `position`
     * is omitted the status is appended to the end of the list. A duplicate name
     * within the list (`uq_statuses_scope_name`, case-insensitive) becomes
     * `409 status.duplicate`.
     */
    async createForList(input: CreateStatusInput): Promise<StatusRecord> {
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("statuses.create.list_not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        const position =
            input.position !== undefined
                ? input.position
                : await this.statuses.nextPosition(input.listId);

        try {
            return await this.statuses.create({
                id: fakeId("st"),
                scopeId: input.listId,
                name: input.name,
                statusGroup: input.statusGroup,
                position,
                color: input.color,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "status.duplicate",
                    `A status named "${input.name}" already exists in this list`,
                );
            }
            throw err;
        }
    }

    /**
     * Update a status the caller's workspace owns. The status is resolved within
     * the workspace first (joined through its list's space): a missing or
     * cross-workspace id yields `404 status.not_found` — the write that follows
     * is keyed on the PK alone, so this gate is the sole isolation control. A
     * `name` rename that collides with another status in the same list
     * (`uq_statuses_scope_name`, case-insensitive) becomes `409 status.duplicate`.
     * At least one updatable field is guaranteed present by the controller.
     */
    async updateById(input: UpdateStatusInput): Promise<StatusRecord> {
        const existing = await this.statuses.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!existing) {
            this.logger.debug("statuses.update.not_found", {
                statusId: input.id,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "status.not_found",
                `Status ${input.id} does not exist`,
            );
        }

        let updated: StatusRecord | null;
        try {
            updated = await this.statuses.update(input.id, {
                name: input.name,
                color: input.color,
                statusGroup: input.statusGroup,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "status.duplicate",
                    `A status named "${input.name}" already exists in this list`,
                );
            }
            throw err;
        }

        if (!updated) {
            // The row vanished between the isolation gate and the write (a
            // concurrent delete) — surface a 404, not a 500.
            throw AppError.notFound(
                "status.not_found",
                `Status ${input.id} does not exist`,
            );
        }
        return updated;
    }

    /**
     * Delete a status the caller's workspace owns. Resolved within the workspace
     * first (joined through its list's space): a missing or cross-workspace id
     * yields `404 status.not_found` — no cross-tenant existence oracle.
     *
     * Two refusals protect data and the Board view's per-group invariant, checked
     * inside one transaction that holds a `FOR UPDATE` lock on the target's group:
     *
     *   - `409 status.in_use` — any task still references the status. Checked up
     *     front via `countTasksUsingStatus`; the `fk_tasks_status` `ON DELETE
     *     RESTRICT` constraint is the race-safe backstop if a task is inserted
     *     between the check and the delete.
     *   - `422 status.last_in_group` — it is the only status left in its
     *     `status_group`. Every list must keep ≥1 status per group so the Board
     *     view renders. The group lock makes this race-safe: two parallel deletes
     *     of the last two statuses in a group can never both pass.
     *
     * Precedence: `in_use` (409) is evaluated before `last_in_group` (422) — the
     * 409 is the headline rule in both API_DESIGN.md §7 and api-endpoints/07.
     */
    async deleteById(input: DeleteStatusInput): Promise<void> {
        const existing = await this.statuses.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!existing) {
            this.logger.debug("statuses.delete.not_found", {
                statusId: input.id,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "status.not_found",
                `Status ${input.id} does not exist`,
            );
        }

        await this.db.transaction(async (tx) => {
            // Lock every status in the target's group so concurrent deletes
            // within the same group serialize (race-safe last-in-group guard).
            const groupIds = await this.statuses.lockGroupStatusIds(
                existing.scopeId,
                existing.statusGroup,
                tx,
            );

            // Re-confirm the row still exists under the lock — a concurrent
            // delete may have removed it after the isolation gate above.
            if (!groupIds.includes(input.id)) {
                throw AppError.notFound(
                    "status.not_found",
                    `Status ${input.id} does not exist`,
                );
            }

            // 409 — a task still points at this status. Caller must move tasks.
            const taskCount = await this.statuses.countTasksUsingStatus(
                input.id,
                tx,
            );
            if (taskCount > 0) {
                throw AppError.conflict(
                    "status.in_use",
                    `Status ${input.id} is still used by ${taskCount} task(s); move them to another status first`,
                );
            }

            // 422 — refuse to empty a status_group (Board view needs ≥1 per group).
            if (groupIds.length <= 1) {
                throw AppError.unprocessable(
                    "status.last_in_group",
                    `Cannot delete the last "${existing.statusGroup}" status of this list`,
                );
            }

            try {
                const affected = await this.statuses.deleteById(input.id, tx);
                if (affected === 0) {
                    throw AppError.notFound(
                        "status.not_found",
                        `Status ${input.id} does not exist`,
                    );
                }
            } catch (err) {
                if (isReferencedError(err)) {
                    // A task referencing the status raced in after the pre-check;
                    // the FK RESTRICT rejected the delete.
                    throw AppError.conflict(
                        "status.in_use",
                        `Status ${input.id} is still used by a task; move it to another status first`,
                    );
                }
                throw err;
            }
        });

        this.logger.info("statuses.delete.ok", {
            statusId: input.id,
            workspaceId: input.workspaceId,
        });
    }

    /**
     * Bulk-reposition a list's statuses. The list is resolved within the
     * workspace first: a missing or cross-workspace id yields `404 list.not_found`
     * (no cross-tenant existence oracle).
     *
     * All writes happen in one transaction holding a `FOR UPDATE` lock on the
     * list's statuses, so concurrent reorders serialize and the membership check
     * is race-safe. Every supplied id MUST be a status in THIS list — an id from
     * another list (or workspace), or one a concurrent delete just removed, yields
     * `404 status.not_found` and rolls back the whole batch (no partial reorder).
     *
     * The body may be a partial subset of the list's statuses; unlisted statuses
     * keep their current position. `position` carries no uniqueness constraint, so
     * duplicate positions are permitted — the read path tie-breaks by id. Returns
     * the full list reordered (by position, then id), matching the GET shape.
     */
    async reorderForList(
        input: ReorderStatusesInput,
    ): Promise<StatusRecord[]> {
        const list = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("statuses.reorder.list_not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        return this.db.transaction(async (tx) => {
            const owned = new Set(
                await this.statuses.lockListStatusIds(input.listId, tx),
            );

            // Validate the whole batch BEFORE any write — all-or-nothing.
            for (const item of input.items) {
                if (!owned.has(item.id)) {
                    throw AppError.notFound(
                        "status.not_found",
                        `Status ${item.id} is not part of list ${input.listId}`,
                    );
                }
            }

            for (const item of input.items) {
                await this.statuses.updatePosition(item.id, item.position, tx);
            }

            this.logger.info("statuses.reorder.ok", {
                listId: input.listId,
                workspaceId: input.workspaceId,
                count: input.items.length,
            });

            return this.statuses.listByList(input.listId, tx);
        });
    }
}
