-- 022_checklist_counters.sql — checklist rollup counters on tasks, 2026-08-12
--
-- The office asked for "how much of this task's checklist work is done" to be
-- visible ON THE TASK — the row/board "3/7" chip and the drawer's aggregate %.
-- Counting per render would be a JOIN on every list paint, so the counts ride
-- the task row like subtasks_count/comments_count already do:
--
--   a. tasks.checklist_items_total — items across ALL the task's checklists
--   b. tasks.checklist_items_done  — of those, is_completed = 1
--
-- App-maintained (NO triggers — the 1442 lesson): every ChecklistsService
-- write that can change either number calls
-- TasksRepo.recomputeChecklistCounters(taskId) inside its own transaction —
-- an ABSOLUTE recompute (same design as recomputeSubtaskCounters), so
-- whatever any caller misses, the next write repairs.
--
-- Three-synchronized-edits (database/upgrades/README.md):
--   1. database/schema.sql (tasks §, beside the other counters),
--   2. Drizzle server/src/db/schema/tasks.ts,
--   3. this script. Ships WITH the server build that maintains the counters
--      (older builds simply never update them; the backfill below and the
--      next new-build write both repair).
--
-- Idempotent the MySQL 8 way: information_schema-gated ADD COLUMN; the
-- backfill is an absolute recompute, safe to re-run any time.

SET @have_total := (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE()
                       AND table_name = 'tasks'
                       AND column_name = 'checklist_items_total');
SET @sql := IF(@have_total = 0,
    'ALTER TABLE tasks ADD COLUMN checklist_items_total INT UNSIGNED NOT NULL DEFAULT 0 AFTER attachments_count',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have_done := (SELECT COUNT(*) FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = 'tasks'
                      AND column_name = 'checklist_items_done');
SET @sql := IF(@have_done = 0,
    'ALTER TABLE tasks ADD COLUMN checklist_items_done INT UNSIGNED NOT NULL DEFAULT 0 AFTER checklist_items_total',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill: absolute recompute for every task that has checklist items, and an
-- explicit zero for every task that does not (repairs any prior drift too).
UPDATE tasks t
  LEFT JOIN (
        SELECT cl.task_id AS tid,
               COUNT(*) AS cnt,
               SUM(ci.is_completed) AS done_cnt
          FROM checklist_items ci
          JOIN checklists cl ON cl.id = ci.checklist_id
         GROUP BY cl.task_id
    ) agg ON agg.tid = t.id
   SET t.checklist_items_total = COALESCE(agg.cnt, 0),
       t.checklist_items_done = COALESCE(agg.done_cnt, 0);

-- rollback:
--   ALTER TABLE tasks DROP COLUMN checklist_items_done;
--   ALTER TABLE tasks DROP COLUMN checklist_items_total;
