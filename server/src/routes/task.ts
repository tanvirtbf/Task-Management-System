import { Router } from "express";
import { TaskController } from "../controllers/TaskController";
import { TaskService } from "../services/taskService";
import { authenticate } from "../middlewares/authenticate";
import { apiRateLimiter } from "../middlewares/rateLimiters";
import { createTaskValidator, updateTaskValidator } from "../validators/taskValidator";

const router = Router();

const taskService = new TaskService();
const controller = new TaskController(taskService);

router.use(authenticate, apiRateLimiter);

router.get("/", controller.list);
router.get("/:id", controller.getOne);
router.post("/", createTaskValidator, controller.create);
router.patch("/:id", updateTaskValidator, controller.update);
router.delete("/:id", controller.remove);

export default router;
