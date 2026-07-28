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
import { AppError, type ErrorDetail } from "../errors";
import { getPermission, type PermissionKey } from "./catalog";
import { NO_PERMISSION } from "./types";
import type { ActorPermissions, PermissionEntry } from "./types";

/**
 * What the caller knows about the resource being acted on. Every field is
 * optional, and every missing field can only make the answer MORE restrictive
 * — the decision is fail-closed by construction, so a service that forgets to
 * pass `spaceId` produces a spurious 403, never a silent grant.
 */
export interface PermissionContext {
    /** The space the resource lives in (a task's list's space, etc.). */
    spaceId?: string | null;
    /** Who created the resource. */
    createdBy?: string | null;
    /** Who the resource is assigned to. Nulls are ignored. */
    assigneeIds?: readonly (string | null | undefined)[] | null;
    /**
     * Decide ownership yourself. Use when "own" means something the two fields
     * above cannot express — a comment's author, a checklist's parent task,
     * a notification's recipient. Wins over `createdBy` / `assigneeIds`.
     */
    isOwn?: boolean;
}

/**
 * Why a request was denied. Carried in the error `details` so the client (and
 * a log line) can tell "you were never given this" apart from "you have it,
 * just not here" — the single most common support question in any RBAC system.
 */
export type DenyReason =
    /** No role the actor holds grants this permission at all. */
    | "no_grant"
    /** Granted, but limited to spaces that do not include this one. */
    | "out_of_scope"
    /** Granted only for the actor's own items, and this is not one. */
    | "not_own";

export type Decision =
    | { allowed: true }
    | { allowed: false; reason: DenyReason };

const ALLOWED: Decision = { allowed: true };

/**
 * What one permission grants this actor. Never undefined, so callers do not
 * null-check. The OWNER short-circuits to full access here — that is the
 * anti-lockout floor (D-7), and putting it in one place is what makes it
 * impossible to forget at a call site.
 */
export const entryFor = (
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
): PermissionEntry => {
    if (!actor) return NO_PERMISSION;
    // The two hard-wired full-access paths, both deliberately in ONE place:
    // the owner floor (D-7) and the background-job principal (P9, landmine L5).
    if (actor.isOwner || actor.kind === "system") {
        return { ...NO_PERMISSION, all: true };
    }
    return actor.perms.get(permissionKey) ?? NO_PERMISSION;
};

/**
 * Is this resource the actor's own? "Own" means they created it or it is
 * assigned to them — the definition the catalog's `own` scope documents.
 */
export const isOwnResource = (
    actor: ActorPermissions | null | undefined,
    ctx: PermissionContext | undefined,
): boolean => {
    if (!actor || !ctx) return false;
    if (ctx.isOwn !== undefined) return ctx.isOwn;
    if (ctx.createdBy && ctx.createdBy === actor.userId) return true;
    return (ctx.assigneeIds ?? []).some((id) => !!id && id === actor.userId);
};

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
export const decide = (
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
    ctx?: PermissionContext,
): Decision => {
    const entry = entryFor(actor, permissionKey);

    const hasSpaceReach = entry.spaceIds.size > 0;
    const hasOwnReach = entry.own || entry.ownSpaceIds.size > 0;
    if (!entry.all && !hasSpaceReach && !hasOwnReach) {
        return { allowed: false, reason: "no_grant" };
    }

    if (entry.all) return ALLOWED;

    const spaceId = ctx?.spaceId ?? null;
    if (spaceId && entry.spaceIds.has(spaceId)) return ALLOWED;

    const own = isOwnResource(actor, ctx);
    if (own) {
        if (entry.own) return ALLOWED;
        if (spaceId && entry.ownSpaceIds.has(spaceId)) return ALLOWED;
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

/** Precise object-level check — the service layer's question. */
export const can = (
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
    ctx?: PermissionContext,
): boolean => decide(actor, permissionKey, ctx).allowed;

/**
 * Coarse verb-level check: does this actor hold the permission ANYWHERE?
 *
 * Used by the route middleware (P11) and by the client (P10/P25) to decide
 * whether a control is worth showing. True here does NOT mean a specific
 * action will succeed — the service still runs `can()` on the resolved row.
 */
export const holds = (
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
): boolean => {
    const e = entryFor(actor, permissionKey);
    return e.all || e.own || e.spaceIds.size > 0 || e.ownSpaceIds.size > 0;
};

// ─── error taxonomy ──────────────────────────────────────────────────────────

/** The generic code, and the one the RBAC domain itself uses. */
export const RBAC_FORBIDDEN = "rbac.forbidden";

/**
 * Domains whose error code is not simply the permission's own namespace.
 * `role.manage` / `role.assign` are the RBAC administration domain, and the
 * plan names `rbac.forbidden` as their code.
 */
const CODE_OVERRIDES: Readonly<Record<string, string>> = {
    role: RBAC_FORBIDDEN,
};

/**
 * `task.edit` → `task.forbidden`, `report.note` → `report.forbidden`.
 *
 * Derived from the key so a new permission never needs a new table entry, and
 * deliberately reusing `review.forbidden` / `report.forbidden` — the codes the
 * dept-review services already return — so that swapping those gates over in
 * P15 is invisible to the client.
 */
export const permissionErrorCode = (permissionKey: string): string => {
    const ns = permissionKey.split(".")[0];
    if (!ns) return RBAC_FORBIDDEN;
    return CODE_OVERRIDES[ns] ?? `${ns}.forbidden`;
};

/** "Edit tasks" → "edit tasks", for use mid-sentence. */
const phrase = (permissionKey: PermissionKey): string => {
    const label = getPermission(permissionKey)?.label;
    if (!label) return permissionKey;
    return label.charAt(0).toLowerCase() + label.slice(1);
};

/**
 * The message a person actually reads. Built from the catalog label, so it
 * names the capability in the same words as the checkbox an admin must tick
 * for them — "You don't have permission to edit tasks." beats "Forbidden".
 */
export const denyMessage = (
    permissionKey: PermissionKey,
    reason: DenyReason,
): string => {
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

/**
 * The 403 for a permission denial.
 *
 * `details` carries the permission key and the reason. Both are facts about
 * the ACTOR's own configuration, never about the resource — no space id, no
 * owner name — so this leaks nothing an existence-probe could use (D-9: reads
 * deny by 404 before ever reaching here).
 */
export const forbiddenFor = (
    permissionKey: PermissionKey,
    reason: DenyReason,
): AppError => {
    const details: ErrorDetail[] = [
        { field: "permission", issue: permissionKey },
        { field: "reason", issue: reason },
    ];
    return AppError.forbidden(
        permissionErrorCode(permissionKey),
        denyMessage(permissionKey, reason),
        details,
    );
};

/**
 * Object-level guard — the first statement of a mutating service method.
 * Throws the taxonomy 403; returns nothing when allowed.
 */
export function assertCan(
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
    ctx?: PermissionContext,
): void {
    const decision = decide(actor, permissionKey, ctx);
    if (!decision.allowed) {
        throw forbiddenFor(permissionKey, decision.reason);
    }
}

/**
 * Verb-level guard — for the route middleware, where no resource exists yet.
 * Always denies with `no_grant`, because "holds it nowhere" is the only way to
 * fail this check.
 */
export function assertHolds(
    actor: ActorPermissions | null | undefined,
    permissionKey: PermissionKey,
): void {
    if (!holds(actor, permissionKey)) {
        throw forbiddenFor(permissionKey, "no_grant");
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
export const routeForbidden = (permissionKey: PermissionKey): AppError =>
    AppError.forbidden(
        "auth.forbidden",
        "You don't have enough permissions",
        [
            { field: "permission", issue: permissionKey },
            { field: "reason", issue: "no_grant" },
        ],
    );
