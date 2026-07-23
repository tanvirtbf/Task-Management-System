-- =============================================================================
-- 003_department_reports.sql — Dept Review feature, Phase 3 (2026-07-22)
-- Adds the `department_reports` table (weekly per-department HR reports).
--
-- Safety: purely additive (one CREATE TABLE); no existing objects touched.
-- Single-apply (re-run fails harmlessly on duplicate table — do not re-run).
-- Space FK is ON DELETE RESTRICT by design: reports are retained HR history —
-- the app surfaces 409 `space.has_reports` on space hard-delete attempts.
--
-- Apply:  mysql -uroot -proot taskmanagement    < database/upgrades/003_department_reports.sql
--         mysql -uroot -proot taskmanagement_qa < database/upgrades/003_department_reports.sql
-- =============================================================================

CREATE TABLE department_reports (
    id              VARCHAR(64)  NOT NULL,
    internal_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id    VARCHAR(64)  NOT NULL,
    space_id        VARCHAR(64)  NOT NULL,
    week_start      DATE         NOT NULL,
    week_end        DATE         NOT NULL,
    head_user_id    VARCHAR(64)  NULL,
    head_note       VARCHAR(1000) NULL,
    payload         JSON         NOT NULL,
    generated_by    VARCHAR(64)  NULL,
    generated_at    TIMESTAMP    NOT NULL,
    notified_at     TIMESTAMP    NULL,
    acknowledged_by VARCHAR(64)  NULL,
    acknowledged_at TIMESTAMP    NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_department_reports_internal_id (internal_id),
    UNIQUE KEY uq_department_reports_space_week (space_id, week_start),
    CONSTRAINT fk_dept_reports_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dept_reports_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_department_reports_ws_week (workspace_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- rollback:
-- DROP TABLE IF EXISTS department_reports;
