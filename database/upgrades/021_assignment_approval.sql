-- 021_assignment_approval.sql — cross-team assignment approval (team-access P8),
-- 2026-08-11
--
-- TEAM_ACCESS_AND_AUDIT_PLAN.md Phase 8 (R1.4/R1.5): assigning a person who is
-- NOT a member of the space that owns the task (Q11 — membership decides, not
-- home team) no longer assigns them directly. It creates a PENDING request the
-- target user, any Head of a team the target belongs to, or an admin must
-- accept (atomic claim — a double-click can never double-accept), decline, or
-- answer with a `query` ("I need 2 more days" + proposed date). The requester
-- answers a query through its OWN endpoint (fix B2 — after upgrade 020 the
-- requester holds no task.edit on the task, so a generic edit would deadlock
-- the negotiation); the date change routes through the normal task-update path
-- so the overdue-alert re-arm still fires. Unanswered requests expire after 7
-- days via the new `assignment-request-expiry` job (Q6 — remember the cron
-- line in deploy/cron/bbtasks-jobs when rolling prod).
--
-- DORMANT under the open seeded grants: the gate first asks "does the target's
-- `task.view` reach everything?" — while Member/Guest still hold `all` (any
-- fresh `db:seed`), every assignment stays instant, which is also why the whole
-- jest suite runs unchanged. After 019 (the switch), members' reach is `own`,
-- and the membership question (Q11) starts deciding. Same-team assignment is
-- ALWAYS instant (Q5); the S0/S1 on-call auto-assign is exempt (Q7); bulk
-- reports "N assigned, M pending approval" instead of silently succeeding (Q8).
--
-- Three-synchronized-edits (database/upgrades/README.md):
--   1. database/schema.sql §43 + §44 + the two notification ENUMs,
--   2. Drizzle: server/src/db/schema/assignment-requests.ts + _shared.ts,
--   3. this script. Fresh `db:setup` is now 46 tables / 5 views / 9 triggers.
--
-- Contents:
--   a. `task_assignment_requests` — current state, one row per negotiation.
--      `pending_flag` is a VIRTUAL generated column (the user_roles `scope_key`
--      precedent) used only by uq_tar_one_pending: at most ONE live request
--      per (task, person); decided history stacks freely (NULLs are distinct).
--      Never modelled in Drizzle, never written by the app.
--   b. `task_assignment_request_events` — append-only ledger (the task_reviews
--      shape) so the P9 drawer panel can show the whole back-and-forth.
--   c. Three notification types appended at the END of BOTH ENUMs:
--      `assignment_request` (to the target + their Heads),
--      `assignment_request_decided` (to the requester: accepted / declined /
--      expired — and to the receiver side on cancel),
--      `assignment_query` (query raised → requester; query answered → receiver).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; MODIFY to the same ENUM definition
-- is a no-op. Safe to apply BEFORE the P8 server build (the tables just sit
-- empty), and required WITH it (the Drizzle schema reads them).

CREATE TABLE IF NOT EXISTS task_assignment_requests (
    id                VARCHAR(64) NOT NULL,
    internal_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id      VARCHAR(64) NOT NULL,
    space_id          VARCHAR(64) NOT NULL,
    task_id           VARCHAR(64) NOT NULL,
    target_user_id    VARCHAR(64) NOT NULL,
    requested_by      VARCHAR(64) NOT NULL,
    status            ENUM('pending','accepted','declined','expired','cancelled')
                          NOT NULL DEFAULT 'pending',
    request_note      VARCHAR(500) NULL,
    query_note        VARCHAR(500) NULL,
    proposed_due_date DATE NULL,
    decided_by        VARCHAR(64) NULL,
    decided_at        TIMESTAMP NULL,
    expires_at        TIMESTAMP NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL,
    pending_flag      TINYINT GENERATED ALWAYS AS
                          (IF(status = 'pending', 1, NULL)) VIRTUAL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tar_internal_id (internal_id),
    UNIQUE KEY uq_tar_one_pending (task_id, target_user_id, pending_flag),
    CONSTRAINT fk_tar_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_target FOREIGN KEY (target_user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_requested_by FOREIGN KEY (requested_by)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_decided_by FOREIGN KEY (decided_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_tar_target (target_user_id, status, internal_id),
    INDEX idx_tar_requester (requested_by, status, internal_id),
    INDEX idx_tar_task_time (task_id, internal_id),
    INDEX idx_tar_expiry (status, expires_at),
    INDEX idx_tar_workspace (workspace_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS task_assignment_request_events (
    id                VARCHAR(64) NOT NULL,
    internal_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id        VARCHAR(64) NOT NULL,
    actor_id          VARCHAR(64) NULL,
    action            ENUM('created','accepted','declined','queried','answered',
                           'cancelled','expired') NOT NULL,
    note              VARCHAR(500) NULL,
    proposed_due_date DATE NULL,
    created_at        TIMESTAMP NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tare_internal_id (internal_id),
    CONSTRAINT fk_tare_request FOREIGN KEY (request_id)
        REFERENCES task_assignment_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tare_actor FOREIGN KEY (actor_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_tare_request_time (request_id, internal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Three new types, appended at the END (order parity with the Drizzle tuple —
-- the upgrades/014 rule). Appending never strands existing rows.
ALTER TABLE notifications
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue',
                            'assignment_request','assignment_request_decided',
                            'assignment_query') NOT NULL;

ALTER TABLE user_notification_prefs
    MODIFY COLUMN type ENUM('assigned','mentioned','comment','status_change',
                            'form_submitted',
                            'task_reviewed','report_ready','overdue',
                            'assignment_request','assignment_request_decided',
                            'assignment_query') NOT NULL;

-- rollback:
--   -- (delete rows of the new types first or the MODIFY back to 8 values fails)
--   DELETE FROM notifications WHERE type IN
--       ('assignment_request','assignment_request_decided','assignment_query');
--   DELETE FROM user_notification_prefs WHERE type IN
--       ('assignment_request','assignment_request_decided','assignment_query');
--   ALTER TABLE notifications MODIFY COLUMN type ENUM('assigned','mentioned',
--       'comment','status_change','form_submitted','task_reviewed',
--       'report_ready','overdue') NOT NULL;
--   ALTER TABLE user_notification_prefs MODIFY COLUMN type ENUM('assigned',
--       'mentioned','comment','status_change','form_submitted','task_reviewed',
--       'report_ready','overdue') NOT NULL;
--   DROP TABLE IF EXISTS task_assignment_request_events;
--   DROP TABLE IF EXISTS task_assignment_requests;
