// =============================================================================
// REQUEST CONTEXT — the current caller's actor + visibility, without threading.
//   Plan: RBAC_DYNAMIC_PLAN.md P11 (middleware) / P16-P22 (repository reads)
//
// ── WHY AN ASYNC CONTEXT AND NOT A PARAMETER ─────────────────────────────────
// Row-level visibility has to reach ~20 repository methods that sit three or
// four layers below the request (controller → service → repo, sometimes via a
// second service). Threading a `scope` argument through all of them would mean
// touching every caller of every one of those methods — including ~2,800
// existing tests that construct repos directly — and a single missed call site
// would be a silent leak with nothing to catch it.
//
// `AsyncLocalStorage` gives every repository the caller's scope with no plumbing
// and no chance of passing the WRONG one. The store is established once, in the
// global v1 chain, so an API route cannot forget it.
//
// ── THE DEFAULT IS TODAY'S BEHAVIOUR, ON PURPOSE ─────────────────────────────
// `visibilityScope()` returns `ALL_VISIBLE` when there is no request context at
// all. That covers exactly three callers, and all three are correct:
//   · background jobs        — they run as the system principal (P9);
//   · seed / migration code  — no user exists yet;
//   · unit tests             — which construct repositories directly.
// It also covers unauthenticated public routes (the public-form carve-out, L4).
// Every real API request DOES have a context, and P32 asserts that.
// =============================================================================
import { AsyncLocalStorage } from "async_hooks";
import type { SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import type { Request } from "express";
import { getPolicy } from "./policy";
import {
    ALL_VISIBLE,
    NOTHING_VISIBLE,
    scopePredicate,
    type VisibilityScope,
} from "./scope";
import type { ActorPermissions } from "./types";
import type { Principal } from "./principals";

interface RequestStore {
    /** The live request — read lazily so `authenticate` can run after us. */
    req?: Request;
    /** Memoised per request. */
    principal?: Principal | null;
    /** An explicitly-installed principal (jobs, tests, elevated blocks). */
    forced?: Principal;
}

const storage = new AsyncLocalStorage<RequestStore>();

/** Establish an empty store for one request. Populated lazily on first use. */
export const runWithRequest = <T>(req: Request, fn: () => T): T =>
    storage.run({ req }, fn);

/**
 * Run `fn` with an explicit principal — a background job, or a deliberately
 * elevated block inside a request (P9's `elevate*`). Nested calls replace the
 * principal for their duration only.
 */
export const runWithPrincipal = <T>(principal: Principal, fn: () => T): T =>
    storage.run({ forced: principal }, fn);

/** The resolved principal, or null when there is no authenticated caller. */
export const currentPrincipal = async (): Promise<Principal | null> => {
    const store = storage.getStore();
    if (!store) return null;
    if (store.forced) return store.forced;
    if (store.principal !== undefined) return store.principal;

    const auth = (store.req as { auth?: { sub: string; workspaceId: string } })
        ?.auth;
    if (!auth?.sub || !auth.workspaceId) {
        store.principal = null;
        return null;
    }
    store.principal = await getPolicy().principalFor(
        auth.sub,
        auth.workspaceId,
    );
    return store.principal;
};

/** The caller's actor, or null outside an authenticated request. */
export const currentActor = async (): Promise<ActorPermissions | null> =>
    (await currentPrincipal())?.actor ?? null;

/**
 * THE ROW FILTER. Call this at the top of any repository method that must not
 * return rows the caller cannot see, and hand the result to `scopePredicate`.
 *
 * Returns `ALL_VISIBLE` when there is no request context (see the file header),
 * and `NOTHING_VISIBLE` when there IS an authenticated caller whose token names
 * a user that no longer exists in the workspace — the fail-closed direction.
 */
export const visibilityScope = async (): Promise<VisibilityScope> => {
    const store = storage.getStore();
    if (!store) return ALL_VISIBLE;
    if (store.forced) return store.forced.scope;

    const auth = (store.req as { auth?: { sub: string; workspaceId: string } })
        ?.auth;
    if (!auth?.sub) return ALL_VISIBLE; // unauthenticated public route (L4)

    const principal = await currentPrincipal();
    return principal ? principal.scope : NOTHING_VISIBLE;
};

/**
 * The two one-liners repositories actually call. Each returns a `WHERE`
 * fragment for the caller's visibility, or `undefined` when they are
 * unrestricted — which is every user until an admin narrows `space.view`, so
 * today these add nothing to the emitted SQL.
 *
 *   const vis = await spaceScopeFilter(spaces.id);
 *   ...where(and(eq(spaces.workspaceId, ws), vis))
 */
export const spaceScopeFilter = async (
    column: AnyMySqlColumn,
): Promise<SQL | undefined> =>
    scopePredicate(await visibilityScope(), { spaceCol: column });

/**
 * `alsoAllow` is the `own` escape hatch — extra OR-ed predicates so a person
 * keeps seeing what they created or are assigned to even outside their spaces.
 */
export const listScopeFilter = async (
    column: AnyMySqlColumn,
    alsoAllow?: readonly (SQL | undefined)[],
): Promise<SQL | undefined> =>
    scopePredicate(
        await visibilityScope(),
        { listCol: column },
        alsoAllow ? { alsoAllow } : {},
    );

/** True when a request context is installed — used by the P32 sweep. */
export const hasRequestContext = (): boolean =>
    storage.getStore() !== undefined;

/** Drop the memoised principal so the next read re-resolves (after a write). */
export const invalidateRequestPrincipal = (): void => {
    const store = storage.getStore();
    if (store) delete store.principal;
};
