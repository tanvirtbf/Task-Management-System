-- 027_task_deadline_time.sql — DEADLINE TIME PLAN P1, 2026-09-08
--
-- Gives `tasks.start_date` and `tasks.due_date` an optional time of day, so work
-- can be handed out with an hourly deadline ("due today 5:00 PM") instead of only
-- a calendar day.
--
-- ── why TIME columns and not DATE -> DATETIME ────────────────────────────────
-- Migrating the two DATE columns to DATETIME would rebuild three indexes on a
-- live table (`idx_tasks_list_active`, `idx_tasks_overdue_scan`,
-- `idx_tasks_recurrence`) AND rewrite the meaning of every existing row in one
-- step: a date with no time would become midnight, so every task due today would
-- turn overdue the moment it shipped.
--
-- Two nullable TIME columns leave every existing row untouched. This is also the
-- shape `recurrence_time` (upgrades/024) already uses, so it is a pattern this
-- schema has run in production for a month.
--
-- ── ⛔ what NULL means (plan §B1 — the decision everything rests on) ──────────
--   due_time   IS NULL  →  END of that day   (23:59:59.999 on the workspace clock)
--   start_time IS NULL  →  START of that day (00:00:00)
--
-- NOT midnight for both. Today "overdue" is `due_date < today`, so a task due
-- today is never overdue DURING today. End-of-day is the only reading that keeps
-- that true, which is what makes this migration invisible to existing data.
-- The rule is enforced in application code (one resolver, P2) — MySQL is not
-- asked to know it. `client/src/components/ui/DueDateBadge.test.tsx` pins the
-- behaviour this preserves.
--
-- ── ordering ────────────────────────────────────────────────────────────────
-- `ck_tasks_dates` still guards `start_date <= due_date` and needs no change.
-- The finer rule — same day, start 5:00 PM but due 9:00 AM — is a comparison of
-- (date, time) pairs and lives in `TaskWriteService`, because a CHECK cannot
-- express "compare the times only when the dates are equal" portably.
--
-- Add-only, appended at the end of the table so InnoDB can use ALGORITHM=INSTANT.
-- information_schema-gated: re-running is a no-op. No backfill — NULL is correct.

SET @have := (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'tasks'
                 AND column_name = 'start_time');
SET @sql := IF(@have = 0,
    'ALTER TABLE tasks ADD COLUMN start_time TIME NULL',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'tasks'
                 AND column_name = 'due_time');
SET @sql := IF(@have = 0,
    'ALTER TABLE tasks ADD COLUMN due_time TIME NULL',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify (both = 1):
--   SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema = DATABASE() AND table_name = 'tasks'
--      AND column_name IN ('start_time','due_time');
--
-- And that nothing was backfilled — every existing task must still be NULL:
--   SELECT COUNT(*) FROM tasks WHERE due_time IS NOT NULL OR start_time IS NOT NULL;
--
-- rollback:
--   ALTER TABLE tasks DROP COLUMN start_time;
--   ALTER TABLE tasks DROP COLUMN due_time;
-- Dropping them discards any times people have set; the dates survive untouched,
-- and every task falls back to the whole-day meaning it had before this shipped.
