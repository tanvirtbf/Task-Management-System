"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateRequestPrincipal = exports.hasRequestContext = exports.listScopeFilter = exports.spaceScopeFilter = exports.visibilityScope = exports.currentActor = exports.currentPrincipal = exports.runWithPrincipal = exports.runWithRequest = void 0;
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
const async_hooks_1 = require("async_hooks");
const policy_1 = require("./policy");
const scope_1 = require("./scope");
const storage = new async_hooks_1.AsyncLocalStorage();
/** Establish an empty store for one request. Populated lazily on first use. */
const runWithRequest = (req, fn) => storage.run({ req }, fn);
exports.runWithRequest = runWithRequest;
/**
 * Run `fn` with an explicit principal — a background job, or a deliberately
 * elevated block inside a request (P9's `elevate*`). Nested calls replace the
 * principal for their duration only.
 */
const runWithPrincipal = (principal, fn) => storage.run({ forced: principal }, fn);
exports.runWithPrincipal = runWithPrincipal;
/** The resolved principal, or null when there is no authenticated caller. */
const currentPrincipal = async () => {
    const store = storage.getStore();
    if (!store)
        return null;
    if (store.forced)
        return store.forced;
    if (store.principal !== undefined)
        return store.principal;
    const auth = store.req
        ?.auth;
    if (!auth?.sub || !auth.workspaceId) {
        store.principal = null;
        return null;
    }
    store.principal = await (0, policy_1.getPolicy)().principalFor(auth.sub, auth.workspaceId);
    return store.principal;
};
exports.currentPrincipal = currentPrincipal;
/** The caller's actor, or null outside an authenticated request. */
const currentActor = async () => (await (0, exports.currentPrincipal)())?.actor ?? null;
exports.currentActor = currentActor;
/**
 * THE ROW FILTER. Call this at the top of any repository method that must not
 * return rows the caller cannot see, and hand the result to `scopePredicate`.
 *
 * Returns `ALL_VISIBLE` when there is no request context (see the file header),
 * and `NOTHING_VISIBLE` when there IS an authenticated caller whose token names
 * a user that no longer exists in the workspace — the fail-closed direction.
 */
const visibilityScope = async () => {
    const store = storage.getStore();
    if (!store)
        return scope_1.ALL_VISIBLE;
    if (store.forced)
        return store.forced.scope;
    const auth = store.req
        ?.auth;
    if (!auth?.sub)
        return scope_1.ALL_VISIBLE; // unauthenticated public route (L4)
    const principal = await (0, exports.currentPrincipal)();
    return principal ? principal.scope : scope_1.NOTHING_VISIBLE;
};
exports.visibilityScope = visibilityScope;
/**
 * The two one-liners repositories actually call. Each returns a `WHERE`
 * fragment for the caller's visibility, or `undefined` when they are
 * unrestricted — which is every user until an admin narrows `space.view`, so
 * today these add nothing to the emitted SQL.
 *
 *   const vis = await spaceScopeFilter(spaces.id);
 *   ...where(and(eq(spaces.workspaceId, ws), vis))
 */
const spaceScopeFilter = async (column) => (0, scope_1.scopePredicate)(await (0, exports.visibilityScope)(), { spaceCol: column });
exports.spaceScopeFilter = spaceScopeFilter;
/**
 * `alsoAllow` is the `own` escape hatch — extra OR-ed predicates so a person
 * keeps seeing what they created or are assigned to even outside their spaces.
 */
const listScopeFilter = async (column, alsoAllow) => (0, scope_1.scopePredicate)(await (0, exports.visibilityScope)(), { listCol: column }, alsoAllow ? { alsoAllow } : {});
exports.listScopeFilter = listScopeFilter;
/** True when a request context is installed — used by the P32 sweep. */
const hasRequestContext = () => storage.getStore() !== undefined;
exports.hasRequestContext = hasRequestContext;
/** Drop the memoised principal so the next read re-resolves (after a write). */
const invalidateRequestPrincipal = () => {
    const store = storage.getStore();
    if (store)
        delete store.principal;
};
exports.invalidateRequestPrincipal = invalidateRequestPrincipal;
