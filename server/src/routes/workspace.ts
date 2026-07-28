import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { WorkspaceController } from "../controllers/WorkspaceController";
import { WorkspaceService } from "../services/WorkspaceService";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import { workspaceUpdateValidator } from "../validators/workspace";
import type { AuthRequest } from "../types";
import type { WorkspaceUpdateRequest } from "../types/workspace";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const workspaceRepo = new WorkspaceRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const workspaceService = new WorkspaceService(
    db,
    workspaceRepo,
    workspaceActivityRepo,
);
const workspaceController = new WorkspaceController(workspaceService, logger);

// ─── GET /api/v1/workspace ───────────────────────────────────────────────────
// Authenticated (any member). Returns the workspace bound to the caller's JWT
// `workspaceId` claim — the id is never read from client input, so there is no
// cross-tenant read. The v1-level `apiLimiter` already covers rate limiting.
router.get(
    "/",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        workspaceController.get(req as AuthRequest, res, next),
);

// ─── PATCH /api/v1/workspace ───────────────────────────────────────────────────
// 👑 Admin/owner only. Partial update of workspace settings; writes a
// `workspace_activity` row in the same transaction. Returns the updated
// Workspace (200). `requirePermission` yields a spec-shaped `auth.forbidden` envelope
// via the global error handler; the target is always the caller's own
// `workspaceId` claim, so there is no cross-tenant write.
router.patch(
    "/",
    authenticate,
    requirePermission("workspace.settings"),
    workspaceUpdateValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        workspaceController.patch(req as WorkspaceUpdateRequest, res, next),
);

export default router;
