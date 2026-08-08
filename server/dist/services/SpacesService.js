"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpacesService = void 0;
const errors_1 = require("../errors");
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
/**
 * §5 Spaces business logic. The read paths are single workspace-scoped reads;
 * `create` owns the transaction that pairs the space insert with its
 * `workspace_activity` audit row.
 */
class SpacesService {
    db;
    spaces;
    lists;
    activity;
    users;
    logger;
    constructor(db, spaces, lists, activity, users, logger) {
        this.db = db;
        this.spaces = spaces;
        this.lists = lists;
        this.activity = activity;
        this.users = users;
        this.logger = logger;
    }
    /**
     * Attach the hydrated `head` user to space rows (Dept Review V1). One
     * batched `findManyByIdsInWorkspace` for ALL distinct head ids — never a
     * per-row lookup (anti-N+1). A head id that no longer resolves in the
     * workspace hydrates as null (defensive; cannot happen through the
     * validated write path).
     */
    async hydrateHeads(rows, workspaceId) {
        const headIds = [
            ...new Set(rows.flatMap((r) => (r.headUserId ? [r.headUserId] : []))),
        ];
        const heads = headIds.length
            ? await this.users.findManyByIdsInWorkspace(headIds, workspaceId)
            : [];
        const byId = new Map(heads.map((u) => [u.id, u]));
        return rows.map((r) => ({
            ...r,
            head: r.headUserId ? (byId.get(r.headUserId) ?? null) : null,
        }));
    }
    /**
     * List the spaces in a workspace. The `workspaceId` always comes from the
     * caller's verified JWT (`req.auth.workspaceId`) — never from client input
     * — so there is no cross-tenant read path.
     */
    async listSpaces(input) {
        const rows = await this.spaces.listByWorkspace(input.workspaceId, {
            includeArchived: input.includeArchived,
        });
        return this.hydrateHeads(rows, input.workspaceId);
    }
    /**
     * Read a single space within the caller's workspace. A missing or
     * cross-workspace id both resolve to `404 space.not_found` — the repo
     * scopes by `workspace_id`, so there is no cross-tenant existence oracle.
     * An archived space still exists and is returned (200), not 404.
     */
    async getSpace(input) {
        const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!space) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        const [withHead] = await this.hydrateHeads([space], input.workspaceId);
        return withHead;
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
    async create(input) {
        // F18 (ISS-032): the SAME head rule PATCH has always applied. POST used
        // to perform none of the checks and silently drop whatever it could
        // not use — 201, head_user_id NULL, no error. Same permission too:
        // installing a head at create time is as much a head-assignment act as
        // installing one later (F7 made `space.head_assign` real on PATCH; a
        // create-time bypass would undo that).
        if (input.headUserId !== undefined && input.headUserId !== null) {
            (0, can_1.assertCan)(await (0, context_1.currentActor)(), "space.head_assign", {});
            await this.assertValidHead(input.headUserId, input.workspaceId);
        }
        const created = await this.withDuplicateName(input.name, () => this.db.transaction(async (tx) => {
            const id = await this.spaces.insert({
                workspaceId: input.workspaceId,
                name: input.name,
                description: input.description,
                icon: input.icon,
                color: input.color,
                isPrivate: input.isPrivate,
                position: input.position,
                createdBy: input.actorId,
                headUserId: input.headUserId ?? null,
            }, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: id,
                action: "created",
                context: { name: input.name },
            }, tx);
            const space = await this.spaces.findByIdInWorkspace(id, input.workspaceId, tx);
            if (!space) {
                // Unreachable: the row was just inserted in this transaction.
                // The guard only satisfies the `SpaceRecord | null` return type.
                throw errors_1.AppError.internal();
            }
            return space;
        }));
        // F18 made the head settable at create — hydrate it like every read.
        const [withHead] = await this.hydrateHeads([created], input.workspaceId);
        return withHead;
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
    async update(input) {
        const existing = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        // F7: `space.head_assign` finally gates something. The route carries
        // `space.edit` (general edits, unchanged); changing WHO HEADS the
        // department additionally requires this grant — body-conditional, so
        // it must live here, not in route middleware. Closes the F6 finding
        // that the key existed in catalog+seed and was checked nowhere.
        // Covers set, change AND clear (null) — removing a head is as much a
        // head-assignment act as installing one.
        if (input.fields.headUserId !== undefined) {
            (0, can_1.assertCan)(await (0, context_1.currentActor)(), "space.head_assign", {
                spaceId: existing.id,
            });
        }
        // F22 (ISS-034): archived means FROZEN, the way lists already work
        // (POST /lists into an archived space was always 409). Renaming or
        // re-heading an archived space silently mutated a thing the workspace
        // considers put away. Unarchive first.
        if (existing.archivedAt) {
            throw errors_1.AppError.conflict("space.archived", "This space is archived — unarchive it before editing");
        }
        // Dept Review V1 — validate a non-null head BEFORE the write. Shared
        // with `create()` since F18 (ISS-032): the two paths used to disagree,
        // with POST silently dropping the very value PATCH refuses.
        if (input.fields.headUserId !== undefined) {
            await this.assertValidHead(input.fields.headUserId, input.workspaceId);
        }
        const changedFields = Object.keys(input.fields);
        if (changedFields.length === 0) {
            const [withHead] = await this.hydrateHeads([existing], input.workspaceId);
            return withHead;
        }
        const updatedRow = await this.withDuplicateName(input.fields.name, () => this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            await this.spaces.updateFields(input.spaceId, input.fields, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "updated",
                context: { fields: changedFields },
            }, tx);
            const updated = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId, tx);
            if (!updated) {
                // Unreachable: the row was locked in this transaction.
                throw errors_1.AppError.internal();
            }
            return updated;
        }));
        const [withHead] = await this.hydrateHeads([updatedRow], input.workspaceId);
        return withHead;
    }
    /**
     * F27 (ISS-033): run a write and translate the new
     * `uq_spaces_workspace_name` violation into the spec's 409. The index —
     * not an application pre-check — is what makes this race-free, exactly as
     * TagService has always done it.
     */
    async withDuplicateName(name, run) {
        try {
            return await run();
        }
        catch (err) {
            const e = err;
            if (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) {
                throw errors_1.AppError.conflict("space.duplicate", `A space called "${name}" already exists in this workspace`);
            }
            throw err;
        }
    }
    /**
     * A non-null department head must be an existing user of THIS workspace,
     * active, and not a guest. All three failures are 422 `space.head_invalid`
     * — bad input, not a missing resource (and no cross-tenant existence
     * oracle: a foreign user id reads as unknown). One rule, both write paths
     * (F18 / ISS-032 — POST used to silently drop what PATCH refuses).
     */
    async assertValidHead(headUserId, workspaceId) {
        if (headUserId === null)
            return; // clear — nothing to validate
        const head = await this.users.findByIdInWorkspace(headUserId, workspaceId);
        if (!head) {
            throw errors_1.AppError.unprocessable("space.head_invalid", "head_user_id must be an existing user in this workspace", [{ field: "head_user_id", issue: "unknown user" }]);
        }
        if (head.status !== "active") {
            throw errors_1.AppError.unprocessable("space.head_invalid", "head_user_id must be an active user", [{ field: "head_user_id", issue: "user is not active" }]);
        }
        if (head.role === "guest") {
            throw errors_1.AppError.unprocessable("space.head_invalid", "A guest cannot be a department head", [{ field: "head_user_id", issue: "guests cannot be heads" }]);
        }
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
    async archive(input) {
        const existing = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        if (existing.archivedAt) {
            return; // already archived — idempotent no-op
        }
        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId, tx);
            if (!locked || locked.archivedAt) {
                return; // raced with another archive/delete — nothing to do
            }
            const now = new Date();
            const listsArchived = await this.lists.countNonArchivedBySpace(input.spaceId, tx);
            await this.spaces.setArchivedAt(input.spaceId, now, tx);
            await this.lists.archiveAllBySpace(input.spaceId, now, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "archived",
                context: {
                    name: locked.name,
                    lists_archived: listsArchived,
                },
            }, tx);
        });
    }
    /**
     * Unarchive (restore) a space within the caller's workspace. A missing or
     * cross-workspace id is `404 space.not_found`. Idempotent: a space that is
     * not archived is a no-op (no activity row). Otherwise the row is locked,
     * re-checked under the lock, its `archived_at` cleared, and an `unarchived`
     * activity row appended — in one transaction.
     *
     * F16 (ISS-041): unarchive now RESTORES the lists the matching archive
     * cascaded — and only those. The old note here argued that restoring was
     * impossible without wrongly resurrecting independently-archived lists;
     * that concern is real, but the archive cascade already leaves the
     * discriminator behind: it stamps every list with the SAME instant the
     * space gets, and skips lists that were already archived. Restoring
     * `archived_at = <the space's archivedAt>` is therefore the exact inverse.
     * Without it the space came back EMPTY — P8 archived Marketing for two
     * seconds and its three boards were invisible for ninety minutes.
     */
    async unarchive(input) {
        const existing = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        if (!existing.archivedAt) {
            return; // not archived — idempotent no-op
        }
        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId, tx);
            if (!locked || !locked.archivedAt) {
                return; // raced with another unarchive — already restored
            }
            // F16 (ISS-041): bring back what the archive cascade took down,
            // BEFORE clearing the space's own stamp (the equality needs it).
            const listsRestored = await this.lists.unarchiveBySpaceArchivedAt(input.spaceId, locked.archivedAt, tx);
            await this.spaces.setArchivedAt(input.spaceId, null, tx);
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "unarchived",
                context: { name: locked.name, lists_restored: listsRestored },
            }, tx);
        });
    }
    /**
     * Hard-delete a space within the caller's workspace (🛡️ owner-only at the
     * route). Preconditions, each with its own status:
     *   - absent / cross-workspace id → `404 space.not_found`.
     *   - not archived → `409 space.not_archived` (05-spaces.md: "must be archived").
     *   - still holds ANY list → `409 space.not_empty`.
     *   - has department_reports → `409 space.has_reports` (Dept Review V1:
     *     reports are retained HR history, backed by an ON DELETE RESTRICT FK —
     *     archive the space instead).
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
    async remove(input) {
        const existing = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        if (!existing.archivedAt) {
            throw errors_1.AppError.conflict("space.not_archived", "Space must be archived before it can be deleted");
        }
        if ((await this.lists.countBySpace(input.spaceId)) > 0) {
            throw errors_1.AppError.conflict("space.not_empty", "Space still has lists; delete them before deleting the space");
        }
        if ((await this.spaces.countReportsBySpace(input.spaceId)) > 0) {
            throw errors_1.AppError.conflict("space.has_reports", "Space has department reports (retained HR history); archive it instead of deleting");
        }
        await this.db.transaction(async (tx) => {
            await this.spaces.lockById(input.spaceId, tx);
            const locked = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId, tx);
            if (!locked) {
                return; // concurrently deleted — idempotent
            }
            if (!locked.archivedAt) {
                throw errors_1.AppError.conflict("space.not_archived", "Space must be archived before it can be deleted");
            }
            if ((await this.lists.countBySpace(input.spaceId, tx)) > 0) {
                throw errors_1.AppError.conflict("space.not_empty", "Space still has lists; delete them before deleting the space");
            }
            if ((await this.spaces.countReportsBySpace(input.spaceId, tx)) > 0) {
                throw errors_1.AppError.conflict("space.has_reports", "Space has department reports (retained HR history); archive it instead of deleting");
            }
            await this.activity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "space",
                entityId: input.spaceId,
                action: "deleted",
                context: { name: locked.name },
            }, tx);
            await this.spaces.deleteById(input.spaceId, tx);
        });
    }
}
exports.SpacesService = SpacesService;
