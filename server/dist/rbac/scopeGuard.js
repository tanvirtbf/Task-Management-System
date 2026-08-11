"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveLegacyRole = exports.assertTaskScoped = exports.hasFullReach = exports.assertScoped = void 0;
// =============================================================================
// SCOPE GUARD — the service-layer half of a permission check (F8 / ISS-047).
//
// `requirePermission` (P11) answers the VERB question at the route: "does this
// actor hold the key anywhere?" It deliberately cannot answer the OBJECT
// question — which space the resolved row lives in, whether the actor created
// or is assigned to it — because no row exists at middleware time. Until F8,
// nothing answered it: a grant narrowed to `own` or a space edited anything the
// visibility layer let it see.
//
// `assertScoped` is that second half, called by write services AFTER they
// resolve the row. It composes with F7's route gates rather than replacing
// them: the route proves the verb, this proves the reach.
//
// Contexts without an HTTP actor pass untouched — background jobs run as the
// system principal, seed/migration code has no user, and the public-form
// submit is anonymous by design. Each of those surfaces has its own boundary
// guard; scope is a statement about a USER's grant, and there is no user.
// =============================================================================
const can_1 = require("./can");
const context_1 = require("./context");
/**
 * Enforce a grant's scope against a resolved resource. Throws the taxonomy 403
 * (`task.forbidden` etc., reason `not_own` / `out_of_scope`) when the actor
 * holds the key but their grant does not reach this resource.
 */
const assertScoped = async (permissionKey, ctx) => {
    const actor = await (0, context_1.currentActor)();
    if (!actor || actor.kind !== "user")
        return;
    (0, can_1.assertCan)(actor, permissionKey, ctx);
};
exports.assertScoped = assertScoped;
/**
 * True when the actor's grant for `key` reaches everywhere (`all`) — or when
 * there is no user actor to narrow. Callers use this to SKIP the queries that
 * build a `PermissionContext` (space lookup, assignee list): every seeded role
 * holds every granted key at scope `all`, so the hot path pays nothing for F8.
 */
const hasFullReach = async (key) => {
    const actor = await (0, context_1.currentActor)();
    if (!actor || actor.kind !== "user")
        return true;
    return (0, can_1.entryFor)(actor, key).all;
};
exports.hasFullReach = hasFullReach;
/**
 * Team-access P7 — THE task-scope guard, unified (G4). Enforce `key`'s reach
 * against one resolved task, with the full context the decision needs:
 *
 *   · the task's SPACE            (space-scoped grants),
 *   · its creator + assignees     ("own" grants — R2.2's assignee rule),
 *   · its space's HEAD            (the head-of-owning-space allow-path: a
 *                                  department head edits their department's
 *                                  work without being assigned to each task).
 *
 * Full-reach grants skip both lookups (every unrestricted role — today's hot
 * path pays nothing). Task-adjacent services (checklists, attachments,
 * custom-field values, dependencies, SLA) call this with `task.edit`:
 * mutating a task's CONTENT is editing the task, whatever the route's verb.
 */
const assertTaskScoped = async (key, task, source) => {
    if (await (0, exports.hasFullReach)(key))
        return;
    const [info, assignees] = await Promise.all([
        source.spaceInfoByTask([task.id]),
        source.assigneesByTask([task.id]),
    ]);
    const spaceInfo = info.get(task.id);
    await (0, exports.assertScoped)(key, {
        spaceId: spaceInfo?.spaceId ?? null,
        spaceHeadUserId: spaceInfo?.headUserId ?? null,
        createdBy: task.createdBy,
        assigneeIds: assignees.get(task.id) ?? [],
    });
};
exports.assertTaskScoped = assertTaskScoped;
/**
 * F10 (ISS-021, D4 = live check): the caller's legacy role AS OF THIS REQUEST.
 *
 * The access token carries a `role` claim frozen at sign time, and the
 * service-level gates used to trust it — so an admin demoted to member kept
 * admin powers on those gates for up to 15 minutes. The RBAC resolver already
 * reads the live user row on every authenticated request (`getActorContext`,
 * version-cached), so the fresh role is ALREADY PAID FOR — this just hands it
 * to the gates. Falls back to the JWT claim when there is no user actor
 * (background jobs, direct-service unit tests), where staleness cannot exist.
 */
const liveLegacyRole = async (fallback) => {
    const actor = await (0, context_1.currentActor)();
    return actor?.kind === "user" ? actor.legacyRole : fallback;
};
exports.liveLegacyRole = liveLegacyRole;
