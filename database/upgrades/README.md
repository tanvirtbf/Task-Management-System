# database/upgrades/ — live-DB ALTER scripts (Dept Review feature onward)

**Why this exists:** the Drizzle migration chain is FROZEN (journal ends at 0004; 0005 unjournaled; `_post.sql` replay non-idempotent — see `SYSTEM_GAP_SCAN_2026-07-21.md` H3 and `DEPARTMENT_REVIEW_PLAN.md` §2.1). Until the tooling is re-baselined, **every schema change ships as three synchronized edits**:

1. `database/schema.sql` — the operative source (fresh installs via `npm run db:setup`, all jest DBs),
2. the Drizzle TS schema (`server/src/db/schema/*` + barrel `index.ts`),
3. a script in THIS directory — the ONLY upgrade path for already-provisioned DBs (dev `taskmanagement`, `taskmanagement_qa`, future prod).

## Conventions

- **Naming:** `NNN_short_name.sql`, NNN zero-padded, strictly increasing. Apply in order.
- **Header comment:** feature/phase, date, what it changes.
- **Idempotence:** prefer guarded statements where MySQL 8 allows; otherwise note "single-apply" in the header.
- **Rollback:** every script ends with a commented `-- rollback:` section (DROP/MODIFY statements to reverse it). Rollback of ENUM-append = usually "leave in place" (harmless) — say so explicitly.
- **Apply:**
  ```
  mysql -uroot -proot taskmanagement     < database/upgrades/NNN_x.sql
  mysql -uroot -proot taskmanagement_qa  < database/upgrades/NNN_x.sql
  ```
- **Log every application** (which DB, when) in `DEPT_REVIEW_LOG.md`.

## Applied-state tracker

| Script | dev (`taskmanagement`) | `taskmanagement_qa` | prod |
|---|---|---|---|
| `001_dept_head_enums.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ⏳ pending (no prod yet) |
| `002_task_reviews.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ⏳ pending (no prod yet) |
| `003_department_reports.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ⏳ pending (no prod yet) |
| `004_rbac.sql` | ✅ 2026-07-25 | ✅ 2026-07-25 | ⏳ pending (no prod yet) |
| `005_clock_views.sql` | ✅ 2026-08-03 | ✅ 2026-08-03 | ⏳ pending (no prod yet) |
| `006_counters.sql` | ✅ 2026-08-05 | ✅ 2026-08-05 | ⏳ pending (no prod yet) |
| `007_orphans_and_cascades.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `008_form_submission_retention.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `009_notification_types.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `010_name_uniqueness.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 ⚠️ after renaming 6 dupes | ⏳ pending (no prod yet) |
| `011_guest_role_tightening.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `012_drop_fiscal_year.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `013_perf_indexes.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ⏳ pending (no prod yet) |
| `014_overdue_alerts.sql` | ✅ 2026-08-08 | ✅ 2026-08-08 | ⏳ pending (no prod yet) |

> `005` ships with the F3 clock fix and is only correct alongside it. If you apply
> `005`, the app's `DB_TIMEZONE` **must** be `+00:00` (see `server/.env.example`).
>
> `011` + `012` ship with F28. `011` rewrites the seeded **Guest** role's grants (19 → 7,
> read-and-comment) and its description; `012` drops `fiscal_year_start_month` and its CHECK.
> Both are information_schema-gated and re-runnable. Order within the pair does not matter,
> but both must land with the F28 server build — the seeded-role specs and the workspace
> serializer assume them.
>
> `014` ships with the assignment/overdue-email build (2026-08-08): the Drizzle schema
> reads `tasks.overdue_notified_at` and the `overdue-alert` job writes `overdue`-typed
> notifications, so apply `014` **before or with** that server build. It re-adds the
> `overdue` ENUM value that `009` removed — legitimately this time, because the job is
> its producer. Gated + re-runnable. Remember the new cron line
> (`deploy/cron/bbtasks-jobs`: `*/10` overdue-alert) when rolling prod.
