"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const allowQuery_1 = require("../middlewares/allowQuery");
const TagController_1 = require("../controllers/TagController");
const TagService_1 = require("../services/TagService");
const TagsRepo_1 = require("../repositories/TagsRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const tags_1 = require("../validators/tags");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const tagsRepo = new TagsRepo_1.TagsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const tagService = new TagService_1.TagService(db, tagsRepo, workspaceActivityRepo, logger_1.default);
const tagController = new TagController_1.TagController(tagService, logger_1.default);
// ─── GET /api/v1/tags ──────────────────────────────────────────────────────
// Authenticated — any role may list the workspace's tags (only create / update
// / delete are owner/admin per §9). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input. Tags are workspace-wide.
router.get("/", authenticate_1.default, 
// F23 (ISS-014): a mistyped filter is a 422, not the full set.
(0, allowQuery_1.allowQuery)(["limit", "cursor"]), (req, res, next) => tagController.list(req, res, next));
// ─── POST /api/v1/tags ─────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body.
router.post("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.tags"), tags_1.createTagValidator, validate_1.validate, (req, res, next) => tagController.create(req, res, next));
// ─── PATCH /api/v1/tags/:id ────────────────────────────────────────────────
// 👑 admin/owner only. Same chain/precedence as POST: `authenticate` (401) →
// `requirePermission` (403) → validation (422). The tag id is a path param; workspace
// scope and the actor come from `req.auth`, never the body.
router.patch("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.tags"), tags_1.updateTagValidator, validate_1.validate, (req, res, next) => tagController.update(req, res, next));
// ─── DELETE /api/v1/tags/:id ───────────────────────────────────────────────
// 👑 admin/owner only. Same chain/precedence as POST/PATCH: `authenticate`
// (401) → `requirePermission` (403) → validation (422). Deleting a tag also removes it
// from every task that had it (via the `task_tags` FK cascade). The tag id is a
// path param; workspace scope and the actor come from `req.auth`, never the body.
router.delete("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("catalog.tags"), tags_1.deleteTagValidator, validate_1.validate, (req, res, next) => tagController.delete(req, res, next));
exports.default = router;
