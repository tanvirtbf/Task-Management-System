-- 023_task_delete_approval.sql — permanent-delete approval, 2026-08-16
--
-- Until now a permanent task delete was admin-only and instant: everyone else
-- could archive (reversible) but never ask for the task to actually go, and
-- there was no record of who wanted it gone or why. This adds the missing
-- middle: ANYONE who may delete a task can REQUEST its permanent removal, the
-- task keeps working normally while the request is pending, and only an
-- Owner/Admin holding `task.delete_hard` can approve — at which point the
-- existing hard-delete path runs (subtree, notifications, R2 purge queue).
--
-- Locked decisions (asked and answered before the build, 2026-08-16):
--   · pending ⇒ the task is UNCHANGED, just flagged. Nothing hides on a mere
--     request, so a request can never be used to make someone's work vanish.
--   · an Admin/Owner deleting their own way stays INSTANT (they are the
--     approver; a self-approval round trip would be theatre).
--   · approvers are Owner/Admin only. A Head may REQUEST, not approve.
--
-- Three-synchronized-edits (database/upgrades/README.md):
--   1. database/schema.sql §45 + the two notification ENUMs + the entity ENUM,
--   2. Drizzle: server/src/db/schema/delete-requests.ts + _shared.ts,
--   3. this script. Fresh `db:setup` becomes 47 tables / 5 views / 9 triggers.
--
-- `pending_flag` is the 021 VIRTUAL-generated-column trick: at most ONE live
-- request per task, while decided history stacks freely (NULLs are distinct).
-- Never modelled in Drizzle, never written by the app.
--
-- ⚠️ The task FK cascades. On approval the task row is destroyed, so its
-- request row goes with it — which is why the approval writes a
-- `workspace_activity` audit row BEFORE deleting (that table's entity_id has
-- no FK). Same rule the permanent MEMBER delete follows: the evidence must
-- outlive the thing it describes.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; MODIFY to the same ENUM is a no-op.

CREATE TABLE IF NOT EXISTS task_delete_requests (
    id             VARCHAR(64) NOT NULL,
    internal_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id   VARCHAR(64) NOT NULL,
    -- Owning space AT REQUEST TIME (snapshot; live reads derive via the list).
    space_id       VARCHAR(64) NOT NULL,
    task_id        VARCHAR(64) NOT NULL,
    -- Denormalised so the audit trail and the requester's notification can
    -- still name the task after it has been destroyed.
    task_name      VARCHAR(500) NOT NULL,
    requested_by   VARCHAR(64) NOT NULL,
    reason         VARCHAR(500) NULL,
    status         ENUM('pending','approved','rejected','cancelled')
                       NOT NULL DEFAULT 'pending',
    decided_by     VARCHAR(64) NULL,
    decided_at     TIMESTAMP NULL,
    decision_note  VARCHAR(500) NULL,
    created_at     TIMESTAMP NOT NULL,
    updated_at     TIMESTAMP NOT NULL,
    pending_flag   TINYINT GENERATED ALWAYS AS
                       (IF(status = 'pending', 1, NULL)) VIRTUAL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tdr_internal_id (internal_id),
    UNIQUE KEY uq_tdr_one_pending (task_id, pending_flag),
    CONSTRAINT fk_tdr_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tdr_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tdr_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tdr_requested_by FOREIGN KEY (requested_by)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tdr_decided_by FOREIGN KEY (decided_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_tdr_workspace (workspace_id, status, internal_id),
    INDEX idx_tdr_requester (requested_by, status, internal_id),
    INDEX idx_tdr_task (task_id, internal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Two new notification types, appended at the END of BOTH ENUMs (the 014/021
-- rule — appending never strands existing rows).
ALTER TABLE notifications
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue',
                            'assignment_request','assignment_request_decided',
                            'assignment_query',
                            'delete_request','delete_request_decided') NOT NULL;

ALTER TABLE user_notification_prefs
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue',
                            'assignment_request','assignment_request_decided',
                            'assignment_query',
                            'delete_request','delete_request_decided') NOT NULL;

-- A new ENTITY type as well: once a delete is approved the task is gone, so a
-- notification pointing at it would navigate to a 404 (that was ISS-073). The
-- decision notification is ABOUT the request, and says so.
ALTER TABLE notifications
    MODIFY COLUMN entity_type ENUM('task','comment','form','automation',
                                   'incident','report','delete_request') NOT NULL;

-- rollback:
--   DELETE FROM notifications WHERE type IN ('delete_request','delete_request_decided');
--   DELETE FROM user_notification_prefs WHERE type IN ('delete_request','delete_request_decided');
--   ALTER TABLE notifications MODIFY COLUMN entity_type ENUM('task','comment',
--       'form','automation','incident','report') NOT NULL;
--   ALTER TABLE notifications MODIFY COLUMN type ENUM('assigned','mentioned',
--       'comment','status_change','form_submitted','task_reviewed','report_ready',
--       'overdue','assignment_request','assignment_request_decided',
--       'assignment_query') NOT NULL;
--   ALTER TABLE user_notification_prefs MODIFY COLUMN type ENUM('assigned',
--       'mentioned','comment','status_change','form_submitted','task_reviewed',
--       'report_ready','overdue','assignment_request',
--       'assignment_request_decided','assignment_query') NOT NULL;
--   DROP TABLE IF EXISTS task_delete_requests;
