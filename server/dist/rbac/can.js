"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeForbidden = exports.forbiddenFor = exports.denyMessage = exports.permissionErrorCode = exports.RBAC_FORBIDDEN = exports.holds = exports.can = exports.decide = exports.isOwnResource = exports.entryFor = void 0;
exports.assertCan = assertCan;
exports.assertHolds = assertHolds;
// =============================================================================
// THE DECISION — may this actor do this, to THIS thing?
//   Plan: RBAC_DYNAMIC_PLAN.md P7 · Actor model: `rbac/types.ts` (P6)
//
// Everything here is PURE: given a resolved actor and a description of the
// resource, it answers yes/no and — when the answer is no — says why, in the
// shape the API returns. No database, no service, no request.
//
// ── THE TWO QUESTIONS (they are not the same) ────────────────────────────────
//   holds(actor, 'task.edit')            "could they edit ANY task?"   — the
//     VERB. Coarse. This is what the route middleware (P11) asks, because a
//     middleware runs before the resource is loaded and cannot know its space.
//
//   can(actor, 'task.edit', { spaceId, createdBy, assigneeIds })
//     "may they edit THIS task?" — the OBJECT. Precise. This is what a service
//     asks, after it has resolved the row (P12-P15).
//
// Both layers are mandatory: the middleware alone cannot see the object, and
// the service alone leaves the route open to anyone who guesses a URL.
//
// ── WHAT IS *NOT* HERE ───────────────────────────────────────────────────────
// `can()` never looks at `actor.legacyRole`. The legacy role reaches the
// decision only through the roles seeded from it (P3), which is exactly what
// makes the P11-P15 swap provable: if a gate still passes for the wrong
// reason, no permission was involved. The ONE hard-wired path is the owner
// floor (D-7), and it lives in `entryFor`.
//
// It also does not decide VISIBILITY (which rows a query may return) — that is
// `VisibilityScope` + `scopePredicate` in P8. `can()` answers about one
// already-identified resource.
// =============================================================================
const errors_1 = require("../errors");
const catalog_1 = require("./catalog");
const types_1 = require("./types");
const ALLOWED = { allowed: true };
/**
 * What one permission grants this actor. Never undefined, so callers do not
 * null-check. The OWNER short-circuits to full access here — that is the
 * anti-lockout floor (D-7), and putting it in one place is what makes it
 * impossible to forget at a call site.
 */
const entryFor = (actor, permissionKey) => {
    if (!actor)
        return types_1.NO_PERMISSION;
    // The two hard-wired full-access paths, both deliberately in ONE place:
    // the owner floor (D-7) and the background-job principal (P9, landmine L5).
    if (actor.isOwner || actor.kind === "system") {
        return { ...types_1.NO_PERMISSION, all: true };
    }
    return actor.perms.get(permissionKey) ?? types_1.NO_PERMISSION;
};
exports.entryFor = entryFor;
/**
 * Is this resource the actor's own? "Own" means they created it or it is
 * assigned to them — the definition the catalog's `own` scope documents.
 */
const isOwnResource = (actor, ctx) => {
    if (!actor || !ctx)
        return false;
    if (ctx.isOwn !== undefined)
        return ctx.isOwn;
    if (ctx.createdBy && ctx.createdBy === actor.userId)
        return true;
    return (ctx.assigneeIds ?? []).some((id) => !!id && id === actor.userId);
};
exports.isOwnResource = isOwnResource;
/**
 * The full answer, with a reason when denied.
 *
 * Allowed if ANY of the four reaches covers the resource (allow-wins union,
 * D-4 — there is no explicit deny):
 *   · `all`                              → anywhere
 *   · `spaceIds`  ∋ ctx.spaceId          → inside those spaces
 *   · `own`       ∧ it is theirs         → their items, anywhere
 *   · `ownSpaceIds` ∋ ctx.spaceId ∧ theirs → their items, inside those spaces
 */
const decide = (actor, permissionKey, ctx) => {
    const entry = (0, exports.entryFor)(actor, permissionKey);
    const hasSpaceReach = entry.spaceIds.size > 0;
    const hasOwnReach = entry.own || entry.ownSpaceIds.size > 0;
    if (!entry.all && !hasSpaceReach && !hasOwnReach) {
        return { allowed: false, reason: "no_grant" };
    }
    if (entry.all)
        return ALLOWED;
    // Team-access P7 (G4): the head-of-owning-space allow-path, beside the
    // owner floor in spirit but ctx-scoped in mechanics — it exists only when
    // the caller resolved the space's head and handed it in (task-scope
    // checks do; nothing else does). Placed AFTER the no_grant return: a head
    // stripped of the verb entirely is still refused.
    if (actor &&
        ctx?.spaceHeadUserId &&
        ctx.spaceHeadUserId === actor.userId) {
        return ALLOWED;
    }
    const spaceId = ctx?.spaceId ?? null;
    if (spaceId && entry.spaceIds.has(spaceId))
        return ALLOWED;
    const own = (0, exports.isOwnResource)(actor, ctx);
    if (own) {
        if (entry.own)
            return ALLOWED;
        if (spaceId && entry.ownSpaceIds.has(spaceId))
            return ALLOWED;
    }
    // Denied. Pick the reason that tells the person what to do about it: if
    // every remaining reach requires ownership, the blocker is ownership;
    // otherwise it is the space (including "no space was named", which for a
    // workspace-wide action means their grant simply does not reach that far).
    if (!own && hasOwnReach && !hasSpaceReach) {
        return { allowed: false, reason: "not_own" };
    }
    return { allowed: false, reason: "out_of_scope" };
};
exports.decide = decide;
/** Precise object-level check — the service layer's question. */
const can = (actor, permissionKey, ctx) => (0, exports.decide)(actor, permissionKey, ctx).allowed;
exports.can = can;
/**
 * Coarse verb-level check: does this actor hold the permission ANYWHERE?
 *
 * Used by the route middleware (P11) and by the client (P10/P25) to decide
 * whether a control is worth showing. True here does NOT mean a specific
 * action will succeed — the service still runs `can()` on the resolved row.
 */
const holds = (actor, permissionKey) => {
    const e = (0, exports.entryFor)(actor, permissionKey);
    return e.all || e.own || e.spaceIds.size > 0 || e.ownSpaceIds.size > 0;
};
exports.holds = holds;
// ─── error taxonomy ──────────────────────────────────────────────────────────
/** The generic code, and the one the RBAC domain itself uses. */
exports.RBAC_FORBIDDEN = "rbac.forbidden";
/**
 * Domains whose error code is not simply the permission's own namespace.
 * `role.manage` / `role.assign` are the RBAC administration domain, and the
 * plan names `rbac.forbidden` as their code.
 */
const CODE_OVERRIDES = {
    role: exports.RBAC_FORBIDDEN,
};
/**
 * `task.edit` → `task.forbidden`, `report.note` → `report.forbidden`.
 *
 * Derived from the key so a new permission never needs a new table entry, and
 * deliberately reusing `review.forbidden` / `report.forbidden` — the codes the
 * dept-review services already return — so that swapping those gates over in
 * P15 is invisible to the client.
 */
const permissionErrorCode = (permissionKey) => {
    const ns = permissionKey.split(".")[0];
    if (!ns)
        return exports.RBAC_FORBIDDEN;
    return CODE_OVERRIDES[ns] ?? `${ns}.forbidden`;
};
exports.permissionErrorCode = permissionErrorCode;
/** "Edit tasks" → "edit tasks", for use mid-sentence. */
const phrase = (permissionKey) => {
    const label = (0, catalog_1.getPermission)(permissionKey)?.label;
    if (!label)
        return permissionKey;
    return label.charAt(0).toLowerCase() + label.slice(1);
};
/**
 * The message a person actually reads. Built from the catalog label, so it
 * names the capability in the same words as the checkbox an admin must tick
 * for them — "You don't have permission to edit tasks." beats "Forbidden".
 */
const denyMessage = (permissionKey, reason) => {
    const what = phrase(permissionKey);
    switch (reason) {
        case "no_grant":
            return `You don't have permission to ${what}.`;
        case "out_of_scope":
            return `You can only ${what} inside the spaces you are assigned to.`;
        case "not_own":
            return `You can only ${what} for items you created or are assigned to.`;
    }
};
exports.denyMessage = denyMessage;
/**
 * The 403 for a permission denial.
 *
 * `details` carries the permission key and the reason. Both are facts about
 * the ACTOR's own configuration, never about the resource — no space id, no
 * owner name — so this leaks nothing an existence-probe could use (D-9: reads
 * deny by 404 before ever reaching here).
 */
const forbiddenFor = (permissionKey, reason) => {
    const details = [
        { field: "permission", issue: permissionKey },
        { field: "reason", issue: reason },
    ];
    return errors_1.AppError.forbidden((0, exports.permissionErrorCode)(permissionKey), (0, exports.denyMessage)(permissionKey, reason), details);
};
exports.forbiddenFor = forbiddenFor;
/**
 * Object-level guard — the first statement of a mutating service method.
 * Throws the taxonomy 403; returns nothing when allowed.
 */
function assertCan(actor, permissionKey, ctx) {
    const decision = (0, exports.decide)(actor, permissionKey, ctx);
    if (!decision.allowed) {
        throw (0, exports.forbiddenFor)(permissionKey, decision.reason);
    }
}
/**
 * Verb-level guard — for the route middleware, where no resource exists yet.
 * Always denies with `no_grant`, because "holds it nowhere" is the only way to
 * fail this check.
 */
function assertHolds(actor, permissionKey) {
    if (!(0, exports.holds)(actor, permissionKey)) {
        throw (0, exports.forbiddenFor)(permissionKey, "no_grant");
    }
}
/**
 * The route-gate 403 — byte-identical to what `canAccess` returned before P11
 * (`auth.forbidden`, same sentence), because swapping ~40 live endpoints onto
 * permissions must be invisible on the wire. The permission key and reason ride
 * along in `details`, which is purely additive.
 *
 * The richer per-domain codes (`task.forbidden`, …) belong to the SERVICE-level
 * `assertCan`, which is new surface and has no contract to preserve.
 */
const routeForbidden = (permissionKey) => errors_1.AppError.forbidden("auth.forbidden", "You don't have enough permissions", [
    { field: "permission", issue: permissionKey },
    { field: "reason", issue: "no_grant" },
]);
exports.routeForbidden = routeForbidden;
