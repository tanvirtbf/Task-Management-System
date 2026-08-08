-- 007_orphans_and_cascades.sql — FIXING phase F16, 2026-08-06
--
--   ISS-022  hard-deleting a task orphaned its R2 objects forever. The
--            attachments FK is ON DELETE CASCADE, so the rows vanish with the
--            task and the r2-purge job — which finds objects by reading
--            soft-deleted attachment rows — never learns those objects exist.
--            P4 proved it: four stranded objects had to be deleted by hand.
--            New table: the hard-delete transaction copies the subtree's
--            storage keys here BEFORE the task row goes; the r2-purge job
--            drains the queue on its normal schedule.
--
--   ISS-073  hard-deleting a task left its notifications in every recipient's
--            inbox, pointing at a 404. `notifications.entity_id` is
--            polymorphic (no FK is possible), so the delete is app-side in the
--            same transaction; this script sweeps the orphans that already
--            accumulated (13 had built up in dev before anyone looked).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + a DELETE that matches nothing on a
-- clean database.

CREATE TABLE IF NOT EXISTS r2_purge_queue (
    id            VARCHAR(64)  NOT NULL,
    storage_key   VARCHAR(500) NOT NULL,
    thumbnail_key VARCHAR(500) NULL,
    queued_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_r2_purge_queued (queued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- Sweep the task-notification orphans that pre-date the fix. Only the 'task'
-- entity type: it is the only one with a hard-delete path (comments tombstone,
-- and report/form/automation/incident rows are never hard-deleted).
DELETE nf FROM notifications nf
 WHERE nf.entity_type = 'task'
   AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = nf.entity_id);

-- rollback:
--   DROP TABLE IF EXISTS r2_purge_queue;
--   -- the swept notification rows pointed at deleted tasks; nothing to restore.
