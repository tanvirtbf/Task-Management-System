"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeController = void 0;
const errors_1 = require("../errors");
const permissionsSerializer_1 = require("../serializers/permissionsSerializer");
/**
 * `GET /api/v1/me/permissions` (API_DESIGN.md §34).
 *
 * The client's whole view of what it may do. Deliberately a SEPARATE endpoint
 * from `/auth/me`: identity and authority change on different schedules — a
 * 403 or a role change means "refetch permissions", not "refetch who I am" —
 * and `/auth/me` is a pinned Appendix-A shape (exactly 10 keys, asserted by
 * three tests) that must not grow a nested object.
 */
class MeController {
    policy;
    logger;
    constructor(policy, logger) {
        this.policy = policy;
        this.logger = logger;
    }
    async permissions(req, res, next) {
        try {
            const { sub: userId, workspaceId } = req.auth;
            const principal = await this.policy.principalFor(userId, workspaceId);
            if (!principal) {
                // The token names a user who is not in that workspace — the
                // same 404 the rest of the API gives for out-of-tenant ids.
                throw errors_1.AppError.notFound("user.not_found", "User not found");
            }
            this.logger.debug("me.permissions.ok", {
                requestId: req.requestId,
                userId,
                version: principal.actor.version,
                count: principal.actor.perms.size,
            });
            res.status(200).json((0, permissionsSerializer_1.toWirePermissions)(principal.actor, principal.scope));
        }
        catch (err) {
            next(err);
        }
    }
}
exports.MeController = MeController;
