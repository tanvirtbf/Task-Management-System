"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const WorkspaceController_1 = require("../controllers/WorkspaceController");
const WorkspaceService_1 = require("../services/WorkspaceService");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const workspace_1 = require("../validators/workspace");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const workspaceRepo = new WorkspaceRepo_1.WorkspaceRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const workspaceService = new WorkspaceService_1.WorkspaceService(db, workspaceRepo, workspaceActivityRepo);
const workspaceController = new WorkspaceController_1.WorkspaceController(workspaceService, logger_1.default);
// ─── GET /api/v1/workspace ───────────────────────────────────────────────────
// Authenticated (any member). Returns the workspace bound to the caller's JWT
// `workspaceId` claim — the id is never read from client input, so there is no
// cross-tenant read. The v1-level `apiLimiter` already covers rate limiting.
router.get("/", authenticate_1.default, (req, res, next) => workspaceController.get(req, res, next));
// ─── PATCH /api/v1/workspace ───────────────────────────────────────────────────
// 👑 Admin/owner only. Partial update of workspace settings; writes a
// `workspace_activity` row in the same transaction. Returns the updated
// Workspace (200). `requirePermission` yields a spec-shaped `auth.forbidden` envelope
// via the global error handler; the target is always the caller's own
// `workspaceId` claim, so there is no cross-tenant write.
router.patch("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("workspace.settings"), workspace_1.workspaceUpdateValidator, validate_1.validate, (req, res, next) => workspaceController.patch(req, res, next));
exports.default = router;
