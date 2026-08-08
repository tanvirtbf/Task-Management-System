-- 009_notification_types.sql — FIXING phase F19 (ISS-064 / ISS-072), 2026-08-06
--
-- Decisions D6–D8: of the twelve declared notification types, SEVEN had no
-- producer anywhere in the codebase. `comment` and `status_change` got real
-- producers in F19 (they are what a task manager is expected to do, and both
-- have an obvious trigger already on the write path). The other five —
-- due_soon, overdue, automation_failed, pr_review, incident_alert — have no
-- triggering surface at all (no scheduler, no automations, no review-request
-- flow), so they leave the enum: a type nothing can ever produce is a lie in
-- the settings UI. And `email_enabled` is dropped: MailService sends exactly
-- two transactional mails (password reset, invitation); a per-type email
-- channel is a feature, not a fix, and the toggle promised it anyway.
--
-- Order matters: rows holding a removed enum value block the ALTER, so they
-- are deleted first. No producer ever wrote them, so any that exist came from
-- hand inserts or old seeds. Idempotent: the DELETEs match nothing on a clean
-- DB, MODIFY to the same definition is a no-op, and the column drop is gated.

DELETE FROM notifications
 WHERE type IN ('due_soon','overdue','automation_failed','pr_review','incident_alert');

DELETE FROM user_notification_prefs
 WHERE type IN ('due_soon','overdue','automation_failed','pr_review','incident_alert');

ALTER TABLE notifications
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready') NOT NULL;

ALTER TABLE user_notification_prefs
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready') NOT NULL;

SET @have_email := (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE()
                       AND table_name = 'user_notification_prefs'
                       AND column_name = 'email_enabled');
SET @sql := IF(@have_email = 1,
    'ALTER TABLE user_notification_prefs DROP COLUMN email_enabled',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- rollback:
--   ALTER TABLE user_notification_prefs ADD COLUMN email_enabled BOOLEAN NOT NULL DEFAULT TRUE;
--   ALTER TABLE notifications MODIFY COLUMN type ENUM('assigned','mentioned','comment',
--       'status_change','due_soon','overdue','form_submitted','automation_failed',
--       'pr_review','incident_alert','task_reviewed','report_ready') NOT NULL;
--   ALTER TABLE user_notification_prefs MODIFY COLUMN type ENUM(...same 12...) NOT NULL;
--   -- the deleted rows had no producer; there is nothing real to restore.
