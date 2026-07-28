-- =============================================================================
-- 004_rbac.sql — Dynamic RBAC, Phase 2 (2026-07-25)
-- Adds the permission/role model:
--   · workspaces.permissions_version  (cache stamp for instant revocation)
--   · permissions       — the permission CATALOG (synced from code at boot)
--   · roles             — per-workspace, user-definable roles
--   · role_permissions  — what a role grants, at what scope
--   · user_roles        — assignments; a space-scoped grant IS membership
--
-- Safety: PURELY ADDITIVE. One ADD COLUMN with a NOT NULL DEFAULT (instant in
-- MySQL 8) + four CREATE TABLEs. No existing row is read, rewritten or moved,
-- and nothing enforces these tables yet (enforcement starts at P11/P16) — so
-- applying this changes NO behaviour.
-- Single-apply: re-running fails harmlessly on duplicate column/table.
--
-- Ordering matters: `permissions` and `roles` must exist before
-- `role_permissions`, and `roles` + `spaces` + `users` before `user_roles`.
--
-- Apply:  mysql -uroot -proot taskmanagement    < database/upgrades/004_rbac.sql
--         mysql -uroot -proot taskmanagement_qa < database/upgrades/004_rbac.sql
-- =============================================================================

-- The Windows `mysql.exe` client defaults to the console codepage (cp850), which
-- would tag the CHECK constraint's string literal `_cp850` and leave this DB
-- differing from one provisioned through `database/schema.sql` (node/mysql2,
-- utf8mb4). Pin the connection charset so both build paths are byte-identical.
SET NAMES utf8mb4;

-- ─── 1. workspaces.permissions_version ───────────────────────────────────────
-- AFTER fiscal_year_start_month keeps the column order identical to a fresh
-- `database/schema.sql` provision (no SHOW CREATE drift between build paths).
ALTER TABLE workspaces
    ADD COLUMN permissions_version INT UNSIGNED NOT NULL DEFAULT 1
        AFTER fiscal_year_start_month;

-- ─── 2. permissions (catalog) ────────────────────────────────────────────────
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

-- ─── 3. roles ────────────────────────────────────────────────────────────────
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
    CONSTRAINT fk_roles_ws FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_roles_created_by FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT ck_roles_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$'),
    INDEX idx_roles_workspace (workspace_id, archived_at, rank_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ─── 4. role_permissions ─────────────────────────────────────────────────────
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

-- ─── 5. user_roles ───────────────────────────────────────────────────────────
-- `scope_key` (VIRTUAL, generated) exists only so the grant UNIQUE key is
-- NULL-safe — MySQL treats NULLs as distinct, which would otherwise allow the
-- same workspace-wide grant to be inserted twice.
-- It MUST be VIRTUAL, not STORED: MySQL forbids a foreign key with
-- ON UPDATE CASCADE on a base column of a STORED generated column (error 1215),
-- and `scope_id` is both the FK to `spaces` and the base of this expression.
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

-- rollback:
-- DROP TABLE IF EXISTS user_roles;
-- DROP TABLE IF EXISTS role_permissions;
-- DROP TABLE IF EXISTS roles;
-- DROP TABLE IF EXISTS permissions;
-- ALTER TABLE workspaces DROP COLUMN permissions_version;
