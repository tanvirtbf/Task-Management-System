-- =============================================================================
-- 002_task_reviews.sql — Dept Review feature, Phase 2 (2026-07-22)
-- Adds the `task_reviews` append-only ledger table and the 3 denormalised
-- current-review columns (+FK) on `tasks`.
--
-- Safety: purely additive; no data touched. tasks ADD COLUMN ... AFTER is
-- INSTANT-eligible on MySQL 8.0.43; the FK add is a brief INPLACE (auto-creates
-- its supporting index, name = constraint name — same as the schema.sql path).
-- Single-apply (re-run fails harmlessly on duplicate column/table — do not
-- re-run).
--
-- Apply:  mysql -uroot -proot taskmanagement    < database/upgrades/002_task_reviews.sql
--         mysql -uroot -proot taskmanagement_qa < database/upgrades/002_task_reviews.sql
-- =============================================================================

ALTER TABLE tasks
    ADD COLUMN review_status ENUM('approved','flagged') NULL AFTER completed_at,
    ADD COLUMN reviewed_at TIMESTAMP NULL AFTER review_status,
    ADD COLUMN reviewed_by VARCHAR(64) NULL AFTER reviewed_at,
    ADD CONSTRAINT fk_tasks_reviewed_by FOREIGN KEY (reviewed_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE task_reviews (
    id            VARCHAR(64)  NOT NULL,
    internal_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id  VARCHAR(64)  NOT NULL,
    space_id      VARCHAR(64)  NOT NULL,
    task_id       VARCHAR(64)  NOT NULL,
    reviewer_id   VARCHAR(64)  NOT NULL,
    status        ENUM('approved','flagged') NOT NULL,
    note          VARCHAR(500) NULL,
    created_at    TIMESTAMP    NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_task_reviews_internal_id (internal_id),
    CONSTRAINT fk_task_reviews_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_reviews_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_reviews_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_reviews_reviewer FOREIGN KEY (reviewer_id)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_task_reviews_space_time (space_id, internal_id),
    INDEX idx_task_reviews_task_time (task_id, internal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- rollback:
-- DROP TABLE IF EXISTS task_reviews;
-- ALTER TABLE tasks DROP FOREIGN KEY fk_tasks_reviewed_by;
-- ALTER TABLE tasks DROP COLUMN reviewed_by, DROP COLUMN reviewed_at, DROP COLUMN review_status;
