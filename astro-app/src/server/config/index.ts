import { readEnv } from "../shim/env";

/**
 * Lazy config — every property reads the environment at ACCESS time, not at
 * import time. On Cloudflare Workers env vars only exist per-request (the
 * Astro middleware calls setRuntimeEnv() before the backend runs), so the
 * old `const { X } = process.env` destructuring pattern would freeze
 * undefined values at module load.
 *
 * Key set mirrors the original Express server's Config, with MySQL replaced
 * by Turso (libSQL).
 */
export const Config = {
    get PORT() {
        return readEnv("PORT");
    },
    get NODE_ENV() {
        return readEnv("NODE_ENV");
    },
    get LOG_LEVEL() {
        return readEnv("LOG_LEVEL");
    },

    // ── Turso (libSQL) ────────────────────────────────────────────────────
    get TURSO_DATABASE_URL() {
        return readEnv("TURSO_DATABASE_URL");
    },
    get TURSO_AUTH_TOKEN() {
        return readEnv("TURSO_AUTH_TOKEN");
    },

    // ── Auth ──────────────────────────────────────────────────────────────
    get ACCESS_TOKEN_SECRET() {
        return readEnv("ACCESS_TOKEN_SECRET");
    },
    get REFRESH_TOKEN_SECRET() {
        return readEnv("REFRESH_TOKEN_SECRET");
    },
    get COOKIE_SECRET() {
        return readEnv("COOKIE_SECRET");
    },
    get ACCESS_TOKEN_TTL() {
        return readEnv("ACCESS_TOKEN_TTL");
    },
    get REFRESH_TOKEN_TTL() {
        return readEnv("REFRESH_TOKEN_TTL");
    },

    // ── Mailer — prefer MAIL_* names, legacy SMTP_*/EMAIL_* fallback ──────
    get SMTP_HOST() {
        return readEnv("MAIL_HOST") ?? readEnv("SMTP_HOST");
    },
    get SMTP_PORT() {
        return readEnv("MAIL_PORT") ?? readEnv("SMTP_PORT");
    },
    get SMTP_USER() {
        return readEnv("MAIL_USERNAME") ?? readEnv("SMTP_USER");
    },
    get SMTP_PASS() {
        return readEnv("MAIL_PASSWORD") ?? readEnv("SMTP_PASS");
    },
    get EMAIL_FROM() {
        return readEnv("MAIL_FROM_ADDRESS") ?? readEnv("EMAIL_FROM");
    },
    get EMAIL_FROM_NAME() {
        return readEnv("MAIL_FROM_NAME") ?? readEnv("EMAIL_FROM_NAME");
    },

    // ── Public URLs ───────────────────────────────────────────────────────
    get FRONTEND_URL() {
        return readEnv("FRONTEND_URL");
    },
    get API_URL() {
        return readEnv("API_URL");
    },
    get CORS_ALLOWED_ORIGINS() {
        return readEnv("CORS_ALLOWED_ORIGINS");
    },

    get INTERNAL_JOB_TOKEN() {
        return readEnv("INTERNAL_JOB_TOKEN");
    },

    // ── Cloudflare R2 (S3-compatible presigned uploads) ──────────────────
    get CLOUDFLARE_ACCOUNT_ID() {
        return readEnv("CLOUDFLARE_ACCOUNT_ID");
    },
    get CLOUDFLARE_R2_ACCESS_KEY() {
        return readEnv("CLOUDFLARE_R2_ACCESS_KEY");
    },
    get CLOUDFLARE_R2_SECRET_KEY() {
        return readEnv("CLOUDFLARE_R2_SECRET_KEY");
    },
    get CLOUDFLARE_R2_BUCKET() {
        return readEnv("CLOUDFLARE_R2_BUCKET");
    },
    get CLOUDFLARE_R2_PUBLIC_URL() {
        return readEnv("CLOUDFLARE_R2_PUBLIC_URL");
    },
    get R2_SIGNED_URL_TTL() {
        return readEnv("R2_SIGNED_URL_TTL");
    },

    // ── OpenAI (AI Help Assistant) ────────────────────────────────────────
    get OPENAI_API_KEY() {
        return readEnv("OPENAI_API_KEY");
    },
    get OPENAI_MODEL() {
        return readEnv("OPENAI_MODEL") ?? "gpt-4o-mini";
    },
    get OPENAI_MAX_OUTPUT_TOKENS() {
        return readEnv("OPENAI_MAX_OUTPUT_TOKENS") ?? "800";
    },

    // ── Encryption (PII at rest) ──────────────────────────────────────────
    get ENCRYPTION_KEY() {
        return readEnv("ENCRYPTION_KEY") ?? "";
    },
};
