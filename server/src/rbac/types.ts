// =============================================================================
// RBAC DOMAIN TYPES — the resolved-actor model.
//   Plan: RBAC_DYNAMIC_PLAN.md Part 2.3
//
// These live in `rbac/` rather than inside a service on purpose: the decision
// function `can()` (P7), the `requirePermission` middleware (P11) and the
// repository predicates (P8/P16+) must all be able to reason about an actor
// WITHOUT constructing a `PolicyService`. Only the resolution (DB read +
// cache) needs the service; the decision is pure.
//
// `PolicyService` re-exports everything here, so the P6 import path still
// works.
// =============================================================================

/** What one permission grants this actor, after folding every contribution. */
export interface PermissionEntry {
    /** Anywhere in the workspace. */
    all: boolean;
    /** Full reach inside these spaces. */
    spaceIds: ReadonlySet<string>;
    /** Items the actor created / is assigned to, anywhere. */
    own: boolean;
    /** Items the actor created / is assigned to, but only inside these spaces. */
    ownSpaceIds: ReadonlySet<string>;
}

/**
 * Where an actor came from. Only a `user` actor was resolved from the database
 * — the other two are synthesised for callers that have no session (P9):
 *   `system` — a background job. Bypasses every check (`entryFor`).
 *   `public` — an anonymous public-form submission. Holds a deliberately tiny,
 *              explicit grant set; bypasses nothing.
 */
export type ActorKind = "user" | "system" | "public";

export interface ActorPermissions {
    kind: ActorKind;
    userId: string;
    workspaceId: string;
    /**
     * The workspace owner. Hard-wired to hold every permission (plan D-7): the
     * anti-lockout floor, anchored on the legacy `users.role` column because
     * that is the one value existing in-service rules already protect (the
     * owner's role cannot be changed and the owner cannot be deactivated).
     */
    isOwner: boolean;
    /** Legacy `users.role`, still carried while P11-P15 migrate the gates. */
    legacyRole: string;
    /** `permissions_version` this snapshot was resolved at. */
    version: number;
    perms: ReadonlyMap<string, PermissionEntry>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** An entry that grants nothing — the shape `can()` sees for an absent key. */
export const NO_PERMISSION: PermissionEntry = {
    all: false,
    spaceIds: EMPTY_SET,
    own: false,
    ownSpaceIds: EMPTY_SET,
};
