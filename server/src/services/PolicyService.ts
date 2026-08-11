import type { Logger } from "winston";
import type { UserRolesRepo } from "../repositories/UserRolesRepo";
import type { EffectiveGrantRow } from "../repositories/UserRolesRepo";
import type { PermissionKey } from "../rbac/catalog";
import {
    assertCan,
    assertHolds,
    can,
    decide,
    entryFor,
    holds,
    type Decision,
    type PermissionContext,
} from "../rbac/can";
import { NO_PERMISSION } from "../rbac/types";
import type { ActorPermissions, PermissionEntry } from "../rbac/types";
import { materialiseScope } from "../rbac/scope";
import type { ListScopeSource, VisibilityScope } from "../rbac/scope";
import { elevateToSpaces } from "../rbac/principals";
import type { ElevationReason, Principal } from "../rbac/principals";

/**
 * POLICY RESOLUTION — turns a user's raw grant rows into an effective
 * permission set, and caches it so revocation is instant.
 *   Plan: RBAC_DYNAMIC_PLAN.md P6 · Scope rules: `src/rbac/bootstrap.ts` header
 *
 * ── HOW A GRANT BECOMES AN EFFECTIVE PERMISSION ─────────────────────────────
 * Each row is one (permission, grant-scope) from a role the user holds, plus
 * the scope of the ASSIGNMENT that gave them that role. The effective reach is
 * the NARROWER of the two — a space-scoped assignment can never grant power
 * outside its space (the escalation guard):
 *
 *   assignment=workspace + grant 'all'    → all         (everywhere)
 *   assignment=workspace + grant 'space'  → nothing     (an explicit space
 *                                            assignment is what 'space' means)
 *   assignment=workspace + grant 'own'    → own         (own items, anywhere)
 *   assignment=space(S)  + grant 'all'    → space {S}   (DOWNGRADED)
 *   assignment=space(S)  + grant 'space'  → space {S}
 *   assignment=space(S)  + grant 'own'    → ownSpace {S}
 *
 * A user may hold several roles; contributions UNION (allow wins — there is no
 * explicit deny, plan D-4). `all` absorbs everything; workspace-wide `own`
 * absorbs any `ownSpace`.
 *
 * ── THE CACHE ────────────────────────────────────────────────────────────────
 * Keyed by `(userId, permissions_version)`. Every RBAC mutation bumps
 * `workspaces.permissions_version` (see `RolesRepo.bumpPermissionsVersion`), so
 * a cached entry is invalidated the moment anything changes — which is what
 * removes the ~15-minute stale-role window of the JWT-carried role. A cache hit
 * costs exactly ONE indexed query (the version + legacy role lookup); a miss
 * costs two.
 *
 * The cache is per-process and holds no secrets — it is a read-through of data
 * the user is already entitled to see about themselves.
 *
 * ── WHERE THE DECISION LIVES ────────────────────────────────────────────────
 * This class RESOLVES; it does not decide. `can()` / `assertCan()` and the 403
 * taxonomy are pure functions in `src/rbac/can.ts` (P7) — the methods at the
 * bottom of this class are one-line delegations so a service that already
 * holds a `PolicyService` does not need a second import.
 */

// The actor model itself lives in `rbac/types.ts` so that `can()` and the
// repository predicates stay free of any service dependency. Re-exported here
// because this is where callers expect to find it.
export { NO_PERMISSION };
export type { ActorPermissions, PermissionEntry };

const EMPTY_SET: ReadonlySet<string> = new Set();

interface MutableEntry {
    all: boolean;
    spaceIds: Set<string>;
    own: boolean;
    ownSpaceIds: Set<string>;
}

/**
 * Fold raw grant rows into the effective permission map. Pure — exported so it
 * can be unit-tested without a database.
 */
export const foldGrants = (
    rows: readonly EffectiveGrantRow[],
): Map<string, PermissionEntry> => {
    const acc = new Map<string, MutableEntry>();
    const entryFor = (key: string): MutableEntry => {
        let e = acc.get(key);
        if (!e) {
            e = {
                all: false,
                spaceIds: new Set(),
                own: false,
                ownSpaceIds: new Set(),
            };
            acc.set(key, e);
        }
        return e;
    };

    for (const row of rows) {
        const spaceScoped = row.assignmentScopeType === "space";
        const spaceId = row.assignmentScopeId;
        // Defensive: a 'space' assignment without an id cannot grant anything.
        if (spaceScoped && !spaceId) continue;

        const e = entryFor(row.permissionKey);
        if (!spaceScoped) {
            switch (row.grantScope) {
                case "all":
                    e.all = true;
                    break;
                case "own":
                    e.own = true;
                    break;
                case "space":
                    // A workspace-wide assignment of a space-scoped grant
                    // reaches no space — the admin UI warns about this combo.
                    break;
            }
            continue;
        }

        // Space-scoped assignment: everything is clamped to that space.
        switch (row.grantScope) {
            case "all":
            case "space":
                e.spaceIds.add(spaceId as string);
                break;
            case "own":
                e.ownSpaceIds.add(spaceId as string);
                break;
        }
    }

    // Normalise: broader forms absorb narrower ones, so `can()` stays trivial.
    const out = new Map<string, PermissionEntry>();
    for (const [key, e] of acc) {
        const all = e.all;
        const own = e.own;
        const entry: PermissionEntry = {
            all,
            spaceIds: all ? EMPTY_SET : e.spaceIds,
            own,
            ownSpaceIds: all || own ? EMPTY_SET : e.ownSpaceIds,
        };
        // Drop entries that ended up granting nothing (e.g. workspace-wide
        // assignment of a 'space' grant) so the map only holds real power.
        if (
            entry.all ||
            entry.own ||
            entry.spaceIds.size > 0 ||
            entry.ownSpaceIds.size > 0
        ) {
            out.set(key, entry);
        }
    }
    return out;
};

interface CacheEntry {
    version: number;
    actor: ActorPermissions;
}

/** Plenty for a workspace of this size; the bound only guards against leaks. */
const MAX_CACHE_ENTRIES = 5000;

/**
 * Team-access P4: the one read the fold needs from
 * `space_visibility_grants`. An interface (not the repo class) so unit tests
 * stub it without a database; `SpaceVisibilityGrantsRepo` satisfies it.
 */
export interface VisibilityGrantsSource {
    targetsForViewers(
        viewerSpaceIds: readonly string[],
        workspaceId: string,
    ): Promise<string[]>;
}

export class PolicyService {
    private cache = new Map<string, CacheEntry>();

    constructor(
        private userRoles: UserRolesRepo,
        /** Supplies the `listIds` half of a visibility scope — `ListsRepo`. */
        private listScope: ListScopeSource,
        /**
         * Team-access P4: team → team sight. Optional so pre-P4 direct
         * constructions keep working; absent = no expansion (identical to an
         * empty grants table).
         */
        private visibilityGrants?: VisibilityGrantsSource,
        private logger?: Logger,
    ) {}

    /**
     * The actor's effective permissions right now.
     *
     * Returns `null` only when the user does not exist in that workspace. A
     * user who simply has no roles resolves to an actor with an empty map —
     * "authenticated but powerless" is a valid state, not an error.
     */
    async resolveActor(
        userId: string,
        workspaceId: string,
    ): Promise<ActorPermissions | null> {
        const ctx = await this.userRoles.getActorContext(userId, workspaceId);
        if (!ctx) return null;

        const key = `${workspaceId}|${userId}`;
        const cached = this.cache.get(key);
        if (cached && cached.version === ctx.permissionsVersion) {
            return cached.actor;
        }

        // NOTE ON `ctx.status`: a deactivated account whose access token has not
        // yet expired still resolves to its full permission set. That mirrors
        // the pre-RBAC behaviour EXACTLY, and it is a deliberate design decision
        // of this codebase, not an oversight — nine tests across seven modules
        // document it ("status enforced at refresh, not here"), because
        // deactivation revokes the refresh session and the access token lives at
        // most 15 minutes. Making the resolver deny on status would be a real
        // improvement, but it is an AUTH-layer change (it applies to every
        // endpoint, RBAC-gated or not), so it belongs in `authenticate`, not
        // here, and it is flagged as a known gap rather than smuggled in.
        const rows = await this.userRoles.listEffectiveGrants(
            userId,
            workspaceId,
        );
        const perms = foldGrants(rows);
        await this.applyVisibilityGrants(perms, workspaceId);
        const actor: ActorPermissions = {
            kind: "user",
            userId,
            workspaceId,
            isOwner: ctx.legacyRole === "owner",
            legacyRole: ctx.legacyRole,
            version: ctx.permissionsVersion,
            perms,
        };

        if (this.cache.size >= MAX_CACHE_ENTRIES) {
            // Cheap FIFO eviction — insertion order is Map's iteration order.
            const oldest = this.cache.keys().next();
            if (!oldest.done) this.cache.delete(oldest.value);
        }
        this.cache.set(key, { version: ctx.permissionsVersion, actor });
        this.logger?.debug("policy.actor.resolved", {
            userId,
            workspaceId,
            version: ctx.permissionsVersion,
            permissions: actor.perms.size,
        });
        return actor;
    }

    /**
     * Team-access P4 — team → team SIGHT, applied at the fold so every
     * downstream consumer (visibleSpaceIds → the repo filters, and
     * `can("space.view", {spaceId})` object checks) follows through the one
     * choke point:
     *
     *   - Only a SCOPED `space.view` entry is expanded; `all` needs nothing
     *     and pays nothing — which is exactly what keeps this DORMANT while
     *     every seeded role still sees everything.
     *   - The viewer set is the entry's own spaceIds (the person's teams, by
     *     the D-1/D-2 membership model) BEFORE expansion — grants are a
     *     single hop, never transitive.
     *   - Only `space.view` widens. Write keys (`task.edit`, …) are
     *     untouched: sight is not touch.
     *   - Cached with the fold by `(userId, permissions_version)` —
     *     grant/revoke bumps the version, so a change bites on the very next
     *     request.
     */
    private async applyVisibilityGrants(
        perms: Map<string, PermissionEntry>,
        workspaceId: string,
    ): Promise<void> {
        if (!this.visibilityGrants) return;
        const view = perms.get("space.view");
        if (!view || view.all || view.spaceIds.size === 0) return;
        const targets = await this.visibilityGrants.targetsForViewers(
            [...view.spaceIds],
            workspaceId,
        );
        if (targets.length === 0) return;
        perms.set("space.view", {
            all: view.all,
            spaceIds: new Set([...view.spaceIds, ...targets]),
            own: view.own,
            ownSpaceIds: view.ownSpaceIds,
        });
    }

    // ── the decision (P7) ────────────────────────────────────────────────────
    // Thin delegations to the pure functions in `rbac/can.ts`. There is ONE
    // implementation; these exist so a service that already holds a
    // `PolicyService` collaborator does not need a second import.

    /** What one permission grants this actor. Never undefined. */
    entryFor(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
    ): PermissionEntry {
        return entryFor(actor, permissionKey);
    }

    /** May this actor do this to THIS resource? */
    can(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
        ctx?: PermissionContext,
    ): boolean {
        return can(actor, permissionKey, ctx);
    }

    /** The same question, with the reason when the answer is no. */
    decide(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
        ctx?: PermissionContext,
    ): Decision {
        return decide(actor, permissionKey, ctx);
    }

    /** Does this actor hold the permission ANYWHERE? (verb-level check) */
    holds(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
    ): boolean {
        return holds(actor, permissionKey);
    }

    /** Object-level guard — throws the taxonomy 403. */
    assertCan(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
        ctx?: PermissionContext,
    ): void {
        assertCan(actor, permissionKey, ctx);
    }

    /** Verb-level guard — throws the taxonomy 403. */
    assertHolds(
        actor: ActorPermissions | null | undefined,
        permissionKey: PermissionKey,
    ): void {
        assertHolds(actor, permissionKey);
    }

    /**
     * What this actor's queries may see (P8). Resolve ONCE per request and
     * pass the result down — it is deliberately not cached, because a new list
     * must be visible immediately (see `rbac/scope.ts#materialiseScope`).
     *
     * Free for an unrestricted actor: no query at all.
     */
    async visibilityFor(
        actor: ActorPermissions | null | undefined,
    ): Promise<VisibilityScope> {
        const scope = await materialiseScope(actor, this.listScope);
        this.logger?.debug("policy.scope.resolved", {
            userId: actor?.userId,
            workspaceId: actor?.workspaceId,
            kind: scope.kind,
        });
        return scope;
    }

    /**
     * The whole principal for a signed-in caller — actor + scope in one
     * object (P9). This is what P11 attaches to the request and what the
     * assistant's tool executor carries, so a tool can never widen beyond the
     * person who asked.
     *
     * `null` when the user is not in that workspace, exactly like
     * `resolveActor`.
     */
    async principalFor(
        userId: string,
        workspaceId: string,
    ): Promise<Principal | null> {
        const actor = await this.resolveActor(userId, workspaceId);
        if (!actor) return null;
        return { actor, scope: await this.visibilityFor(actor) };
    }

    /** Does this workspace row exist? (used to keep a stale-JWT 404 a 404) */
    async workspaceExists(workspaceId: string): Promise<boolean> {
        return this.userRoles.workspaceExists(workspaceId);
    }

    /**
     * Full reach inside the given spaces, for a caller that has ALREADY been
     * authorized at the boundary (landmine L1 — `/dept` queues and the weekly
     * report must count the whole department, not the reader's slice).
     */
    async elevateToSpaces(
        reason: ElevationReason,
        spaceIds: readonly string[],
        workspaceId: string,
    ): Promise<VisibilityScope> {
        return elevateToSpaces(
            reason,
            { spaceIds, workspaceId, source: this.listScope },
            this.logger,
        );
    }

    /**
     * Forget a cached actor. Correctness does NOT depend on this — the version
     * stamp already invalidates every process — but dropping the local entry
     * right after a mutation avoids one stale read inside the same request.
     */
    invalidate(userId: string, workspaceId: string): void {
        this.cache.delete(`${workspaceId}|${userId}`);
    }

    /** Drop everything (tests, and any future "permissions changed" broadcast). */
    clearCache(): void {
        this.cache.clear();
    }

    /** Cached entry count — exposed for tests and future metrics. */
    get cacheSize(): number {
        return this.cache.size;
    }
}
