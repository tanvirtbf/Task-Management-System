"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const MeController_1 = require("../controllers/MeController");
const policy_1 = require("../rbac/policy");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const router = express_1.default.Router();
const meController = new MeController_1.MeController((0, policy_1.getPolicy)(), logger_1.default);
// ─── GET /api/v1/me/permissions ──────────────────────────────────────────────
// 🔐 any authenticated user. Their resolved permission set + the spaces they
// can see, resolved fresh from the DB (never from the JWT) so a revocation is
// visible on the next call.
router.get("/me/permissions", authenticate_1.default, (req, res, next) => meController.permissions(req, res, next));
exports.default = router;
