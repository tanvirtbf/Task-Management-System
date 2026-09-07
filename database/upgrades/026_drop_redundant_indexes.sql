-- 026_drop_redundant_indexes.sql — TEST PLAN P13 (KI-21), 2026-09-07
--
-- Two indexes whose column list is a strict PREFIX of another index on the same
-- table. MySQL's leftmost-prefix rule means the wider index already serves
-- every lookup the narrow one could, so the narrow one earns nothing and costs
-- a write amplification on every INSERT/UPDATE plus its own pages in the buffer
-- pool.
--
--   comments                  idx_comments_task_time  (task_id, created_at)
--                    ⊂ idx_comments_task_created_internal
--                                (task_id, created_at, internal_id)
--
--   task_custom_field_values  idx_tcfv_field          (custom_field_id)
--                    ⊂ idx_tcfv_option
--                                (custom_field_id, option_id_generated)
--
-- Both were in the ORIGINAL schema; `013_perf_indexes` added the wider comment
-- index (to kill a filesort) and did not remove the one it superseded. That is
-- how this pair came to exist, and it is worth knowing before adding the next
-- covering index.
--
-- ── proven, not assumed ─────────────────────────────────────────────────────
-- P13 built a 5,047-task / 12,410-comment fixture (`scripts/scale-seed.cjs`)
-- and compared EXPLAIN either side of the drop. Both queries kept the SAME
-- access path — same table order, `type=ref`, same `key_len`, same row
-- estimate — and simply named the wider index instead:
--
--   task_custom_field_values   key=idx_tcfv_field  →  key=idx_tcfv_option
--   comments                   key=idx_comments_task_created_internal (unchanged;
--                              the optimiser already preferred the wider one)
--
-- ── why the FK check below matters ──────────────────────────────────────────
-- `fk_tcfv_field` is a foreign key on `custom_field_id`, and InnoDB requires an
-- index on a foreign key's column. Dropping `idx_tcfv_field` is only legal
-- because `idx_tcfv_option` has that column leftmost. So each drop is gated on
-- the SUPERSEDING index still existing — if a future migration removed the
-- wider index, this script must not go on to remove the narrow one as well and
-- leave the table (and its FK) with nothing.
--
-- Index-only DDL: no rows change. Gated on information_schema, so re-running is
-- a no-op.

-- ── comments ────────────────────────────────────────────────────────────────
SET @wide := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'comments'
                 AND index_name = 'idx_comments_task_created_internal');
SET @narrow := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'comments'
                   AND index_name = 'idx_comments_task_time');
SET @sql := IF(@wide > 0 AND @narrow > 0,
    'ALTER TABLE comments DROP INDEX idx_comments_task_time',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── task_custom_field_values ────────────────────────────────────────────────
SET @wide := (SELECT COUNT(*) FROM information_schema.statistics
               WHERE table_schema = DATABASE()
                 AND table_name = 'task_custom_field_values'
                 AND index_name = 'idx_tcfv_option');
SET @narrow := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE()
                   AND table_name = 'task_custom_field_values'
                   AND index_name = 'idx_tcfv_field');
SET @sql := IF(@wide > 0 AND @narrow > 0,
    'ALTER TABLE task_custom_field_values DROP INDEX idx_tcfv_field',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Rollback, if a future query ever proves it needs the narrower pair:
--   ALTER TABLE comments ADD INDEX idx_comments_task_time (task_id, created_at);
--   ALTER TABLE task_custom_field_values ADD INDEX idx_tcfv_field (custom_field_id);
