"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const RolesController_1 = require("../controllers/RolesController");
const RolesAdminService_1 = require("../services/RolesAdminService");
const RolesRepo_1 = require("../repositories/RolesRepo");
const UserRolesRepo_1 = require("../repositories/UserRolesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const policy_1 = require("../rbac/policy");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const roles_1 = require("../validators/roles");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const service = new RolesAdminService_1.RolesAdminService(db, new RolesRepo_1.RolesRepo(db), new UserRolesRepo_1.UserRolesRepo(db), new UsersRepo_1.UsersRepo(db), new SpacesRepo_1.SpacesRepo(db), (0, policy_1.getPolicy)(), logger_1.default);
const controller = new RolesController_1.RolesController(service, logger_1.default);
const as = (req) => req;
const readGate = (0, requirePermission_1.requirePermission)("role.manage");
const assignGate = (0, requirePermission_1.requirePermission)("role.assign");
// ─── GET /api/v1/roles/catalog ───────────────────────────────────────────────
// 🔐 role.manage. The permission catalog grouped for the admin grid. Declared
// BEFORE `/roles/:id` so "catalog" is not read as an id.
router.get("/roles/catalog", authenticate_1.default, readGate, (req, res, next) => controller.catalog(as(req), res, next));
// ─── GET /api/v1/roles ───────────────────────────────────────────────────────
router.get("/roles", authenticate_1.default, readGate, (req, res, next) => controller.list(as(req), res, next));
// ─── POST /api/v1/roles ──────────────────────────────────────────────────────
router.post("/roles", authenticate_1.default, readGate, roles_1.createRoleValidator, validate_1.validate, (req, res, next) => controller.create(as(req), res, next));
// ─── PATCH /api/v1/roles/:id ─────────────────────────────────────────────────
router.patch("/roles/:id", authenticate_1.default, readGate, roles_1.updateRoleValidator, validate_1.validate, (req, res, next) => controller.update(as(req), res, next));
// ─── PUT /api/v1/roles/:id/permissions ───────────────────────────────────────
// The permission grid's save. Replaces the whole grant set atomically.
router.put("/roles/:id/permissions", authenticate_1.default, readGate, roles_1.setPermissionsValidator, validate_1.validate, (req, res, next) => controller.setPermissions(as(req), res, next));
// ─── GET /api/v1/roles/:id/holders ───────────────────────────────────────────
router.get("/roles/:id/holders", authenticate_1.default, readGate, roles_1.roleIdValidator, validate_1.validate, (req, res, next) => controller.holders(as(req), res, next));
// ─── DELETE /api/v1/roles/:id ────────────────────────────────────────────────
router.delete("/roles/:id", authenticate_1.default, readGate, roles_1.roleIdValidator, validate_1.validate, (req, res, next) => controller.remove(as(req), res, next));
// ─── assignments ─────────────────────────────────────────────────────────────
// 🔐 role.assign. `/users/:id/roles` sits in this router (not `users.ts`)
// because it is RBAC surface; the path is declared in full and the router
// mounts at the v1 root BEFORE `/users` so the 3-segment path wins.
router.get("/users/:id/roles", authenticate_1.default, assignGate, roles_1.roleIdValidator, validate_1.validate, (req, res, next) => controller.listAssignments(as(req), res, next));
router.post("/users/:id/roles", authenticate_1.default, assignGate, roles_1.assignRoleValidator, validate_1.validate, (req, res, next) => controller.assign(as(req), res, next));
router.delete("/users/:id/roles/:assignmentId", authenticate_1.default, assignGate, roles_1.revokeRoleValidator, validate_1.validate, (req, res, next) => controller.revoke(as(req), res, next));
// ─── GET /api/v1/spaces/:id/members ──────────────────────────────────────────
// 🔐 space.members_manage. Everyone holding a role scoped to this space — the
// membership model IS the assignment table (plan D-1/D-2).
router.get("/spaces/:id/members", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.members_manage"), roles_1.roleIdValidator, validate_1.validate, (req, res, next) => controller.spaceMembers(as(req), res, next));
exports.default = router;
