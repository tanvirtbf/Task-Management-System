import { config } from "dotenv";
import path from "path";

// Base config — always loaded.
config({
    path: path.join(__dirname, `../../.env`),
});
// When running under NODE_ENV=test we layer `.env.test` on top so the test
// suite can point at a separate database / mailer / etc. without clobbering
// the dev `.env`. Dev does NOT auto-load `.env.dev` — we want one source of
// truth for local development.
if (process.env.NODE_ENV === "test") {
    config({
        path: path.join(__dirname, `../../.env.test`),
        override: true,
    });
}

const {
    PORT,
    NODE_ENV,
    LOG_LEVEL,

    DB_HOST,
    DB_PORT,
    DB_USERNAME,
    DB_PASSWORD,
    DB_NAME,
    DB_POOL_MAX,
    DB_POOL_QUEUE_LIMIT,

    ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_SECRET,
    COOKIE_SECRET,
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,

    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    EMAIL_FROM,
    EMAIL_FROM_NAME,

    FRONTEND_URL,
    API_URL,
    CORS_ALLOWED_ORIGINS,

    INTERNAL_JOB_TOKEN,

    // Cloudflare R2 (S3-compatible object storage for §16 attachments).
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY,
    CLOUDFLARE_R2_SECRET_KEY,
    CLOUDFLARE_R2_BUCKET,
    CLOUDFLARE_R2_PUBLIC_URL,
    R2_SIGNED_URL_TTL,
} = process.env;

export const Config = {
    PORT,
    NODE_ENV,
    LOG_LEVEL,

    DB_HOST,
    DB_PORT,
    DB_USERNAME,
    DB_PASSWORD,
    // `DB_NAME_OVERRIDE` lets a single process (e.g. one jest run) target an
    // isolated database without editing the shared `.env.test`. Backward
    // compatible: when unset, the normal `DB_NAME` applies.
    DB_NAME: process.env.DB_NAME_OVERRIDE ?? DB_NAME,
    DB_POOL_MAX,
    DB_POOL_QUEUE_LIMIT,

    ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_SECRET,
    COOKIE_SECRET,
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,

    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    EMAIL_FROM,
    EMAIL_FROM_NAME,

    FRONTEND_URL,
    API_URL,
    CORS_ALLOWED_ORIGINS,

    INTERNAL_JOB_TOKEN,

    // Cloudflare R2 — consumed by R2Service. Absent in `.env.test`, which is
    // how the attachment suite runs with zero network (R2Service falls back to
    // its deterministic test transport).
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY,
    CLOUDFLARE_R2_SECRET_KEY,
    CLOUDFLARE_R2_BUCKET,
    CLOUDFLARE_R2_PUBLIC_URL,
    R2_SIGNED_URL_TTL,
};
