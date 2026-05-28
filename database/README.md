# BeautyBooth — Database Schema

Single source of truth for the MySQL production schema.

## Files

| File          | Purpose                                                           |
|---------------|-------------------------------------------------------------------|
| `schema.sql`  | Full DDL — 31 tables, FK constraints, indexes, views, triggers.   |

## Quick install

```bash
# Create database with the right charset/collation
mysql -u root -p -e "
  CREATE DATABASE beautybooth
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
"

# Apply schema
mysql -u root -p beautybooth < database/schema.sql

# Verify
mysql -u root -p beautybooth -e "SHOW TABLES;"
# Should list 31 tables.
```

## Design summary

- **Engine:** InnoDB everywhere — row locks, foreign keys, MVCC.
- **Charset:** `utf8mb4 / utf8mb4_unicode_ci` — full Bangla support, including compound glyphs (ক্ষ, ঞ্চ etc.).
- **Row format:** `DYNAMIC` — allows long `VARCHAR` + `JSON` columns to be stored off-page when needed.
- **Normalisation:** 3NF for the core. Deliberate denormalisations on `tasks` (counters) and `customers` (aggregates) are documented inline.
- **Soft delete:** `archived_at TIMESTAMP NULL` on user-visible entities. Hard `DELETE` reserved for actual GDPR-style removals.
- **IDs:** `VARCHAR(64)` semantic IDs matching the frontend (`sp-ops`, `l-fb-orders`, `t-90042`). High-volume tables also get an `internal_id BIGINT UNSIGNED AUTO_INCREMENT UNIQUE` for cursor pagination.

## Table inventory (31)

```
Auth / Identity           (5)
  workspaces, users, sessions, password_reset_tokens, invitations

Hierarchy                 (5)
  spaces, lists, statuses, task_types, tags

Tasks core                (5)
  tasks, task_assignees, task_watchers, task_tags, task_dependencies

Task content              (5)
  task_activity, comments, checklists, checklist_items, attachments

Custom fields             (3)
  custom_fields, custom_field_options, task_custom_field_values

Engineering               (2)
  sprints, on_call_shifts

Cross-cutting / domain    (5)
  customers, forms, form_fields, form_submissions, notifications

Audit                     (1)
  workspace_activity
```

## Key indexes (the hot paths)

| Query                                           | Index                                                          |
|-------------------------------------------------|----------------------------------------------------------------|
| List page (tasks for list, exclude archived)    | `idx_tasks_list_active(primary_list_id, archived_at, status_id, due_date)` |
| Sprint board                                    | `idx_tasks_sprint(sprint_id, status_id)`                       |
| "PRs awaiting my review" filter                 | `idx_tasks_reviewer(reviewer_id, pr_status)`                   |
| Stuck-orders KPI                                | `idx_tasks_status_updated(status_id, updated_at)`              |
| Lookup `ORD-1042`                               | `idx_tasks_custom_id(custom_id)` + unique within workspace     |
| Customer search by phone                        | `idx_customers_phone(phone)`                                   |
| Customer search by name (Bangla)                | `ft_customers_name FULLTEXT(name)`                             |
| Inbox: unread-first, time-sorted                | `idx_notifications_user_state(user_id, is_read, created_at DESC)` |
| Task drawer comment thread                      | `idx_comments_task_time(task_id, created_at)`                  |
| Per-task activity feed                          | `idx_task_activity_task_time(task_id, created_at DESC)`        |

## Counter maintenance

The schema ships with triggers that keep these denormalised counters in sync:

- `tasks.comments_count`
- `tasks.attachments_count`
- `tasks.subtasks_count`
- `tasks.subtasks_completed`
- `forms.submission_count`

**Important:** if your application layer is also maintaining these counters, **drop the triggers** or you will double-count. The triggers are at the bottom of `schema.sql` — comment them out before importing if you go with app-level maintenance.

## Production checklist

1. `innodb_buffer_pool_size = 70% of RAM`
2. `slow_query_log = 1` with `long_query_time = 0.5`
3. `sql_require_primary_key = ON` (every table has one — guards against future migrations)
4. Daily logical backup: `mysqldump --single-transaction --quick --routines --triggers --events beautybooth > backup.sql`
5. Weekly `OPTIMIZE TABLE tasks, comments, notifications, task_activity` for tables with heavy UPDATE workload (counters)
6. Time zone: `default-time-zone = '+00:00'` in `my.cnf`. The app converts to `Asia/Dhaka` at render time.

## Notes that aren't immediately obvious in the SQL

- **Polymorphic FKs are intentional:** `statuses.scope_id` and `custom_fields.scope_id` can point to a list, space, or workspace depending on `scope_type`. MySQL can't enforce this at the DB level — the application layer must validate. Documented inline at each occurrence.

- **`SET` column on `workspaces.working_days`:** stores up to 7 days as a 1-byte bitmask. Fine for fixed enumeration, much smaller than a junction table.

- **`tasks.recurrence_days SET('sun'…'sat')`:** same trick for "every Mon, Wed, Fri" without an additional join.

- **Phone format validated by CHECK:** `customers.phone REGEXP '^01[3-9][0-9]{8}$'` — matches the Bangla phone validator in `client/src/lib/bd-phone.ts`. Catches bad data at the DB boundary even if a buggy API skips validation.

- **VIP flag is a `GENERATED ALWAYS AS … STORED` column:** computed from `total_orders >= 5 OR lifetime_value >= 1000000` (paisa, i.e., ৳10,000). Filterable via `idx_customers_workspace_vip` without an extra column to maintain.

- **No table has TIMESTAMP without explicit `DEFAULT`:** MySQL 8's `explicit_defaults_for_timestamp = ON` is the default; we always specify defaults.

## Migration story (future)

When you eventually migrate from this single-tenant schema:

- `users.workspace_id` is already there — multi-tenancy is a row-level security policy + middleware addition, not a schema change.
- Adding a new task type, status, custom-field type? Just INSERT into the appropriate catalog table — no DDL needed.
- Adding a new dev field on tasks? `ALTER TABLE tasks ADD COLUMN …` — operational tasks leave it NULL, gated by `task_types.is_dev_type` flag.

## What this schema deliberately does NOT support

These were dropped per `WHAT_SHUTKIHUT_ACTUALLY_NEEDS.md` §4:

- Automation builder (no `automations`/`automation_runs` tables — backend hardcodes the 4-5 needed flows)
- Multiple dashboards / widget system (no `dashboards`/`widgets` tables — Home is fixed)
- Templates feature (no `templates` table — festival template is a hardcoded endpoint)
- Notepad (no `notes` table — Google Docs covers this)
- Reminders separate from tasks (no `reminders` table — `tasks.due_date` is the reminder)
- 2FA / TOTP (no `two_factor_secrets` table — password is enough for internal use)
- Webhooks UI / API keys (handled via env config, no `webhooks` or `api_keys` tables)
- Time-tracking logs (no `time_logs` table — `tasks.time_tracked_seconds` is the counter; if you ever need a log, add it later)
