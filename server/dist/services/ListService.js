"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListService = void 0;
const errors_1 = require("../errors");
/**
 * True when a mysql2 error is a foreign-key RESTRICT violation (errno 1451 /
 * `ER_ROW_IS_REFERENCED_2`). Lets `delete` treat a task created concurrently
 * with the hard-delete as `409 list.not_empty` — the race-safe backstop behind
 * the `countByPrimaryList` pre-check.
 */
const isForeignKeyConstraintError = (err) => typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "ER_ROW_IS_REFERENCED_2" ||
        err.code === "ER_ROW_IS_REFERENCED");
/**
 * §6 Lists domain logic. Controllers translate HTTP; this service owns the
 * read flow and the workspace-isolation guard.
 */
/** mysql2 surfaces a unique-violation as `ER_DUP_ENTRY` / errno 1062. */
const isDuplicateKeyError = (err) => {
    const e = err;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};
class ListService {
    db;
    spaces;
    lists;
    statuses;
    taskTypes;
    tasks;
    activity;
    logger;
    constructor(db, spaces, lists, statuses, taskTypes, tasks, activity, logger) {
        this.db = db;
        this.spaces = spaces;
        this.lists = lists;
        this.statuses = statuses;
        this.taskTypes = taskTypes;
        this.tasks = tasks;
        this.activity = activity;
        this.logger = logger;
    }
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
    /**
     * F27 (ISS-035): translate the new `uq_lists_space_name` violation into
     * the spec's 409. Two lists with the same name inside one space rendered
     * as identical children in the sidebar tree with nothing to tell them
     * apart — the same trap as ISS-033, one level deeper. The INDEX is what
     * makes this race-free; this only names the error.
     */
    async withDuplicateName(name, run) {
        try {
            return await run();
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("list.duplicate", `A list called "${name}" already exists in this space`);
            }
            throw err;
        }
    }
    async create(input) {
        const nameForConflict = input.name;
        const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!space) {
            this.logger.debug("list.create.space_not_found", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        if (space.archivedAt) {
            this.logger.debug("list.create.space_archived", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.conflict("space.archived", "Cannot create a list in an archived space");
        }
        return this.withDuplicateName(nameForConflict, () => this.db.transaction(async (tx) => {
            // Resolve `default_task_type_id` within the tx so a concurrent
            // task-type delete cannot slip between the check and the insert and
            // turn the FK into a 500.
            if (input.defaultTaskTypeId !== null) {
                const taskType = await this.taskTypes.findByIdInWorkspace(input.defaultTaskTypeId, input.workspaceId, tx);
                if (!taskType) {
                    throw errors_1.AppError.unprocessable("list.invalid_task_type", "default_task_type_id is not a task type in this workspace", [
                        {
                            field: "default_task_type_id",
                            issue: `${input.defaultTaskTypeId} is not a task type in this workspace`,
                        },
                    ]);
                }
            }
            const position = await this.lists.nextPosition(input.spaceId, tx);
            const id = await this.lists.insert({
                spaceId: input.spaceId,
                name: input.name,
                description: input.description,
                icon: input.icon,
                color: input.color,
                isPrivate: input.isPrivate,
                position,
                defaultTaskTypeId: input.defaultTaskTypeId,
                createdBy: input.actorId,
            }, tx);
            // §6: every new list opens with the 5 default statuses.
            await this.statuses.seedDefaultsForList(id, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "list",
                entityId: id,
                action: "created",
                context: { name: input.name, space_id: input.spaceId },
            }, tx);
            const list = await this.lists.findRecordByIdInWorkspace(id, input.workspaceId, tx);
            if (!list) {
                // Unreachable: the row was just inserted in this transaction.
                throw errors_1.AppError.internal();
            }
            return list;
        }));
    }
    /**
     * Return every list in a space the caller's workspace owns. The space is
     * resolved within the workspace first: a missing or cross-workspace id
     * yields `404 space.not_found` — never another workspace's data, and never
     * a misleading empty `200`.
     */
    async listBySpace(input) {
        const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!space) {
            this.logger.debug("list.list_by_space.space_not_found", {
                spaceId: input.spaceId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
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
    async listAll(input) {
        if (input.spaceId !== undefined) {
            const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
            if (!space) {
                this.logger.debug("list.list_all.space_not_found", {
                    spaceId: input.spaceId,
                    workspaceId: input.workspaceId,
                });
                throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
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
    async update(input) {
        const nameForConflict = input.name;
        const existing = await this.lists.findRecordByIdInWorkspace(input.listId, input.workspaceId);
        if (!existing) {
            this.logger.debug("list.update.not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        if (existing.archivedAt) {
            this.logger.debug("list.update.archived", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.conflict("list.archived", "Cannot update an archived list");
        }
        return this.withDuplicateName(nameForConflict, () => this.db.transaction(async (tx) => {
            if (input.defaultTaskTypeId !== undefined &&
                input.defaultTaskTypeId !== null) {
                const taskType = await this.taskTypes.findByIdInWorkspace(input.defaultTaskTypeId, input.workspaceId, tx);
                if (!taskType) {
                    throw errors_1.AppError.unprocessable("list.invalid_task_type", "default_task_type_id is not a task type in this workspace", [
                        {
                            field: "default_task_type_id",
                            issue: `${input.defaultTaskTypeId} is not a task type in this workspace`,
                        },
                    ]);
                }
            }
            /**
             * F28 (ISS-036, decision D12.7) — the MOVE.
             *
             * Guards, in the order a caller meets them:
             *   404 `space.not_found` — unknown, or in another workspace (the
             *       same non-oracle shape `create` uses)
             *   409 `space.archived`  — a live list may not land in an archived
             *       space; it would vanish from the tree
             *   409 `list.duplicate`  — F27 added `uq_lists_space_name`, so the
             *       target space may already hold this name. Checked here for a
             *       clear message; `withDuplicateName` around the transaction is
             *       still the race-safe arbiter.
             *
             * A move to the space the list is already in is a no-op, not an
             * error — re-sending the current value is how PATCH clients behave.
             *
             * ⚠️ VISIBILITY MOVES WITH IT. Reach in this product is space-scoped
             * (`rbac/scope.ts`), so relocating a list changes WHO CAN SEE ITS
             * TASKS. That is the feature rather than a side effect, but it is
             * the kind of thing that surprises someone, so it is documented on
             * the endpoint and recorded in the activity context below.
             */
            if (input.spaceId !== undefined &&
                input.spaceId !== existing.spaceId) {
                const target = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId, tx);
                if (!target) {
                    throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
                }
                if (target.archivedAt) {
                    throw errors_1.AppError.conflict("space.archived", "Cannot move a list into an archived space");
                }
                const clash = await this.lists.findByNameInSpace(input.spaceId, input.name ?? existing.name, tx);
                if (clash && clash.id !== input.listId) {
                    throw errors_1.AppError.conflict("list.duplicate", `That space already has a list named "${input.name ?? existing.name}"`);
                }
            }
            await this.lists.update(input.listId, {
                name: input.name,
                description: input.description,
                icon: input.icon,
                color: input.color,
                defaultTaskTypeId: input.defaultTaskTypeId,
                spaceId: input.spaceId,
            }, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "list",
                entityId: input.listId,
                action: "updated",
                context: { fields: input.fields },
            }, tx);
            const updated = await this.lists.findRecordByIdInWorkspace(input.listId, input.workspaceId, tx);
            if (!updated) {
                throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
            }
            return updated;
        }));
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
    async archive(input) {
        const found = await this.lists.findByIdInWorkspace(input.listId, input.workspaceId);
        if (!found) {
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        await this.db.transaction(async (tx) => {
            const transitioned = await this.lists.archive(input.listId, tx);
            if (transitioned) {
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "list",
                    entityId: input.listId,
                    action: "archived",
                }, tx);
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
    async unarchive(input) {
        const found = await this.lists.findByIdInWorkspace(input.listId, input.workspaceId);
        if (!found) {
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        await this.db.transaction(async (tx) => {
            const transitioned = await this.lists.unarchive(input.listId, tx);
            if (transitioned) {
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "list",
                    entityId: input.listId,
                    action: "unarchived",
                }, tx);
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
    async delete(input) {
        const list = await this.lists.findRecordByIdInWorkspace(input.listId, input.workspaceId);
        if (!list) {
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        if (!list.archivedAt) {
            throw errors_1.AppError.conflict("list.not_archived", "A list must be archived before it can be deleted");
        }
        const taskCount = await this.tasks.countByPrimaryList(input.listId);
        if (taskCount > 0) {
            throw errors_1.AppError.conflict("list.not_empty", "Cannot delete a list that still has tasks; move or delete them first");
        }
        await this.db.transaction(async (tx) => {
            let affected;
            try {
                affected = await this.lists.hardDelete(input.listId, tx);
            }
            catch (err) {
                if (isForeignKeyConstraintError(err)) {
                    // A task was created against the list after the count above.
                    throw errors_1.AppError.conflict("list.not_empty", "Cannot delete a list that still has tasks; move or delete them first");
                }
                throw err;
            }
            if (affected === 0) {
                // A concurrent delete already removed it — nothing more to do,
                // and the other deleter owns the activity row.
                return;
            }
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "list",
                entityId: input.listId,
                action: "deleted",
                context: { name: list.name, space_id: list.spaceId },
            }, tx);
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
    async getById(input) {
        const list = await this.lists.findRecordByIdInWorkspace(input.listId, input.workspaceId);
        if (!list) {
            this.logger.debug("list.get.not_found", {
                listId: input.listId,
                workspaceId: input.workspaceId,
            });
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        return list;
    }
}
exports.ListService = ListService;
