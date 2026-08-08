-- 010_name_uniqueness.sql — FIXING phase F27 (ISS-033/035/027), 2026-08-06
--
-- The settled cross-phase pattern: of eight named resources, THREE enforce
-- case-insensitive uniqueness and five do not — and the three that work are the
-- CATALOG resources (statuses, task types, tags) while the ones that do not are
-- the NAVIGATION resources, where a duplicate name hurts most. ISS-033's real
-- incident: the workspace ended up with two spaces called "Marketing" — one
-- with three lists and a head, one empty — rendering identically in the sidebar
-- tree and needing to be untangled by hand.
--
-- This copies the working implementation exactly: a UNIQUE INDEX on the same
-- `utf8mb4_unicode_ci` columns the others use (so "Marketing" and "marketing"
-- collide, no application-side lower() needed), which makes the rule race-free.
-- The services map ER_DUP_ENTRY to the spec's 409 code, the way TagService
-- already does. D11: enforced on CREATE **and** RENAME — the three working
-- resources do both, and an index cannot tell them apart anyway.
--
--   spaces  UNIQUE (workspace_id, name)
--   lists   UNIQUE (space_id, name)        -- one level deeper in the tree
--   roles   UNIQUE (workspace_id, name)    -- role_key was already deduped;
--                                             the DISPLAY name was not
--
-- Archived rows are INCLUDED deliberately: an archived space can be restored,
-- and a restore that produced a duplicate would recreate the exact incident
-- ISS-033 records. MySQL has no partial index, so this is also the only option.
--
-- Verified before writing: the demo database has ZERO collision groups across
-- all three tables, so no data has to be resolved first. On a database that
-- does hold duplicates this ALTER fails loudly with ER_DUP_ENTRY naming the
-- colliding value — resolve them and re-run.
--
-- Idempotent: each ADD is gated on information_schema.

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE()
                 AND table_name = 'spaces'
                 AND index_name = 'uq_spaces_workspace_name');
SET @sql := IF(@have = 0,
    'ALTER TABLE spaces ADD UNIQUE KEY uq_spaces_workspace_name (workspace_id, name)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE()
                 AND table_name = 'lists'
                 AND index_name = 'uq_lists_space_name');
SET @sql := IF(@have = 0,
    'ALTER TABLE lists ADD UNIQUE KEY uq_lists_space_name (space_id, name)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @have := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE()
                 AND table_name = 'roles'
                 AND index_name = 'uq_roles_workspace_name');
SET @sql := IF(@have = 0,
    'ALTER TABLE roles ADD UNIQUE KEY uq_roles_workspace_name (workspace_id, name)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- rollback:
--   ALTER TABLE spaces DROP INDEX uq_spaces_workspace_name;
--   ALTER TABLE lists  DROP INDEX uq_lists_space_name;
--   ALTER TABLE roles  DROP INDEX uq_roles_workspace_name;
