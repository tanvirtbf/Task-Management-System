import { config } from "dotenv";

config();

const requiredEnvVars = [
    "SECRET_KEY",
    "DB_HOST",
    "DB_PORT",
    "DB_USERNAME",
    "DB_PASSWORD",
    "DB_NAME",
] as const;

const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const {
    PORT,
    NODE_ENV,
    DB_HOST,
    DB_PORT,
    DB_USERNAME,
    DB_PASSWORD,
    DB_NAME,
    SECRET_KEY,
    FRONTEND_URL,
} = process.env;

export const Config = {
    PORT: PORT || "4000",
    NODE_ENV: NODE_ENV || "dev",
    DB_HOST: DB_HOST!,
    DB_PORT: DB_PORT!,
    DB_USERNAME: DB_USERNAME!,
    DB_PASSWORD: DB_PASSWORD!,
    DB_NAME: DB_NAME!,
    SECRET_KEY: SECRET_KEY!,
    FRONTEND_URL: FRONTEND_URL || "http://localhost:5173",

    ACCESS_TOKEN_TTL: "1h",
    REFRESH_TOKEN_TTL: "7d",
    REFRESH_TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,
};
