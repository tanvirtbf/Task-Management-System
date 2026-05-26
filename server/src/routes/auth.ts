import { Router } from "express";
import { AuthController } from "../controllers/AuthController";
import { AuthService } from "../services/authService";
import { CredentialService } from "../services/credentialService";
import { TokenService } from "../services/tokenService";
import { UserService } from "../services/userService";
import { authenticate } from "../middlewares/authenticate";
import {
    loginRateLimiter,
    logoutRateLimiter,
    refreshRateLimiter,
    registerRateLimiter,
} from "../middlewares/rateLimiters";
import { loginValidator, registerValidator } from "../validators/authValidator";

const router = Router();

const userService = new UserService();
const credentialService = new CredentialService();
const tokenService = new TokenService();
const authService = new AuthService(userService, credentialService, tokenService);
const controller = new AuthController(authService, userService);

router.post("/register", registerRateLimiter, registerValidator, controller.register);
router.post("/login", loginRateLimiter, loginValidator, controller.login);
router.post("/refresh", refreshRateLimiter, controller.refresh);
router.post("/logout", logoutRateLimiter, controller.logout);
router.get("/me", authenticate, controller.me);

export default router;
