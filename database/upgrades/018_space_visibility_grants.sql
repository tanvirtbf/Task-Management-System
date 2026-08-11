-- 018_space_visibility_grants.sql — team → team sight (team-access P4), 2026-08-11
--
-- Phase 4 of TEAM_ACCESS_AND_AUDIT_PLAN.md: the mechanism for "Supply Chain
-- can ALSO SEE Software" — built and manageable now, DORMANT until the P6
-- visibility switch (today every seeded role's `space.view` is `all`, so the
-- expansion changes nothing for anybody).
--
-- One table: `space_visibility_grants` — one row per (viewer team, target
-- team) pair. Consumed at actor-fold time (PolicyService): a space-scoped
-- `space.view` entry gains the granted targets, so spaces, lists, tasks,
-- search and home all follow through the ONE visibility choke point. Sight
-- only — write keys (`task.edit` etc.) are untouched. Single hop by design:
-- a grant to team A does not inherit A's own grants.
--
-- `viewer <> target` is enforced app-side (422): MySQL 8 forbids a CHECK on
-- columns used in cascading FKs (the reason task_dependencies uses triggers).
--
-- Grant/revoke bump `workspaces.permissions_version` — the fold caches by it.
--
-- Mirrored in database/schema.sql §42 + server/src/db/schema/rbac.ts (the
-- three-synchronized-edits rule). Fresh `db:setup` now provisions
-- **44 tables** / 5 views / 9 triggers (was 43 since 015).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS (the 007/015 pattern).

CREATE TABLE IF NOT EXISTS space_visibility_grants (
    id              VARCHAR(64) NOT NULL,
    workspace_id    VARCHAR(64) NOT NULL,
    viewer_space_id VARCHAR(64) NOT NULL,
    target_space_id VARCHAR(64) NOT NULL,
    granted_by      VARCHAR(64) NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
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

-- rollback:
--   DROP TABLE IF EXISTS space_visibility_grants;
--   UPDATE workspaces SET permissions_version = permissions_version + 1;
