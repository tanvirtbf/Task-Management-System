-- 005_clock_views.sql — FIXING phase F3 (the clock fix), 2026-08-03
--
-- Realigns the two clock-dependent views to the canonical clock F3 established.
--
-- WHAT CHANGED IN F3: the MySQL session is now pinned to UTC (`DB_TIMEZONE=+00:00`),
-- because Drizzle's TIMESTAMP mapper hardcodes `+0000` in both directions and is
-- only correct when the session is UTC. That fixed the 6h drift on every
-- TIMESTAMP column — but it also changed what the session-dependent date/time
-- functions return, so these two views had to be re-derived against it:
--
--   v_current_on_call — `week_start`/`week_end` are DATE columns holding *Dhaka
--     business days*, so the comparison needs a Dhaka calendar day. Under the new
--     UTC session, `CURDATE()` (what the live DB had) and `UTC_DATE()` (what
--     schema.sql had) both yield the UTC day, which rolls the roster over 6h
--     late — Monday 00:00-06:00 Dhaka would still report last week's engineer.
--     `DATE(UTC_TIMESTAMP() + INTERVAL 6 HOUR)` is Dhaka's day regardless of the
--     session zone, and matches the app's `dhakaToday()` helper exactly.
--     (Bangladesh is permanently UTC+6, no DST, so the fixed offset is exact and
--     no `CONVERT_TZ` timezone tables are needed.)
--
--   v_breached_sla — compares against UTC-stored TIMESTAMPs, so it needs the UTC
--     instant. The live DB had drifted to `NOW()`, which under the old Dhaka
--     session ran ~6h ahead and reported not-yet-due tasks as breached. Pinning
--     it back to `UTC_TIMESTAMP()` (what schema.sql always said) is correct under
--     any session zone, so this can never silently drift again.
--
-- Both views were already three-way inconsistent between the live DB, schema.sql
-- and _post.sql (logged in FULL_SYSTEM_TEST_LOG.md). This script makes all three
-- agree. Neither view is read by the application — it queries base tables — so
-- this has no runtime effect today; it stops the views from lying to anyone who
-- runs them by hand, and to the QA phases that diff view-vs-endpoint.
--
-- Idempotent: CREATE OR REPLACE, safe to re-apply.

CREATE OR REPLACE VIEW v_current_on_call AS
    SELECT s.*
      FROM on_call_shifts s
     WHERE DATE(UTC_TIMESTAMP() + INTERVAL 6 HOUR)
           BETWEEN s.week_start AND s.week_end;

CREATE OR REPLACE VIEW v_breached_sla AS
    SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
           t.task_type_id, t.sla_due_at,
           TIMESTAMPDIFF(MINUTE, t.sla_due_at, UTC_TIMESTAMP()) AS minutes_breached
      FROM tasks t
     WHERE t.sla_due_at IS NOT NULL
       AND t.sla_due_at < UTC_TIMESTAMP()
       AND t.completed_at IS NULL
       AND t.archived_at IS NULL;

-- rollback: restore the pre-F3 definitions. Only meaningful alongside reverting
-- DB_TIMEZONE to its old value — these views are correct *for the UTC session*,
-- and rolling them back on their own reintroduces the 6h skew.
--
-- CREATE OR REPLACE VIEW v_current_on_call AS
--     SELECT s.* FROM on_call_shifts s
--      WHERE UTC_DATE() BETWEEN s.week_start AND s.week_end;
--
-- CREATE OR REPLACE VIEW v_breached_sla AS
--     SELECT t.id, t.workspace_id, t.primary_list_id, t.custom_id, t.name,
--            t.task_type_id, t.sla_due_at,
--            TIMESTAMPDIFF(MINUTE, t.sla_due_at, NOW()) AS minutes_breached
--       FROM tasks t
--      WHERE t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW()
--        AND t.completed_at IS NULL AND t.archived_at IS NULL;
