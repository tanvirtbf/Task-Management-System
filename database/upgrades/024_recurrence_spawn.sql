-- 024_recurrence_spawn.sql — make recurrence actually recur, 2026-08-16
--
-- Recurrence has been half-built since V1: `recurrence_pattern` /
-- `recurrence_days` / `recurrence_ends_at` are stored, the drawer has a
-- Repeats picker, and NOTHING has ever read them. The knowledge base has been
-- telling the office the honest truth ("you set it, the system does not create
-- the next one"). The office asked for the other half.
--
-- Locked decisions (asked and answered before the build, 2026-08-16):
--   · the person picks the TIME of day, not just the day — "protidin sokal
--     9:00". Hence `recurrence_time`; the job ticks every 15 minutes.
--   · the spawned task's NAME carries the date — "Stock check — 17 Aug 2026" —
--     so each occurrence is findable and one day's is never confused for
--     another's.
--   · NOTHING else is copied. No assignee, no start/due date, no tags, no
--     priority, no description, no checklist. Same list, same task type, a
--     fresh task. That is the whole point: the copy is work to be picked up,
--     not a clone of yesterday's state.
--
-- Columns:
--   a. recurrence_time            TIME  — when, in the WORKSPACE's timezone.
--                                 NULL on rows that predate this build; the
--                                 job treats NULL as 09:00 so an existing
--                                 recurrence starts working rather than
--                                 silently never firing.
--   b. recurrence_last_spawned_on DATE  — the idempotency claim. The job's
--                                 conditional UPDATE on this column is what
--                                 makes "run me every 15 minutes" produce ONE
--                                 task per day (the department_reports
--                                 notified_at shape).
--   c. recurring_source_id        FK    — the copy points at its template, so
--                                 the UI can say where it came from and the
--                                 job can never treat a copy as a template.
--
-- Three-synchronized-edits (database/upgrades/README.md):
--   1. database/schema.sql (tasks §, recurrence block),
--   2. Drizzle server/src/db/schema/tasks.ts,
--   3. this script. Ships WITH the build that adds the `recurrence-spawn` job;
--      an older build simply ignores the columns.
--
-- ⚠️ Remember the new cron line when rolling prod (deploy/cron/bbtasks-jobs):
--      */15 * * * *  recurrence-spawn
--
-- Idempotent: information_schema-gated ADD COLUMN / ADD INDEX / ADD CONSTRAINT.

SET @have_time := (SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = 'tasks'
                      AND column_name = 'recurrence_time');
SET @sql := IF(@have_time = 0,
    'ALTER TABLE tasks ADD COLUMN recurrence_time TIME NULL AFTER recurrence_days',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @have_last := (SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = 'tasks'
                      AND column_name = 'recurrence_last_spawned_on');
SET @sql := IF(@have_last = 0,
    'ALTER TABLE tasks ADD COLUMN recurrence_last_spawned_on DATE NULL AFTER recurrence_ends_at',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @have_src := (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                     AND table_name = 'tasks'
                     AND column_name = 'recurring_source_id');
SET @sql := IF(@have_src = 0,
    'ALTER TABLE tasks ADD COLUMN recurring_source_id VARCHAR(64) NULL AFTER recurrence_last_spawned_on',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- SET NULL, not CASCADE: deleting the template must never delete the work its
-- occurrences represent — those are real tasks people did.
SET @have_fk := (SELECT COUNT(*) FROM information_schema.table_constraints
                  WHERE table_schema = DATABASE()
                    AND table_name = 'tasks'
                    AND constraint_name = 'fk_tasks_recurring_source');
SET @sql := IF(@have_fk = 0,
    'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_recurring_source FOREIGN KEY (recurring_source_id) REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The job's scan: "live templates whose next occurrence is due".
SET @have_idx := (SELECT COUNT(*) FROM information_schema.statistics
                   WHERE table_schema = DATABASE()
                     AND table_name = 'tasks'
                     AND index_name = 'idx_tasks_recurrence_due');
SET @sql := IF(@have_idx = 0,
    'ALTER TABLE tasks ADD INDEX idx_tasks_recurrence_due (workspace_id, recurrence_pattern, recurrence_last_spawned_on)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- rollback:
--   ALTER TABLE tasks DROP FOREIGN KEY fk_tasks_recurring_source;
--   ALTER TABLE tasks DROP INDEX idx_tasks_recurrence_due;
--   ALTER TABLE tasks DROP COLUMN recurring_source_id;
--   ALTER TABLE tasks DROP COLUMN recurrence_last_spawned_on;
--   ALTER TABLE tasks DROP COLUMN recurrence_time;
--   (and remove the */15 recurrence-spawn cron line)
