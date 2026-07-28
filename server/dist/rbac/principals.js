"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.elevateToSpaces = exports.elevate = exports.elevationReasons = exports.isPublic = exports.publicFormPrincipal = exports.publicFormActor = exports.isSystem = exports.systemPrincipal = exports.systemActor = exports.SYSTEM_USER_ID = void 0;
const scope_1 = require("./scope");
/** The `user_id` recorded for job-driven work. Not a real row. */
exports.SYSTEM_USER_ID = "system";
// ─── 1. background jobs (L5) ─────────────────────────────────────────────────
/**
 * A background job. Holds every permission via `entryFor`'s `kind === "system"`
 * branch, and sees the whole workspace.
 *
 * `kind` is what grants this, NOT `isOwner` — a job is not the owner, and
 * saying so would put a false actor in audit rows and in any future
 * "only the owner may…" rule.
 */
const systemActor = (workspaceId) => ({
    kind: "system",
    userId: exports.SYSTEM_USER_ID,
    workspaceId,
    isOwner: false,
    legacyRole: "system",
    version: 0,
    perms: new Map(),
});
exports.systemActor = systemActor;
const systemPrincipal = (workspaceId) => ({
    actor: (0, exports.systemActor)(workspaceId),
    scope: scope_1.ALL_VISIBLE,
});
exports.systemPrincipal = systemPrincipal;
const isSystem = (actor) => actor?.kind === "system";
exports.isSystem = isSystem;
// ─── 2. the public form (L4) ─────────────────────────────────────────────────
const spaceOnly = (spaceId) => ({
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
const publicFormActor = (input) => ({
    kind: "public",
    userId: input.attributedTo,
    workspaceId: input.workspaceId,
    isOwner: false,
    legacyRole: "member",
    version: 0,
    perms: new Map([
        ["task.create", spaceOnly(input.spaceId)],
        ["customfield.set_value", spaceOnly(input.spaceId)],
    ]),
});
exports.publicFormActor = publicFormActor;
/**
 * The submission principal. The scope is the form's own list and nothing
 * else, so even a bug that hands this principal to a listing query can only
 * ever surface that one list.
 */
const publicFormPrincipal = (input) => ({
    actor: (0, exports.publicFormActor)(input),
    scope: (0, scope_1.makeScope)([input.spaceId], [input.listId]),
});
exports.publicFormPrincipal = publicFormPrincipal;
const isPublic = (actor) => actor?.kind === "public";
exports.isPublic = isPublic;
const ELEVATION_REASONS = [
    "job",
    "dept_review_stats",
    "weekly_report",
    "public_form",
];
/** The documented set, for the test that pins it. */
const elevationReasons = () => ELEVATION_REASONS;
exports.elevationReasons = elevationReasons;
/**
 * Unrestricted, on purpose. Use ONLY where the caller has already been
 * authorized by something else (a job token, a boundary guard).
 */
const elevate = (reason, logger) => {
    logger?.debug("rbac.elevate", { reason, kind: "all" });
    return scope_1.ALL_VISIBLE;
};
exports.elevate = elevate;
/**
 * Full reach INSIDE the named spaces, and nowhere else — the shape landmine L1
 * needs. A department head reading `/dept` must see every task in that
 * department, but elevation stops at its edge.
 *
 * Prefer this over `elevate()` whenever the spaces are known: it is the
 * difference between "this head sees all of Marketing" and "this head sees
 * the entire company".
 */
const elevateToSpaces = async (reason, input, logger) => {
    if (input.spaceIds.length === 0)
        return (0, scope_1.makeScope)([], []);
    const listIds = await input.source.idsBySpaces(input.spaceIds, input.workspaceId);
    logger?.debug("rbac.elevate", {
        reason,
        kind: "spaces",
        spaces: input.spaceIds.length,
        lists: listIds.length,
    });
    return (0, scope_1.makeScope)(input.spaceIds, listIds);
};
exports.elevateToSpaces = elevateToSpaces;
