import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

export const registerRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { errors: [{ msg: "Too many registration attempts. Try again later." }] },
});

export const loginRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    max: 7,
    standardHeaders: true,
    legacyHeaders: false,
    message: { errors: [{ msg: "Too many login attempts. Try again later." }] },
});

export const refreshRateLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
});

export const logoutRateLimiter = rateLimit({
    windowMs: ONE_MINUTE,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

export const apiRateLimiter = rateLimit({
    windowMs: ONE_MINUTE,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
});
