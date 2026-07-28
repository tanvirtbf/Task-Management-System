// =============================================================================
// PRINCIPALS — the callers that have no session, and the deliberate bypasses.
//   Plan: RBAC_DYNAMIC_PLAN.md P9 · Landmines L1 (dept-review stats), L4
//   (public form), L5 (background jobs)
//
// Enforcement needs two things at every call site: WHO is acting
// (`ActorPermissions`) and WHAT their queries may see (`VisibilityScope`).
// A logged-in request gets both from `PolicyService`. Three callers cannot:
//
//   1. BACKGROUND JOBS (L5) have no `req.auth` at all — `internalAuth` checks a
//      shared token, nothing more. The weekly department report, the snooze
//      waker and the janitors all run "as nobody".
//   2. THE PUBLIC FORM (L4) is submitted by an anonymous stranger on the
//      internet. Today the service synthesises `role: MEMBER` and attributes
//      the task to the form's creator.
//   3. BOUNDARY-AUTHORIZED AGGREGATES (L1) — `/dept` review queues and the
//      weekly report payload legitimately count EVERY task in a department.
//      They are already gated ("you must be this space's head or an admin")
//      and then must NOT be re-filtered by the caller's personal reach, or the
//      numbers a head reads would silently be a subset of the truth.
//
// ── WHY EVERY BYPASS IS NAMED ────────────────────────────────────────────────
// Each of these is a hole in the wall. `ElevationReason` is a CLOSED union, so
// a new bypass cannot be added anywhere in the codebase without editing this
// file — which is the review checkpoint. `grep elevate` lists every hole.
// =============================================================================
import type { Logger } from "winston";
import {
    ALL_VISIBLE,
    makeScope,
    type ListScopeSource,
    type VisibilityScope,
} from "./scope";
import type { ActorPermissions, PermissionEntry } from "./types";

/** Actor + the rows they may see. Attached to the request in P11. */
export interface Principal {
    actor: ActorPermissions;
    scope: VisibilityScope;
}

/** The `user_id` recorded for job-driven work. Not a real row. */
export const SYSTEM_USER_ID = "system";

// ─── 1. background jobs (L5) ─────────────────────────────────────────────────

/**
 * A background job. Holds every permission via `entryFor`'s `kind === "system"`
 * branch, and sees the whole workspace.
 *
 * `kind` is what grants this, NOT `isOwner` — a job is not the owner, and
 * saying so would put a false actor in audit rows and in any future
 * "only the owner may…" rule.
 */
export const systemActor = (workspaceId: string): ActorPermissions => ({
    kind: "system",
    userId: SYSTEM_USER_ID,
    workspaceId,
    isOwner: false,
    legacyRole: "system",
    version: 0,
    perms: new Map(),
});

export const systemPrincipal = (workspaceId: string): Principal => ({
    actor: systemActor(workspaceId),
    scope: ALL_VISIBLE,
});

export const isSystem = (actor: ActorPermissions | null | undefined): boolean =>
    actor?.kind === "system";

// ─── 2. the public form (L4) ─────────────────────────────────────────────────

const spaceOnly = (spaceId: string): PermissionEntry => ({
    all: false,
    spaceIds: new Set([spaceId]),
    own: false,
    ownSpaceIds: new Set(),
});

/**
 * Exactly what an anonymous form submission writes: a task on the form's list,
 * plus the custom-field values the form collected. Nothing else — not a read
 * of anyone else's task, not an attachment, not an assignment.
 *
 * `userId` stays the form's CREATOR, because that is who today's submission
 * path attributes the created task to (`created_by`) and changing it would
 * rewrite history for existing forms. `kind: "public"` is what records that
 * the creator is not the one actually acting.
 */
export const publicFormActor = (input: {
    workspaceId: string;
    /** The space owning the form's list — the only place this actor reaches. */
    spaceId: string;
    /** The form's `created_by`, kept as the attribution identity. */
    attributedTo: string;
}): ActorPermissions => ({
    kind: "public",
    userId: input.attributedTo,
    workspaceId: input.workspaceId,
    isOwner: false,
    legacyRole: "member",
    version: 0,
    perms: new Map<string, PermissionEntry>([
        ["task.create", spaceOnly(input.spaceId)],
        ["customfield.set_value", spaceOnly(input.spaceId)],
    ]),
});

/**
 * The submission principal. The scope is the form's own list and nothing
 * else, so even a bug that hands this principal to a listing query can only
 * ever surface that one list.
 */
export const publicFormPrincipal = (input: {
    workspaceId: string;
    spaceId: string;
    listId: string;
    attributedTo: string;
}): Principal => ({
    actor: publicFormActor(input),
    scope: makeScope([input.spaceId], [input.listId]),
});

export const isPublic = (actor: ActorPermissions | null | undefined): boolean =>
    actor?.kind === "public";

// ─── 3. deliberate elevation (L1, L4) ────────────────────────────────────────

/**
 * Every legitimate reason to run a query with more reach than the caller has.
 * Closed on purpose — see the file header.
 */
export type ElevationReason =
    /** A background job, which has no caller at all (L5). */
    | "job"
    /** `/dept` queues + summaries: head/admin-gated, must count the whole space (L1). */
    | "dept_review_stats"
    /** The weekly report payload, on-demand or from Monday's job (L1). */
    | "weekly_report"
    /** Anonymous slug lookup — there is no actor to scope by (L4). */
    | "public_form";

const ELEVATION_REASONS: readonly ElevationReason[] = [
    "job",
    "dept_review_stats",
    "weekly_report",
    "public_form",
];

/** The documented set, for the test that pins it. */
export const elevationReasons = (): readonly ElevationReason[] =>
    ELEVATION_REASONS;

/**
 * Unrestricted, on purpose. Use ONLY where the caller has already been
 * authorized by something else (a job token, a boundary guard).
 */
export const elevate = (
    reason: ElevationReason,
    logger?: Logger,
): VisibilityScope => {
    logger?.debug("rbac.elevate", { reason, kind: "all" });
    return ALL_VISIBLE;
};

/**
 * Full reach INSIDE the named spaces, and nowhere else — the shape landmine L1
 * needs. A department head reading `/dept` must see every task in that
 * department, but elevation stops at its edge.
 *
 * Prefer this over `elevate()` whenever the spaces are known: it is the
 * difference between "this head sees all of Marketing" and "this head sees
 * the entire company".
 */
export const elevateToSpaces = async (
    reason: ElevationReason,
    input: {
        spaceIds: readonly string[];
        workspaceId: string;
        source: ListScopeSource;
    },
    logger?: Logger,
): Promise<VisibilityScope> => {
    if (input.spaceIds.length === 0) return makeScope([], []);
    const listIds = await input.source.idsBySpaces(
        input.spaceIds,
        input.workspaceId,
    );
    logger?.debug("rbac.elevate", {
        reason,
        kind: "spaces",
        spaces: input.spaceIds.length,
        lists: listIds.length,
    });
    return makeScope(input.spaceIds, listIds);
};
