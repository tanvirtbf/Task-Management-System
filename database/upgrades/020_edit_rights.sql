-- 020_edit_rights.sql — edit rights (team-access P7), 2026-08-11
--
-- Phase 7 of TEAM_ACCESS_AND_AUDIT_PLAN.md: from this flip, a MEMBER may
-- edit / archive / delete only tasks they CREATED or are ASSIGNED to — plus,
-- via the new head allow-path shipped with this build, the HEAD of the
-- owning space may do all of it for their department without being assigned
-- (R2.2: "sudhu jara task e assign ase … othoba oi team er head").
--
-- Admin / Owner keep `all`. Guest holds none of these keys (D12.1) — nothing
-- to flip there. `task.assign` deliberately stays `all` until P8 puts the
-- cross-team APPROVAL gate in front of it.
--
-- The adjacent surfaces (checklists, attachments, custom-field values,
-- dependencies, SLA override) enforce the same rule in code from this build:
-- mutating a task's CONTENT requires `task.edit` reach on that task,
-- whatever the route's own verb key is. Their verb keys stay `all` — the
-- object-level check is what narrows.
--
-- Ships as DATA like 019: seed specs stay open for fresh installs; this file
-- is the tightening; prod's upgrade chain replays it. Re-running a seed
-- script re-asserts the open grants — re-apply 019 + 020 after.
--
-- Idempotent: no-op on rows already flipped.

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
   SET rp.scope = 'own'
 WHERE r.is_system = 1
   AND r.role_key = 'member'
   AND rp.permission_key IN ('task.edit', 'task.archive', 'task.delete');

UPDATE workspaces SET permissions_version = permissions_version + 1;

-- rollback (instant, no data loss):
--   UPDATE role_permissions rp
--     JOIN roles r ON r.id = rp.role_id
--      SET rp.scope = 'all'
--    WHERE r.is_system = 1
--      AND r.role_key = 'member'
--      AND rp.permission_key IN ('task.edit', 'task.archive', 'task.delete');
--   UPDATE workspaces SET permissions_version = permissions_version + 1;
