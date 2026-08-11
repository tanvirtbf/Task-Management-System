"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const TeamsController_1 = require("../controllers/TeamsController");
const TeamMembershipService_1 = require("../services/TeamMembershipService");
const teams_1 = require("../validators/teams");
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
const router = express_1.default.Router();
const controller = new TeamsController_1.TeamsController((0, TeamMembershipService_1.teamMembership)(), logger_1.default);
const as = (req) => req;
// ─── GET /api/v1/teams ───────────────────────────────────────────────────────
// 🔐 member.view — whoever may see the member roster may see the org chart.
router.get("/teams", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.view"), (req, res, next) => controller.directory(as(req), res, next));
// ─── POST /api/v1/spaces/:id/members ─────────────────────────────────────────
// 🔐 admin OR the space's head OR `space.members_manage` (service-enforced).
router.post("/spaces/:id/members", authenticate_1.default, teams_1.addTeamMemberValidator, validate_1.validate, (req, res, next) => controller.addMember(as(req), res, next));
// ─── DELETE /api/v1/spaces/:id/members/:userId ───────────────────────────────
// Same guard. The current head cannot be removed (409 `team.head_locked`).
router.delete("/spaces/:id/members/:userId", authenticate_1.default, teams_1.removeTeamMemberValidator, validate_1.validate, (req, res, next) => controller.removeMember(as(req), res, next));
// ─── PATCH /api/v1/users/:id/team ────────────────────────────────────────────
// 🔐 member.role_change (org-structure management, same tier as role changes).
// Body `{space_id}`; null clears. Setting a team also ensures membership.
router.patch("/users/:id/team", authenticate_1.default, (0, requirePermission_1.requirePermission)("member.role_change"), teams_1.setHomeTeamValidator, validate_1.validate, (req, res, next) => controller.setHomeTeam(as(req), res, next));
exports.default = router;
