-- 019_visibility_switch.sql — THE SWITCH (team-access P6), 2026-08-11
--
-- Phase 6 of TEAM_ACCESS_AND_AUDIT_PLAN.md: from this moment, a Member (and a
-- Guest) sees ONLY:
--   · the teams they belong to        (user_roles space rows — plan D-1/D-2),
--   · teams granted to their team(s)  (space_visibility_grants, P4),
--   · any task they created or are assigned to, ANYWHERE (the own-escape).
-- Admin and Owner keep `all` (Q4). NO CODE CHANGES ship with this file — the
-- entire mechanism (P1 membership, P4 grants, P5 leak closure) is already
-- live and dormant; these two data flips arm it.
--
-- WHY task.view flips to OWN and not 'space' (fix B1): the cross-team escape
-- (`rbac/ownEscape.ts`) is gated on holding `task.view` with own-reach. The
-- workspace-wide Member assignment + grant 'own' folds to "own items,
-- anywhere" — which is what keeps a cross-team assignee able to open, read
-- and finish the task another team gave them. With 'space' instead, every
-- cross-team assignment would silently vanish from the assignee's screen.
--
-- WHY this works at all: every member holds the Member role TWICE —
--   · workspace-scoped (the L13 mirror)  → space.view 'space' contributes
--     NOTHING here (documented fold rule), task.view 'own' → own-anywhere;
--   · space-scoped (their P1 membership) → space.view 'space' → THEIR teams,
--     which is exactly the boundary this feature is about.
--
-- Ships as DATA, deliberately not as a seed change: fresh installs still
-- seed the open pre-RBAC defaults ("dormant until an admin tightens") and
-- the thousands of tests that rely on that stay meaningful; THIS file is the
-- tightening for real workspaces, and prod's upgrade chain replays it.
--
-- ⚠️ The manual seed scripts (`npm run db:seed`, `npm run db:seed:demo`)
-- re-assert the OPEN seeded grants (seedSystemRoles is a repair operation).
-- The server boot does NOT. If you ever re-run a seed script, re-apply 019.
--
-- Idempotent: the UPDATEs are no-ops on rows already flipped.

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
   SET rp.scope = 'space'
 WHERE r.is_system = 1
   AND r.role_key IN ('member', 'guest')
   AND rp.permission_key = 'space.view';

UPDATE role_permissions rp
  JOIN roles r ON r.id = rp.role_id
   SET rp.scope = 'own'
 WHERE r.is_system = 1
   AND r.role_key IN ('member', 'guest')
   AND rp.permission_key = 'task.view';

-- The fold caches by this stamp — the flip bites on the very next request.
UPDATE workspaces SET permissions_version = permissions_version + 1;

-- rollback (INSTANT, no data loss — one UPDATE + the bump):
--   UPDATE role_permissions rp
--     JOIN roles r ON r.id = rp.role_id
--      SET rp.scope = 'all'
--    WHERE r.is_system = 1
--      AND r.role_key IN ('member', 'guest')
--      AND rp.permission_key IN ('space.view', 'task.view');
--   UPDATE workspaces SET permissions_version = permissions_version + 1;
