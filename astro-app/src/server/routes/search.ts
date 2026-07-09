import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { SearchController } from "../controllers/SearchController";
import { SearchService } from "../services/SearchService";
import { SearchRepo } from "../repositories/SearchRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { searchValidator } from "../validators/search";
import type { AuthRequest } from "../types";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// SearchRepo owns the five LIKE queries; TasksRepo is reused (read-only) for the
// batched task hydration — neither is mutated.
const db = getDb();
const searchRepo = new SearchRepo(db);
const tasksRepo = new TasksRepo(db);
const searchService = new SearchService(searchRepo, tasksRepo);
const searchController = new SearchController(searchService, logger);

// ─── GET /api/v1/search ──────────────────────────────────────────────────────
// 🔐 any authenticated member. Multi-resource typeahead, all results scoped to
// the caller's workspace.
router.get(
    "/",
    authenticate,
    searchValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        searchController.search(req as AuthRequest, res, next),
);

export default router;
