-- =============================================================================
-- 001_dept_head_enums.sql — Dept Review feature, Phase 1 (2026-07-22)
-- Adds `spaces.head_user_id` (+FK+index) and extends the notification-type
-- ENUMs on BOTH tables that carry them (notifications §29 AND
-- user_notification_prefs §29b — two physical copies of the same ENUM).
--
-- Safety: purely additive. ENUM values are appended at the END only
-- (ALGORITHM=INSTANT-eligible on MySQL 8.0.43); ADD COLUMN ... AFTER is
-- INSTANT-eligible since 8.0.29. No data is touched. Single-apply (the
-- spaces ALTER fails harmlessly with a duplicate-column/constraint error
-- if re-run — do not re-run).
--
-- Apply:  mysql -uroot -proot taskmanagement    < database/upgrades/001_dept_head_enums.sql
--         mysql -uroot -proot taskmanagement_qa < database/upgrades/001_dept_head_enums.sql
-- =============================================================================

ALTER TABLE spaces
    ADD COLUMN head_user_id VARCHAR(64) NULL AFTER is_private,
    ADD CONSTRAINT fk_spaces_head FOREIGN KEY (head_user_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD INDEX idx_spaces_head (head_user_id);

ALTER TABLE notifications
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
        'due_soon','overdue','form_submitted','automation_failed','pr_review',
        'incident_alert','task_reviewed','report_ready') NOT NULL;

ALTER TABLE notifications
    MODIFY COLUMN entity_type ENUM('task','comment','form','automation',
        'incident','report') NOT NULL;

ALTER TABLE user_notification_prefs
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
        'due_soon','overdue','form_submitted','automation_failed','pr_review',
        'incident_alert','task_reviewed','report_ready') NOT NULL;

-- rollback:
-- ALTER TABLE spaces DROP FOREIGN KEY fk_spaces_head;
-- ALTER TABLE spaces DROP INDEX idx_spaces_head;
-- ALTER TABLE spaces DROP COLUMN head_user_id;
-- ENUM appends are harmless to leave in place after a feature rollback.
-- Strict ENUM revert (only if NO row uses the new values — delete such rows first):
-- ALTER TABLE notifications MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','pr_review','incident_alert') NOT NULL;
-- ALTER TABLE notifications MODIFY COLUMN entity_type ENUM('task','comment','form','automation','incident') NOT NULL;
-- ALTER TABLE user_notification_prefs MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change','due_soon','overdue','form_submitted','automation_failed','pr_review','incident_alert') NOT NULL;
