-- 025_assigned_by.sql — every task records who handed the work out, 2026-08-22
--
-- ASSIGNED_BY_PLAN P1. The complaint this answers, verbatim: a supply-chain
-- member gives a task to the software team, the software person may not do it,
-- and NOBODY CAN SEE WHO ASSIGNED IT. `created_by` is close but not the same
-- thing — it is a fact about the RECORD and can never be corrected, while
-- "who handed this out" is a fact about the WORK and sometimes needs fixing.
--
-- What already existed (this is why the backfill is honest and not a guess):
-- `task_assignees.assigned_by` has been written on every assignment path since
-- V1 (TaskMembershipRepo, both the create and the add-assignees path) and is
-- 100% populated — 46 of 46 rows in dev, zero nulls. Its ON DUPLICATE KEY
-- clause deliberately keeps the ORIGINAL assigner when someone is re-added.
-- It was simply never put on the wire and never shown to anyone. So existing
-- tasks get their REAL history here, not a blanket copy of created_by.
--
-- Columns:
--   a. assigned_by  VARCHAR(64) NULL  — FK to users, ON DELETE SET NULL.
--      NULLable for exactly one reason: a manager who leaves must be
--      deletable. `created_by` is RESTRICT and stays that way; attribution
--      must never be the thing that blocks removing a leaver. The wire falls
--      back to created_by when this is NULL, so no screen ever shows a blank.
--
-- Backfill rule (locked as D2): the EARLIEST real assigner on the task wins;
-- created_by is the fallback for tasks that never had an assignee. Verified
-- read-only against live dev data before writing this script — of 47 tasks,
-- 46 take a real assigner, 1 falls back, 0 end up NULL, and 0 reference a
-- missing user (so the FK below holds).
--
-- Three-synchronized-edits (database/upgrades/README.md):
--   1. database/schema.sql (tasks §, after created_by + FK + index),
--   2. Drizzle server/src/db/schema/tasks.ts,
--   3. this script.
--
-- Single-apply (MySQL 8.4 has no ADD COLUMN IF NOT EXISTS). Re-running is
-- harmless in effect but errors on the duplicate column — check first with:
--   SELECT COUNT(*) FROM information_schema.COLUMNS
--    WHERE table_schema=DATABASE() AND table_name='tasks'
--      AND column_name='assigned_by';   -- 0 = safe to apply
--
-- Ordering: ADDITIVE. Apply BEFORE deploying the code that reads it. Older
-- code ignores the column entirely, so there is no window where this hurts.

ALTER TABLE tasks
    ADD COLUMN assigned_by VARCHAR(64) NULL AFTER created_by,
    ADD INDEX idx_tasks_assigned_by (assigned_by);

-- Backfill BEFORE adding the foreign key, so the constraint is validated
-- against final data rather than being added and then filled.
UPDATE tasks t
   SET t.assigned_by = COALESCE(
       (SELECT ta.assigned_by
          FROM task_assignees ta
         WHERE ta.task_id = t.id
           AND ta.assigned_by IS NOT NULL
         ORDER BY ta.assigned_at ASC, ta.user_id ASC
         LIMIT 1),
       t.created_by)
 WHERE t.assigned_by IS NULL;

ALTER TABLE tasks
    ADD CONSTRAINT fk_tasks_assigned_by FOREIGN KEY (assigned_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Verify (expect: 0 unattributed, and every value a real user)
--   SELECT COUNT(*) FROM tasks WHERE assigned_by IS NULL;                    -- 0
--   SELECT COUNT(*) FROM tasks t LEFT JOIN users u ON u.id = t.assigned_by
--    WHERE t.assigned_by IS NOT NULL AND u.id IS NULL;                       -- 0

-- rollback:
--   ALTER TABLE tasks DROP FOREIGN KEY fk_tasks_assigned_by;
--   ALTER TABLE tasks DROP INDEX idx_tasks_assigned_by;
--   ALTER TABLE tasks DROP COLUMN assigned_by;
-- (Dropping the column discards any corrections people made to attribution;
--  the original assigner history survives in task_assignees.assigned_by.)
