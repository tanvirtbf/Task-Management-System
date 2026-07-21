-- =============================================================================
-- POST-MIGRATION SQL — applied after `drizzle-kit migrate` / `drizzle-kit push`.
--
-- Drizzle ORM doesn't natively support:
--   1.  TRIGGERS (counter maintenance + self-dep guard)
--   2.  CREATE OR REPLACE VIEW with raw SQL expressions
--
-- So those DDL statements live here and are run by `db/migrate.ts` after
-- `migrate(...)` completes the Drizzle migrations.
-- =============================================================================

-- ─── 1. Self-dependency guard triggers (BEFORE INSERT / UPDATE) ──────────────
DELIMITER $$

CREATE TRIGGER trg_task_dependencies_no_self_insert
BEFORE INSERT ON task_dependencies
FOR EACH ROW
BEGIN
    IF NEW.task_id = NEW.related_task_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'task_dependencies: task cannot depend on itself';
    END IF;
END$$

CREATE TRIGGER trg_task_dependencies_no_self_update
BEFORE UPDATE ON task_dependencies
FOR EACH ROW
BEGIN
    IF NEW.task_id = NEW.related_task_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'task_dependencies: task cannot depend on itself';
    END IF;
END$$


-- ─── 2. Counter-maintenance triggers ─────────────────────────────────────────

CREATE TRIGGER trg_comments_after_insert
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks SET comments_count = comments_count + 1 WHERE id = NEW.task_id;
END$$

CREATE TRIGGER trg_comments_after_delete
AFTER DELETE ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.task_id;
END$$

CREATE TRIGGER trg_attachments_after_insert
AFTER INSERT ON attachments
FOR EACH ROW
BEGIN
    IF NEW.deleted_at IS NULL AND NEW.upload_status = 'complete' THEN
        UPDATE tasks SET attachments_count = attachments_count + 1 WHERE id = NEW.task_id;
    END IF;
END$$

CREATE TRIGGER trg_attachments_after_update
AFTER UPDATE ON attachments
FOR EACH ROW
BEGIN
    -- Decrement if: was complete+not-deleted, now deleted OR status changed from complete
    IF (OLD.deleted_at IS NULL AND OLD.upload_status = 'complete') AND
       (NEW.deleted_at IS NOT NULL OR NEW.upload_status != 'complete') THEN
        UPDATE tasks SET attachments_count = GREATEST(attachments_count - 1, 0) WHERE id = NEW.task_id;
    -- Increment if: was not-complete/deleted, now complete+not-deleted
    ELSEIF (OLD.deleted_at IS NOT NULL OR OLD.upload_status != 'complete') AND
           (NEW.deleted_at IS NULL AND NEW.upload_status = 'complete') THEN
        UPDATE tasks SET attachments_count = attachments_count + 1 WHERE id = NEW.task_id;
    END IF;
END$$

-- Subtask counters: NO triggers — MySQL forbids a `tasks` trigger from updating
-- `tasks` (error 1442), which crashed every subtask status change (500). Removed
-- 2026-07-14; counters stay 0 until app-side maintenance is added (gate item).
-- Kept in sync with database/schema.sql.

CREATE TRIGGER trg_form_submissions_after_insert
AFTER INSERT ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms SET submission_count = submission_count + 1 WHERE id = NEW.form_id;
END$$

DELIMITER ;


-- ─── 3. Views ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_open_tasks AS
    SELECT t.*, s.status_group
      FROM tasks t
      JOIN statuses s ON s.id = t.status_id
     WHERE t.archived_at IS NULL
       AND s.status_group NOT IN ('done','closed');

CREATE OR REPLACE VIEW v_open_bugs AS
    SELECT t.workspace_id, t.id, t.custom_id, t.name,
           t.bug_severity, t.reporter_team, t.created_at, t.updated_at,
           ta.user_id AS assignee_id
      FROM tasks t
      JOIN statuses s   ON s.id = t.status_id
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
     WHERE t.task_type_id = 'tt-bug'
       AND t.archived_at IS NULL
       AND s.status_group NOT IN ('done','closed');

CREATE OR REPLACE VIEW v_active_sprint AS
    SELECT * FROM sprints WHERE status = 'active';

CREATE OR REPLACE VIEW v_current_on_call AS
    SELECT s.* FROM on_call_shifts s
     WHERE UTC_DATE() BETWEEN s.week_start AND s.week_end;

CREATE OR REPLACE VIEW v_breached_sla AS
    SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
           t.task_type_id, t.sla_due_at,
           TIMESTAMPDIFF(MINUTE, t.sla_due_at, UTC_TIMESTAMP()) AS minutes_breached
      FROM tasks t
     WHERE t.sla_due_at IS NOT NULL
       AND t.sla_due_at < UTC_TIMESTAMP()
       AND t.completed_at IS NULL
       AND t.archived_at IS NULL;
