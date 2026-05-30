-- =============================================================================
-- BeautyBooth Task Management System
-- MySQL 8.0+ production schema  (Bangla-ready, 3NF, indexed for the actual
-- query patterns of the React frontend in this repo).
--
-- Scope:
--   * Operational layer for 5 non-tech teams (Operations, Inventory, Customer
--     Support, Product Listing, Marketing) — see WHAT_SHUTKIHUT_ACTUALLY_NEEDS.md
--   * Engineering layer for the in-house dev team — see WHAT_DEV_TEAM_NEEDS.md
--
-- Engine / charset:
--   * InnoDB everywhere (row locks, FKs, MVCC)
--   * utf8mb4 / utf8mb4_unicode_ci  (full Bangla support incl. compound glyphs)
--   * ROW_FORMAT=DYNAMIC          (allows long VARCHAR / JSON off-page)
--   * sql_require_primary_key=ON  recommended in production my.cnf
--
-- Naming conventions:
--   tables          plural snake_case  (`tasks`, `task_assignees`)
--   primary keys    `id`               (VARCHAR(64) — matches frontend slugs)
--   foreign keys    `<entity>_id`      (`primary_list_id`, `created_by` for users)
--   constraint name fk_<table>_<column>  /  uq_<table>_<cols>  /  idx_<table>_<cols>
--   timestamps      `created_at`, `updated_at`, `archived_at`, `completed_at`
--
-- 3NF discipline:
--   * No repeating groups — M2M relations live in their own junction tables.
--   * Every non-key column depends on the whole primary key.
--   * No transitive dependencies in core tables.
--   * Counters on `tasks` (comments_count etc.) and on `customers` (total_orders
--     etc.) are *intentional* denormalisations for read performance — they are
--     maintained at the application layer (or via the optional triggers at the
--     end of this file). Both choices are documented at the call site.
--
-- Soft delete:
--   * `archived_at TIMESTAMP NULL` for user-visible entities (tasks, lists,
--     spaces, attachments, comments). Hard DELETE is reserved for users who
--     explicitly request data removal.
--
-- ID strategy:
--   * VARCHAR(64) primary keys, matching the frontend's semantic IDs
--     (`sp-ops`, `l-fb-orders`, `t-90042`, `cf_cod_amount`).
--   * For tables with >1M expected rows long-term (tasks, comments,
--     notifications, workspace_activity) an `internal_id BIGINT UNSIGNED
--     AUTO_INCREMENT UNIQUE` is added as a secondary key for efficient
--     pagination via numeric cursors.
--
-- Tested against MySQL 8.0.36 (default `sql_mode='ONLY_FULL_GROUP_BY,
-- STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,
-- NO_ENGINE_SUBSTITUTION'`).
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Drop in reverse dependency order so re-running the file works cleanly.
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS workspace_activity;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS form_submissions;
DROP TABLE IF EXISTS form_fields;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS task_custom_field_values;
DROP TABLE IF EXISTS custom_field_options;
DROP TABLE IF EXISTS custom_fields;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS checklist_items;
DROP TABLE IF EXISTS checklists;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS task_activity;
DROP TABLE IF EXISTS task_dependencies;
DROP TABLE IF EXISTS task_tags;
DROP TABLE IF EXISTS task_watchers;
DROP TABLE IF EXISTS task_assignees;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS stock_batches;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS on_call_shifts;
DROP TABLE IF EXISTS sprints;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS task_types;
DROP TABLE IF EXISTS statuses;
DROP TABLE IF EXISTS lists;
DROP TABLE IF EXISTS spaces;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS workspaces;
SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================================
-- 1. workspaces
-- Single-tenant in V1 (one row, `ws-main`) but schema is multi-tenant ready —
-- every downstream entity references `workspace_id` so we can flip the auth
-- layer to multi-tenant without a migration.
-- =============================================================================
CREATE TABLE workspaces (
    id                       VARCHAR(64)  NOT NULL,
    name                     VARCHAR(120) NOT NULL,
    logo_url                 VARCHAR(500) NULL,
    timezone                 VARCHAR(64)  NOT NULL DEFAULT 'Asia/Dhaka',
    default_locale           VARCHAR(16)  NOT NULL DEFAULT 'en-US',
    -- Week-start: 0=Sunday … 6=Saturday. BD typically starts work on Saturday=6
    week_starts_on           TINYINT UNSIGNED NOT NULL DEFAULT 6,
    -- SET column lets us store working-days as a bit-mask in 1 byte
    working_days             SET('sun','mon','tue','wed','thu','fri','sat')
                                  NOT NULL DEFAULT 'sun,mon,tue,wed,thu',
    business_hours_start     TIME NOT NULL DEFAULT '09:00:00',
    business_hours_end       TIME NOT NULL DEFAULT '18:00:00',
    -- BD fiscal year starts July (=7)
    fiscal_year_start_month  TINYINT UNSIGNED NOT NULL DEFAULT 7,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT ck_workspaces_week_starts_on CHECK (week_starts_on BETWEEN 0 AND 6),
    CONSTRAINT ck_workspaces_fiscal_month  CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    CONSTRAINT ck_workspaces_hours          CHECK (business_hours_start < business_hours_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 2. users
-- Roles are intentionally restricted to ('owner','admin','member','guest') —
-- per spec the UI uses only Admin/Member but the schema keeps Owner (single
-- person, can't be demoted) and Guest (external collaborator, V2).
-- =============================================================================
CREATE TABLE users (
    id            VARCHAR(64)  NOT NULL,
    workspace_id  VARCHAR(64)  NOT NULL,
    first_name    VARCHAR(80)  NOT NULL,
    last_name     VARCHAR(80)  NOT NULL,
    email         VARCHAR(255) NOT NULL,
    -- argon2id hash, exposed to nobody. Length covers argon2 + future bcrypt.
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('owner','admin','member','guest') NOT NULL DEFAULT 'member',
    avatar_url    VARCHAR(500) NULL,
    status        ENUM('active','invited','deactivated') NOT NULL DEFAULT 'invited',
    timezone      VARCHAR(64)  NOT NULL DEFAULT 'Asia/Dhaka',
    last_login_at TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_users_workspace_email UNIQUE (workspace_id, email),
    CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_users_workspace_status (workspace_id, status),
    INDEX idx_users_email           (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 3. sessions
-- One row per active refresh token. Access tokens stay stateless (HS256 JWT)
-- per the `.env.dev` policy already in the repo.
-- `token_hash` stores SHA-256 of the opaque refresh-token string — never the
-- raw token, so a DB leak does not yield live sessions.
-- =============================================================================
CREATE TABLE sessions (
    id            VARCHAR(64)  NOT NULL,
    user_id       VARCHAR(64)  NOT NULL,
    token_hash    CHAR(64)     NOT NULL,
    user_agent    VARCHAR(500) NULL,
    ip_address    VARCHAR(45)  NULL,    -- IPv6-safe
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP    NOT NULL,
    revoked_at    TIMESTAMP    NULL,

    PRIMARY KEY (id),
    CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_sessions_user_active (user_id, revoked_at, expires_at),
    INDEX idx_sessions_expires     (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 4. password_reset_tokens
-- Short-lived (≤ 30 min). Single-use via consumed_at.
-- =============================================================================
CREATE TABLE password_reset_tokens (
    id          VARCHAR(64) NOT NULL,
    user_id     VARCHAR(64) NOT NULL,
    token_hash  CHAR(64)    NOT NULL,
    expires_at  TIMESTAMP   NOT NULL,
    consumed_at TIMESTAMP   NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_password_reset_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_password_reset_user (user_id),
    INDEX idx_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 5. invitations
-- An admin invites a new email; user accepts via /invitation/:token.
-- =============================================================================
CREATE TABLE invitations (
    id           VARCHAR(64)  NOT NULL,
    workspace_id VARCHAR(64)  NOT NULL,
    email        VARCHAR(255) NOT NULL,
    role         ENUM('admin','member','guest') NOT NULL DEFAULT 'member',
    token_hash   CHAR(64)     NOT NULL,
    invited_by   VARCHAR(64)  NOT NULL,
    expires_at   TIMESTAMP    NOT NULL,
    accepted_at  TIMESTAMP    NULL,
    accepted_by  VARCHAR(64)  NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_invitations_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_invitations_invited_by FOREIGN KEY (invited_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invitations_accepted_by FOREIGN KEY (accepted_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_invitations_workspace_email (workspace_id, email),
    INDEX idx_invitations_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 6. spaces
-- The 5 operational spaces (sp-ops, sp-inv, sp-cs, sp-listing, sp-mkt) + the
-- engineering space (sp-eng). Plus user-created custom spaces.
-- =============================================================================
CREATE TABLE spaces (
    id            VARCHAR(64)  NOT NULL,
    workspace_id  VARCHAR(64)  NOT NULL,
    name          VARCHAR(120) NOT NULL,
    description   VARCHAR(500) NULL,
    icon          VARCHAR(64)  NOT NULL DEFAULT 'Folder',
    color         CHAR(7)      NOT NULL DEFAULT '#4F46E5',
    is_private    BOOLEAN      NOT NULL DEFAULT FALSE,
    position      INT UNSIGNED NOT NULL DEFAULT 0,
    archived_at   TIMESTAMP    NULL,
    created_by    VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_spaces_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_spaces_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT ck_spaces_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$'),
    INDEX idx_spaces_workspace_archived (workspace_id, archived_at, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 7. lists
-- Flat under spaces — no folders in V1 per spec. `default_task_type_id` lets a
-- list set "every new task is a Bug" etc.
-- =============================================================================
CREATE TABLE lists (
    id                    VARCHAR(64)  NOT NULL,
    space_id              VARCHAR(64)  NOT NULL,
    name                  VARCHAR(120) NOT NULL,
    description           VARCHAR(500) NULL,
    icon                  VARCHAR(64)  NOT NULL DEFAULT 'ListChecks',
    color                 CHAR(7)      NOT NULL DEFAULT '#4F46E5',
    position              INT UNSIGNED NOT NULL DEFAULT 0,
    default_task_type_id  VARCHAR(64)  NULL,
    is_private            BOOLEAN      NOT NULL DEFAULT FALSE,
    archived_at           TIMESTAMP    NULL,
    created_by            VARCHAR(64)  NOT NULL,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_lists_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_lists_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    -- default_task_type_id FK is added after task_types is created (circular).
    INDEX idx_lists_space_archived  (space_id, archived_at, position),
    INDEX idx_lists_default_task_type (default_task_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 8. task_types
-- Workspace-scoped. System types (Task, Milestone) cannot be deleted.
-- Dev types (Bug, Feature, Tech Debt, Incident, Release) are seeded.
-- =============================================================================
CREATE TABLE task_types (
    id                 VARCHAR(64)  NOT NULL,
    workspace_id       VARCHAR(64)  NOT NULL,
    name               VARCHAR(80)  NOT NULL,
    description        VARCHAR(300) NULL,
    icon               VARCHAR(64)  NOT NULL DEFAULT 'CheckSquare',
    color              CHAR(7)      NOT NULL DEFAULT '#6B7280',
    is_milestone_type  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_system          BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Engineering task types get this flag set so the UI knows to expose dev
    -- sections (subtasks, dependencies, git panel, activity).
    is_dev_type        BOOLEAN      NOT NULL DEFAULT FALSE,
    position           INT UNSIGNED NOT NULL DEFAULT 0,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_task_types_workspace_name UNIQUE (workspace_id, name),
    CONSTRAINT fk_task_types_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_task_types_workspace (workspace_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Close the circular FK from lists → task_types
ALTER TABLE lists
    ADD CONSTRAINT fk_lists_default_task_type FOREIGN KEY (default_task_type_id)
        REFERENCES task_types(id) ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- 9. statuses
-- Per-list workflow definitions. status_group is the 4-bucket grouping the
-- frontend uses to colour columns and decide "is this task done?".
-- =============================================================================
CREATE TABLE statuses (
    id            VARCHAR(64)  NOT NULL,
    -- scope_type left for future folder/space scoping. In V1 only 'list'.
    scope_type    ENUM('list','space') NOT NULL DEFAULT 'list',
    scope_id      VARCHAR(64)  NOT NULL,
    name          VARCHAR(80)  NOT NULL,
    color         CHAR(7)      NOT NULL DEFAULT '#94A3B8',
    status_group  ENUM('not_started','active','done','closed') NOT NULL,
    position      INT UNSIGNED NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_statuses_scope_name UNIQUE (scope_type, scope_id, name),
    INDEX idx_statuses_scope (scope_type, scope_id, position),
    INDEX idx_statuses_group (status_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
-- NOTE: statuses.scope_id refers polymorphically to lists.id (or spaces.id
-- in V2). Polymorphic FKs are not enforceable at the DB level; the application
-- layer must validate scope_id existence per scope_type.


-- =============================================================================
-- 10. tags
-- Workspace-scoped, NOT space-scoped per spec ("urgent", "vip-customer",
-- "festival" apply across teams).
-- =============================================================================
CREATE TABLE tags (
    id           VARCHAR(64)  NOT NULL,
    workspace_id VARCHAR(64)  NOT NULL,
    name         VARCHAR(60)  NOT NULL,
    color        CHAR(7)      NOT NULL DEFAULT '#94A3B8',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_tags_workspace_name UNIQUE (workspace_id, name),
    CONSTRAINT fk_tags_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 11. sprints  (Engineering only)
-- =============================================================================
CREATE TABLE sprints (
    id                VARCHAR(64)  NOT NULL,
    workspace_id      VARCHAR(64)  NOT NULL,
    name              VARCHAR(80)  NOT NULL,
    goal              VARCHAR(300) NULL,
    start_date        DATE         NOT NULL,
    end_date          DATE         NOT NULL,
    status            ENUM('planned','active','closed') NOT NULL DEFAULT 'planned',
    committed_points  INT UNSIGNED NOT NULL DEFAULT 0,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_sprints_workspace_name UNIQUE (workspace_id, name),
    CONSTRAINT fk_sprints_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ck_sprints_dates CHECK (start_date <= end_date),
    INDEX idx_sprints_workspace_status (workspace_id, status, start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 12. tasks  (the central table)
-- =============================================================================
CREATE TABLE tasks (
    id                   VARCHAR(64)  NOT NULL,
    -- Numeric cursor for efficient keyset pagination — separate from `id`.
    internal_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id         VARCHAR(64)  NOT NULL,
    primary_list_id      VARCHAR(64)  NOT NULL,
    -- Per-list incrementing number powering "ORD-1042". Compose display ID
    -- from `<list.prefix>-<task_number>` in the application layer.
    task_number          INT UNSIGNED NOT NULL,
    -- Display ID exposed to humans. Pre-computed for fast lookup.
    custom_id            VARCHAR(40)  NULL,

    name                 VARCHAR(500) NOT NULL,
    -- TipTap HTML for dev task types; plain text for operational. MEDIUMTEXT
    -- (up to 16 MB) is sized for the rare long bug repro with embedded stack
    -- traces; ordinary descriptions fit in a few KB.
    description          MEDIUMTEXT   NULL,

    status_id            VARCHAR(64)  NOT NULL,
    priority             TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- 0=None .. 4=Low
    task_type_id         VARCHAR(64)  NOT NULL,

    parent_task_id       VARCHAR(64)  NULL,
    nesting_depth        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_milestone         BOOLEAN      NOT NULL DEFAULT FALSE,

    start_date           DATE         NULL,
    due_date             DATE         NULL,
    completed_at         TIMESTAMP    NULL,

    -- ─── SLA (P0 — CS complaints + engineering S0/S1 bugs) ────────────────
    -- Set by app at create time based on task type / severity:
    --   complaint task        → created_at + 24h
    --   bug task severity=S0  → created_at + 2h
    --   bug task severity=S1  → created_at + 24h
    --   bug task severity=S2  → created_at + 7d
    --   other                 → NULL (no SLA)
    -- App + cron read `WHERE sla_due_at < NOW() AND completed_at IS NULL AND
    -- archived_at IS NULL` to find breached tasks for notifications + UI flags.
    sla_due_at           TIMESTAMP    NULL,
    -- ──────────────────────────────────────────────────────────────────────

    -- Recurrence — simple per spec. cron_expression reserved for future.
    recurrence_pattern   ENUM('none','daily','weekly') NOT NULL DEFAULT 'none',
    recurrence_days      SET('sun','mon','tue','wed','thu','fri','sat') NULL,
    recurrence_ends_at   DATE         NULL,

    time_estimate_seconds  INT UNSIGNED NULL,
    time_tracked_seconds   INT UNSIGNED NOT NULL DEFAULT 0,

    -- Denormalised counters (maintained by app or by the optional triggers).
    -- Keeping them here avoids COUNT() on every list render.
    subtasks_count       INT UNSIGNED NOT NULL DEFAULT 0,
    subtasks_completed   INT UNSIGNED NOT NULL DEFAULT 0,
    comments_count       INT UNSIGNED NOT NULL DEFAULT 0,
    attachments_count    INT UNSIGNED NOT NULL DEFAULT 0,

    -- ─── Engineering-only fields (NULL for operational tasks) ────────────
    sprint_id            VARCHAR(64)  NULL,
    story_points         TINYINT UNSIGNED NULL,
    reviewer_id          VARCHAR(64)  NULL,
    branch_name          VARCHAR(200) NULL,
    pr_url               VARCHAR(500) NULL,
    pr_status            ENUM('open','merged','closed','draft') NULL,
    bug_severity         ENUM('S0','S1','S2','S3') NULL,
    bug_reproducibility  ENUM('always','sometimes','once','cannot') NULL,
    bug_environment      ENUM('production','staging','local') NULL,
    bug_browser          VARCHAR(120) NULL,
    reporter_team        ENUM('ops','cs','inventory','listing','marketing','internal') NULL,
    deployed_at          TIMESTAMP    NULL,
    rollback_reason      VARCHAR(500) NULL,
    -- ──────────────────────────────────────────────────────────────────────

    archived_at          TIMESTAMP    NULL,
    created_by           VARCHAR(64)  NOT NULL,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_tasks_internal_id (internal_id),
    UNIQUE KEY uq_tasks_custom_id   (workspace_id, custom_id),
    UNIQUE KEY uq_tasks_list_number (primary_list_id, task_number),

    CONSTRAINT fk_tasks_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_list FOREIGN KEY (primary_list_id)
        REFERENCES lists(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_status FOREIGN KEY (status_id)
        REFERENCES statuses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_task_type FOREIGN KEY (task_type_id)
        REFERENCES task_types(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_sprint FOREIGN KEY (sprint_id)
        REFERENCES sprints(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_reviewer FOREIGN KEY (reviewer_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT ck_tasks_priority CHECK (priority BETWEEN 0 AND 4),
    CONSTRAINT ck_tasks_nesting  CHECK (nesting_depth <= 2),  -- spec: 2 levels max
    CONSTRAINT ck_tasks_dates    CHECK (start_date IS NULL OR due_date IS NULL
                                        OR start_date <= due_date),

    -- Hot indexes (ordered by selectivity for each query path) -------------
    -- List page → tasks of a list, exclude archived, group/sort by status
    INDEX idx_tasks_list_active (primary_list_id, archived_at, status_id, due_date),
    -- Sprint board → all tasks in a sprint
    INDEX idx_tasks_sprint (sprint_id, status_id),
    -- Eng Home "PRs awaiting me"
    INDEX idx_tasks_reviewer (reviewer_id, pr_status),
    -- Stuck-orders KPI on Home (Confirmed >2h)
    INDEX idx_tasks_status_updated (status_id, updated_at),
    -- Search by custom_id (ORD-1042)
    INDEX idx_tasks_custom_id (custom_id),
    -- Parent → children lookup (subtasks)
    INDEX idx_tasks_parent (parent_task_id),
    -- Bug-triage queries by severity
    INDEX idx_tasks_severity (bug_severity, status_id),
    -- Recurring tasks scheduler scan
    INDEX idx_tasks_recurrence (recurrence_pattern, due_date),
    -- SLA breach scanner: tasks whose deadline passed and aren't done.
    -- Composite ordered so MySQL can range-scan sla_due_at and skip closed
    -- tasks via the second column. archived_at filter is on the index too.
    INDEX idx_tasks_sla (sla_due_at, completed_at, archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC
  AUTO_INCREMENT = 1;


-- =============================================================================
-- 14. task_assignees  (M2M users ↔ tasks)
-- =============================================================================
CREATE TABLE task_assignees (
    task_id    VARCHAR(64) NOT NULL,
    user_id    VARCHAR(64) NOT NULL,
    assigned_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by VARCHAR(64) NULL,

    PRIMARY KEY (task_id, user_id),
    CONSTRAINT fk_task_assignees_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_assignees_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_assignees_assigned_by FOREIGN KEY (assigned_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- "Tasks assigned to me" KPI on Home → user-first index
    INDEX idx_task_assignees_user (user_id, task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 15. task_watchers (M2M)
-- Per spec, auto-add commenters and assignees → app layer maintains this.
-- =============================================================================
CREATE TABLE task_watchers (
    task_id    VARCHAR(64) NOT NULL,
    user_id    VARCHAR(64) NOT NULL,
    started_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (task_id, user_id),
    CONSTRAINT fk_task_watchers_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_watchers_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_task_watchers_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 16. task_tags  (M2M tasks ↔ tags)
-- =============================================================================
CREATE TABLE task_tags (
    task_id  VARCHAR(64) NOT NULL,
    tag_id   VARCHAR(64) NOT NULL,
    added_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (task_id, tag_id),
    CONSTRAINT fk_task_tags_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_tags_tag FOREIGN KEY (tag_id)
        REFERENCES tags(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_task_tags_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 17. task_dependencies  (Engineering — blocks / blocked-by)
-- task_id  blocks    related_task_id   (one direction stored; the inverse is
-- derived: `related_task_id` is blocked_by `task_id`).
-- =============================================================================
CREATE TABLE task_dependencies (
    id              VARCHAR(64) NOT NULL,
    task_id         VARCHAR(64) NOT NULL,
    related_task_id VARCHAR(64) NOT NULL,
    -- Kept as ENUM in case 'duplicates' / 'relates_to' are added later, but V1
    -- only uses 'blocks'.
    dep_type        ENUM('blocks') NOT NULL DEFAULT 'blocks',
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      VARCHAR(64) NOT NULL,

    PRIMARY KEY (id),
    CONSTRAINT uq_task_dependencies UNIQUE (task_id, related_task_id, dep_type),
    CONSTRAINT fk_task_dependencies_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_dependencies_related FOREIGN KEY (related_task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_dependencies_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    -- NOTE: A CHECK constraint `task_id <> related_task_id` would be ideal here
    -- but MySQL 8 forbids CHECK on columns used in cascading FKs (ER_CHECK_CONSTRAINT_REFERS).
    -- The self-loop is rejected at INSERT time by trg_task_dependencies_no_self below,
    -- and the application layer also validates before issuing the INSERT.
    INDEX idx_task_dependencies_related (related_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 17. task_activity  (per-task audit feed shown in TaskActivitySection)
-- A row per status change, branch link, PR event, assignment etc.
-- =============================================================================
CREATE TABLE task_activity (
    id          VARCHAR(64)  NOT NULL,
    internal_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id     VARCHAR(64)  NOT NULL,
    actor_id    VARCHAR(64)  NULL,   -- NULL = system event (cron, webhook)
    -- Stable string code so the UI can switch on it.
    action      VARCHAR(60)  NOT NULL,
    -- Optional structured payload (from/to status, branch name, PR URL, …).
    context     JSON         NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_task_activity_internal_id (internal_id),
    CONSTRAINT fk_task_activity_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_activity_actor FOREIGN KEY (actor_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- Reverse-chronological per task → composite index
    INDEX idx_task_activity_task_time (task_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 19. comments  (1-level threading via parent_comment_id)
-- =============================================================================
CREATE TABLE comments (
    id                VARCHAR(64)  NOT NULL,
    internal_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id           VARCHAR(64)  NOT NULL,
    parent_comment_id VARCHAR(64)  NULL,   -- NULL = top-level
    author_id         VARCHAR(64)  NOT NULL,
    body              TEXT         NOT NULL,
    edited_at         TIMESTAMP    NULL,
    deleted_at        TIMESTAMP    NULL,   -- tombstone for "deleted by user"
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_comments_internal_id (internal_id),
    CONSTRAINT fk_comments_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id)
        REFERENCES comments(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_comments_author FOREIGN KEY (author_id)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_comments_task_time (task_id, created_at),
    INDEX idx_comments_parent    (parent_comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 20. checklists
-- =============================================================================
CREATE TABLE checklists (
    id         VARCHAR(64)  NOT NULL,
    task_id    VARCHAR(64)  NOT NULL,
    name       VARCHAR(200) NOT NULL,
    position   INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_checklists_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_checklists_task (task_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 21. checklist_items
-- =============================================================================
CREATE TABLE checklist_items (
    id              VARCHAR(64)  NOT NULL,
    checklist_id    VARCHAR(64)  NOT NULL,
    parent_item_id  VARCHAR(64)  NULL,        -- 1-level nesting allowed
    text            VARCHAR(500) NOT NULL,
    is_completed    BOOLEAN      NOT NULL DEFAULT FALSE,
    completed_at    TIMESTAMP    NULL,
    completed_by    VARCHAR(64)  NULL,
    assignee_id     VARCHAR(64)  NULL,
    position        INT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_checklist_items_checklist FOREIGN KEY (checklist_id)
        REFERENCES checklists(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_checklist_items_parent FOREIGN KEY (parent_item_id)
        REFERENCES checklist_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_checklist_items_assignee FOREIGN KEY (assignee_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_checklist_items_completed_by FOREIGN KEY (completed_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_checklist_items_checklist (checklist_id, position),
    INDEX idx_checklist_items_assignee  (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 22. attachments
-- File bytes live in object storage (Cloudflare R2); `storage_key` is the path,
-- `url` is a signed/public URL refreshed on read.
-- =============================================================================
CREATE TABLE attachments (
    id            VARCHAR(64)  NOT NULL,
    task_id       VARCHAR(64)  NOT NULL,
    -- Filename as uploaded; sanitised
    name          VARCHAR(255) NOT NULL,
    storage_key   VARCHAR(500) NOT NULL,  -- e.g. workspaces/ws-main/attachments/abc.jpg
    mime_type     VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes    BIGINT UNSIGNED NOT NULL,
    thumbnail_key VARCHAR(500) NULL,
    uploaded_by   VARCHAR(64)  NOT NULL,
    uploaded_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP    NULL,
    -- §16 three-step upload flow: the row is created 'pending' at /uploads/sign,
    -- then flips to 'complete' at /attachments/:id/finalize once an R2 HEAD
    -- confirms the object landed. The attachments_count triggers count only
    -- 'complete', non-deleted rows, so a signed-but-unfinalised row never inflates
    -- the counter (and the hourly janitor sweeps rows still 'pending' after 1h).
    upload_status ENUM('pending','complete') NOT NULL DEFAULT 'pending',

    PRIMARY KEY (id),
    CONSTRAINT fk_attachments_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_attachments_uploaded_by FOREIGN KEY (uploaded_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_attachments_task (task_id, uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 23. custom_fields  (definitions — only the 6 supported types per spec)
-- scope_type = workspace | space | list  →  scope_id polymorphic, app validates.
-- =============================================================================
CREATE TABLE custom_fields (
    id                  VARCHAR(64)  NOT NULL,
    workspace_id        VARCHAR(64)  NOT NULL,
    scope_type          ENUM('workspace','space','list') NOT NULL,
    scope_id            VARCHAR(64)  NULL,    -- NULL when scope_type='workspace'
    name                VARCHAR(120) NOT NULL,
    -- Only 6 supported types per WHAT_SHUTKIHUT_ACTUALLY_NEEDS.md §3 #12.
    -- ENUM is intentional: enforces the constraint at the DB level so old
    -- mock data (long_text, location etc.) can't be silently re-introduced.
    type                ENUM('text','phone','money','date','dropdown','files') NOT NULL,
    -- Type-specific knobs (max_length, currency, precision, date_format, …)
    config              JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    is_required         BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Stored as JSON so the type can be flexible per the `type` column.
    default_value       JSON         NULL,
    position            INT UNSIGNED NOT NULL DEFAULT 0,
    hidden_from_guests  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by          VARCHAR(64)  NOT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_custom_fields_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_custom_fields_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_custom_fields_scope (scope_type, scope_id, position),
    INDEX idx_custom_fields_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 24. custom_field_options  (dropdown options — 3NF instead of JSON array)
-- Frontend persists options inline on the field; we split them out so that
-- option_id is a stable referenceable key from task_custom_field_values.
-- =============================================================================
CREATE TABLE custom_field_options (
    id              VARCHAR(64)  NOT NULL,
    custom_field_id VARCHAR(64)  NOT NULL,
    label           VARCHAR(120) NOT NULL,
    color           CHAR(7)      NOT NULL DEFAULT '#94A3B8',
    position        INT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_cf_options_field_label UNIQUE (custom_field_id, label),
    CONSTRAINT fk_cf_options_field FOREIGN KEY (custom_field_id)
        REFERENCES custom_fields(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_cf_options_field (custom_field_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 25. task_custom_field_values
-- Per-task value of a custom field. Stored as JSON to handle 6 type shapes:
--   text    →  {"text": "..."}
--   phone   →  {"text": "01712345678"}
--   money   →  {"amount": 12345, "currency": "BDT"}   (paisa as int)
--   date    →  {"date": "2026-05-28", "include_time": false}
--   dropdown→  {"option_id": "src_facebook"}
--   files   →  {"file_ids": ["att-001", "att-002"]}
-- =============================================================================
CREATE TABLE task_custom_field_values (
    task_id          VARCHAR(64) NOT NULL,
    custom_field_id  VARCHAR(64) NOT NULL,
    value            JSON        NOT NULL,
    updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,
    updated_by       VARCHAR(64) NULL,

    PRIMARY KEY (task_id, custom_field_id),
    CONSTRAINT fk_tcfv_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tcfv_field FOREIGN KEY (custom_field_id)
        REFERENCES custom_fields(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tcfv_updated_by FOREIGN KEY (updated_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_tcfv_field (custom_field_id),
    -- Generated column for fast dropdown filtering ("Source = Facebook")
    -- Indexable expression — uses MySQL 8 JSON shortcut for ->> ()
    option_id_generated VARCHAR(64) GENERATED ALWAYS AS
        (JSON_UNQUOTE(JSON_EXTRACT(value, '$.option_id'))) VIRTUAL,
    INDEX idx_tcfv_option (custom_field_id, option_id_generated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 26. forms
-- Public form per list (FB complaint intake link, etc.).
-- Branding/settings JSON keeps the surface compact; if the dashboard ever needs
-- to query by these they're moved out.
-- =============================================================================
CREATE TABLE forms (
    id                VARCHAR(64)  NOT NULL,
    list_id           VARCHAR(64)  NOT NULL,
    title             VARCHAR(200) NOT NULL,
    description       VARCHAR(2000) NULL,
    is_public         BOOLEAN      NOT NULL DEFAULT TRUE,
    public_slug       VARCHAR(120) NOT NULL,
    branding          JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    settings          JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    -- Denormalised submission counter (incremented on each submit)
    submission_count  INT UNSIGNED NOT NULL DEFAULT 0,
    created_by        VARCHAR(64)  NOT NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_forms_public_slug UNIQUE (public_slug),
    CONSTRAINT fk_forms_list FOREIGN KEY (list_id)
        REFERENCES lists(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_forms_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_forms_list (list_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 27. form_fields  (normalised — 3NF, in contrast to the frontend's JSON list)
-- =============================================================================
CREATE TABLE form_fields (
    id             VARCHAR(64)  NOT NULL,
    form_id        VARCHAR(64)  NOT NULL,
    -- 'task_attr' = built-in task field (name, description, due_date, …)
    -- 'custom_field' = `field_key` is a custom_fields.id
    field_kind     ENUM('task_attr','custom_field') NOT NULL,
    field_key      VARCHAR(120) NOT NULL,
    label          VARCHAR(200) NOT NULL,
    help_text      VARCHAR(500) NULL,
    placeholder    VARCHAR(200) NULL,
    is_required    BOOLEAN      NOT NULL DEFAULT FALSE,
    is_hidden      BOOLEAN      NOT NULL DEFAULT FALSE,
    default_value  JSON         NULL,
    position       INT UNSIGNED NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_form_fields_form_key UNIQUE (form_id, field_kind, field_key),
    CONSTRAINT fk_form_fields_form FOREIGN KEY (form_id)
        REFERENCES forms(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_form_fields_form (form_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 28. form_submissions
-- =============================================================================
CREATE TABLE form_submissions (
    id              VARCHAR(64)  NOT NULL,
    internal_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    form_id         VARCHAR(64)  NOT NULL,
    -- Set when the submission has been converted into a task.
    task_id         VARCHAR(64)  NULL,
    submitter_email VARCHAR(255) NULL,
    submitter_ip    VARCHAR(45)  NULL,
    -- Raw submitted values; the conversion to a Task uses this + form_fields.
    data            JSON         NOT NULL,
    submitted_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_form_submissions_internal_id (internal_id),
    CONSTRAINT fk_form_submissions_form FOREIGN KEY (form_id)
        REFERENCES forms(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_form_submissions_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_form_submissions_form_time (form_id, submitted_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 29. notifications
-- Per-user inbox. Snooze + read state.
-- =============================================================================
CREATE TABLE notifications (
    id             VARCHAR(64)  NOT NULL,
    internal_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        VARCHAR(64)  NOT NULL,
    type           ENUM('assigned','mentioned','comment','status_change',
                        'due_soon','overdue','form_submitted',
                        'automation_failed','pr_review',
                        'incident_alert') NOT NULL,
    entity_type    ENUM('task','comment','form','automation',
                        'incident') NOT NULL,
    entity_id      VARCHAR(64)  NOT NULL,
    actor_id       VARCHAR(64)  NULL,
    title          VARCHAR(300) NOT NULL,
    body           VARCHAR(1000) NULL,
    is_read        BOOLEAN      NOT NULL DEFAULT FALSE,
    snoozed_until  TIMESTAMP    NULL,
    -- Track email delivery separately so we know what was emailed.
    email_sent_at  TIMESTAMP    NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_notifications_internal_id (internal_id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- Inbox query: unread-first, then by time
    INDEX idx_notifications_user_state (user_id, is_read, created_at DESC),
    -- Snooze worker: find ready notifications
    INDEX idx_notifications_snoozed (snoozed_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 30. on_call_shifts
-- One row per week per engineer on call. The current engineer is found by
-- `WHERE week_start <= CURDATE() AND week_end >= CURDATE()`.
-- =============================================================================
CREATE TABLE on_call_shifts (
    id          VARCHAR(64) NOT NULL,
    workspace_id VARCHAR(64) NOT NULL,
    week_start  DATE        NOT NULL,    -- Monday
    week_end    DATE        NOT NULL,    -- Sunday
    engineer_id VARCHAR(64) NOT NULL,
    created_by  VARCHAR(64) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_on_call_shifts_week UNIQUE (workspace_id, week_start),
    CONSTRAINT fk_on_call_shifts_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_on_call_shifts_engineer FOREIGN KEY (engineer_id)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_on_call_shifts_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT ck_on_call_shifts_week CHECK (week_start <= week_end),
    INDEX idx_on_call_shifts_engineer (engineer_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 31. workspace_activity  (light workspace-wide audit log per Op#20)
-- Per-task activity lives in task_activity. This table captures workspace-
-- level events: user invited, role changed, list created/archived, …
-- =============================================================================
CREATE TABLE workspace_activity (
    id           VARCHAR(64)  NOT NULL,
    internal_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id VARCHAR(64)  NOT NULL,
    actor_id     VARCHAR(64)  NULL,
    entity_type  ENUM('workspace','space','list','task_type','tag',
                      'custom_field','user','role','sprint') NOT NULL,
    entity_id    VARCHAR(64)  NOT NULL,
    action       VARCHAR(60)  NOT NULL,   -- 'created' | 'archived' | 'role_changed' | …
    context      JSON         NULL,
    ip_address   VARCHAR(45)  NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_workspace_activity_internal_id (internal_id),
    CONSTRAINT fk_workspace_activity_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_workspace_activity_actor FOREIGN KEY (actor_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_workspace_activity_workspace_time (workspace_id, created_at DESC),
    INDEX idx_workspace_activity_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 32. templates  (reusable task structures — "Apply template" feature)
--
-- Per FINAL_REQUIREMENTS.md §5.18 — any team can have task templates with
-- pre-built checklists, default task type, tags and description. Applied
-- via `POST /templates/:id/apply` which spawns a parent task with the
-- checklist materialised.
-- =============================================================================
CREATE TABLE templates (
    id            VARCHAR(64)  NOT NULL,
    workspace_id  VARCHAR(64)  NOT NULL,
    -- 'task'  = creates a single task with checklist + meta (V1 scope)
    -- 'list'  = creates a new list with seeded tasks (V2)
    -- 'space' = creates a new space (V2)
    type          ENUM('task','list','space') NOT NULL DEFAULT 'task',
    name          VARCHAR(120) NOT NULL,
    description   TEXT         NULL,
    -- lucide-react icon name shown in the picker.
    icon          VARCHAR(60)  NULL,
    color         CHAR(7)      NULL,    -- #RRGGBB hex
    -- Template body — JSON so the shape stays flexible:
    --   { taskTypeId, priority, tags[], checklistName,
    --     checklistItems: [{ text, dueOffsetDays? }],
    --     description }
    structure     JSON         NOT NULL,
    usage_count   INT UNSIGNED NOT NULL DEFAULT 0,
    created_by    VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_templates_workspace_name UNIQUE (workspace_id, name),
    CONSTRAINT fk_templates_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_templates_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Filter by type in the picker ("show me task templates")
    INDEX idx_templates_workspace_type (workspace_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- OPTIONAL: counter-maintenance triggers
-- These keep `tasks.comments_count`, `tasks.attachments_count`,
-- `tasks.subtasks_count`, `tasks.subtasks_completed` and `forms.submission_count`
-- in sync without app-layer code. Wire them in only if your application layer
-- isn't already maintaining the counters — running both will double-count.
-- Toggle the @MAINTAIN_COUNTERS variable below to compile-in or compile-out.
-- =============================================================================

DELIMITER $$

-- Enforce "a task cannot depend on itself" — replaces the CHECK constraint we
-- couldn't add because MySQL 8 forbids CHECK on columns used in cascading FKs.
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

CREATE TRIGGER trg_comments_after_insert
AFTER INSERT ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks
       SET comments_count = comments_count + 1
     WHERE id = NEW.task_id;
END$$

CREATE TRIGGER trg_comments_after_delete
AFTER DELETE ON comments
FOR EACH ROW
BEGIN
    UPDATE tasks
       SET comments_count = GREATEST(comments_count - 1, 0)
     WHERE id = OLD.task_id;
END$$

-- A row "counts" toward tasks.attachments_count only when it is finalised
-- (upload_status='complete') AND not soft-deleted (deleted_at IS NULL). A
-- 'pending' sign-time row therefore does NOT count until /finalize flips it.
CREATE TRIGGER trg_attachments_after_insert
AFTER INSERT ON attachments
FOR EACH ROW
BEGIN
    IF NEW.deleted_at IS NULL AND NEW.upload_status = 'complete' THEN
        UPDATE tasks
           SET attachments_count = attachments_count + 1
         WHERE id = NEW.task_id;
    END IF;
END$$

CREATE TRIGGER trg_attachments_after_update
AFTER UPDATE ON attachments
FOR EACH ROW
BEGIN
    -- Increment when the row crosses from not-counted to counted
    -- (e.g. pending→complete at finalize, or an undelete that restores a
    -- complete row); decrement on the reverse (soft-delete of a complete row).
    IF (OLD.deleted_at IS NOT NULL OR OLD.upload_status <> 'complete')
       AND (NEW.deleted_at IS NULL AND NEW.upload_status = 'complete') THEN
        UPDATE tasks
           SET attachments_count = attachments_count + 1
         WHERE id = NEW.task_id;
    ELSEIF (OLD.deleted_at IS NULL AND OLD.upload_status = 'complete')
       AND (NEW.deleted_at IS NOT NULL OR NEW.upload_status <> 'complete') THEN
        UPDATE tasks
           SET attachments_count = GREATEST(attachments_count - 1, 0)
         WHERE id = NEW.task_id;
    END IF;
END$$

CREATE TRIGGER trg_subtasks_after_insert
AFTER INSERT ON tasks
FOR EACH ROW
BEGIN
    IF NEW.parent_task_id IS NOT NULL THEN
        UPDATE tasks
           SET subtasks_count = subtasks_count + 1
         WHERE id = NEW.parent_task_id;
    END IF;
END$$

CREATE TRIGGER trg_subtasks_after_update
AFTER UPDATE ON tasks
FOR EACH ROW
BEGIN
    -- A subtask just transitioned to a done/closed group → increment parent's
    -- completed counter. We detect via status_id change + new status_group
    -- being terminal. Looking up the status group requires a SELECT.
    IF NEW.parent_task_id IS NOT NULL AND OLD.status_id <> NEW.status_id THEN
        UPDATE tasks p
           JOIN statuses s_old ON s_old.id = OLD.status_id
           JOIN statuses s_new ON s_new.id = NEW.status_id
           SET p.subtasks_completed = p.subtasks_completed
               + CASE WHEN s_new.status_group IN ('done','closed') THEN 1 ELSE 0 END
               - CASE WHEN s_old.status_group IN ('done','closed') THEN 1 ELSE 0 END
         WHERE p.id = NEW.parent_task_id;
    END IF;
END$$

CREATE TRIGGER trg_subtasks_after_delete
AFTER DELETE ON tasks
FOR EACH ROW
BEGIN
    IF OLD.parent_task_id IS NOT NULL THEN
        UPDATE tasks
           SET subtasks_count = GREATEST(subtasks_count - 1, 0)
         WHERE id = OLD.parent_task_id;
    END IF;
END$$

CREATE TRIGGER trg_form_submissions_after_insert
AFTER INSERT ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms
       SET submission_count = submission_count + 1
     WHERE id = NEW.form_id;
END$$

DELIMITER ;


-- =============================================================================
-- VIEWS — convenience aggregates the API can read from instead of writing the
-- joins by hand. Optional; remove if you prefer all reads in application code.
-- =============================================================================

-- Open tasks (operational + engineering), excluding archived. Used by My Work
-- card on Home, and "Stuck Orders" KPI.
CREATE OR REPLACE VIEW v_open_tasks AS
    SELECT t.*, s.status_group
      FROM tasks t
      JOIN statuses s ON s.id = t.status_id
     WHERE t.archived_at IS NULL
       AND s.status_group NOT IN ('done','closed');

-- Open bugs aggregated by severity (Bug Triage page, Eng Home counts).
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

-- Active sprint per workspace (one row per workspace).
CREATE OR REPLACE VIEW v_active_sprint AS
    SELECT *
      FROM sprints
     WHERE status = 'active';

-- Current on-call engineer per workspace.
CREATE OR REPLACE VIEW v_current_on_call AS
    SELECT s.*
      FROM on_call_shifts s
     WHERE CURDATE() BETWEEN s.week_start AND s.week_end;

-- Tasks whose SLA window passed without completion — drives the red flag in
-- the CS team UI and the on-call paging job for engineering S0/S1 bugs.
CREATE OR REPLACE VIEW v_breached_sla AS
    SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
           t.task_type_id, t.sla_due_at,
           TIMESTAMPDIFF(MINUTE, t.sla_due_at, NOW()) AS minutes_breached
      FROM tasks t
     WHERE t.sla_due_at IS NOT NULL
       AND t.sla_due_at < NOW()
       AND t.completed_at IS NULL
       AND t.archived_at IS NULL;


-- =============================================================================
-- END OF SCHEMA
--
-- Post-install:
--   1. Run `SET GLOBAL innodb_file_per_table = ON;` (default in MySQL 8).
--   2. Tune `innodb_buffer_pool_size` to ~70% of available RAM.
--   3. Enable slow-query log: `slow_query_log = 1`, `long_query_time = 0.5`.
--   4. Add weekly `OPTIMIZE TABLE tasks, comments, notifications, task_activity`
--      to defragment after heavy update workloads.
--   5. Backup nightly via `mysqldump --single-transaction --quick --routines`.
--   6. Application layer should run `ALTER TABLE tasks AUTO_INCREMENT = X`
--      check periodically if you ever migrate to BIGINT internal_id-only PKs.
-- =============================================================================
