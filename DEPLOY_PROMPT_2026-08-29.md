# Deploy prompt — production server (written 2026-08-29, refreshed 2026-09-03)

Run these steps on the DigitalOcean box (209.38.65.61) — either by hand, or by pasting the
part below the line to a Claude session there.

> Replaces `DEPLOY_PROMPT_2026-08-19.md`, which was written before upgrade `025` existed
> and would have restarted the API against a DB without `tasks.assigned_by` — every task
> read 500s, and its own canary check could not have caught it. That file is deleted.
>
> **Refreshed 2026-09-03** for the test-plan work P0–P6:
> - new build ⇒ **new canary hash** (`index-RU3OSsKx.js`);
> - **step 4's canary was broken and is rewritten** — it curled `/api/v1/tasks`, a route
>   that does not exist, so it answered `404` on a healthy API *and* would have answered
>   `404` with the upgrades missing. It never touched the database. See step 4b.

---

You are deploying an update of the BeautyBooth Task Management app on this server. Work
step by step, verify each step before moving to the next, and report each step's outcome.
If anything deviates from the expectations written here, STOP and tell me instead of
improvising.

## Context (trust this over guesses)

- App repo: `/var/www/html/tasks-beautybooth`, branch `main`.
- **Target: the tip of `origin/main`.** Confirm it matches the SHA you were given in the
  handover message. The build in it is identified by its entry bundle —
  `client/dist/index.html` must reference **`assets/index-RU3OSsKx.js`**. That hash is the
  reliable canary: it changes with every rebuild, so if it is present, the artifacts are
  the intended ones.
- This box has ~560MB free RAM and runs 5 other live apps. **NEVER run `npm run build`,
  `tsc`, or `vite` here.** `server/dist` and `client/dist` are committed in git —
  deploying is: DB upgrades → `git pull` → `pm2 restart` → cron file.
- nginx serves `client/dist` statically and proxies `/api/v1` to the Node API on
  `localhost:5501`, which runs under pm2 as **`bbtasks-api`** (single fork instance —
  keep it that way). New client files go live on pull; nginx needs no action.
- MySQL: database **`taskmanagement`**, connected via unix socket. Credentials and
  `DB_SOCKET_PATH` are in `server/.env` (0600 — read it, never print the secrets).
  `DB_TIMEZONE=+00:00` and pm2's `TZ=Asia/Dhaka` are deliberate — do not change either.
- **The DB is at upgrade `022`. This deploy needs `023`, `024` and `025`** — three, not
  two. The previous deploy prompt stopped at `024`; `025` has landed since.

## ⚠️ THE ONE RULE THAT MATTERS — order

The new code reads three `tasks` columns that `024` adds **and** the `tasks.assigned_by`
column that `025` adds. If the code restarts before the SQL runs, **every task read in the
app 500s** — list, board, calendar, home, everything. All three upgrades are additive and
are ignored by the currently-running old code, so there is no window where applying them
early hurts.

**SQL first, code second. Never the other way.**

## Step 0 — preflight

```bash
cd /var/www/html/tasks-beautybooth
git fetch origin
git log --oneline -1 origin/main   # MUST match the SHA in the handover message
git log --oneline -1 HEAD          # record this SHA — it is the rollback point
git status --porcelain             # MUST be empty — if not, STOP and report what's there
pm2 status                         # bbtasks-api should be online
pm2 logs bbtasks-api --lines 15 --nostream   # note a clean baseline
```

**About `package.json`:** the old prompt told you to stop if it differed. It differs this
time and that is fine and expected:

```bash
git diff --name-only HEAD origin/main -- server/package.json client/package.json
```

- `server/package.json` — **must be unchanged**. If it appears here, STOP: server
  dependencies would need installing and this prompt does not cover that.
- `client/package.json` — **expected to appear.** One unused dependency (`maplibre-gl`)
  was dropped to shrink the bundle. This box never installs client dependencies and never
  builds the client; nginx serves the prebuilt `client/dist`. **No `npm install`. Do not
  run one.**

## Step 1 — backup

```bash
bash deploy/backup/bbtasks-backup.sh
ls -lah /var/backups/bbtasks | tail -3   # confirm a fresh, non-trivial dump exists
```
If the script fails on the disk-space guard or anything else, take a manual
`mysqldump --single-transaction` of `taskmanagement` over the socket before continuing —
do not proceed without a backup. **`025` backfills data**, so this backup is not
ceremonial.

## Step 2 — DB upgrades 023, 024, 025 — in this order

Read the DB user/password/socket from `server/.env`. Set `M` to save typing:

```bash
M="mysql --socket=<DB_SOCKET_PATH> -u<DB_USERNAME> -p<DB_PASSWORD> taskmanagement"
```

**Check before each one.** `023` and `024` are idempotent; **`025` is NOT** — MySQL 8.4
has no `ADD COLUMN IF NOT EXISTS`, so re-running it errors on the duplicate column. Run
this first and only apply `025` if it returns `0`:

```sql
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE table_schema='taskmanagement' AND table_name='tasks'
   AND column_name='assigned_by';        -- 0 = safe to apply 025
```

Then:

```bash
$M < database/upgrades/023_task_delete_approval.sql
$M < database/upgrades/024_recurrence_spawn.sql
$M < database/upgrades/025_assigned_by.sql
```

Verify all three (all against `taskmanagement`):

```sql
-- 023: the approval table exists
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE table_schema='taskmanagement' AND table_name='task_delete_requests';   -- = 1

-- 024: the three recurrence columns exist on tasks
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE table_schema='taskmanagement' AND table_name='tasks'
   AND COLUMN_NAME IN ('recurrence_time','recurrence_last_spawned_on','recurring_source_id');
                                                                             -- 3 rows

-- 025: the column, its FK, and an HONEST backfill
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE table_schema='taskmanagement' AND table_name='tasks'
   AND COLUMN_NAME='assigned_by';                                            -- = 1
SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
 WHERE table_schema='taskmanagement' AND table_name='tasks'
   AND constraint_name='fk_tasks_assigned_by';                               -- = 1
SELECT COUNT(*) FROM tasks WHERE assigned_by IS NULL;                        -- = 0
SELECT COUNT(*) FROM tasks t LEFT JOIN users u ON u.id = t.assigned_by
 WHERE t.assigned_by IS NOT NULL AND u.id IS NULL;                           -- = 0

-- overall
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE table_schema='taskmanagement' AND table_type='BASE TABLE';            -- = 47
```

If `025`'s "assigned_by IS NULL" count is not 0, STOP and report it — the backfill takes
the earliest real assigner from `task_assignees` and falls back to `created_by`, so a NULL
means something unexpected about the data.

Note: if you eyeball timestamp data in raw SQL, run `SET time_zone='+00:00';` first or
everything looks ~6h off — that is expected session-timezone behaviour, not corruption.

## Step 3 — code

```bash
git pull --ff-only origin main
git log --oneline -1                                  # matches the handover SHA
ls -la server/dist/server.js client/dist/index.html    # artifacts present
grep -o 'assets/index-[^"]*\.js' client/dist/index.html | head -1
                                                      # MUST be assets/index-RU3OSsKx.js
```

## Step 4 — restart the API

```bash
pm2 restart bbtasks-api --update-env
pm2 logs bbtasks-api --lines 30 --nostream
# expect: "Database connected successfully." · "Permission catalog synced" ·
#         "Listening on port 5501" · no errors
curl -s http://127.0.0.1:5501/health          # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5501/health/ready   # 200
```

### Step 4b — the canary that actually reads a task

> **This replaces the old check, which was broken.** The previous prompt said to
> `curl /api/v1/tasks` and expect `401`. **That route does not exist** — it answers `404`
> on a perfectly healthy API (tasks are read through `/lists/:id/tasks`, `/tasks/my-work`
> and `/tasks/:id`). Worse, a `404` comes from the router *before any database access*, so
> if `025` had not applied, the check would still have said `404` and the deploy would have
> been declared good while every task read in the app 500s. **The one check meant to catch
> the catastrophic ordering mistake could not catch it.** Verified against a running API on
> 2026-09-03.

An unauthenticated request can never prove the DB is right — every protected route answers
`401` before it touches a row. So log in as a real account and read tasks:

```bash
# Use a real account you can log in as. The password is not echoed.
read -r -p "email: " EMAIL
read -r -s -p "password: " PW; echo

TOKEN=$(curl -s -X POST http://127.0.0.1:5501/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && echo "logged in" || echo "LOGIN FAILED — stop here"

curl -s -o /dev/null -w "my-work  = %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5501/api/v1/tasks/my-work
curl -s -o /dev/null -w "kpis     = %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5501/api/v1/home/kpis

# And prove the new columns are actually being served:
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5501/api/v1/tasks/my-work | grep -c assigned_by
```

- `my-work` and `kpis` must both be **200**. A **500** means the DB upgrades did not
  actually apply — stop, re-verify step 2 (including `025`), and only roll back (step 7)
  if it cannot be resolved.
- The last command must print a number **greater than 0** — that is `025`'s column arriving
  in a real response, which is the thing this whole ordering rule exists to protect.
- If the workspace genuinely has no tasks for that user, `my-work` returns `200` with empty
  buckets and the `grep -c` prints `0`. In that case use an account that has tasks, or read
  one list instead: `curl -H "Authorization: Bearer $TOKEN" .../api/v1/lists/<id>/tasks`.

Then clear the token from your shell: `unset TOKEN PW`.

## Step 5 — cron (the recurrence job)

The repo's cron file carries a `*/15` `recurrence-spawn` line that is not installed yet.

```bash
cp deploy/cron/bbtasks-jobs /etc/cron.d/bbtasks-jobs
chmod 644 /etc/cron.d/bbtasks-jobs             # cron IGNORES group-writable files
chmod +x deploy/cron/run-job.sh                # should already be, confirm
grep recurrence-spawn /etc/cron.d/bbtasks-jobs # the new line is present
deploy/cron/run-job.sh recurrence-spawn --dry-run   # expect ok:true JSON
```

## Step 6 — verification, including the parts that are new this time

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tasks.beautybooth.com.bd   # 200
curl -s https://tasks.beautybooth.com.bd | grep -o 'assets/index-[^"]*\.js' | head -2
# must include index-RU3OSsKx.js — if it still shows the old hash, the browser or a
# cache is serving a stale index.html; check nginx is pointed at client/dist
```

**The app is now a PWA.** nginx already has the right blocks; confirm they are live rather
than assuming:

```bash
curl -sI https://tasks.beautybooth.com.bd/sw.js | grep -i 'cache-control\|service-worker-allowed'
# expect: no-store, must-revalidate  AND  Service-Worker-Allowed: /
curl -sI https://tasks.beautybooth.com.bd/manifest.webmanifest | grep -i 'content-type'
# expect: application/manifest+json
curl -s -o /dev/null -w "%{http_code}\n" https://tasks.beautybooth.com.bd/icon-192.png   # 200
```
If `sw.js` comes back cached or without `Service-Worker-Allowed`, the live nginx config is
older than the repo's `deploy/nginx/tasks.beautybooth.com.bd.conf` — report it; installs
are out of scope for this prompt.

Then watch for ~2 minutes:

```bash
pm2 logs bbtasks-api --lines 40 --nostream    # no errors
```

## Step 7 — rollback plan

Only if the API will not boot, or task reads still 500 after step 2 was re-verified:

```bash
git reset --hard <SHA recorded in step 0>
pm2 restart bbtasks-api
```

**Leave the DB upgrades in place** — they are additive and the old code ignores them.
Dropping `025` would discard any attribution corrections people have made (the original
assigner history survives in `task_assignees.assigned_by`). Tell me before rolling back if
at all possible.

## What this deploy ships

**Added 2026-09-03 — the bug fixes from the test plan (P0–P6).** These are the ones a
person would notice; every one is covered by a regression test and the full gate is green
(37 modules, 5,739 tests, 0 failures):

- **`/eng/home` stopped leaking Engineering's open-bug count to every team.** The tile
  counted the whole workspace while the preview beside it was correctly scoped, so a
  Marketing or CS user saw a number they had no business seeing — and a count of 2 sitting
  over a list of 1. The stale-tickets bucket had the same flaw and could hand a team an
  empty list while their own stale work sat there.
- **`PATCH /tasks/:id` no longer accepts an assignment and silently throws it away.** It
  answered `200` while dropping the assignees on the floor; this shipped once already as
  the list-row assignee editor that "never worked".
- **The "queued for permanent deletion" badge now appears on Home and in search**, not only
  in the List and Board views. The same task used to warn you in one place and say nothing
  in another.
- **"Report a bug" reaches someone again** — S0/S1 go to on-call, everything else to the
  Engineering space head, and the API warns when neither exists.
- **A stale or deleted sprint board says so** instead of rendering as "no tasks".

Then everything from the 08-19 prompt that was never applied, plus two large pieces since:

- **Permanent-delete admin approval** (needs `023`).
- **Task recurrence that actually recurs** (needs `024` + the new cron line).
- **Assistant insights**: people/team questions answered with real, permission-scoped data.
- **Calendar "+N more"**, **filters everywhere**, **@mentions in comments**.
- **Assigned By (needs `025`)**: every task records who handed the work out, defaulting to
  the creator, with real history backfilled from `task_assignees` rather than a blanket
  copy of `created_by`. This is the change that makes `025` mandatory.
- **The mobile rebuild (P0–P8)** — the app is usable on a phone now: a bottom tab bar and
  `/spaces` drill-down instead of an unreachable 56px rail, card task rows (a task name
  went from ~1 visible character to 36), a virtualised list (a 500-task list dropped from
  22,826 DOM nodes to ~540), Home reshaped so work is above the fold, the public customer
  form fixed, the calendar turned into an agenda, first load 666 → 470 KB gzipped, and
  **installable as a PWA** with a service worker that caches the shell. Desktop is
  provably unchanged — a metric guard across 8 routes runs on every test run.
- **Report a Bug reaches a person again**: reports used to land in Bug Triage assigned to
  nobody, notifying nobody, because assignment only ever fired for an S0/S1 with someone
  on call — and the rota lapsed on 2026-08-14, so even a site-down S0 reached no one.
  Now S0/S1 pages the on-call engineer and everything else (plus any page the lapsed rota
  missed) goes to the Engineering space head.

**Nothing needs new env vars.** Server dependencies did not change.

## Two things to check on this box after the deploy

1. **Does the production workspace have a `Bug` task type and a `Bug Triage` list?** If
   either is missing, every bug report returns 409 for everyone — a literal "nobody can
   report a bug". The error message now says exactly which one is missing, but confirm:

   ```sql
   SELECT COUNT(*) FROM task_types WHERE name='Bug';                          -- >= 1
   SELECT id, name, archived_at FROM lists WHERE name='Bug Triage';           -- >= 1 unarchived
   ```

2. **Is there an Engineering space head, and is the on-call rota current?** Routing needs
   at least one of them; with neither, a report is still filed but silent (the API logs
   `eng.report_bug.unrouted`).

   ```sql
   SELECT s.name, u.email, u.status FROM spaces s
     LEFT JOIN users u ON u.id = s.head_user_id WHERE s.name='Engineering';
   SELECT week_start, engineer_id FROM on_call_shifts ORDER BY week_start DESC LIMIT 3;
   ```

---
