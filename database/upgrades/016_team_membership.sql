-- 016_team_membership.sql — teams & heads become real (team-access P1), 2026-08-11
--
-- Phase 1 of TEAM_ACCESS_AND_AUDIT_PLAN.md. NO visibility change yet — this
-- only makes the org structure REAL DATA:
--
--   a. `users.primary_space_id` — the person's HOME team. Space membership
--      itself remains the `user_roles` rows with scope_type='space' (plan
--      D-1/D-2: there is deliberately no separate members table); this column
--      records which of those is home. FK ON DELETE SET NULL: deleting a team
--      leaves its people teamless, it never deletes people.
--   b. Backfill 1 — HEAD MEMBERSHIP (the G2 landmine): `spaces.head_user_id`
--      never created a `user_roles` row, so every department head is invisible
--      to their own space's membership. Insert the missing Member-role space
--      grant for each head. Without this, the later visibility switch (plan
--      P6) would lock every head out of their own department.
--   c. Backfill 2 — heads' home team = the space they head.
--   d. Backfill 3 — anyone holding space grants in EXACTLY ONE space gets that
--      space as home. People in 2+ spaces (or none) stay NULL — an admin
--      assigns them from the new Settings → Teams screen; the screen surfaces
--      them under "no home team yet".
--   e. `permissions_version` bump — backfill (b) changes user grants, and the
--      per-request permission cache is keyed on this stamp; without the bump
--      the new membership rows stay invisible to running servers for the
--      process lifetime.
--
-- Mirrored in database/schema.sql + server/src/db/schema/auth.ts (the
-- three-synchronized-edits rule in database/upgrades/README.md). Fresh
-- `db:setup` counts stay 43 tables / 5 views / 9 triggers (column only).
--
-- Idempotent the MySQL 8 way: ADD COLUMN/INDEX/FK gated on information_schema
-- via PREPARE/EXECUTE (the 014 pattern); backfills guarded by NOT EXISTS /
-- IS NULL. Re-applying is a no-op (except one extra harmless version bump).

-- (a) column — placed AFTER timezone to match schema.sql §2 column order.
SET @have_col := (SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema = DATABASE()
                     AND table_name = 'users'
                     AND column_name = 'primary_space_id');
SET @sql := IF(@have_col = 0,
    'ALTER TABLE users ADD COLUMN primary_space_id VARCHAR(64) NULL AFTER timezone',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have_idx := (SELECT COUNT(*) FROM information_schema.statistics
                   WHERE table_schema = DATABASE()
                     AND table_name = 'users'
                     AND index_name = 'idx_users_primary_space');
SET @sql := IF(@have_idx = 0,
    'ALTER TABLE users ADD INDEX idx_users_primary_space (primary_space_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have_fk := (SELECT COUNT(*) FROM information_schema.table_constraints
                  WHERE table_schema = DATABASE()
                    AND table_name = 'users'
                    AND constraint_name = 'fk_users_primary_space');
SET @sql := IF(@have_fk = 0,
    'ALTER TABLE users ADD CONSTRAINT fk_users_primary_space FOREIGN KEY (primary_space_id) REFERENCES spaces(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- (b) Backfill 1 — every head becomes a MEMBER of the space they head.
-- Role = the workspace's seeded Member system role. The NOT EXISTS checks for
-- ANY space-scoped role in that space (holding e.g. a custom role there is
-- already membership — do not stack a second row). Deterministic id (MD5 of
-- space+user) so a re-run cannot mint duplicates even without the guard.
-- `scope_key` is a GENERATED column — never in the insert list.
INSERT INTO user_roles (id, workspace_id, user_id, role_id, scope_type, scope_id, granted_by)
SELECT CONCAT('urol-mig016-', SUBSTRING(MD5(CONCAT(s.id, ':', s.head_user_id)), 1, 16)),
       s.workspace_id, s.head_user_id, r.id, 'space', s.id, NULL
  FROM spaces s
  JOIN roles r
    ON r.workspace_id = s.workspace_id
   AND r.role_key = 'member'
   AND r.is_system = 1
 WHERE s.head_user_id IS NOT NULL
   AND s.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM user_roles ur
                    WHERE ur.user_id = s.head_user_id
                      AND ur.scope_type = 'space'
                      AND ur.scope_id = s.id);

-- (c) Backfill 2 — a head's home team is the space they head. MIN(id) makes a
-- multi-space head deterministic; only fills NULL (never overwrites a choice).
UPDATE users u
  JOIN (SELECT head_user_id, workspace_id, MIN(id) AS space_id
          FROM spaces
         WHERE head_user_id IS NOT NULL
           AND archived_at IS NULL
         GROUP BY head_user_id, workspace_id) h
    ON h.head_user_id = u.id
   AND h.workspace_id = u.workspace_id
   SET u.primary_space_id = h.space_id
 WHERE u.primary_space_id IS NULL;

-- (d) Backfill 3 — exactly-one-space members get that space as home. Archived
-- roles don't count as membership (matches UserRolesRepo.spaceIdsForUser);
-- grants pointing at archived spaces are excluded via the JOIN.
UPDATE users u
  JOIN (SELECT ur.user_id, ur.workspace_id, MIN(ur.scope_id) AS space_id
          FROM user_roles ur
          JOIN roles r  ON r.id = ur.role_id AND r.archived_at IS NULL
          JOIN spaces s ON s.id = ur.scope_id AND s.archived_at IS NULL
         WHERE ur.scope_type = 'space'
           AND ur.scope_id IS NOT NULL
         GROUP BY ur.user_id, ur.workspace_id
        HAVING COUNT(DISTINCT ur.scope_id) = 1) g
    ON g.user_id = u.id
   AND g.workspace_id = u.workspace_id
   SET u.primary_space_id = g.space_id
 WHERE u.primary_space_id IS NULL;

-- (e) grants changed in (b) → invalidate every cached permission fold.
UPDATE workspaces SET permissions_version = permissions_version + 1;

-- rollback:
--   DELETE FROM user_roles WHERE id LIKE 'urol-mig016-%';
--   ALTER TABLE users DROP FOREIGN KEY fk_users_primary_space;
--   ALTER TABLE users DROP INDEX idx_users_primary_space;
--   ALTER TABLE users DROP COLUMN primary_space_id;
--   UPDATE workspaces SET permissions_version = permissions_version + 1;
