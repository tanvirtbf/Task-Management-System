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
import { assertCan, entryFor, type PermissionContext } from "./can";
import type { PermissionKey } from "./catalog";
import { currentActor } from "./context";

/**
 * Enforce a grant's scope against a resolved resource. Throws the taxonomy 403
 * (`task.forbidden` etc., reason `not_own` / `out_of_scope`) when the actor
 * holds the key but their grant does not reach this resource.
 */
export const assertScoped = async (
    permissionKey: PermissionKey,
    ctx: PermissionContext,
): Promise<void> => {
    const actor = await currentActor();
    if (!actor || actor.kind !== "user") return;
    assertCan(actor, permissionKey, ctx);
};

/**
 * True when the actor's grant for `key` reaches everywhere (`all`) — or when
 * there is no user actor to narrow. Callers use this to SKIP the queries that
 * build a `PermissionContext` (space lookup, assignee list): every seeded role
 * holds every granted key at scope `all`, so the hot path pays nothing for F8.
 */
export const hasFullReach = async (key: PermissionKey): Promise<boolean> => {
    const actor = await currentActor();
    if (!actor || actor.kind !== "user") return true;
    return entryFor(actor, key).all;
};

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
export const liveLegacyRole = async (fallback: string): Promise<string> => {
    const actor = await currentActor();
    return actor?.kind === "user" ? actor.legacyRole : fallback;
};
