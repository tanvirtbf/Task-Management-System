-- 017_task_audit.sql — audit log completion (team-access P3), 2026-08-11
--
-- Phase 3 of TEAM_ACCESS_AND_AUDIT_PLAN.md: "no change to a task can happen
-- without a row." Most of that phase is application code (the missing
-- task_activity writers); the ONE schema consequence is here:
--
--   `workspace_activity.entity_type` gains 'task' — appended at the END
--   (END-appends are instant DDL and keep ordinal parity with the Drizzle
--   tuple, which also appends last; the 014 rule).
--
--   Why: a HARD delete cascades away the task row and, with it, every
--   task_activity row it ever had — the entire audit trail of the deleted
--   task vanishes in the same statement. The deletion trail therefore has to
--   live in workspace_activity, and that table's ENUM had no 'task' member
--   (TaskWriteService.del's own comment admitted it: "audit-LOGGED (not a DB
--   row)" — meaning a winston line was the only witness).
--
-- The `GET /activity ?entity_type=` validator reads the shared Drizzle tuple,
-- so the new filter value is accepted automatically with the server build.
--
-- Mirrored in database/schema.sql + server/src/db/schema/_shared.ts (the
-- three-synchronized-edits rule). Counts stay 43 tables / 5 views / 9 triggers.
--
-- Idempotent: MODIFY COLUMN to the same definition is a no-op. Re-runnable.

ALTER TABLE workspace_activity
    MODIFY COLUMN entity_type ENUM('workspace','space','list','task_type','tag',
                                   'custom_field','user','role','sprint','task') NOT NULL;

-- rollback:
--   -- (delete task rows first or the MODIFY back to 9 values will fail)
--   DELETE FROM workspace_activity WHERE entity_type = 'task';
--   ALTER TABLE workspace_activity
--       MODIFY COLUMN entity_type ENUM('workspace','space','list','task_type','tag',
--                                      'custom_field','user','role','sprint') NOT NULL;
