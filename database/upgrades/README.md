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
| `001_dept_head_enums.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ✅ 2026-08-11 (Phase A) |
| `002_task_reviews.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ✅ 2026-08-11 (Phase A) |
| `003_department_reports.sql` | ✅ 2026-07-22 | ✅ 2026-07-22 | ✅ 2026-08-11 (Phase A) |
| `004_rbac.sql` | ✅ 2026-07-25 | ✅ 2026-07-25 | ✅ 2026-08-11 (Phase A) |
| `005_clock_views.sql` | ✅ 2026-08-03 | ✅ 2026-08-03 | ✅ 2026-08-11 (Phase A) |
| `006_counters.sql` | ✅ 2026-08-05 | ✅ 2026-08-05 | ✅ 2026-08-11 (Phase A) |
| `007_orphans_and_cascades.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `008_form_submission_retention.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `009_notification_types.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `010_name_uniqueness.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 ⚠️ after renaming 6 dupes | ✅ 2026-08-11 (Phase A) |
| `011_guest_role_tightening.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `012_drop_fiscal_year.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `013_perf_indexes.sql` | ✅ 2026-08-06 | ✅ 2026-08-06 | ✅ 2026-08-11 (Phase A) |
| `014_overdue_alerts.sql` | ✅ 2026-08-08 | ✅ 2026-08-08 | ✅ 2026-08-11 (Phase A) |
| `015_push_subscriptions.sql` | ✅ 2026-08-08 | ✅ 2026-08-08 | ✅ 2026-08-11 (Phase A) |
| `016_team_membership.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 | ✅ 2026-08-11 (Phase A) |
| `017_task_audit.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 | ✅ 2026-08-11 (Phase A) |
| `018_space_visibility_grants.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 | ✅ 2026-08-11 (Phase A) |
| `019_visibility_switch.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 (first) | ✅ 2026-08-16 (Phase C flip) |
| `020_edit_rights.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 (first) | ✅ 2026-08-16 (Phase C flip) |
| `021_assignment_approval.sql` | ✅ 2026-08-11 | ✅ 2026-08-11 (first, re-apply proven) | ✅ 2026-08-11 (Phase A) |
| `022_checklist_counters.sql` | ✅ 2026-08-12 | ✅ 2026-08-12 (first, re-apply proven) | ✅ 2026-08-12 |
| `023_task_delete_approval.sql` | ✅ 2026-08-16 | ⏳ | ⏳ ships with the delete-approval build |
| `024_recurrence_spawn.sql` | ✅ 2026-08-16 | ⏳ | ⏳ ships with the recurrence build (+ cron line) |

> **prod = `tasks.beautybooth.com.bd`.** Phase A of `LIVE_ROLLOUT_TEAM_ACCESS.md`
> landed 001–018 + 021 on 2026-08-11 and `022` on 2026-08-12; every one of them was
> re-verified against the live schema on 2026-08-12 (46 tables / 5 views / 9 triggers,
> 56 permission rows). `019` + `020` are the DELIBERATE hold: they are Phase C, the
> operator-approved visibility flip, and stay unapplied until every live team has a
> Head (the runbook's gate 2).
>
> ⚠️ **`019`/`020` rollback — read before ever reversing them.** The blocks written
> at the bottom of those two scripts restore the SEEDED baseline (`all`), which is
> only correct on a workspace nobody has tightened by hand. On prod (verified
> 2026-08-16, immediately before the flip) an admin had already narrowed things
> through Settings → Roles: member/guest `space.view` and `task.view` were already
> `space`, and `task.archive`/`task.delete` were `space` — **not** `all`. Running
> the in-file rollback there would have WIDENED member reach past what the office
> actually had. Before reversing on any lived-in database, read the four scopes
> first and restore THOSE:
> ```sql
> SELECT r.role_key, rp.permission_key, rp.scope FROM role_permissions rp
>   JOIN roles r ON r.id = rp.role_id
>  WHERE r.is_system = 1 AND r.role_key IN ('member','guest')
>    AND rp.permission_key IN ('space.view','task.view','task.edit',
>                              'task.archive','task.delete');
> ```
> (A prod-specific restore file was written on the box at the time of the flip.)
>
> `023` ships with the permanent-delete-approval build: the Drizzle schema reads
> `task_delete_requests` and the routes write it, so apply it **before or with**
> that server build. It also appends two notification types and one notification
> ENTITY type (`delete_request` — an approved delete destroys the task, so the
> decision notice cannot point at it). ENUM appends and `CREATE TABLE IF NOT
> EXISTS`: re-runnable. Fresh `db:setup` is now **47 tables / 5 views / 9 triggers**.
>
> `024` makes Recurrence actually recur. It only ADDS three nullable columns to
> `tasks` (`recurrence_time`, `recurrence_last_spawned_on`, `recurring_source_id`),
> one self-FK and one index — information_schema-gated, re-runnable, and harmless
> ahead of the server build (nothing reads them until `recurrence-spawn` exists).
> It must land WITH the new cron line, or recurring tasks stay as dead as they
> were: `*/15 * * * * … recurrence-spawn` (see `deploy/cron/bbtasks-jobs`).
>
> `005` ships with the F3 clock fix and is only correct alongside it. If you apply
> `005`, the app's `DB_TIMEZONE` **must** be `+00:00` (see `server/.env.example`).
>
> `011` + `012` ship with F28. `011` rewrites the seeded **Guest** role's grants (19 → 7,
> read-and-comment) and its description; `012` drops `fiscal_year_start_month` and its CHECK.
> Both are information_schema-gated and re-runnable. Order within the pair does not matter,
> but both must land with the F28 server build — the seeded-role specs and the workspace
> serializer assume them.
>
> `015` ships with the Web Push build (2026-08-08) — the same day as `014`, applied
> after it. It only ADDS the `push_subscriptions` table, so it is safe to apply
> ahead of the server build and safe to apply without VAPID keys (the feature
> stays off until they exist). Fresh `db:setup` is now **43 tables / 5 views /
> 9 triggers** (was 42/5/9 since F33).
>
> `014` ships with the assignment/overdue-email build (2026-08-08): the Drizzle schema
> reads `tasks.overdue_notified_at` and the `overdue-alert` job writes `overdue`-typed
> notifications, so apply `014` **before or with** that server build. It re-adds the
> `overdue` ENUM value that `009` removed — legitimately this time, because the job is
> its producer. Gated + re-runnable. Remember the new cron line
> (`deploy/cron/bbtasks-jobs`: `*/10` overdue-alert) when rolling prod.
>
> `022` = checklist rollup counters (2026-08-12): `tasks.checklist_items_total`
> + `tasks.checklist_items_done`, feeding the row/board "3/7" chip and the
> drawer's aggregate %. App-maintained (`TasksRepo.recomputeChecklistCounters`
> in every ChecklistsService write tx — absolute recompute, no triggers);
> the in-file backfill is an absolute recompute too, safe to re-run any time.
> Ships WITH the build that maintains it. Rollback = two DROP COLUMNs.
>
> `021` = cross-team assignment approval (team-access P8, 2026-08-11): the
> `task_assignment_requests` + `task_assignment_request_events` tables and three
> notification types appended at the END of both ENUMs (`assignment_request`,
> `assignment_request_decided`, `assignment_query`). Fresh `db:setup` is now
> **46 tables / 5 views / 9 triggers**. CREATE IF NOT EXISTS + same-definition
> MODIFY — idempotent (re-apply proven on qa); safe ahead of the P8 server build,
> required with it. DORMANT until 019 is live (the gate first asks whether the
> target's `task.view` reach is `all`). Remember the new cron line
> (`deploy/cron/bbtasks-jobs`: hourly `assignment-request-expiry`) when rolling
> prod — a lapsed request is refused by the API even between runs, so the job
> only bounds how promptly the requester is told.
>
> `020` = edit rights (team-access P7, 2026-08-11): Member `task.edit`/`archive`/`delete`
> → `own`. Ships WITH the P7 server build (the head allow-path + the adjacent-surface
> checks live in code). Rollback = one UPDATE in-file. Same seed-script caveat as 019.
>
> `019` is **THE SWITCH** (team-access P6, 2026-08-11): flips the seeded Member+Guest
> grants — `space.view` → `space`, `task.view` → `own` (B1). Pure DATA, no code ships
> with it; **rollback = one UPDATE back to `all` + a version bump (documented in-file,
> instant, no data loss)**. ⚠️ `db:seed`/`db:seed:demo` re-assert the OPEN seeds —
> re-apply 019 after ever re-running them. Applied to qa FIRST, then dev, per the plan.
>
> `018` ships with team-access Phase 4 (2026-08-11): the `space_visibility_grants`
> table — "team A can also SEE team B", consumed at the PolicyService actor fold.
> DORMANT until the P6 visibility switch (every seeded role still sees `all`).
> Fresh `db:setup` is now **44 tables / 5 views / 9 triggers**. Add-only + IF NOT
> EXISTS — safe to apply ahead of the server build.
>
> `017` ships with team-access Phase 3 (audit-log completion, 2026-08-11): appends
> `'task'` to `workspace_activity.entity_type` so a HARD-deleted task leaves a trail
> there (its own `task_activity` rows die in the FK cascade). END-append, gated by
> being a same-definition no-op on re-run; apply **before or with** that server build.
>
> `016` ships with team-access Phase 1 (TEAM_ACCESS_AND_AUDIT_PLAN.md, 2026-08-11):
> adds `users.primary_space_id` (home team) and backfills the G2 landmine — every
> `spaces.head_user_id` now also holds a Member-role `user_roles` row scoped to their
> own space (heads used to have NO membership row at all). Apply **before or with**
> that server build (the Drizzle schema reads the column). Gated + re-runnable;
> counts stay 43/5/9.
