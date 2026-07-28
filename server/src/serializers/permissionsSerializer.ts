import { entryFor } from "../rbac/can";
import { PERMISSION_KEYS } from "../rbac/catalog";
import type { VisibilityScope } from "../rbac/scope";
import type { ActorPermissions } from "../rbac/types";
import type { WireMyPermissions, WirePermissionEntry } from "../types/rbac";

/**
 * `ActorPermissions` + `VisibilityScope` → the `GET /me/permissions` payload.
 *
 * Two deliberate choices:
 *
 * 1. **The owner is materialised, not flagged.** Rather than making the client
 *    special-case `is_owner`, every key the owner holds (i.e. all of them) is
 *    written out with `all: true`. The client's `can()` is then the same three
 *    lines for everybody — and the one place that could forget the owner floor
 *    stays on the server. `is_owner` is still sent, for the badge.
 * 2. **Only real power is listed.** A permission that grants nothing is
 *    omitted, so `Object.keys(permissions)` is exactly "what this person can
 *    do" and the payload stays small for restricted users.
 */

const toWireEntry = (
    actor: ActorPermissions,
    key: (typeof PERMISSION_KEYS)[number],
): WirePermissionEntry | null => {
    const e = entryFor(actor, key);
    if (
        !e.all &&
        !e.own &&
        e.spaceIds.size === 0 &&
        e.ownSpaceIds.size === 0
    ) {
        return null;
    }
    return {
        all: e.all,
        space_ids: [...e.spaceIds].sort(),
        own: e.own,
        own_space_ids: [...e.ownSpaceIds].sort(),
    };
};

export const toWirePermissions = (
    actor: ActorPermissions,
    scope: VisibilityScope,
): WireMyPermissions => {
    const permissions: Record<string, WirePermissionEntry> = {};
    for (const key of PERMISSION_KEYS) {
        const entry = toWireEntry(actor, key);
        if (entry) permissions[key] = entry;
    }
    return {
        version: actor.version,
        is_owner: actor.isOwner,
        role: actor.legacyRole,
        visible_space_ids:
            scope.kind === "all" ? null : [...scope.spaceIds].sort(),
        permissions,
    };
};
