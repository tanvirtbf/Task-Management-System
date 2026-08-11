# LIVE ROLLOUT — Team Access + Audit + Approval (P1–P10)

**Audience: the Claude instance operating the PRODUCTION server.** Follow this file
top-to-bottom. It supersedes every other deployment document in this repo —
in particular, **do NOT follow `PRE_DEPLOYMENT_CHECKLIST.md`** (it describes a
different system and is stale).

**The situation you are deploying into:** this workspace has been in daily use
by a real office for a long time. The database holds THEIR real tasks, comments,
attachments and accounts. The prime directives, in order:

1. **No data loss.** Ever. Under any step.
2. **No surprise lockouts.** Nobody logs in tomorrow and sees an empty app.
3. **Reversible.** The one behavior flip in this rollout is a one-UPDATE rollback.

What this rollout delivers (built and verified on dev+qa, commits
`2ed25ec…7889cea` on `main`): teams with Heads and membership; a per-task audit
log; team-scoped visibility; edit rights (assignees + creator + owning team's
Head only); cross-team assignment approval (accept / decline / query / answer)
with email + push; an hourly request-expiry job; full UI for all of it.

---

## 0. HARD PROHIBITIONS (read before touching anything)

- **NEVER** run `npm run db:setup`, `npm run db:seed`, `npm run db:seed:demo`,
  `drizzle-kit push`, or `drizzle-kit migrate` against the live database.
  Every one of them can wipe or overwrite live data or re-assert permissive
  role grants. Schema changes on this system ship ONLY as the ordered scripts
  in `database/upgrades/`.
- **NEVER** run `npm run build` (client or server) on this box — it has too
  little free RAM and the build artifacts (`server/dist`, `client/dist`) are
  already committed to git. The committed client bundle uses a RELATIVE
  `/api/v1` base, so it works behind the existing same-domain nginx proxy as-is.
- **NEVER** proceed past a failed step. Stop, diagnose, and if in doubt ask the
  operator. The backup from step 1 is your escape hatch.
- **Do not apply `019` or `020` in Phase A.** They are the deliberate,
  operator-approved flip in Phase C. Everything else is additive and invisible.

---

## 1. BACKUP — non-negotiable first step

```bash
cd /var/www/html/tasks-beautybooth
# Use the repo's backup kit if already installed, otherwise dump directly:
bash deploy/backup/bbtasks-backup.sh || \
  mysqldump --single-transaction --routines --triggers \
    -u<DBUSER> -p tasks_db_name | gzip > ~/bbtasks-pre-teamaccess-$(date +%F).sql.gz

# VERIFY the dump is real before continuing:
ls -lh ~/bbtasks-pre-teamaccess-*.sql.gz     # size must be plausibly large, not 20 bytes
gunzip -t ~/bbtasks-pre-teamaccess-*.sql.gz  # integrity
```

Restore path (only if something goes badly wrong, with operator approval):
`gunzip < dump.sql.gz | mysql -u<DBUSER> -p tasks_db_name`.

---

## 2. PROBE — find out where this database currently is

The upgrade scripts are ordered `001…021`. The live DB was provisioned long ago
and some scripts may already be applied. Run these probes (read-only):

```sql
SELECT COUNT(*) AS base_tables FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_type='BASE TABLE';

-- Marker → the upgrade that created it is ALREADY applied:
SHOW TABLES LIKE 'task_reviews';                 -- 002
SHOW TABLES LIKE 'roles';                        -- 004  (RBAC — the new build NEEDS this at boot)
SHOW TABLES LIKE 'v_current_on_call';            -- (view) 005-era
SHOW COLUMNS FROM tasks LIKE 'overdue_notified_at';   -- 014
SHOW TABLES LIKE 'push_subscriptions';           -- 015
SHOW COLUMNS FROM users LIKE 'primary_space_id'; -- 016
SHOW TABLES LIKE 'space_visibility_grants';      -- 018
SHOW TABLES LIKE 'task_assignment_requests';     -- 021
```

Build the **pending list** = every script in `database/upgrades/` from the first
missing marker onward, in numeric order, **EXCLUDING `019` and `020`** (Phase C).
All scripts are written for live DBs: information_schema-gated, idempotent or
single-apply-safe, each with a `-- rollback:` section at the bottom. Re-running
an already-applied one is a no-op — when unsure, include it.

End state after Phase A must be **46 base tables / 5 views / 9 triggers**.

---

## 3. PHASE A — additive upgrade + new build (users notice nothing)

Do this at a quiet hour. Total downtime: one pm2 restart (seconds).

### 3.1 Pull the code (do not build)

```bash
cd /var/www/html/tasks-beautybooth
git fetch origin && git checkout main && git pull origin main   # ≥ 7889cea
```

### 3.2 Check `server/.env` against `server/.env.example`

Required or the NEW build refuses to boot / misbehaves:

- `DB_TIMEZONE=+00:00`  ← **boot guard**: the new server EXITS at startup
  without it. If the old build ran without this key, add it now.
- `FRONTEND_URL=https://tasks.beautybooth.com.bd` (email + push links).
- `INTERNAL_JOB_TOKEN=<random>` (cron job auth — must match what
  `deploy/cron/run-job.sh` sends).
- `MAIL_*` — note these now send REAL email (assignment, overdue, approval
  flows). That is intended.
- Optional, feature-gating only (leave absent if not provisioned): `VAPID_*`
  (web push), R2 credentials (attachments), `OPENAI_API_KEY` (help assistant).
- Do NOT change working DB connection settings. (If MySQL auth ever fails with
  `caching_sha2`, the known fix on this box is `DB_SOCKET_PATH` — but if the
  app connects today, leave it exactly as it is.)

### 3.3 Data pre-checks for two specific scripts (only if they are pending)

- **`010_name_uniqueness.sql`** adds unique keys. On lived-in data duplicates
  may exist and the script will fail with `ER_DUP_ENTRY` naming the index. If
  that happens: find the duplicates and rename them, then re-run. Pattern:
  ```sql
  SELECT name, COUNT(*) FROM <table named by the error>
   GROUP BY <the columns in the failed index> HAVING COUNT(*) > 1;
  ```
  Renaming a duplicate (append " (2)") is safe and user-visible only cosmetically.
- **`011_guest_role_tightening.sql`** narrows the seeded **Guest** role to
  read-and-comment. If this workspace has active guests, tell the operator —
  guests keep seeing, they lose editing. (Members are untouched.)

### 3.4 Apply the pending upgrades, in order, logging each

```bash
cd /var/www/html/tasks-beautybooth
for f in database/upgrades/0XX_*.sql ...   # YOUR pending list, numeric order, SKIP 019+020
do
  echo "== applying $f" | tee -a ~/teamaccess-rollout.log
  mysql -u<DBUSER> -p tasks_db_name < "$f" 2>&1 | tee -a ~/teamaccess-rollout.log
done
```

The old build keeps running happily while these land — every script here only
ADDS tables/columns/enum values or fixes data the old code never reads.

Verify: table/view/trigger counts = **46 / 5 / 9**; and
`SELECT COUNT(*) FROM permissions;` returns **56** after the new build's first
boot (it syncs the catalog at startup).

### 3.5 Install runtime deps + restart onto the new build

```bash
cd /var/www/html/tasks-beautybooth/server
npm ci --omit=dev                       # deps only; this is NOT a build
pm2 startOrReload ../deploy/pm2/ecosystem.config.js
pm2 logs --lines 50                     # watch the boot: no errors, no exit loop
curl -fsS http://localhost:5501/health && curl -fsS http://localhost:5501/health/ready
```

### 3.6 Cron + logrotate refresh

```bash
sudo cp deploy/cron/bbtasks-jobs /etc/cron.d/bbtasks-jobs   # now EIGHT jobs
sudo chmod 644 /etc/cron.d/bbtasks-jobs
chmod +x deploy/cron/run-job.sh
sudo cp deploy/logrotate/bbtasks /etc/logrotate.d/bbtasks
# hand-test the NEW job once:
deploy/cron/run-job.sh assignment-request-expiry --dry-run
```

### 3.7 Phase A smoke (as a real browser user)

- Login works; task lists, comments, bell all behave exactly as yesterday.
- Every task drawer now shows an **Activity** section (the audit log) — new,
  read-only, harmless.
- Admins see **Settings → Teams** — new page, currently mostly "unassigned".
- **Visibility has NOT changed**: members still see everything. Correct —
  the switch is Phase C.

**STOP HERE. Phase B is human work, not yours.**

---

## 4. PHASE B — the admin builds the roster (people work, nothing flips)

Hand the operator/admins these tasks (the Bangla how-to is `TEAM_GUIDE.md` —
share it with the office now):

1. On **Settings → Teams**: put EVERY active member on their team(s); set each
   person's home team; give EVERY team a **Head**. Guests too (a guest with no
   team sees nothing after the flip).
2. If one team must see another team's boards, add the sight grant on the same
   page ("can also see").

**Gate — Phase C is forbidden until both queries return ZERO rows:**

```sql
-- active members/guests with NO team membership (would go BLIND at the flip):
SELECT u.id, u.email, u.role FROM users u
 WHERE u.status='active' AND u.role IN ('member','guest')
   AND NOT EXISTS (SELECT 1 FROM user_roles ur
                    WHERE ur.user_id = u.id AND ur.scope_type='space');

-- live teams with no Head (their tasks would have no head-editor/approver):
SELECT id, name FROM spaces
 WHERE archived_at IS NULL AND head_user_id IS NULL;
```

The system runs happily in this half-state for as long as the office needs —
days if necessary. There is no rush to Phase C.

---

## 5. PHASE C — THE FLIP (operator says GO, quiet hour)

Get the operator's explicit go-ahead first. Then:

```bash
mysql -u<DBUSER> -p tasks_db_name < database/upgrades/019_visibility_switch.sql
mysql -u<DBUSER> -p tasks_db_name < database/upgrades/020_edit_rights.sql
```

No restart needed — grants are cached per `permissions_version`, which both
scripts bump; the very next request obeys the new rules.

### 5.1 Immediate verification (2 minutes, as three different users)

- A **member**: sidebar shows ONLY their team(s); another team's list URL → not
  found; a teammate's task opens **View only**; their OWN task still edits.
- An **admin**: still sees everything.
- Someone **assigned to another team's task** (if any exist): that task still
  opens from Inbox/My Work/its link.
- Assign a cross-team person to any task → it must become a **pending request**
  (drawer "Assignment approval" panel + their Inbox → Requests), not an
  instant assignment.

### 5.2 ROLLBACK (if the office says stop — one minute, zero data loss)

Authoritative copies live at the bottom of each script; they are:

```sql
-- undo 020 (edit rights):
UPDATE role_permissions rp JOIN roles r ON r.id = rp.role_id
   SET rp.scope='all'
 WHERE r.role_key='member'
   AND rp.permission_key IN ('task.edit','task.archive','task.delete');

-- undo 019 (the visibility switch):
UPDATE role_permissions rp JOIN roles r ON r.id = rp.role_id
   SET rp.scope='all'
 WHERE r.role_key IN ('member','guest')
   AND rp.permission_key IN ('space.view','task.view');

UPDATE workspaces SET permissions_version = permissions_version + 1;
```

Rows, tasks, teams, requests — everything survives a rollback untouched; only
the reach flips back. You can re-apply 019+020 later at will.

---

## 6. NEXT-DAY CHECKS

- `pm2 logs` — no error spikes; `mail.sent` lines appear for real activity.
- Cron log shows `assignment-request-expiry` ticking hourly (`{ ok: true … }`).
- No flood of overdue emails happened (if `014` was newly applied, its built-in
  backfill pre-claimed the historical backlog — by design).
- Ask the admin if anyone reports "I can't see X" → almost always a missing
  team membership; fix on Settings → Teams, effective immediately.

## 7. WHAT CHANGED FOR THE OFFICE (so you can answer questions)

| Before | After |
|---|---|
| Everyone saw every team's boards | Members/guests see their own team(s); admins see all; sight grants widen per team |
| Anyone could edit any task | Only assignees, the creator, that team's Head, admins — everyone else read+comment ("View only") |
| Anyone could assign anyone instantly | Same-team instant; cross-team = an approval request (accept/decline/query/answer, 7-day expiry, email+push); S0/S1 on-call paging exempt |
| Changes were invisible | Every task drawer has the full Activity history |

User-facing help: `TEAM_GUIDE.md` (Bangla). Decisions + phase details:
`TEAM_ACCESS_AND_AUDIT_PLAN.md` (§7 = decision log). Upgrade bookkeeping:
`database/upgrades/README.md`.

## 8. SUCCESS = all of these true

- [ ] Backup exists, integrity-checked, restorable
- [ ] DB at 46 tables / 5 views / 9 triggers; `permissions` = 56 rows
- [ ] New build serving `/health` + `/health/ready`; no pm2 restarts looping
- [ ] Cron has 8 jobs; expiry job dry-run answered `ok`
- [ ] Phase B gate queries both returned zero rows BEFORE the flip
- [ ] Post-flip: member=own-team-only, admin=all, cross-team assign=request
- [ ] Office informed (TEAM_GUIDE.md shared); no unresolved "can't see" reports
