"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const WorkspaceActivityController_1 = require("../controllers/WorkspaceActivityController");
const WorkspaceActivityService_1 = require("../services/WorkspaceActivityService");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const workspaceActivity_1 = require("../validators/workspaceActivity");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const activityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const service = new WorkspaceActivityService_1.WorkspaceActivityService(activityRepo, usersRepo);
const controller = new WorkspaceActivityController_1.WorkspaceActivityController(service, logger_1.default);
// Mounted at the `/activity` prefix. `/recent` (literal) is declared before the
// `/` feed for clarity; the two never collide (distinct paths).
// ─── GET /api/v1/activity/recent ─────────────────────────────────────────────
// Authenticated — any workspace member may read the workspace's activity feed
// (no role gate per the spec). Workspace scope comes from `req.auth.workspaceId`.
router.get("/recent", authenticate_1.default, (0, requirePermission_1.requirePermission)("activity.view"), workspaceActivity_1.recentActivityValidator, validate_1.validate, (req, res, next) => controller.recent(req, res, next));
// ─── GET /api/v1/activity ────────────────────────────────────────────────────
router.get("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("activity.view"), workspaceActivity_1.activityFeedValidator, validate_1.validate, (req, res, next) => controller.feed(req, res, next));
exports.default = router;
