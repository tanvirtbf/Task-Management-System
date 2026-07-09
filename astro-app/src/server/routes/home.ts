import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { HomeController } from "../controllers/HomeController";
import { HomeService } from "../services/HomeService";
import { HomeRepo } from "../repositories/HomeRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { agendaValidator } from "../validators/home";
import type { AuthRequest } from "../types";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// HomeRepo owns the KPI/agenda aggregate queries; TasksRepo is reused (read-only)
// for the agenda's batched task hydration — neither is mutated.
const db = getDb();
const homeRepo = new HomeRepo(db);
const tasksRepo = new TasksRepo(db);
const homeService = new HomeService(homeRepo, tasksRepo);
const homeController = new HomeController(homeService, logger);

// ─── GET /api/v1/home/kpis ───────────────────────────────────────────────────
// 🔐 any authenticated member. The 6 home KPI tiles, scoped to the caller's
// workspace (and user, where the metric is "my").
router.get(
    "/kpis",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        homeController.kpis(req as AuthRequest, res, next),
);

// ─── GET /api/v1/home/agenda ─────────────────────────────────────────────────
// 🔐 any authenticated member. The caller's open tasks due on `?date=` (today
// by default).
router.get(
    "/agenda",
    authenticate,
    agendaValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        homeController.agenda(req as AuthRequest, res, next),
);

export default router;
