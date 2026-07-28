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
import { inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { entryFor } from "./can";
import type { PermissionKey } from "./catalog";
import type { ActorPermissions } from "./types";

/** The one permission that decides visibility. */
export const VISIBILITY_PERMISSION: PermissionKey = "space.view";

/**
 * What a request may see. Materialised ONCE (see `materialiseScope`) and then
 * handed to every repository the request touches.
 *
 * `listIds` is carried alongside `spaceIds` because `lists` has no
 * `workspace_id` and `tasks` has no `space_id` — a task is filtered by
 * `primary_list_id`, which is the leading column of `idx_tasks_list_active`.
 * Filtering tasks by list ids therefore uses the hot index and is *faster*
 * than today's unindexed workspace-wide scan.
 */
export type VisibilityScope =
    | { readonly kind: "all" }
    | {
          readonly kind: "scoped";
          readonly spaceIds: readonly string[];
          readonly listIds: readonly string[];
      };

/** Sees the whole workspace — today's state for every seeded role. */
export const ALL_VISIBLE: VisibilityScope = { kind: "all" };

/** Sees no space at all (still able to see own items via `alsoAllow`). */
export const NOTHING_VISIBLE: VisibilityScope = {
    kind: "scoped",
    spaceIds: [],
    listIds: [],
};

/** Ids are de-duplicated and sorted so the emitted SQL is deterministic. */
const normalise = (ids: readonly string[]): readonly string[] =>
    [...new Set(ids)].sort();

export const makeScope = (
    spaceIds: readonly string[],
    listIds: readonly string[],
): VisibilityScope => ({
    kind: "scoped",
    spaceIds: normalise(spaceIds),
    listIds: normalise(listIds),
});

/**
 * The space half of the answer — pure, no database.
 *
 * `space.view` offers only `all` and `space` (catalog invariant), so an `own`
 * grant on it is meaningless and is deliberately ignored rather than being
 * quietly turned into extra reach.
 */
export const visibleSpaceIds = (
    actor: ActorPermissions | null | undefined,
):
    | { kind: "all" }
    | { kind: "scoped"; spaceIds: readonly string[] } => {
    const entry = entryFor(actor, VISIBILITY_PERMISSION);
    if (entry.all) return { kind: "all" };
    return { kind: "scoped", spaceIds: normalise([...entry.spaceIds]) };
};

/** The one query materialising a scope needs. `ListsRepo` satisfies it. */
export interface ListScopeSource {
    idsBySpaces(
        spaceIds: readonly string[],
        workspaceId: string,
    ): Promise<string[]>;
}

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
export const materialiseScope = async (
    actor: ActorPermissions | null | undefined,
    source: ListScopeSource,
): Promise<VisibilityScope> => {
    if (!actor) return NOTHING_VISIBLE;
    const spaces = visibleSpaceIds(actor);
    if (spaces.kind === "all") return ALL_VISIBLE;
    if (spaces.spaceIds.length === 0) return NOTHING_VISIBLE;
    const listIds = await source.idsBySpaces(
        spaces.spaceIds,
        actor.workspaceId,
    );
    return makeScope(spaces.spaceIds, listIds);
};

// ─── the predicate ───────────────────────────────────────────────────────────

/**
 * Which column carries the scope. Pick `spaceCol` when the table has a space
 * id (`spaces.id`, `lists.space_id`, `forms.space_id`), `listCol` when it
 * hangs off a list (`tasks.primary_list_id`, `statuses.scope_id`).
 */
export type ScopeTarget =
    | { spaceCol: AnyMySqlColumn; listCol?: never }
    | { listCol: AnyMySqlColumn; spaceCol?: never };

export interface ScopePredicateOptions {
    /**
     * Extra allow-paths OR-ed with the scope — the `own` escape hatch, e.g.
     * `[eq(tasks.createdBy, me)]` so a bug you reported into another
     * department stays visible to you.
     *
     * They are OR-ed, never AND-ed. Writing
     * `and(scopePredicate(...), or(mine))` by hand is the mistake this
     * parameter exists to prevent: it would *narrow* the space scope instead
     * of widening it, and would still leave `1 = 0` blocking an actor whose
     * only reach is `own`.
     */
    alsoAllow?: readonly (SQL | undefined)[];
}

/** `1 = 0` — matches no row, and is valid SQL (unlike `col in ()`). */
export const denyAll = (): SQL => sql`1 = 0`;

/**
 * The `WHERE` fragment for one scoped column, or `undefined` when the actor is
 * unrestricted (which leaves the query exactly as it is today).
 */
export const scopePredicate = (
    scope: VisibilityScope,
    target: ScopeTarget,
    opts: ScopePredicateOptions = {},
): SQL | undefined => {
    // Unrestricted wins outright: `all` already covers every `alsoAllow` path,
    // and returning undefined keeps the SQL byte-identical to today's.
    if (scope.kind === "all") return undefined;

    const parts: SQL[] = [];
    if (target.spaceCol) {
        if (scope.spaceIds.length > 0) {
            parts.push(inArray(target.spaceCol, [...scope.spaceIds]));
        }
    } else if (scope.listIds.length > 0) {
        parts.push(inArray(target.listCol, [...scope.listIds]));
    }

    for (const extra of opts.alsoAllow ?? []) {
        if (extra) parts.push(extra);
    }

    if (parts.length === 0) return denyAll();
    if (parts.length === 1) return parts[0];
    return or(...parts) as SQL;
};

// ─── cheap membership checks (no SQL) ────────────────────────────────────────

/** True when the actor is unrestricted — useful to skip work entirely. */
export const seesEverything = (scope: VisibilityScope): boolean =>
    scope.kind === "all";

export const isSpaceVisible = (
    scope: VisibilityScope,
    spaceId: string | null | undefined,
): boolean => {
    if (scope.kind === "all") return true;
    return !!spaceId && scope.spaceIds.includes(spaceId);
};

export const isListVisible = (
    scope: VisibilityScope,
    listId: string | null | undefined,
): boolean => {
    if (scope.kind === "all") return true;
    return !!listId && scope.listIds.includes(listId);
};

/** One-line form for logs and debugging: "all" or "2 spaces / 7 lists". */
export const describeScope = (scope: VisibilityScope): string =>
    scope.kind === "all"
        ? "all"
        : `${scope.spaceIds.length} spaces / ${scope.listIds.length} lists`;
