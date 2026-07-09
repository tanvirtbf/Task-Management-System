import { MySql2Database } from "../db/client";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { ListsRepo, type ListRecord } from "../repositories/ListsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";

/**
 * True when a libsql error is a foreign-key RESTRICT violation
 * (`SQLITE_CONSTRAINT_FOREIGNKEY` / "FOREIGN KEY constraint failed"). Lets
 * `delete` treat a task created concurrently with the hard-delete as `409
 * list.not_empty` — the race-safe backstop behind the `countByPrimaryList`
 * pre-check.
 */
const isForeignKeyConstraintError = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    ((err as { code?: unknown }).code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
        (err instanceof Error &&
            err.message.includes("FOREIGN KEY constraint failed")));

export interface ListBySpaceInput {
    spaceId: string;
    workspaceId: string;
    includeArchived: boolean;
}

export interface CreateListInput {
    workspaceId: string;
    actorId: string;
    spaceId: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isPrivate: boolean;
    /** A task-type id resolved in the caller's workspace, or null for none. */
    defaultTaskTypeId: string | null;
}

export interface ListAllInput {
    workspaceId: string;
    spaceId?: string;
    includeArchived: boolean;
}

export interface GetListInput {
    listId: string;
    workspaceId: string;
}

export interface UpdateListInput {
    listId: string;
    workspaceId: string;
    actorId: string;
    name?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    /** A task-type id, `null` to clear, or `undefined` to leave unchanged. */
    defaultTaskTypeId?: string | null;
    /** Wire field names actually supplied — recorded in the activity context. */
    fields: string[];
}

/**
 * §6 Lists domain logic. Controllers translate HTTP; this service owns the
 * read flow and the workspace-isolation guard.
 */
export class ListService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private spaces: SpacesRepo,
        private lists: ListsRepo,
        private statuses: StatusesRepo,
        private taskTypes: TaskTypesRepo,
        private tasks: TasksRepo,
        private activity: WorkspaceActivityRepo,
        private logger: Logger,
    ) {}

    /**
     * Create a list in a space the caller's workspace owns, seed its default
     * status workflow, and record the `created` activity — all in one
     * transaction (all-or-nothing).
     *
     * Guards, in order (each before any write, so a rejected request leaves no
     * partial state):
     *   - `404 space.not_found` — the space is missing or in another workspace
     *     (no cross-tenant existence oracle).
     *   - `409 space.archived` — the parent space is soft-deleted; a new active
     *     list under an archived container would break the cascade-archive
     *     invariant, so creation is refused.
     *   - `422 list.invalid_task_type` — a non-null `default_task_type_id` that
     *     does not resolve in the workspace. Validated INSIDE the tx (a read on
     *     `tx`) so it cannot race with a concurrent task-type delete into an FK
     *     500.
     *
     * `workspace_id` and the actor come from the verified token, never the body.
     * `position` appends to the end of the space; `lists` has no unique
     * constraint on `(space_id, position)` or `(space_id, name)`, so concurrent
     * creates never deadlock or 409 — a position tie is broken deterministically
     * by `id` at read time. The just-inserted row is re-read inside the tx so the
     * response carries the authoritative DB `created_at`, identical to a later GET.
     */
    async create(input: CreateListInput): Promise<ListRecord> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            this.logger.debug("list.create.space_not_found", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (space.archivedAt) {
            this.logger.debug("list.create.space_archived", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw AppError.conflict(
                "space.archived",
                "Cannot create a list in an archived space",
            );
        }

        return this.db.transaction(async (tx) => {
            // Resolve `default_task_type_id` within the tx so a concurrent
            // task-type delete cannot slip between the check and the insert and
            // turn the FK into a 500.
            if (input.defaultTaskTypeId !== null) {
                const taskType = await this.taskTypes.findByIdInWorkspace(
                    input.defaultTaskTypeId,
                    input.workspaceId,
                    tx,
                );
                if (!taskType) {
                    throw AppError.unprocessable(
                        "list.invalid_task_type",
                        "default_task_type_id is not a task type in this workspace",
                        [
                            {
                                field: "default_task_type_id",
                                issue: `${input.defaultTaskTypeId} is not a task type in this workspace`,
                            },
                        ],
                    );
                }
            }

            const position = await this.lists.nextPosition(input.spaceId, tx);
            const id = await this.lists.insert(
                {
                    spaceId: input.spaceId,
                    name: input.name,
                    description: input.description,
                    icon: input.icon,
                    color: input.color,
                    isPrivate: input.isPrivate,
                    position,
                    defaultTaskTypeId: input.defaultTaskTypeId,
                    createdBy: input.actorId,
                },
                tx,
            );

            // §6: every new list opens with the 5 default statuses.
            await this.statuses.seedDefaultsForList(id, tx);

            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "list",
                    entityId: id,
                    action: "created",
                    context: { name: input.name, space_id: input.spaceId },
                },
                tx,
            );

            const list = await this.lists.findRecordByIdInWorkspace(
                id,
                input.workspaceId,
                tx,
            );
            if (!list) {
                // Unreachable: the row was just inserted in this transaction.
                throw AppError.internal();
            }
            return list;
        });
    }

    /**
     * Return every list in a space the caller's workspace owns. The space is
     * resolved within the workspace first: a missing or cross-workspace id
     * yields `404 space.not_found` — never another workspace's data, and never
     * a misleading empty `200`.
     */
    async listBySpace(input: ListBySpaceInput): Promise<ListRecord[]> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            this.logger.debug("list.list_by_space.space_not_found", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }

        return this.lists.findBySpace(input.spaceId, input.includeArchived);
    }

    /**
     * Every list in the caller's workspace, optionally narrowed to one space.
     * `workspaceId` is always the verified JWT's, never client input, so there
     * is no cross-tenant read path.
     *
     * When a `spaceId` filter is supplied it is resolved within the workspace
     * first: a missing or cross-workspace id yields `404 space.not_found` (same
     * contract as `listBySpace`) rather than a misleading empty `200`. With no
     * `spaceId`, all of the workspace's lists are returned.
     */
    async listAll(input: ListAllInput): Promise<ListRecord[]> {
        if (input.spaceId !== undefined) {
            const space = await this.spaces.findByIdInWorkspace(
                input.spaceId,
                input.workspaceId,
            );
            if (!space) {
                this.logger.debug("list.list_all.space_not_found", {
                    spaceId: input.spaceId,
                    workspaceId: input.workspaceId,
                });
                throw AppError.notFound(
                    "space.not_found",
                    `Space ${input.spaceId} does not exist`,
                );
            }
        }

        return this.lists.listByWorkspace(input.workspaceId, {
            spaceId: input.spaceId,
            includeArchived: input.includeArchived,
        });
    }

    /**
     * Apply a partial update to a list the caller's workspace owns, and record
     * the `updated` activity — atomically.
     *
     * Guards, in order:
     *   - `404 list.not_found` — missing or cross-workspace id (no existence
     *     oracle).
     *   - `409 list.archived` — an archived list is read-only; unarchive it
     *     first. (Mirrors the membership endpoints' archived guard.)
     *   - `422 list.invalid_task_type` — a non-null `default_task_type_id` that
     *     does not resolve in the workspace; validated INSIDE the tx so a
     *     concurrent task-type delete cannot turn the FK into a 500. An explicit
     *     `null` clears the default and skips the lookup.
     *
     * The PK-keyed write is preceded by the workspace-scoped resolve, so it is
     * the sole isolation control. The row is re-read inside the tx for the
     * authoritative wire shape; a `null` there means a concurrent hard-delete
     * removed it between the resolve and the write → `404 list.not_found`.
     * `name` has no unique constraint, so a rename never 409s.
     */
    async update(input: UpdateListInput): Promise<ListRecord> {
        const existing = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!existing) {
            this.logger.debug("list.update.not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }
        if (existing.archivedAt) {
            this.logger.debug("list.update.archived", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.conflict(
                "list.archived",
                "Cannot update an archived list",
            );
        }

        return this.db.transaction(async (tx) => {
            if (
                input.defaultTaskTypeId !== undefined &&
                input.defaultTaskTypeId !== null
            ) {
                const taskType = await this.taskTypes.findByIdInWorkspace(
                    input.defaultTaskTypeId,
                    input.workspaceId,
                    tx,
                );
                if (!taskType) {
                    throw AppError.unprocessable(
                        "list.invalid_task_type",
                        "default_task_type_id is not a task type in this workspace",
                        [
                            {
                                field: "default_task_type_id",
                                issue: `${input.defaultTaskTypeId} is not a task type in this workspace`,
                            },
                        ],
                    );
                }
            }

            await this.lists.update(
                input.listId,
                {
                    name: input.name,
                    description: input.description,
                    icon: input.icon,
                    color: input.color,
                    defaultTaskTypeId: input.defaultTaskTypeId,
                },
                tx,
            );

            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "list",
                    entityId: input.listId,
                    action: "updated",
                    context: { fields: input.fields },
                },
                tx,
            );

            const updated = await this.lists.findRecordByIdInWorkspace(
                input.listId,
                input.workspaceId,
                tx,
            );
            if (!updated) {
                throw AppError.notFound(
                    "list.not_found",
                    `List ${input.listId} does not exist`,
                );
            }
            return updated;
        });
    }

    /**
     * Archive a list the caller's workspace owns (soft-delete). Resolves the id
     * within the workspace first (`404 list.not_found` otherwise — no existence
     * oracle), then flips `archived_at` and records the `archived` activity in
     * one transaction.
     *
     * Idempotent: archiving an already-archived list is a `204` no-op — it writes
     * no second activity row and does not move `archived_at`. The repo's
     * conditional UPDATE is the race-safe arbiter (`affectedRows` gates the
     * activity write), so two concurrent archives produce exactly one activity
     * row. Archiving does NOT cascade to the list's tasks: §6 is silent on a
     * list→task cascade, and tasks own their own archive lifecycle (§10); an
     * archived list simply drops out of the default list views.
     */
    async archive(input: {
        listId: string;
        workspaceId: string;
        actorId: string;
    }): Promise<void> {
        const found = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!found) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        await this.db.transaction(async (tx) => {
            const transitioned = await this.lists.archive(input.listId, tx);
            if (transitioned) {
                await this.activity.record(
                    {
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "list",
                        entityId: input.listId,
                        action: "archived",
                    },
                    tx,
                );
            }
        });
    }

    /**
     * Unarchive a list the caller's workspace owns (reverse of `archive`). Same
     * shape: resolve within the workspace (`404 list.not_found`), then flip
     * `archived_at` back to NULL and record the `unarchived` activity in one
     * transaction. Idempotent — unarchiving a non-archived list is a `204` no-op
     * with no activity row.
     */
    async unarchive(input: {
        listId: string;
        workspaceId: string;
        actorId: string;
    }): Promise<void> {
        const found = await this.lists.findByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!found) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        await this.db.transaction(async (tx) => {
            const transitioned = await this.lists.unarchive(input.listId, tx);
            if (transitioned) {
                await this.activity.record(
                    {
                        workspaceId: input.workspaceId,
                        actorId: input.actorId,
                        entityType: "list",
                        entityId: input.listId,
                        action: "unarchived",
                    },
                    tx,
                );
            }
        });
    }

    /**
     * Hard-delete a list the caller's workspace owns. Per §6 the list must be
     * archived AND empty.
     *
     * Guards, in order (all before any write):
     *   - `404 list.not_found` — missing or cross-workspace id (no oracle).
     *   - `409 list.not_archived` — the list is still active; it must be
     *     archived first (the spec's "must be archived" precondition).
     *   - `409 list.not_empty` — one or more tasks still reference the list.
     *     Counted across ALL archived states because `fk_tasks_list` is `ON
     *     DELETE RESTRICT` (an archived task blocks the delete too); this is
     *     stricter than the §6 prose's "non-archived tasks", but it matches what
     *     the DB enforces and avoids a 500.
     *
     * The teardown (list-scoped statuses → the list row; `forms` cascade) and the
     * `deleted` activity run in one transaction. A task created concurrently
     * between the emptiness check and the delete trips the FK RESTRICT, caught
     * and surfaced as `409 list.not_empty`. If the row is already gone (a
     * concurrent delete won), it is a silent no-op — no second activity row.
     */
    async delete(input: {
        listId: string;
        workspaceId: string;
        actorId: string;
    }): Promise<void> {
        const list = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }
        if (!list.archivedAt) {
            throw AppError.conflict(
                "list.not_archived",
                "A list must be archived before it can be deleted",
            );
        }

        const taskCount = await this.tasks.countByPrimaryList(input.listId);
        if (taskCount > 0) {
            throw AppError.conflict(
                "list.not_empty",
                "Cannot delete a list that still has tasks; move or delete them first",
            );
        }

        await this.db.transaction(async (tx) => {
            let affected: number;
            try {
                affected = await this.lists.hardDelete(input.listId, tx);
            } catch (err) {
                if (isForeignKeyConstraintError(err)) {
                    // A task was created against the list after the count above.
                    throw AppError.conflict(
                        "list.not_empty",
                        "Cannot delete a list that still has tasks; move or delete them first",
                    );
                }
                throw err;
            }

            if (affected === 0) {
                // A concurrent delete already removed it — nothing more to do,
                // and the other deleter owns the activity row.
                return;
            }

            await this.activity.record(
                {
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "list",
                    entityId: input.listId,
                    action: "deleted",
                    context: { name: list.name, space_id: list.spaceId },
                },
                tx,
            );
        });
    }

    /**
     * Read one list by id within the caller's workspace. A missing or
     * cross-workspace id is `404 list.not_found` (never another tenant's list,
     * no existence oracle). Archived lists ARE returned — `archived_at` is
     * soft-delete, and the detail / unarchive flows need to fetch them; the
     * list-only `archived_at IS NULL` filter does not apply to a direct read
     * (mirrors `TasksService.getById`). No transaction — a single-row read needs
     * no cross-table snapshot.
     */
    async getById(input: GetListInput): Promise<ListRecord> {
        const list = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            this.logger.debug("list.get.not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }

        return list;
    }
}
