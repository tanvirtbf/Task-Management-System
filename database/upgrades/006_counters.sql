-- 006_counters.sql — FIXING phase F15 (the counters), 2026-08-05
--
-- Three denormalised counters drift because each is maintained by a rule that
-- does not match how the application actually writes. `attachments_count` is
-- the one that gets it right — an AFTER UPDATE trigger that moves in BOTH
-- directions and understands soft delete — and it is the model copied here.
--
--   ISS-065  comments_count  — trg_comments_after_delete fires on SQL DELETE,
--            but `DELETE /comments/:id` SOFT-deletes (stamps deleted_at), so
--            the counter only ever went UP. Measured: 3 comments, delete one,
--            still 3, while the list returns 2. The badge lies to the reader.
--
--   ISS-080  forms.submission_count — INSERT-only trigger; the 90-day retention
--            job DELETEs rows directly, so the count drifts permanently upward.
--
--   ISS-046  subtasks_count / subtasks_completed — maintained by NOTHING. Every
--            task reports 0/0. These CANNOT be triggers: MySQL forbids a trigger
--            on `tasks` from modifying `tasks` (the removed
--            trg_subtasks_after_* triggers crashed every subtask status change
--            with ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG). schema.sql:1482-1488
--            already records that decision, so this one is fixed APP-SIDE in
--            TaskWriteService; this script only BACKFILLS the existing rows.
--
-- Idempotent: every CREATE is preceded by a DROP IF EXISTS, and the backfills
-- are absolute (SET = a computed value, not += ), so re-applying is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Drop the three STALE subtask triggers (SCAN-H4)
-- ─────────────────────────────────────────────────────────────────────────────
-- These exist on the dev database and on NOTHING else — not in schema.sql, not
-- in a freshly provisioned DB, not in production. They are the removed triggers
-- ISS-046 describes, left behind on one machine, and they are not merely dead:
-- because a trigger on `tasks` cannot modify `tasks`, ANY write that reaches
-- them dies with
--
--     ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG — Can't update table 'tasks' in
--     stored function/trigger because it is already used by the statement which
--     invoked this stored function/trigger
--
-- F15 reproduced exactly that: with these present, the new app-side counter
-- maintenance turned every subtask status change and every hard delete into a
-- 500. Dropping them is a precondition for the fix below, not a tidy-up. They
-- were deliberately preserved (fixing rule X9) so this phase could confirm the
-- crash first-hand rather than take it on faith.
DROP TRIGGER IF EXISTS trg_subtasks_after_insert;
DROP TRIGGER IF EXISTS trg_subtasks_after_update;
DROP TRIGGER IF EXISTS trg_subtasks_after_delete;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. comments_count — count SOFT deletes, in both directions
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_comments_after_update;

DELIMITER $$

-- A comment "counts" while `deleted_at IS NULL`. Mirrors
-- trg_attachments_after_update exactly: increment on the crossing into
-- counted, decrement on the crossing out, ignore every other UPDATE (an edit
-- to `body` must not move the counter).
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

DELIMITER ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. forms.submission_count — decrement when the retention job deletes
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_form_submissions_after_delete;

DELIMITER $$

CREATE TRIGGER trg_form_submissions_after_delete
AFTER DELETE ON form_submissions
FOR EACH ROW
BEGIN
    UPDATE forms
       SET submission_count = GREATEST(submission_count - 1, 0)
     WHERE id = OLD.form_id;
END$$

DELIMITER ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — bring every existing row to the truth
-- ─────────────────────────────────────────────────────────────────────────────

-- comments_count = live (non-soft-deleted) comments per task
UPDATE tasks t
   SET t.comments_count = (
       SELECT COUNT(*) FROM comments c
        WHERE c.task_id = t.id AND c.deleted_at IS NULL
   );

-- submission_count = rows actually present
UPDATE forms f
   SET f.submission_count = (
       SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id
   );

-- subtasks_count / subtasks_completed = live children, and how many of those
-- sit on a done-group status. `archived_at IS NULL` matches what the subtask
-- LIST endpoint returns, so the badge and the list agree.
--
-- Written as a JOIN against a DERIVED table, not a correlated subquery: MySQL
-- refuses `UPDATE tasks … (SELECT … FROM tasks …)` with error 1093, "You can't
-- specify target table for update in FROM clause". A derived table is
-- materialised first, so it is allowed. (This is the same family of MySQL
-- restriction that made the original subtask TRIGGERS impossible — see
-- schema.sql:1482-1488.)
UPDATE tasks p
  LEFT JOIN (
        SELECT c.parent_task_id AS pid,
               COUNT(*) AS cnt,
               SUM(s.status_group IN ('done', 'closed')) AS done_cnt
          FROM tasks c
          JOIN statuses s ON s.id = c.status_id
         WHERE c.parent_task_id IS NOT NULL
           AND c.archived_at IS NULL
         GROUP BY c.parent_task_id
    ) agg ON agg.pid = p.id
   SET p.subtasks_count = COALESCE(agg.cnt, 0),
       p.subtasks_completed = COALESCE(agg.done_cnt, 0);

-- rollback:
--   DROP TRIGGER IF EXISTS trg_comments_after_update;
--   DROP TRIGGER IF EXISTS trg_form_submissions_after_delete;
--   -- the backfilled values are CORRECT data; there is nothing to undo there.
--   -- Reverting the app-side subtask maintenance is a code change, not SQL.
