-- 012_drop_fiscal_year.sql — FIXING phase F28 (ISS-029, decision D12.2), 2026-08-06
--
-- ISS-029 found four workspace settings that are stored, validated carefully and
-- read by NOTHING. Three of them get a consumer in this same phase:
-- `working_days` and `business_hours_start/end` now drive SLA deadlines (see
-- server/src/utils/dhakaTime.ts). `fiscal_year_start_month` gets none, because
-- there is no financial-reporting surface anywhere in this product and no
-- plausible consumer for a fiscal year in a task manager. A setting the UI
-- presents as meaningful and the server never reads is the defect; removing it
-- is the honest half of the fix.
--
-- The value being discarded is a single TINYINT per workspace. BeautyBooth's is
-- 7 (Bangladesh's fiscal year starts in July) and it has never been read by any
-- query, job, report or serializer. Nothing downstream can notice.
--
-- The CHECK constraint has to go FIRST: MySQL 8 refuses to drop a column a check
-- constraint references (ER_DEPENDENT_BY_CHECK_CONSTRAINT). Both steps are gated
-- on information_schema, so re-running is a no-op -- MySQL has no
-- DROP ... IF EXISTS for either object in a way that is portable here.

-- ─── 1. the CHECK that references the column ─────────────────────────────────

SET @have := (SELECT COUNT(*) FROM information_schema.table_constraints
               WHERE constraint_schema = DATABASE()
                 AND table_name = 'workspaces'
                 AND constraint_name = 'ck_workspaces_fiscal_month');
SET @sql := IF(@have > 0,
    'ALTER TABLE workspaces DROP CHECK ck_workspaces_fiscal_month',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2. the column ───────────────────────────────────────────────────────────

SET @have := (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE()
                 AND table_name = 'workspaces'
                 AND column_name = 'fiscal_year_start_month');
SET @sql := IF(@have > 0,
    'ALTER TABLE workspaces DROP COLUMN fiscal_year_start_month',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- rollback (restores the column and its default; the per-workspace value is not
-- recoverable, but it was never read -- 7 is the seeded default for BD):
--   ALTER TABLE workspaces
--     ADD COLUMN fiscal_year_start_month TINYINT UNSIGNED NOT NULL DEFAULT 7
--         AFTER business_hours_end,
--     ADD CONSTRAINT ck_workspaces_fiscal_month
--         CHECK (fiscal_year_start_month BETWEEN 1 AND 12);
