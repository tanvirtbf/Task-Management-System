import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { RolesController } from "../controllers/RolesController";
import { RolesAdminService } from "../services/RolesAdminService";
import { RolesRepo } from "../repositories/RolesRepo";
import { UserRolesRepo } from "../repositories/UserRolesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { getPolicy } from "../rbac/policy";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    assignRoleValidator,
    createRoleValidator,
    revokeRoleValidator,
    roleIdValidator,
    setPermissionsValidator,
    updateRoleValidator,
} from "../validators/roles";
import type { AuthRequest } from "../types";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const service = new RolesAdminService(
    db,
    new RolesRepo(db),
    new UserRolesRepo(db),
    new UsersRepo(db),
    new SpacesRepo(db),
    getPolicy(),
    logger,
);
const controller = new RolesController(service, logger);

const as = (req: Request) => req as AuthRequest;
const readGate = requirePermission("role.manage");
const assignGate = requirePermission("role.assign");

// ─── GET /api/v1/roles/catalog ───────────────────────────────────────────────
// 🔐 role.manage. The permission catalog grouped for the admin grid. Declared
// BEFORE `/roles/:id` so "catalog" is not read as an id.
router.get(
    "/roles/catalog",
    authenticate,
    readGate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.catalog(as(req), res, next),
);

// ─── GET /api/v1/roles ───────────────────────────────────────────────────────
router.get(
    "/roles",
    authenticate,
    readGate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(as(req), res, next),
);

// ─── POST /api/v1/roles ──────────────────────────────────────────────────────
router.post(
    "/roles",
    authenticate,
    readGate,
    createRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(as(req), res, next),
);

// ─── PATCH /api/v1/roles/:id ─────────────────────────────────────────────────
router.patch(
    "/roles/:id",
    authenticate,
    readGate,
    updateRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.update(as(req), res, next),
);

// ─── PUT /api/v1/roles/:id/permissions ───────────────────────────────────────
// The permission grid's save. Replaces the whole grant set atomically.
router.put(
    "/roles/:id/permissions",
    authenticate,
    readGate,
    setPermissionsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.setPermissions(as(req), res, next),
);

// ─── GET /api/v1/roles/:id/holders ───────────────────────────────────────────
router.get(
    "/roles/:id/holders",
    authenticate,
    readGate,
    roleIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.holders(as(req), res, next),
);

// ─── DELETE /api/v1/roles/:id ────────────────────────────────────────────────
router.delete(
    "/roles/:id",
    authenticate,
    readGate,
    roleIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.remove(as(req), res, next),
);

// ─── assignments ─────────────────────────────────────────────────────────────
// 🔐 role.assign. `/users/:id/roles` sits in this router (not `users.ts`)
// because it is RBAC surface; the path is declared in full and the router
// mounts at the v1 root BEFORE `/users` so the 3-segment path wins.
router.get(
    "/users/:id/roles",
    authenticate,
    assignGate,
    roleIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.listAssignments(as(req), res, next),
);

router.post(
    "/users/:id/roles",
    authenticate,
    assignGate,
    assignRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.assign(as(req), res, next),
);

router.delete(
    "/users/:id/roles/:assignmentId",
    authenticate,
    assignGate,
    revokeRoleValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.revoke(as(req), res, next),
);

// ─── GET /api/v1/spaces/:id/members ──────────────────────────────────────────
// 🔐 space.members_manage. Everyone holding a role scoped to this space — the
// membership model IS the assignment table (plan D-1/D-2).
router.get(
    "/spaces/:id/members",
    authenticate,
    requirePermission("space.members_manage"),
    roleIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.spaceMembers(as(req), res, next),
);

export default router;
