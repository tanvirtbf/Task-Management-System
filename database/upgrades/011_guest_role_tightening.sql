-- 011_guest_role_tightening.sql — FIXING phase F28 (ISS-094, decision D12.1), 2026-08-06
--
-- The seeded Guest role held NINETEEN grants at scope=all — it was, by its own
-- description, "Same as a member today, except uploading files". That was a
-- faithful reproduction of the pre-RBAC product, where any authenticated user
-- could do all of it and none of the toggles were enforced. F7 (2026-08-04) made
-- all 56 permissions real route gates, and the same day the faithfulness became
-- a hole:
--
--     a guest could DELETE ANY TASK in the workspace,
--     and read EVERY public-form submission — customer contact details.
--
-- ISS-094 was filed naming two of the nineteen (postmortem.manage,
-- sprint.assign_tasks); the measurement found the rest. D12.1 cuts Guest to a
-- read-and-comment persona: space.view, task.view, member.view, activity.view,
-- assistant.use, comment.create, bug.report.
--
-- MEMBER IS DELIBERATELY UNTOUCHED (20 grants). Member is every internal
-- employee; F7's P39 day-in-the-life scored 22/22 against the current grants and
-- this migration must not re-open that.
--
-- Why a migration is required rather than just the code change: `seedSystemRoles`
-- in server/src/rbac/bootstrap.ts only ever INSERTs and upserts grants — it never
-- deletes one — and it does not run automatically after the first bootstrap. An
-- already-seeded database therefore keeps all nineteen forever, however the code
-- reads. Same reason the description is updated here: it is only written on
-- INSERT.
--
-- SAFETY. Only `is_system = 1` roles with role_key = 'guest' are touched. A
-- CUSTOM role an admin built is never modified, even if they named it "Guest" or
-- keyed it 'guest' — those grants are somebody's deliberate configuration.
-- Idempotent: re-running deletes nothing because there is nothing left to delete.
--
-- REVOKING A GRANT CHANGES WHAT PEOPLE CAN DO. Every guest account loses task
-- create/edit/assign/archive/delete, checklist/dependency/custom-field/template
-- writes, both engineering writes, and form.view_submissions. That is the point.
-- D1 recorded that production is not live, so the affected population is the
-- demo guest accounts.

-- ─── 1. revoke the twelve over-broad grants ──────────────────────────────────

DELETE rp FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
 WHERE r.role_key = 'guest'
   AND r.is_system = 1
   AND rp.permission_key IN (
        -- task writes, workspace-wide
        'task.create',
        'task.edit',
        'task.assign',
        'task.archive',
        'task.delete',
        -- writes to a task's structure
        'checklist.manage',
        'dependency.manage',
        'customfield.set_value',
        'template.apply',
        -- engineering writes (the two ISS-094 named)
        'sprint.assign_tasks',
        'postmortem.manage',
        -- customer contact details from public forms
        'form.view_submissions'
   );

-- ─── 2. re-assert the seven that stay ────────────────────────────────────────
-- Repairs a half-applied run, and heals a database seeded before any of these
-- existed. Scope is forced back to 'all' — for a read grant that is the whole
-- workspace, which is what a guest is for.

INSERT INTO role_permissions (role_id, permission_key, scope)
SELECT r.id, p.k, 'all'
  FROM roles r
  JOIN (
        SELECT 'space.view'     AS k
  UNION SELECT 'task.view'
  UNION SELECT 'member.view'
  UNION SELECT 'activity.view'
  UNION SELECT 'assistant.use'
  UNION SELECT 'comment.create'
  UNION SELECT 'bug.report'
  ) p
 WHERE r.role_key = 'guest'
   AND r.is_system = 1
ON DUPLICATE KEY UPDATE scope = VALUES(scope);

-- ─── 3. the description said the quiet part out loud ─────────────────────────

UPDATE roles
   SET description = 'External collaborator. Reads the workspace, comments, and reports bugs.'
 WHERE role_key = 'guest'
   AND is_system = 1
   AND description = 'External collaborator. Same as a member today, except uploading files.';

-- ─── 4. report ───────────────────────────────────────────────────────────────
-- Expect exactly 7 per workspace. Anything else means a custom grant was added
-- to the system Guest role by hand and step 1 removed part of it — check before
-- assuming the migration misfired.

SELECT r.workspace_id,
       COUNT(rp.permission_key) AS guest_grants_now
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
 WHERE r.role_key = 'guest' AND r.is_system = 1
 GROUP BY r.workspace_id;

-- rollback (restores the pre-F28 state exactly):
--   INSERT INTO role_permissions (role_id, permission_key, scope)
--   SELECT r.id, p.k, 'all' FROM roles r JOIN (
--           SELECT 'task.create' AS k
--     UNION SELECT 'task.edit'          UNION SELECT 'task.assign'
--     UNION SELECT 'task.archive'       UNION SELECT 'task.delete'
--     UNION SELECT 'checklist.manage'   UNION SELECT 'dependency.manage'
--     UNION SELECT 'customfield.set_value' UNION SELECT 'template.apply'
--     UNION SELECT 'sprint.assign_tasks'   UNION SELECT 'postmortem.manage'
--     UNION SELECT 'form.view_submissions'
--   ) p WHERE r.role_key='guest' AND r.is_system=1
--   ON DUPLICATE KEY UPDATE scope = VALUES(scope);
