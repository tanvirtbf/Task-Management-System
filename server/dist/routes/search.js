"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const SearchController_1 = require("../controllers/SearchController");
const SearchService_1 = require("../services/SearchService");
const SearchRepo_1 = require("../repositories/SearchRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskDeleteRequestsRepo_1 = require("../repositories/TaskDeleteRequestsRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const search_1 = require("../validators/search");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// SearchRepo owns the five LIKE queries; TasksRepo is reused (read-only) for the
// batched task hydration — neither is mutated. TaskDeleteRequestsRepo supplies
// the "deletion pending" flag (KI-35), the same way the List and My Work
// surfaces get it.
const db = (0, client_1.getDb)();
const searchRepo = new SearchRepo_1.SearchRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const searchService = new SearchService_1.SearchService(searchRepo, tasksRepo, new TaskDeleteRequestsRepo_1.TaskDeleteRequestsRepo(db));
const searchController = new SearchController_1.SearchController(searchService, logger_1.default);
// ─── GET /api/v1/search ──────────────────────────────────────────────────────
// 🔐 any authenticated member. Multi-resource typeahead, all results scoped to
// the caller's workspace.
router.get("/", authenticate_1.default, search_1.searchValidator, validate_1.validate, (req, res, next) => searchController.search(req, res, next));
exports.default = router;
