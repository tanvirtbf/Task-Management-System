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
