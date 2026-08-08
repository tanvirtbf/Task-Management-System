-- 014_overdue_alerts.sql — assignment + overdue email delivery, 2026-08-08
--
-- Two features requested after the F1–F34 fixing campaign closed:
--   1. Assigning someone to a task now also sends them an EMAIL (MailService
--      grew sendTaskAssignedEmail; producers = TaskWriteService.create +
--      TaskMembershipService.addAssignees — the same two places the in-app
--      `assigned` notification already fires).
--   2. A new `overdue-alert` background job (cron */10 min) emails every
--      assignee the moment a task's due_date has passed on the WORKSPACE's own
--      calendar (workspaces.timezone decides "today" — F5 rule), and drops a
--      matching in-app notification. Exactly ONCE per task per deadline.
--
-- Schema consequences, mirrored in database/schema.sql + the Drizzle schema
-- (the three-synchronized-edits rule in database/upgrades/README.md):
--
--   a. `tasks.overdue_notified_at` — the once-only marker. NULL = not yet
--      alerted. The job sets it in the same transaction as the notification
--      insert (an atomic claim, same shape as department_reports.notified_at).
--      TaskWriteService resets it to NULL whenever due_date CHANGES (single
--      PATCH and bulk), so a moved deadline re-arms the alert.
--   b. `idx_tasks_overdue_scan` — the job's scan predicate, leading on the
--      due_date range.
--   c. The `overdue` notification type RETURNS to both ENUMs. upgrades/009
--      removed it because it had NO producer ("a type nothing can ever produce
--      is a lie in the settings UI") — the overdue-alert job IS the producer
--      now, so the 009 rationale points the other way. Appended at the END of
--      the ENUM (after report_ready): END-appends are instant DDL and keep
--      ordinal parity with the Drizzle tuple, which also appends last. The
--      client inbox never lost its `overdue` icon (AlertTriangle, red) and its
--      runtime fallback tolerates unknown types, so no client change is needed.
--
-- Idempotent the MySQL 8 way: ADD COLUMN/INDEX gated on information_schema via
-- PREPARE/EXECUTE (no `IF NOT EXISTS` in MySQL); MODIFY to the same ENUM
-- definition is a no-op. Re-applying is a no-op.

SET @have_col := (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                     AND table_name = 'tasks'
                     AND column_name = 'overdue_notified_at');
SET @sql := IF(@have_col = 0,
    'ALTER TABLE tasks ADD COLUMN overdue_notified_at TIMESTAMP NULL DEFAULT NULL AFTER completed_at',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have_idx := (SELECT COUNT(*) FROM information_schema.statistics
                   WHERE table_schema = DATABASE()
                     AND table_name = 'tasks'
                     AND index_name = 'idx_tasks_overdue_scan');
SET @sql := IF(@have_idx = 0,
    'ALTER TABLE tasks ADD INDEX idx_tasks_overdue_scan (due_date, completed_at, archived_at, overdue_notified_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Re-add `overdue`, appended at the END (order parity with the Drizzle tuple).
-- No DELETEs needed: appending never strands existing rows.
ALTER TABLE notifications
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue') NOT NULL;

ALTER TABLE user_notification_prefs
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue') NOT NULL;

-- One-time backfill — the first-run FLOOD GUARD. Without this, the first real
-- cron tick would blast an "overdue!" email for every HISTORICALLY-late task
-- in the database (dozens on a lived-in workspace) — the feature's contract is
-- "alert at the moment the deadline passes", not "re-litigate the backlog".
-- So the already-overdue backlog is pre-claimed here; alerts start with tasks
-- that become overdue AFTER this upgrade. Escape hatch: touching a task's
-- due_date clears the claim (TaskWriteService), so any specific old task can
-- be re-armed deliberately.
--   - The Dhaka-day idiom matches upgrades/005 (`DATE(UTC_TIMESTAMP() + 6h)`),
--     correct for the single V1 workspace's Asia/Dhaka calendar.
--   - Tasks with NO assignees are deliberately left unclaimed — the job skips
--     them anyway, and assigning someone to an old overdue task later SHOULD
--     alert them ("you were just handed an already-late task").
--   - Idempotent: the IS NULL guard makes a re-run a no-op; a fresh db:setup
--     database has no rows to claim.
UPDATE tasks t
   SET t.overdue_notified_at = UTC_TIMESTAMP()
 WHERE t.due_date IS NOT NULL
   AND t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 6 HOUR)
   AND t.completed_at IS NULL
   AND t.archived_at IS NULL
   AND t.overdue_notified_at IS NULL
   AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id);

-- rollback:
--   -- (delete overdue rows first or the MODIFY back to 7 values will fail)
--   DELETE FROM notifications WHERE type = 'overdue';
--   DELETE FROM user_notification_prefs WHERE type = 'overdue';
--   ALTER TABLE notifications MODIFY COLUMN type ENUM('assigned','mentioned',
--       'comment','status_change','form_submitted','task_reviewed','report_ready') NOT NULL;
--   ALTER TABLE user_notification_prefs MODIFY COLUMN type ENUM('assigned','mentioned',
--       'comment','status_change','form_submitted','task_reviewed','report_ready') NOT NULL;
--   ALTER TABLE tasks DROP INDEX idx_tasks_overdue_scan;
--   ALTER TABLE tasks DROP COLUMN overdue_notified_at;
