"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rbacContext = exports.requirePermission = void 0;
const can_1 = require("../rbac/can");
const context_1 = require("../rbac/context");
const policy_1 = require("../rbac/policy");
/**
 * THE VERB GATE (RBAC_DYNAMIC_PLAN.md P11) — replaces `canAccess([...roles])`.
 *
 * `canAccess` asked "is your JWT's role in this list?", which meant a role
 * change took up to 15 minutes to bite and the answer could never depend on
 * anything but four hard-coded strings. This asks "do you hold this permission,
 * anywhere?", resolved from the database and cached by `permissions_version`,
 * so a revocation is instant.
 *
 * It is deliberately the COARSE half of the check: a middleware runs before the
 * resource is loaded, so it cannot know which space the row lives in. A person
 * who holds `task.edit` only in Marketing passes this gate and is then refused
 * by the service's `assertCan` on a Support task. Both layers are mandatory.
 *
 * ⚠️ THIS IS THE FIRST MIDDLEWARE IN THE CODEBASE THAT READS THE DATABASE.
 * Unavoidable: D-5 requires permissions to come from the database rather than
 * the token. A cache hit costs one indexed lookup.
 *
 * ── THE UNRESOLVABLE-ACTOR CASE ──────────────────────────────────────────────
 * A valid JWT can name a workspace that no longer exists (deleted after the
 * token was issued). Before P11 that request reached the handler and got the
 * handler's natural 404. It still does — turning it into a 403 would be a
 * gratuitous contract change, and it is safe because every downstream query is
 * workspace-scoped and matches nothing. But a JWT naming a workspace that DOES
 * exist for a user who is not in it is refused here: that request could
 * otherwise reach workspace-level rows.
 */
const requirePermission = (permissionKey) => (req, _res, next) => {
    void (async () => {
        try {
            const actor = await (0, context_1.currentActor)();
            if (actor) {
                if (!(0, can_1.holds)(actor, permissionKey)) {
                    throw (0, can_1.routeForbidden)(permissionKey);
                }
                next();
                return;
            }
            const { workspaceId } = req.auth ?? {};
            const exists = !!workspaceId &&
                (await (0, policy_1.getPolicy)().workspaceExists(workspaceId));
            if (exists)
                throw (0, can_1.routeForbidden)(permissionKey);
            next();
        }
        catch (err) {
            next(err);
        }
    })();
};
exports.requirePermission = requirePermission;
/**
 * Establish the per-request RBAC context. Mounted ONCE on the v1 router, ahead
 * of every route, so no endpoint can accidentally run without it. Resolution is
 * lazy — this runs before `authenticate`, and `currentActor()` reads `req.auth`
 * at the moment it is first needed.
 */
const rbacContext = (req, _res, next) => {
    (0, context_1.runWithRequest)(req, next);
};
exports.rbacContext = rbacContext;
