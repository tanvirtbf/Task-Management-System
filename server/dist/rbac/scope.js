"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeScope = exports.isListVisible = exports.isSpaceVisible = exports.seesEverything = exports.scopePredicate = exports.denyAll = exports.materialiseScope = exports.visibleSpaceIds = exports.makeScope = exports.NOTHING_VISIBLE = exports.ALL_VISIBLE = exports.VISIBILITY_PERMISSION = void 0;
// =============================================================================
// VISIBILITY — which ROWS may a query return?
//   Plan: RBAC_DYNAMIC_PLAN.md P8 · Decision layer: `rbac/can.ts` (P7)
//
// `can()` answers about ONE already-identified resource. This file answers the
// other half: what a listing query is allowed to see, expressed as a `WHERE`
// fragment so the filter runs IN SQL.
//
// ── WHY IT MUST BE SQL, NOT A .filter() ──────────────────────────────────────
// Every paginated read in this codebase returns `{data, pagination}` where
// `total_estimate` comes from a SEPARATE `COUNT(*)` and the cursor is a keyset
// on `internal_id`. Post-filtering rows in JS would leave the count and the
// cursor talking about a different set than the page — short pages, wrong
// totals, and rows skipped at page boundaries. So the predicate goes into the
// query, and the count query gets the SAME predicate (landmine L2).
//
// ── THE THREE RULES (landmine L3) ────────────────────────────────────────────
//   unrestricted   → `undefined`     Drizzle drops an undefined condition, so
//                                    the emitted SQL is BYTE-IDENTICAL to
//                                    today's. This is what makes shipping
//                                    visibility a no-op until an admin
//                                    tightens a role.
//   nothing visible→ `sql\`1 = 0\``   NEVER `inArray(col, [])` — Drizzle emits
//                                    `col in ()`, which is a MySQL syntax
//                                    error, and a hand-rolled "skip the filter
//                                    when the list is empty" silently shows
//                                    EVERYTHING. Both failure modes are worse
//                                    than a row-less result.
//   some spaces    → `inArray(col, ids)`
//
// ── WHAT DRIVES IT ───────────────────────────────────────────────────────────
// The `space.view` grant, and only that one. It is the master switch: lists,
// tasks, comments, attachments and search all hang off the space they live in.
// Scope `all` → sees everything; scope `space` → sees the spaces they hold a
// role in (= their membership, plan D-1/D-2).
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const can_1 = require("./can");
/** The one permission that decides visibility. */
exports.VISIBILITY_PERMISSION = "space.view";
/** Sees the whole workspace — today's state for every seeded role. */
exports.ALL_VISIBLE = { kind: "all" };
/** Sees no space at all (still able to see own items via `alsoAllow`). */
exports.NOTHING_VISIBLE = {
    kind: "scoped",
    spaceIds: [],
    listIds: [],
};
/** Ids are de-duplicated and sorted so the emitted SQL is deterministic. */
const normalise = (ids) => [...new Set(ids)].sort();
const makeScope = (spaceIds, listIds) => ({
    kind: "scoped",
    spaceIds: normalise(spaceIds),
    listIds: normalise(listIds),
});
exports.makeScope = makeScope;
/**
 * The space half of the answer — pure, no database.
 *
 * `space.view` offers only `all` and `space` (catalog invariant), so an `own`
 * grant on it is meaningless and is deliberately ignored rather than being
 * quietly turned into extra reach.
 */
const visibleSpaceIds = (actor) => {
    const entry = (0, can_1.entryFor)(actor, exports.VISIBILITY_PERMISSION);
    if (entry.all)
        return { kind: "all" };
    return { kind: "scoped", spaceIds: normalise([...entry.spaceIds]) };
};
exports.visibleSpaceIds = visibleSpaceIds;
/**
 * Resolve the full scope for one request.
 *
 * **Costs nothing on today's path**: an actor with `space.view = all` returns
 * `ALL_VISIBLE` without touching the database, and an actor with no spaces
 * returns early too. Only a genuinely space-restricted actor pays for the
 * single indexed lookup on `idx_lists_space_archived`.
 *
 * **Deliberately NOT cached.** `listIds` changes whenever a list is created,
 * deleted or moved, and none of those bump `permissions_version` — a cached
 * set would hide a brand-new list from exactly the people who work in that
 * space. Resolve per request (P11 attaches it to the request), never longer.
 *
 * `lists.is_private` is NOT applied here: it is enforced nowhere today, and
 * turning it on is P16's job, on purpose, so that P8 changes no behaviour.
 */
const materialiseScope = async (actor, source) => {
    if (!actor)
        return exports.NOTHING_VISIBLE;
    const spaces = (0, exports.visibleSpaceIds)(actor);
    if (spaces.kind === "all")
        return exports.ALL_VISIBLE;
    if (spaces.spaceIds.length === 0)
        return exports.NOTHING_VISIBLE;
    const listIds = await source.idsBySpaces(spaces.spaceIds, actor.workspaceId);
    return (0, exports.makeScope)(spaces.spaceIds, listIds);
};
exports.materialiseScope = materialiseScope;
/** `1 = 0` — matches no row, and is valid SQL (unlike `col in ()`). */
const denyAll = () => (0, drizzle_orm_1.sql) `1 = 0`;
exports.denyAll = denyAll;
/**
 * The `WHERE` fragment for one scoped column, or `undefined` when the actor is
 * unrestricted (which leaves the query exactly as it is today).
 */
const scopePredicate = (scope, target, opts = {}) => {
    // Unrestricted wins outright: `all` already covers every `alsoAllow` path,
    // and returning undefined keeps the SQL byte-identical to today's.
    if (scope.kind === "all")
        return undefined;
    const parts = [];
    if (target.spaceCol) {
        if (scope.spaceIds.length > 0) {
            parts.push((0, drizzle_orm_1.inArray)(target.spaceCol, [...scope.spaceIds]));
        }
    }
    else if (scope.listIds.length > 0) {
        parts.push((0, drizzle_orm_1.inArray)(target.listCol, [...scope.listIds]));
    }
    for (const extra of opts.alsoAllow ?? []) {
        if (extra)
            parts.push(extra);
    }
    if (parts.length === 0)
        return (0, exports.denyAll)();
    if (parts.length === 1)
        return parts[0];
    return (0, drizzle_orm_1.or)(...parts);
};
exports.scopePredicate = scopePredicate;
// ─── cheap membership checks (no SQL) ────────────────────────────────────────
/** True when the actor is unrestricted — useful to skip work entirely. */
const seesEverything = (scope) => scope.kind === "all";
exports.seesEverything = seesEverything;
const isSpaceVisible = (scope, spaceId) => {
    if (scope.kind === "all")
        return true;
    return !!spaceId && scope.spaceIds.includes(spaceId);
};
exports.isSpaceVisible = isSpaceVisible;
const isListVisible = (scope, listId) => {
    if (scope.kind === "all")
        return true;
    return !!listId && scope.listIds.includes(listId);
};
exports.isListVisible = isListVisible;
/** One-line form for logs and debugging: "all" or "2 spaces / 7 lists". */
const describeScope = (scope) => scope.kind === "all"
    ? "all"
    : `${scope.spaceIds.length} spaces / ${scope.listIds.length} lists`;
exports.describeScope = describeScope;
