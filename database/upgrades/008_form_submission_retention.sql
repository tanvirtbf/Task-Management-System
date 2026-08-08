-- 008_form_submission_retention.sql — FIXING phase F17 (ISS-025), 2026-08-06
--
-- The dev database predates migration 0005 (form-submission encryption + the
-- 90-day PII retention) and was never upgraded, so it is missing
-- `form_submissions.encrypted_at` / `expires_at`. The blast radius of that
-- drift on any box that has it:
--
--   GET /forms/:id/submissions       -> 500  "Unknown column 'encrypted_at'"
--   public form intake               -> 500  (FormsService writes encryptedAt)
--   the form-submission-expiry job   -> {"ok":false,"error":"Unknown column…"}
--
-- P41 proved a fresh `db:setup` HAS the columns (schema.sql:967-968 declares
-- them, folded from migration 0005) — so production provisioned from
-- schema.sql is fine, and this script exists for every database provisioned
-- BEFORE the columns existed: dev, `taskmanagement_qa`, and prod only if it
-- ever falls in that category. This is the documented upgrade path
-- (database/upgrades/README.md).
--
-- This retires fixing rule X9's first half: the drift was deliberately kept
-- reproducible while earlier phases' probes needed it (F7/F12/F15 each ADDed
-- the columns for their public-form scenario and DROPped them again). From
-- this script on, the columns are present on purpose, everywhere.
--
-- Idempotent the MySQL 8 way: `ADD COLUMN IF NOT EXISTS` does not exist in
-- MySQL (it is MariaDB syntax), so each ALTER is gated on information_schema
-- via a prepared statement. Re-applying is a no-op.

SET @have_enc := (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                     AND table_name = 'form_submissions'
                     AND column_name = 'encrypted_at');
SET @sql := IF(@have_enc = 0,
    'ALTER TABLE form_submissions ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have_exp := (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                     AND table_name = 'form_submissions'
                     AND column_name = 'expires_at');
SET @sql := IF(@have_exp = 0,
    'ALTER TABLE form_submissions ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- The retention job scans `expires_at < now` — schema.sql ships the index, so
-- the upgraded databases get it too.
SET @have_idx := (SELECT COUNT(*) FROM information_schema.statistics
                   WHERE table_schema = DATABASE()
                     AND table_name = 'form_submissions'
                     AND index_name = 'idx_form_submissions_expires_at');
SET @sql := IF(@have_idx = 0,
    'ALTER TABLE form_submissions ADD INDEX idx_form_submissions_expires_at (expires_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill: rows written while the columns were absent were stored UNENCRYPTED
-- with no retention stamp. `encrypted_at` stays NULL for them — it records
-- when a row was encrypted, and lying about that would hide which rows predate
-- encryption. But every PII row must age out, so give the legacy rows the same
-- 90-day clock they would have received at submission time.
UPDATE form_submissions
   SET expires_at = DATE_ADD(submitted_at, INTERVAL 90 DAY)
 WHERE expires_at IS NULL;

-- rollback:
--   ALTER TABLE form_submissions DROP INDEX idx_form_submissions_expires_at;
--   ALTER TABLE form_submissions DROP COLUMN expires_at;
--   ALTER TABLE form_submissions DROP COLUMN encrypted_at;
