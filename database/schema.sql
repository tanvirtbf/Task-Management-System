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
DROP TABLE IF EXISTS user_notification_prefs;
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
DROP TABLE IF EXISTS department_reports;
DROP TABLE IF EXISTS task_reviews;
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
    -- fiscal_year_start_month was dropped in F28 (upgrades/012): it was stored,
    -- validated 1-12 and read by nothing. There is no financial-reporting
    -- surface in this product. working_days + business_hours DO have a consumer
    -- now -- they drive SLA deadlines (utils/dhakaTime.ts, decision D12.2).
    -- Dynamic RBAC cache stamp: bumped on ANY role/grant/assignment change so
    -- the per-request permission cache invalidates instantly (see §38-41).
    permissions_version      INT UNSIGNED NOT NULL DEFAULT 1,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT ck_workspaces_week_starts_on CHECK (week_starts_on BETWEEN 0 AND 6),
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
    -- Home team (team-access P1, upgrades/016). Space MEMBERSHIP itself is the
    -- `user_roles` rows with scope_type='space' (plan D-1/D-2); this column
    -- only records which of those is the person's home team. FK to spaces is
    -- added post-hoc after §6 (spaces does not exist yet at this point).
    primary_space_id VARCHAR(64) NULL,
    last_login_at TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT uq_users_workspace_email UNIQUE (workspace_id, email),
    CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_users_workspace_status (workspace_id, status),
    INDEX idx_users_email           (email),
    INDEX idx_users_primary_space   (primary_space_id)
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
    -- Department head (Dept Review V1) — reviews this space's tasks. Nullable;
    -- app-side nulling on user deactivation (users are never hard-deleted).
    head_user_id  VARCHAR(64)  NULL,
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
    CONSTRAINT fk_spaces_head FOREIGN KEY (head_user_id)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT ck_spaces_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$'),
    -- F27 (ISS-033): a workspace held TWO spaces called "Marketing" and the
    -- sidebar rendered them identically. Same case-insensitive collation the
    -- catalog resources already rely on; archived rows included (a restore
    -- must not be able to recreate the duplicate).
    CONSTRAINT uq_spaces_workspace_name UNIQUE (workspace_id, name),
    INDEX idx_spaces_workspace_archived (workspace_id, archived_at, position),
    INDEX idx_spaces_head (head_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- users.primary_space_id → spaces (team-access P1, upgrades/016): added
-- post-hoc because `users` (§2) is created before `spaces` (§6) — the same
-- ordering fix the lists ↔ task_types FK uses in §8. ON DELETE SET NULL:
-- deleting a team leaves its people teamless, it never deletes people.
ALTER TABLE users
    ADD CONSTRAINT fk_users_primary_space FOREIGN KEY (primary_space_id)
        REFERENCES spaces(id) ON DELETE SET NULL ON UPDATE CASCADE;


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
    -- F27 (ISS-035): the same trap one level deeper in the tree.
    CONSTRAINT uq_lists_space_name UNIQUE (space_id, name),
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
    -- Overdue-alert claim (upgrades/014): set by the overdue-alert job in the
    -- same tx as its `overdue` notification fanout, so each due_date alerts
    -- its assignees exactly once. App clears it whenever due_date CHANGES
    -- (single PATCH + bulk) — a moved deadline re-arms the alert.
    overdue_notified_at  TIMESTAMP    NULL,

    -- ─── Dept Review V1 — current review state (denormalised) ─────────────
    -- App-maintained in the SAME tx as the task_reviews insert (NO triggers).
    -- reviewed_at is app-written UTC. All three are cleared whenever the task
    -- leaves a done status group (single PATCH, bulk — see TaskWriteService).
    review_status        ENUM('approved','flagged') NULL,
    reviewed_at          TIMESTAMP    NULL,
    reviewed_by          VARCHAR(64)  NULL,

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
    -- Checklist rollup (upgrades/022): items across ALL of the task's
    -- checklists, app-maintained in the same tx as every item write
    -- (TasksRepo.recomputeChecklistCounters — absolute recompute, no drift).
    -- Feeds the row/board "3/7" chip and the drawer's aggregate %.
    checklist_items_total INT UNSIGNED NOT NULL DEFAULT 0,
    checklist_items_done  INT UNSIGNED NOT NULL DEFAULT 0,

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
    CONSTRAINT fk_tasks_reviewed_by FOREIGN KEY (reviewed_by)
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
    INDEX idx_tasks_sla (sla_due_at, completed_at, archived_at),
    -- F30 (ISS-088): list pagination orders by internal_id; without this the
    -- page was index-found then FILESORTED (P40 EXPLAIN).
    INDEX idx_tasks_list_internal (primary_list_id, internal_id),
    -- upgrades/014: the overdue-alert job's every-10-min scan
    -- (due_date < today AND open AND unclaimed).
    INDEX idx_tasks_overdue_scan (due_date, completed_at, archived_at, overdue_notified_at)
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
    INDEX idx_task_activity_task_time (task_id, created_at DESC),
    -- F30 (ISS-088): the feed orders by internal_id DESC.
    INDEX idx_task_activity_task_internal (task_id, internal_id)
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
    INDEX idx_comments_parent    (parent_comment_id),
    -- F30 (ISS-088): listByTask orders by (created_at, internal_id) - the
    -- tie-break is what forced the filesort off idx_comments_task_time.
    INDEX idx_comments_task_created_internal (task_id, created_at, internal_id)
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

-- F16 (ISS-022): R2 object keys awaiting deletion, for the ONE case the
-- soft-delete flow cannot see — a task HARD delete. fk_attachments_task is
-- ON DELETE CASCADE, so the rows vanish with the task, and the r2-purge job
-- (which finds objects by reading soft-deleted attachment rows) never learns
-- those objects exist; the bytes stayed in the bucket forever. The hard-delete
-- transaction copies the subtree's keys here BEFORE deleting the task row; the
-- same job drains the queue. No grace period — the task is already gone.
CREATE TABLE r2_purge_queue (
    id            VARCHAR(64)  NOT NULL,
    storage_key   VARCHAR(500) NOT NULL,
    thumbnail_key VARCHAR(500) NULL,
    queued_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_r2_purge_queued (queued_at)
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
    -- Submitted values, AES-256-GCM encrypted at rest: `data` holds a JSON
    -- { ciphertext, iv, authTag } (PII-at-rest protection, §P1-02). Legacy rows
    -- created before encryption hold the raw object; the read path detects and
    -- decrypts only the encrypted shape.
    data            JSON         NOT NULL,
    submitted_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Encryption + 90-day PII retention (migration 0005 — folded here so
    -- `db:setup` provisions them; the retention job deletes `expires_at < now`).
    encrypted_at    TIMESTAMP    NULL DEFAULT NULL,
    expires_at      TIMESTAMP    NULL DEFAULT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_form_submissions_internal_id (internal_id),
    CONSTRAINT fk_form_submissions_form FOREIGN KEY (form_id)
        REFERENCES forms(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_form_submissions_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_form_submissions_form_time (form_id, submitted_at DESC),
    INDEX idx_form_submissions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 29. notifications
-- Per-user inbox. Snooze + read state.
-- =============================================================================
CREATE TABLE notifications (
    id             VARCHAR(64)  NOT NULL,
    internal_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        VARCHAR(64)  NOT NULL,
    -- F19 (D6, upgrades/009): 12 → 7. The five removed values had no producer
    -- and no surface to build one from. comment/status_change now have REAL
    -- producers instead of being empty promises. upgrades/014 re-added
    -- `overdue` (appended at END) — the overdue-alert job is its producer.
    type           ENUM('assigned','mentioned','comment','status_change',
                        'form_submitted',
                        -- Dept Review V1 (appended at END — ENUM order parity)
                        'task_reviewed','report_ready',
                        -- upgrades/014 — produced by the overdue-alert job
                        'overdue',
                        -- team-access P8 (upgrades/021) — assignment approval
                        'assignment_request','assignment_request_decided',
                        'assignment_query',
                        -- upgrades/023 — permanent-delete approval
                        'delete_request','delete_request_decided') NOT NULL,
    -- `delete_request` (upgrades/023) exists because an APPROVED delete
    -- destroys the task: a notification pointing at it would navigate to a
    -- 404 (ISS-073), so the decision notice is about the REQUEST instead.
    entity_type    ENUM('task','comment','form','automation',
                        'incident','report','delete_request') NOT NULL,
    entity_id      VARCHAR(64)  NOT NULL,
    actor_id       VARCHAR(64)  NULL,
    title          VARCHAR(300) NOT NULL,
    body           VARCHAR(1000) NULL,
    is_read        BOOLEAN      NOT NULL DEFAULT FALSE,
    snoozed_until  TIMESTAMP    NULL,
    -- Soft-delete tombstone (§19 #7 — DELETE hides the row from feed/count).
    deleted_at     TIMESTAMP    NULL,
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
-- 29b. user_notification_prefs  (§19 #8/#9 — per-user, per-type delivery prefs)
-- A MISSING (user_id, type) row means "all channels on" (the spec default); the
-- API lazily fills defaults on read and upserts only the sent types on write.
-- =============================================================================
-- F19 (upgrades/009): the enum is 7 values — the five producerless types were
-- removed (D6), and email_enabled is gone (D8: it promised a channel that has
-- no implementation). in_app_enabled is REAL since F19: NotificationsRepo
-- filters every fanout through it at produce time.
CREATE TABLE user_notification_prefs (
    user_id         VARCHAR(64) NOT NULL,
    type            ENUM('assigned','mentioned','comment','status_change',
                        'form_submitted',
                        -- Dept Review V1 (must mirror notifications.type)
                        'task_reviewed','report_ready',
                        -- upgrades/014 (must mirror notifications.type)
                        'overdue',
                        -- upgrades/021 (must mirror notifications.type)
                        'assignment_request','assignment_request_decided',
                        'assignment_query',
                        -- upgrades/023 (must mirror notifications.type)
                        'delete_request','delete_request_decided') NOT NULL,
    in_app_enabled  BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, type),
    CONSTRAINT fk_user_notification_prefs_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 29c. push_subscriptions  (§29c Web Push devices — upgrades/015, 2026-08-08)
-- One row per (user, browser/device): "this browser agreed to receive pushes
-- for this user". Written once the device grants the browser Notification
-- permission; deleted on sign-out, or by PushService when the push service
-- answers 404/410 (the browser revoked/expired the subscription).
--
-- `endpoint` (the push-service URL) is too long for a utf8mb4 unique index, so
-- uniqueness rides on endpoint_hash = SHA-256 hex of the endpoint. A device
-- that re-subscribes under a DIFFERENT user (shared computer) is REASSIGNED by
-- the upsert — it delivers to whoever is signed in, never the previous user.
-- =============================================================================
CREATE TABLE push_subscriptions (
    id             VARCHAR(64)   NOT NULL,
    user_id        VARCHAR(64)   NOT NULL,
    endpoint_hash  CHAR(64)      NOT NULL,
    endpoint       VARCHAR(1000) NOT NULL,
    -- Browser-generated encryption material (base64url).
    p256dh         VARCHAR(255)  NOT NULL,
    auth           VARCHAR(191)  NOT NULL,
    -- Device label, for answering "which browser is this?" in support.
    user_agent     VARCHAR(255)  NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_push_subscriptions_endpoint (endpoint_hash),
    CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- The fan-out read: every device of a set of recipients.
    INDEX idx_push_subscriptions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 30. on_call_shifts
-- One row per week per engineer on call. These are Dhaka business days. The
-- current engineer is found by `WHERE week_start <= :today AND week_end >=
-- :today`, where `:today` is the Dhaka calendar day bound by the app
-- (`dhakaToday()`) — NOT `CURDATE()`, which renders in the UTC session zone and
-- would roll the roster over 6h late. See database/upgrades/005_clock_views.sql.
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
    -- 'task' appended (team-access P3, upgrades/017): hard-deleting a task
    -- must leave a trail HERE — its own task_activity rows die in the cascade.
    entity_type  ENUM('workspace','space','list','task_type','tag',
                      'custom_field','user','role','sprint','task') NOT NULL,
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
    INDEX idx_workspace_activity_entity (entity_type, entity_id),
    -- F30 (ISS-088): both feed reads order by internal_id DESC.
    INDEX idx_workspace_activity_ws_internal (workspace_id, internal_id)
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
-- 33. task_postmortems  (§22 — postmortem checklist on a resolved Incident)
--
-- One row per Incident task (PK = task_id). `items` is the checklist
-- label → checked map (e.g. { "Root cause identified": true, … }) submitted at
-- POST /api/v1/eng/incidents/:id/postmortem. "Submit" is an UPSERT, so a
-- re-submit updates the same row (and bumps updated_at / updated_by). Only
-- allowed on a task whose type is "Incident" and whose status is done/closed —
-- enforced in the application layer.
-- =============================================================================
CREATE TABLE task_postmortems (
    task_id     VARCHAR(64)  NOT NULL,
    items       JSON         NOT NULL,
    updated_by  VARCHAR(64)  NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (task_id),
    CONSTRAINT fk_task_postmortems_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_postmortems_updated_by FOREIGN KEY (updated_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 34. chat_conversations  (AI Help Assistant — one help-chat thread per row)
--
-- See AI_ASSISTANT_PLAN.md (Phase 6). Owned by a user within a workspace; a
-- user only ever reads their own conversations. `title` is derived from the
-- first question. The turns live in chat_messages.
-- =============================================================================
CREATE TABLE chat_conversations (
    id           VARCHAR(64)  NOT NULL,
    workspace_id VARCHAR(64)  NOT NULL,
    user_id      VARCHAR(64)  NOT NULL,
    title        VARCHAR(200) NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_chat_conversations_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_chat_conversations_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_chat_conversations_user_time (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 35. chat_messages  (AI Help Assistant — user/assistant turns in a thread)
-- =============================================================================
CREATE TABLE chat_messages (
    id              VARCHAR(64)              NOT NULL,
    internal_id     BIGINT UNSIGNED          NOT NULL AUTO_INCREMENT,
    conversation_id VARCHAR(64)              NOT NULL,
    role            ENUM('user','assistant') NOT NULL,
    content         MEDIUMTEXT               NOT NULL,
    created_at      TIMESTAMP                NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_chat_messages_internal_id (internal_id),
    CONSTRAINT fk_chat_messages_conversation FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_chat_messages_conversation_time (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 36. task_reviews  (Dept Review V1 — append-only head-verdict ledger)
-- One row per review ACTION (approve ✓ / flag ⚑). The task's CURRENT review
-- state is denormalised onto tasks.review_status/reviewed_at/reviewed_by and
-- maintained app-side in the SAME transaction (NO triggers — 1442 lesson).
-- `created_at` is app-written UTC (bound param) — deliberately NO DB default.
-- `workspace_id`/`space_id` are historical snapshot annotations (report
-- attribution); live bucketing always derives a task's space via
-- primary_list_id → lists.space_id, never from these columns.
-- =============================================================================
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
    -- RESTRICT: accountability ledger — a user hard-delete must never silently
    -- destroy review history (users are soft-deactivated in practice anyway).
    CONSTRAINT fk_task_reviews_reviewer FOREIGN KEY (reviewer_id)
        REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Space rollups / A-5 history — keyset over internal_id (insertion order)
    INDEX idx_task_reviews_space_time (space_id, internal_id),
    INDEX idx_task_reviews_task_time (task_id, internal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 37. department_reports  (Dept Review V1 — weekly per-department HR reports)
-- One row per (space, Dhaka-calendar week). `payload` = full stats snapshot
-- (JSON, shape owned by ReportStatsService). Regeneratable: the upsert updates
-- payload/generated_* ONLY — never head_note / acknowledged_* / notified_at.
-- `notified_at` = atomic one-time-fanout claim (UPDATE … WHERE notified_at IS
-- NULL; affectedRows=1 elects exactly one notifier — job vs manual race-proof).
-- `generated_at`/`notified_at`/`acknowledged_at` are app-written UTC (NO DB
-- defaults). `head_user_id`/`generated_by`/`acknowledged_by` are point-in-time
-- snapshots (deliberately NO user FKs). Space FK is RESTRICT: reports are
-- retained HR history — a space with reports can be archived but never
-- hard-deleted (SpacesService surfaces 409 `space.has_reports`).
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


-- =============================================================================
-- 38. permissions  (Dynamic RBAC — the permission CATALOG)
-- Reference data, not user content: rows are synced from `server/src/rbac/
-- catalog.ts` at boot. `scopes` is a CSV of the scopes an admin may choose for
-- this permission ('all' always included; 'space' only where the resource
-- resolves to a space; 'own' only where creator/assignee is meaningful).
-- Column is `permission_key`, not `key` — KEY is a MySQL reserved word.
-- =============================================================================
CREATE TABLE permissions (
    permission_key VARCHAR(64)  NOT NULL,
    group_key      VARCHAR(40)  NOT NULL,
    label          VARCHAR(120) NOT NULL,
    description    VARCHAR(400) NOT NULL,
    scopes         VARCHAR(60)  NOT NULL,
    is_dangerous   BOOLEAN      NOT NULL DEFAULT FALSE,
    position       INT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (permission_key),
    INDEX idx_permissions_group (group_key, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 39. roles  (Dynamic RBAC — per-workspace, USER-DEFINABLE)
-- Four rows are seeded as `is_system` (owner/admin/member/guest) reproducing
-- the pre-RBAC behaviour exactly; admins create their own beside them.
-- `rank_order`: lower = more powerful (owner=0) — drives the escalation guard.
-- Column is `role_key` / `rank_order`, not `key` / `rank` — both reserved.
-- =============================================================================
CREATE TABLE roles (
    id           VARCHAR(64)  NOT NULL,
    workspace_id VARCHAR(64)  NOT NULL,
    role_key     VARCHAR(60)  NOT NULL,
    name         VARCHAR(80)  NOT NULL,
    description  VARCHAR(300) NULL,
    color        CHAR(7)      NOT NULL DEFAULT '#6B7280',
    is_system    BOOLEAN      NOT NULL DEFAULT FALSE,
    rank_order   INT UNSIGNED NOT NULL DEFAULT 100,
    created_by   VARCHAR(64)  NULL,
    archived_at  TIMESTAMP    NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_workspace_key (workspace_id, role_key),
    -- F27 (ISS-027): role_key was deduped by silently suffixing it; the
    -- DISPLAY name collided freely, so two roles could look identical.
    UNIQUE KEY uq_roles_workspace_name (workspace_id, name),
    CONSTRAINT fk_roles_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_roles_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT ck_roles_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$'),
    INDEX idx_roles_workspace (workspace_id, archived_at, rank_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 40. role_permissions  (Dynamic RBAC — what a role grants, at what scope)
-- Absence of a row = NOT granted. There is no explicit deny (plan D-4:
-- allow-wins union across every role a user holds, widest scope wins).
-- The catalog FK is RESTRICT so a key that roles still reference cannot vanish.
-- =============================================================================
CREATE TABLE role_permissions (
    role_id        VARCHAR(64) NOT NULL,
    permission_key VARCHAR(64) NOT NULL,
    scope          ENUM('all','space','own') NOT NULL DEFAULT 'all',
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (role_id, permission_key),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
        REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_key)
        REFERENCES permissions(permission_key) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_role_permissions_perm (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 41. user_roles  (Dynamic RBAC — assignments AND space membership)
-- `scope_type='workspace'` applies everywhere; `scope_type='space'` applies
-- inside one space — and holding ANY space-scoped role IS that user's
-- membership of that space (there is deliberately no separate members table).
-- `scope_key` is a VIRTUAL generated column used ONLY by the UNIQUE key: MySQL
-- treats NULLs as distinct, so a unique key over the nullable `scope_id` would
-- allow the same workspace-wide grant to be inserted twice. It must be VIRTUAL,
-- not STORED — MySQL forbids an ON UPDATE CASCADE foreign key on a base column
-- of a STORED generated column (error 1215), and `scope_id` is both the spaces
-- FK and this expression's base. The app never reads or writes it (it is not
-- modelled in the Drizzle mirror).
-- =============================================================================
CREATE TABLE user_roles (
    id           VARCHAR(64) NOT NULL,
    workspace_id VARCHAR(64) NOT NULL,
    user_id      VARCHAR(64) NOT NULL,
    role_id      VARCHAR(64) NOT NULL,
    scope_type   ENUM('workspace','space') NOT NULL DEFAULT 'workspace',
    scope_id     VARCHAR(64) NULL,
    granted_by   VARCHAR(64) NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scope_key    VARCHAR(64) GENERATED ALWAYS AS (IFNULL(scope_id, '*')) VIRTUAL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_roles_grant (user_id, role_id, scope_type, scope_key),
    CONSTRAINT fk_user_roles_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id)
        REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_space FOREIGN KEY (scope_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_granted_by FOREIGN KEY (granted_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_user_roles_user (user_id, scope_type),
    INDEX idx_user_roles_scope (scope_id),
    INDEX idx_user_roles_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 42. space_visibility_grants  (team-access P4, upgrades/018)
-- "Team A can also SEE team B." One row per (viewer, target) pair. Consumed at
-- actor-fold time (PolicyService): a space-scoped `space.view` entry gains the
-- granted targets, so spaces/lists/tasks/search/home all follow through the
-- one visibility choke point. DORMANT while every role's `space.view` is
-- `all` (today) — the machinery ships ahead of the P6 switch.
-- Single hop by design: a grant to A does NOT inherit A's own grants.
-- `viewer <> target` is enforced app-side: MySQL 8 forbids a CHECK on columns
-- used in cascading FKs (the same reason task_dependencies uses triggers).
-- =============================================================================
CREATE TABLE space_visibility_grants (
    id              VARCHAR(64) NOT NULL,
    workspace_id    VARCHAR(64) NOT NULL,
    -- The team that GAINS sight.
    viewer_space_id VARCHAR(64) NOT NULL,
    -- The team that becomes visible to it.
    target_space_id VARCHAR(64) NOT NULL,
    granted_by      VARCHAR(64) NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- Also serves viewer-prefix lookups (targetsForViewers).
    UNIQUE KEY uq_svg_pair (viewer_space_id, target_space_id),
    CONSTRAINT fk_svg_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_svg_viewer FOREIGN KEY (viewer_space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_svg_target FOREIGN KEY (target_space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_svg_granted_by FOREIGN KEY (granted_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_svg_workspace (workspace_id),
    INDEX idx_svg_target (target_space_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 43. task_assignment_requests  (team-access P8, upgrades/021)
-- Cross-team assignment approval (R1.4): when the person being assigned is NOT
-- a member of the space that owns the task (Q11 — membership decides, not home
-- team), the assignment paths create a PENDING request here instead of an
-- assignee row. The target user, any Head of a team the target belongs to, or
-- an admin accepts (atomic claim) / declines / raises a `query` ("I need 2 more
-- days" + proposed date); the requester answers via its own endpoint (fix B2 —
-- after P7 the requester holds no task.edit on the task). Same-team assignment
-- never lands here (Q5), nor does the S0/S1 on-call auto-assign (Q7), nor a
-- target whose `task.view` reach is `all` — which keeps this table EMPTY and
-- the gate dormant while the open seeded grants are in force.
--
-- `space_id` is the owning space AT REQUEST TIME (snapshot annotation, the
-- task_reviews convention); live derivation is always primary_list_id →
-- lists.space_id. `request_note`/`query_note`/`proposed_due_date` mirror the
-- LATEST negotiation state; the full history lives in the events ledger (§44).
-- `pending_flag` is a VIRTUAL generated column used ONLY by the unique key:
-- NULL for decided rows (NULLs are distinct, so history stacks freely), 1 for
-- pending — at most ONE live request per (task, person). VIRTUAL, not STORED,
-- per the user_roles `scope_key` precedent (and never modelled in Drizzle).
-- `expires_at`/`created_at`/`updated_at`/`decided_at` are app-written UTC
-- (bound params) — deliberately NO DB defaults (the task_reviews clock rule).
-- =============================================================================
CREATE TABLE task_assignment_requests (
    id                VARCHAR(64) NOT NULL,
    internal_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id      VARCHAR(64) NOT NULL,
    space_id          VARCHAR(64) NOT NULL,
    task_id           VARCHAR(64) NOT NULL,
    -- The person whose consent is being asked for.
    target_user_id    VARCHAR(64) NOT NULL,
    requested_by      VARCHAR(64) NOT NULL,
    status            ENUM('pending','accepted','declined','expired','cancelled')
                          NOT NULL DEFAULT 'pending',
    -- The requester's message at creation.
    request_note      VARCHAR(500) NULL,
    -- The receiver side's LATEST query ("I need 2 more days").
    query_note        VARCHAR(500) NULL,
    -- The latest proposed new due date riding on that query (DATE — the same
    -- calendar-day domain as tasks.due_date).
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
    -- At most one PENDING request per (task, person); decided history is free.
    UNIQUE KEY uq_tar_one_pending (task_id, target_user_id, pending_flag),
    CONSTRAINT fk_tar_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_space FOREIGN KEY (space_id)
        REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- CASCADE (not RESTRICT): a negotiation is meaningless without its people,
    -- and users are soft-deactivated in practice anyway (F16 clean-cascade rule).
    CONSTRAINT fk_tar_target FOREIGN KEY (target_user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_requested_by FOREIGN KEY (requested_by)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tar_decided_by FOREIGN KEY (decided_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- Received inbox / sent list / drawer history / janitor scan.
    INDEX idx_tar_target (target_user_id, status, internal_id),
    INDEX idx_tar_requester (requested_by, status, internal_id),
    INDEX idx_tar_task_time (task_id, internal_id),
    INDEX idx_tar_expiry (status, expires_at),
    INDEX idx_tar_workspace (workspace_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;


-- =============================================================================
-- 44. task_assignment_request_events  (team-access P8, upgrades/021)
-- Append-only ledger of the whole negotiation (the task_reviews shape): one row
-- per ACTION — created / accepted / declined / queried / answered / cancelled /
-- expired — so the P9 drawer panel can show the back-and-forth verbatim.
-- `actor_id` NULL = the system (the expiry janitor). `created_at` app-written
-- UTC, no DB default.
-- =============================================================================
CREATE TABLE task_assignment_request_events (
    id                VARCHAR(64) NOT NULL,
    internal_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id        VARCHAR(64) NOT NULL,
    actor_id          VARCHAR(64) NULL,
    action            ENUM('created','accepted','declined','queried','answered',
                           'cancelled','expired') NOT NULL,
    note              VARCHAR(500) NULL,
    -- For 'queried': the proposal. For 'answered': the date actually applied.
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


-- =============================================================================
-- 45. task_delete_requests  (permanent-delete approval, upgrades/023)
-- =============================================================================
-- Destroying a task for good used to be admin-only and instant; everyone else
-- could only ARCHIVE. This is the middle step: whoever may delete a task may
-- ASK for it to be removed, and an Owner/Admin holding `task.delete_hard`
-- approves. While a request is pending the task is COMPLETELY unchanged — a
-- request must never be a way to make a colleague's work vanish from a board.
--
-- `task_name` is denormalised because the task FK cascades: approving destroys
-- this row along with the task, so the name has to survive in the audit entry
-- and the requester's notification, both written BEFORE the delete.
--
-- `pending_flag` is the §43 VIRTUAL-column trick — at most ONE live request per
-- task, while decided history stacks freely (NULLs are distinct). Never
-- modelled in Drizzle, never written by the app.
CREATE TABLE task_delete_requests (
    id             VARCHAR(64) NOT NULL,
    internal_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workspace_id   VARCHAR(64) NOT NULL,
    -- Owning space AT REQUEST TIME (snapshot annotation).
    space_id       VARCHAR(64) NOT NULL,
    task_id        VARCHAR(64) NOT NULL,
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

-- F15 (ISS-065): the API SOFT-deletes a comment (stamps deleted_at); it never
-- issues a SQL DELETE, so the trigger above could only fire if someone removed
-- a row by hand and comments_count only ever went UP. A comment counts while
-- deleted_at IS NULL; this moves the counter on the crossing in either
-- direction and ignores an ordinary edit. Same shape as
-- trg_attachments_after_update, which is the one that was always right.
CREATE TRIGGER trg_comments_after_update
AFTER UPDATE ON comments
FOR EACH ROW
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE tasks
           SET comments_count = GREATEST(comments_count - 1, 0)
         WHERE id = NEW.task_id;
    ELSEIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE tasks
           SET comments_count = comments_count + 1
         WHERE id = NEW.task_id;
    END IF;
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

-- Subtask counters (subtasks_count / subtasks_completed): NO triggers.
-- MySQL forbids a trigger on `tasks` from modifying `tasks` (error 1442
-- "Can't update table in stored function/trigger…"), so the former
-- trg_subtasks_after_{insert,update,delete} triggers could not maintain these
-- counters AND actively crashed every subtask status change with a raw 500.
-- Removed 2026-07-14. The counters keep their 0 default; accurate maintenance
-- must be done app-side (recompute on subtask create / status-change / delete)
-- — tracked as a gate follow-up. (In the SQLite port these triggers were legal;
-- MySQL is stricter.)

CREATE TRIGGER trg_form_submissions_after_insert
AFTER INSERT ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms
       SET submission_count = submission_count + 1
     WHERE id = NEW.form_id;
END$$

-- F15 (ISS-080): the 90-day retention job DELETEs submissions directly, so an
-- INSERT-only counter drifted permanently upward.
CREATE TRIGGER trg_form_submissions_after_delete
AFTER DELETE ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms
       SET submission_count = GREATEST(submission_count - 1, 0)
     WHERE id = OLD.form_id;
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
-- `week_start`/`week_end` are Dhaka business days, and the MySQL session runs in
-- UTC (F3 — see database/upgrades/005_clock_views.sql), so "today" must be the
-- Dhaka calendar day, not `CURDATE()`/`UTC_DATE()`. Bangladesh is permanently
-- UTC+6 with no DST, so the fixed offset is exact and needs no tz tables. This
-- expression matches the app's `dhakaToday()` helper.
CREATE OR REPLACE VIEW v_current_on_call AS
    SELECT s.*
      FROM on_call_shifts s
     WHERE DATE(UTC_TIMESTAMP() + INTERVAL 6 HOUR)
           BETWEEN s.week_start AND s.week_end;

-- Tasks whose SLA window passed without completion — drives the red flag in
-- the CS team UI and the on-call paging job for engineering S0/S1 bugs.
CREATE OR REPLACE VIEW v_breached_sla AS
    SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
           t.task_type_id, t.sla_due_at,
           TIMESTAMPDIFF(MINUTE, t.sla_due_at, UTC_TIMESTAMP()) AS minutes_breached
      FROM tasks t
     WHERE t.sla_due_at IS NOT NULL
       AND t.sla_due_at < UTC_TIMESTAMP()
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
