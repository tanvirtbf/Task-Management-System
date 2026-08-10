-- 015_push_subscriptions.sql — Web Push notifications (§29c), 2026-08-08
--
-- The third notification channel, after 014's email + overdue-alert job:
-- REAL browser/desktop/phone notifications, delivered by the operating system
-- even when the app tab is closed (desktop Chrome/Edge/Firefox and Android;
-- iOS only when the site is installed to the Home Screen, per Apple).
--
-- One table: `push_subscriptions` — one row per (user, browser/device) pair.
-- Written by `POST /api/v1/push/subscriptions` after the device grants the
-- browser Notification permission (the client asks once, on first sign-in);
-- deleted on sign-out or by PushService when the push service answers 404/410
-- (the browser revoked/expired it).
--
-- `endpoint` (the push-service URL) is too long for a utf8mb4 unique index, so
-- uniqueness rides on `endpoint_hash` = SHA-256 hex of the endpoint. A device
-- that re-subscribes under a DIFFERENT user (shared computer) is REASSIGNED by
-- the upsert — it delivers to whoever is signed in, never the previous user.
--
-- Ships WITH the 2026-08-08 push build (routes/push.ts + PushService). The
-- server also needs a VAPID keypair in its .env:
--     cd server && npx web-push generate-vapid-keys
-- Without those keys the feature is simply OFF (503 push.not_configured) — the
-- table is harmless either way, so this upgrade is safe to apply ahead of the
-- key rollout.
--
-- Fresh `db:setup` now provisions 43 tables / 5 views / 9 triggers (was 42/5/9
-- since F33).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS (the 007 pattern) — re-running is a
-- no-op, and the dev/qa databases that already carry the table are untouched.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id             VARCHAR(64)   NOT NULL,
    user_id        VARCHAR(64)   NOT NULL,
    endpoint_hash  CHAR(64)      NOT NULL,
    endpoint       VARCHAR(1000) NOT NULL,
    p256dh         VARCHAR(255)  NOT NULL,
    auth           VARCHAR(191)  NOT NULL,
    user_agent     VARCHAR(255)  NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_push_subscriptions_endpoint (endpoint_hash),
    CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_push_subscriptions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- rollback:
--   -- Dropping the table revokes every device subscription; users must
--   -- re-grant permission after it is recreated.
--   DROP TABLE IF EXISTS push_subscriptions;
