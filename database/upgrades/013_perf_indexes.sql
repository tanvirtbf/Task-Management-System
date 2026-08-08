-- 013_perf_indexes.sql — FIXING phase F30 (ISS-088), 2026-08-06
--
-- P40's EXPLAIN at 5,000 tasks / 20,000 comments / 50,000 activity rows found
-- four hot reads doing "Using filesort": the code paginates by `internal_id`
-- (comments tie-break on it after created_at) while every available index ends
-- in a time or status column — so MySQL located the rows by index and then
-- sorted them separately, per page, forever. No present impact (nothing over
-- 300 ms at that volume), but the sort cost scales with the result set and is
-- the first thing that bends at 10× volume.
--
-- Four covering-order indexes, matching each query's ACTUAL ORDER BY:
--
--   tasks               (primary_list_id, internal_id)             listByList
--   comments            (task_id, created_at, internal_id)         listByTask
--   task_activity       (task_id, internal_id)                     feed
--   workspace_activity  (workspace_id, internal_id)                both feeds
--
-- Index-only DDL: no rows change, ~seconds at demo scale. Each step is gated on
-- information_schema, so re-running is a no-op.

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'tasks'
                 AND index_name = 'idx_tasks_list_internal');
SET @sql := IF(@have = 0,
    'ALTER TABLE tasks ADD INDEX idx_tasks_list_internal (primary_list_id, internal_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'comments'
                 AND index_name = 'idx_comments_task_created_internal');
SET @sql := IF(@have = 0,
    'ALTER TABLE comments ADD INDEX idx_comments_task_created_internal (task_id, created_at, internal_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'task_activity'
                 AND index_name = 'idx_task_activity_task_internal');
SET @sql := IF(@have = 0,
    'ALTER TABLE task_activity ADD INDEX idx_task_activity_task_internal (task_id, internal_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'workspace_activity'
                 AND index_name = 'idx_workspace_activity_ws_internal');
SET @sql := IF(@have = 0,
    'ALTER TABLE workspace_activity ADD INDEX idx_workspace_activity_ws_internal (workspace_id, internal_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- rollback (drops only — no data involved):
--   ALTER TABLE tasks              DROP INDEX idx_tasks_list_internal;
--   ALTER TABLE comments           DROP INDEX idx_comments_task_created_internal;
--   ALTER TABLE task_activity      DROP INDEX idx_task_activity_task_internal;
--   ALTER TABLE workspace_activity DROP INDEX idx_workspace_activity_ws_internal;
