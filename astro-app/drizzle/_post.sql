-- =============================================================================
-- POST-MIGRATION SQL (SQLite/Turso) — applied after `drizzle-kit push` by
-- `scripts/apply-post-sql.ts`. Port of server/src/db/migrations/_post.sql.
--
-- SQLite trigger notes vs the MySQL original:
--   * IF ... THEN     → WHEN clauses (attachment update split into 2 triggers)
--   * SIGNAL SQLSTATE → SELECT RAISE(ABORT, '...')
--   * GREATEST(a, b)  → max(a, b)
--   * UPDATE ... JOIN → correlated subqueries
-- Timestamps are INTEGER epoch-ms; DATE-only columns are TEXT ISO dates.
-- Statements are separated by breakpoint marker lines.
-- =============================================================================

-- ─── 1. Self-dependency guard triggers ───────────────────────────────────────
DROP TRIGGER IF EXISTS trg_task_dependencies_no_self_insert;
--> statement-breakpoint
CREATE TRIGGER trg_task_dependencies_no_self_insert
BEFORE INSERT ON task_dependencies
FOR EACH ROW
WHEN NEW.task_id = NEW.related_task_id
BEGIN
    SELECT RAISE(ABORT, 'task_dependencies: task cannot depend on itself');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_task_dependencies_no_self_update;
--> statement-breakpoint
CREATE TRIGGER trg_task_dependencies_no_self_update
BEFORE UPDATE ON task_dependencies
FOR EACH ROW
WHEN NEW.task_id = NEW.related_task_id
BEGIN
    SELECT RAISE(ABORT, 'task_dependencies: task cannot depend on itself');
END;
--> statement-breakpoint

-- ─── 2. Counter-maintenance triggers ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_comments_after_insert;
--> statement-breakpoint
CREATE TRIGGER trg_comments_after_insert
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks SET comments_count = comments_count + 1 WHERE id = NEW.task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_comments_after_delete;
--> statement-breakpoint
CREATE TRIGGER trg_comments_after_delete
AFTER DELETE ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks SET comments_count = max(comments_count - 1, 0) WHERE id = OLD.task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_attachments_after_insert;
--> statement-breakpoint
CREATE TRIGGER trg_attachments_after_insert
AFTER INSERT ON attachments
FOR EACH ROW
WHEN NEW.deleted_at IS NULL AND NEW.upload_status = 'complete'
BEGIN
    UPDATE tasks SET attachments_count = attachments_count + 1 WHERE id = NEW.task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_attachments_after_update_dec;
--> statement-breakpoint
CREATE TRIGGER trg_attachments_after_update_dec
AFTER UPDATE ON attachments
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND OLD.upload_status = 'complete')
 AND (NEW.deleted_at IS NOT NULL OR NEW.upload_status != 'complete')
BEGIN
    UPDATE tasks SET attachments_count = max(attachments_count - 1, 0) WHERE id = NEW.task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_attachments_after_update_inc;
--> statement-breakpoint
CREATE TRIGGER trg_attachments_after_update_inc
AFTER UPDATE ON attachments
FOR EACH ROW
WHEN (OLD.deleted_at IS NOT NULL OR OLD.upload_status != 'complete')
 AND (NEW.deleted_at IS NULL AND NEW.upload_status = 'complete')
BEGIN
    UPDATE tasks SET attachments_count = attachments_count + 1 WHERE id = NEW.task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_subtasks_after_insert;
--> statement-breakpoint
CREATE TRIGGER trg_subtasks_after_insert
AFTER INSERT ON tasks
FOR EACH ROW
WHEN NEW.parent_task_id IS NOT NULL
BEGIN
    UPDATE tasks SET subtasks_count = subtasks_count + 1 WHERE id = NEW.parent_task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_subtasks_after_update;
--> statement-breakpoint
CREATE TRIGGER trg_subtasks_after_update
AFTER UPDATE ON tasks
FOR EACH ROW
WHEN NEW.parent_task_id IS NOT NULL AND OLD.status_id <> NEW.status_id
BEGIN
    UPDATE tasks
       SET subtasks_completed = subtasks_completed
           + (CASE WHEN (SELECT status_group FROM statuses WHERE id = NEW.status_id) IN ('done','closed') THEN 1 ELSE 0 END)
           - (CASE WHEN (SELECT status_group FROM statuses WHERE id = OLD.status_id) IN ('done','closed') THEN 1 ELSE 0 END)
     WHERE id = NEW.parent_task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_subtasks_after_delete;
--> statement-breakpoint
CREATE TRIGGER trg_subtasks_after_delete
AFTER DELETE ON tasks
FOR EACH ROW
WHEN OLD.parent_task_id IS NOT NULL
BEGIN
    UPDATE tasks SET subtasks_count = max(subtasks_count - 1, 0) WHERE id = OLD.parent_task_id;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_form_submissions_after_insert;
--> statement-breakpoint
CREATE TRIGGER trg_form_submissions_after_insert
AFTER INSERT ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms SET submission_count = submission_count + 1 WHERE id = NEW.form_id;
END;
--> statement-breakpoint

-- ─── 3. Views ─────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_open_tasks;
--> statement-breakpoint
CREATE VIEW v_open_tasks AS
    SELECT t.*, s.status_group
      FROM tasks t
      JOIN statuses s ON s.id = t.status_id
     WHERE t.archived_at IS NULL
       AND s.status_group NOT IN ('done','closed');
--> statement-breakpoint
DROP VIEW IF EXISTS v_open_bugs;
--> statement-breakpoint
CREATE VIEW v_open_bugs AS
    SELECT t.workspace_id, t.id, t.custom_id, t.name,
           t.bug_severity, t.reporter_team, t.created_at, t.updated_at,
           ta.user_id AS assignee_id
      FROM tasks t
      JOIN statuses s   ON s.id = t.status_id
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
     WHERE t.task_type_id = 'tt-bug'
       AND t.archived_at IS NULL
       AND s.status_group NOT IN ('done','closed');
--> statement-breakpoint
DROP VIEW IF EXISTS v_active_sprint;
--> statement-breakpoint
CREATE VIEW v_active_sprint AS
    SELECT * FROM sprints WHERE status = 'active';
--> statement-breakpoint
DROP VIEW IF EXISTS v_current_on_call;
--> statement-breakpoint
CREATE VIEW v_current_on_call AS
    SELECT s.* FROM on_call_shifts s
     WHERE date('now') BETWEEN s.week_start AND s.week_end;
--> statement-breakpoint
DROP VIEW IF EXISTS v_breached_sla;
--> statement-breakpoint
CREATE VIEW v_breached_sla AS
    SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
           t.task_type_id, t.sla_due_at,
           cast((cast(unixepoch('subsec') * 1000 as integer) - t.sla_due_at) / 60000 as integer) AS minutes_breached
      FROM tasks t
     WHERE t.sla_due_at IS NOT NULL
       AND t.sla_due_at < cast(unixepoch('subsec') * 1000 as integer)
       AND t.completed_at IS NULL
       AND t.archived_at IS NULL;
