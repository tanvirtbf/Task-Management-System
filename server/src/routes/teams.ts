import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import { TeamsController } from "../controllers/TeamsController";
import { teamMembership } from "../services/TeamMembershipService";
import {
    addTeamMemberValidator,
    grantVisibilityValidator,
    removeTeamMemberValidator,
    revokeVisibilityValidator,
    setHomeTeamValidator,
} from "../validators/teams";
import type { AuthRequest } from "../types";

/**
 * Teams & membership (team-access P1). Mounts at the v1 ROOT (like roles.ts)
 * because its 3-segment paths (`/spaces/:id/members`, `/users/:id/team`) must
 * resolve ahead of the `/spaces/:id` and `/users/:id` param routes.
 *
 * The member add/remove routes deliberately carry NO `requirePermission`: a
 * department head may manage their own team's roster without holding any
 * admin key, so the rule is row-dependent ("admin OR this space's head OR a
 * `space.members_manage` grant reaching this space") and enforced in
 * `TeamMembershipService.assertTeamManager` — the ReviewsService pattern.
 */
const router = express.Router();

const controller = new TeamsController(teamMembership(), logger);
const as = (req: Request) => req as AuthRequest;

// ─── GET /api/v1/teams ───────────────────────────────────────────────────────
// 🔐 member.view — whoever may see the member roster may see the org chart.
router.get(
    "/teams",
    authenticate,
    requirePermission("member.view"),
    (req: Request, res: Response, next: NextFunction) =>
        controller.directory(as(req), res, next),
);

// ─── POST /api/v1/spaces/:id/members ─────────────────────────────────────────
// 🔐 admin OR the space's head OR `space.members_manage` (service-enforced).
router.post(
    "/spaces/:id/members",
    authenticate,
    addTeamMemberValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.addMember(as(req), res, next),
);

// ─── DELETE /api/v1/spaces/:id/members/:userId ───────────────────────────────
// Same guard. The current head cannot be removed (409 `team.head_locked`).
router.delete(
    "/spaces/:id/members/:userId",
    authenticate,
    removeTeamMemberValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.removeMember(as(req), res, next),
);

// ─── POST /api/v1/spaces/:id/visibility-grants ───────────────────────────────
// 🔐 space.members_manage at the ROUTE (admin/owner only) — deliberately NO
// service-level head branch, unlike the member routes: a head must not be able
// to self-expand what their own team can see. Body `{target_space_id}`.
// Idempotent 204. DORMANT until the P6 visibility switch.
router.post(
    "/spaces/:id/visibility-grants",
    authenticate,
    requirePermission("space.members_manage"),
    grantVisibilityValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.grantVisibility(as(req), res, next),
);

// ─── DELETE /api/v1/spaces/:id/visibility-grants/:targetId ───────────────────
// Same gate. Idempotent 204.
router.delete(
    "/spaces/:id/visibility-grants/:targetId",
    authenticate,
    requirePermission("space.members_manage"),
    revokeVisibilityValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.revokeVisibility(as(req), res, next),
);

// ─── PATCH /api/v1/users/:id/team ────────────────────────────────────────────
// 🔐 member.role_change (org-structure management, same tier as role changes).
// Body `{space_id}`; null clears. Setting a team also ensures membership.
router.patch(
    "/users/:id/team",
    authenticate,
    requirePermission("member.role_change"),
    setHomeTeamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.setHomeTeam(as(req), res, next),
);

export default router;
