# Deploy prompt — production server (written 2026-09-07, test plan P14)

Run these steps on the DigitalOcean box (209.38.65.61) — either by hand, or by pasting the
part below the line to a Claude session there.

> Replaces `DEPLOY_PROMPT_2026-08-29.md`, which is deleted. Three things in it were wrong
> or stale by the time this was written, and all three are the same mistake — **a file
> asserting the state of a live system**:
>
> 1. It said "**the DB is at upgrade `022`**". It was not: `025` was already applied, and
>    running it produced `ERROR 1060 Duplicate column`. Harmless only because the prompt
>    pre-CHECKED the column first. **This prompt asserts nothing about the DB; it checks.**
> 2. Its canary hash (`index-03KaeTLH.js`) is the bundle production is serving *now*, so it
>    could no longer detect a failed deploy. New hash below.
> 3. Its step 4a began `cd /var/www/bbtasks` — **not a path on this box**. The repo is
>    `/var/www/html/tasks-beautybooth`. The one command meant to prove pm2 picked up the new
>    code would have failed or read the wrong repo. Fixed.

---

You are deploying an update of the BeautyBooth Task Management app on this server. Work
step by step, verify each step before moving to the next, and report each step's outcome.
If anything deviates from the expectations written here, STOP and tell me instead of
improvising.

## Context (trust this over guesses)

- App repo: `/var/www/html/tasks-beautybooth`, branch `main`.
- **Target: the tip of `origin/main`.** Confirm it matches the SHA in the handover message.
  The build is identified by its entry bundle — `client/dist/index.html` must reference
  **`assets/index-BufrRhaG.js`**. That hash changes with every rebuild, so its presence is
  the reliable canary. (The bundle being replaced is `index-03KaeTLH.js`.)
- This box has ~560MB free RAM and runs 5 other live apps. **NEVER run `npm run build`,
  `tsc`, or `vite` here.** `server/dist` and `client/dist` are committed in git — deploying
  is: DB upgrade → `git pull` → `pm2 restart` → verify.
- nginx serves `client/dist` statically and proxies `/api/v1` to the Node API on
  `localhost:5501`, which runs under pm2 as **`bbtasks-api`** (single fork instance — keep
  it that way). New client files go live on pull; nginx needs no action.
- MySQL: database **`taskmanagement`**, connected via unix socket. Credentials and
  `DB_SOCKET_PATH` are in `server/.env` (0600 — read it, never print the secrets).
  `DB_TIMEZONE=+00:00` and pm2's `TZ=Asia/Dhaka` are deliberate — do not change either.

## ⚠️ How this deploy differs from the last one — it is LOWER risk

The previous deploy carried a hard ordering rule because the new code read columns that the
SQL added: restart first and every task read 500s. **That is not the case here.**

- The only schema change is `026`, which **drops two redundant indexes**. No columns, no
  tables, no data.
- **No new code requires it**, and **it requires no new code**. The old build runs fine
  against the new schema, and the new build runs fine against the old schema. Drizzle names
  indexes but never queries by name.

So either order is safe. Run the SQL first anyway — the habit is worth more than the
exception, and it keeps the rollback story simple.

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

**Dependencies — check, do not assume:**

```bash
git diff --name-only HEAD origin/main -- server/package.json client/package.json
```

- `server/package.json` — **must be unchanged**. If it appears here, STOP: server
  dependencies would need installing and this prompt does not cover that.
- `client/package.json` — if it appears, that is fine. This box never installs client
  dependencies and never builds the client. **No `npm install`. Do not run one.**

## Step 1 — backup

```bash
bash deploy/backup/bbtasks-backup.sh
ls -lah /var/backups/bbtasks | tail -3   # confirm a fresh, non-trivial dump exists
```

If the script fails on its disk-space guard or anything else, take a manual
`mysqldump --single-transaction --routines --triggers` of `taskmanagement` over the socket
before continuing. `026` changes no data, so this backup is genuinely precautionary this
time — but a deploy without one is still a deploy you cannot undo.

## Step 2 — the DB: find out where it is, then apply 026

Read the DB user/password/socket from `server/.env` rather than typing placeholders — the
last deploy pasted `<DB_SOCKET_PATH>` verbatim and got `ERROR 2002`:

```bash
cd /var/www/html/tasks-beautybooth
# Strip only SURROUNDING quotes. A `tr -d` would also eat a quote INSIDE the
# value, and this box's DB password is required by validate_password to hold a
# special character — which may well be one. Tested against a .env carrying
# DB_PASSWORD="p@ss'w0rd!" : the inner quote survives.
Q='s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
SOCK=$(grep -E '^DB_SOCKET_PATH=' server/.env | cut -d= -f2- | sed -E "$Q")
DBU=$(grep -E '^DB_USERNAME=' server/.env | cut -d= -f2- | sed -E "$Q")
export MYSQL_PWD=$(grep -E '^DB_PASSWORD=' server/.env | cut -d= -f2- | sed -E "$Q")
M="mysql --socket=$SOCK -u$DBU taskmanagement"
$M -e "SELECT 1"     # prove the connection before anything else
```

**First, read the state. Do not trust this file about it.**

```sql
-- Where is the DB? Expected: all four = 1/3/1/47. Report whatever you actually get.
SELECT (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE table_schema='taskmanagement' AND table_name='task_delete_requests') AS t023,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE table_schema='taskmanagement' AND table_name='tasks'
           AND COLUMN_NAME IN ('recurrence_time','recurrence_last_spawned_on',
                               'recurring_source_id'))                        AS t024,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE table_schema='taskmanagement' AND table_name='tasks'
           AND column_name='assigned_by')                                     AS t025,
       (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE table_schema='taskmanagement' AND table_type='BASE TABLE')     AS tables_;
```

- If `t023=1 · t024=3 · t025=1 · tables_=47` — the DB is where 2026-09-03 left it. Continue.
- If any is lower, **STOP and report the numbers.** An earlier upgrade is missing and this
  prompt does not cover applying it.

Then apply `026`. It is information_schema-gated, so re-running it is a no-op:

```bash
$M < database/upgrades/026_drop_redundant_indexes.sql
```

Verify — both dropped, and the wider indexes that replace them still present:

```sql
-- the two redundant indexes are gone
SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE table_schema='taskmanagement'
   AND index_name IN ('idx_comments_task_time','idx_tcfv_field');        -- = 0

-- and their supersets survive (0 here would mean the table lost its index entirely)
SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
  FROM information_schema.STATISTICS
 WHERE table_schema='taskmanagement'
   AND index_name IN ('idx_comments_task_created_internal','idx_tcfv_option')
 GROUP BY index_name;
-- expect exactly two rows:
--   idx_comments_task_created_internal  task_id,created_at,internal_id
--   idx_tcfv_option                     custom_field_id,option_id_generated

-- the foreign key that needed one of them is still valid
SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE constraint_schema='taskmanagement' AND constraint_name='fk_tcfv_field';   -- = 1
```

If the two supersets are NOT both present, STOP: `026` should have refused to drop anything
in that case (each drop is gated on its superseding index existing), so their absence means
something else removed them.

Note: if you eyeball timestamp data in raw SQL, run `SET time_zone='+00:00';` first or
everything looks ~6h off — expected session-timezone behaviour, not corruption.

Finally: `unset MYSQL_PWD`.

## Step 3 — code

```bash
git pull --ff-only origin main
git log --oneline -1                                  # matches the handover SHA
ls -la server/dist/server.js client/dist/index.html    # artifacts present
grep -o 'assets/index-[^"]*\.js' client/dist/index.html | head -1
                                                      # MUST be assets/index-BufrRhaG.js
```

If that hash is anything else, **STOP** — the artifacts in the commit are not the ones this
prompt was written for.

## Step 4 — restart the API

```bash
pm2 restart bbtasks-api --update-env
pm2 logs bbtasks-api --lines 30 --nostream
# expect: "Database connected successfully." · "Permission catalog synced" ·
#         "Listening on port 5501" · no errors
curl -s http://127.0.0.1:5501/health          # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5501/health/ready   # 200
```

### Step 4a — is the running process the commit you just pulled?

```bash
cd /var/www/html/tasks-beautybooth
git rev-parse HEAD
curl -s http://127.0.0.1:5501/health/version
# the "git_sha" in the reply must EQUAL the sha above
```

> ⚠️ The previous prompt had `cd /var/www/bbtasks` here — a path that does not exist on this
> box. Corrected above.
>
> `/health/version` reads `.git` when `GIT_SHA` is unset (P8/KI-26), which is what this
> deploy IS. A mismatch means `pm2 restart` did not take, and every check after this point
> would be testing the OLD build. It is deliberately **not** proxied by nginx — it names the
> running build, so it is a from-the-box check for the person deploying.

### Step 4b — the canary that actually reads a task

An unauthenticated request can never prove the DB is right — every protected route answers
`401` before it touches a row. So log in as a real account and read tasks:

```bash
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
curl -s -o /dev/null -w "search   = %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:5501/api/v1/search?q=a"
```

All three must be **200**. `search` is included because it is the read that touches the
`comments` index this deploy changed — a 500 there would be the one plausible symptom of
`026` having gone wrong.

Then clear the token: `unset TOKEN PW EMAIL`.

## Step 5 — cron

The 2026-09-03 deploy installed the cron file including the `*/15` recurrence line. Confirm
rather than reinstall:

```bash
grep -c . /etc/cron.d/bbtasks-jobs                  # the file exists and is non-empty
grep recurrence-spawn /etc/cron.d/bbtasks-jobs      # the */15 line is present
stat -c '%a %n' /etc/cron.d/bbtasks-jobs            # 644 — cron IGNORES group-writable files
deploy/cron/run-job.sh recurrence-spawn --dry-run   # expect ok:true JSON
```

If the file is missing or the recurrence line is absent:

```bash
cp deploy/cron/bbtasks-jobs /etc/cron.d/bbtasks-jobs
chmod 644 /etc/cron.d/bbtasks-jobs
chmod +x deploy/cron/run-job.sh
```

## Step 6 — verification from outside

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tasks.beautybooth.com.bd   # 200
curl -s https://tasks.beautybooth.com.bd | grep -o 'assets/index-[^"]*\.js' | head -2
# must include index-BufrRhaG.js — if it still shows index-03KaeTLH.js, a cache is serving
# a stale index.html; check nginx is pointed at client/dist
```

PWA headers (nginx already has the blocks — confirm they are live, do not assume):

```bash
curl -sI https://tasks.beautybooth.com.bd/sw.js | grep -i 'cache-control\|service-worker-allowed'
# expect: no-store, must-revalidate  AND  Service-Worker-Allowed: /
curl -sI https://tasks.beautybooth.com.bd/manifest.webmanifest | grep -i 'content-type'
# expect: application/manifest+json
```

Then watch for ~2 minutes:

```bash
pm2 logs bbtasks-api --lines 40 --nostream    # no errors
```

### Step 6a — the one user-visible thing worth checking by eye

Open the site and look at a task whose due date is **today**. Its date chip must read
**"Today"** in amber, not the red **overdue** chip. That is the P13 fix arriving: the chip
used to be computed from a UTC-midnight reading of the wire date, so it was correct in
Dhaka and a day early everywhere west of UTC. Dhaka is UTC+6, so this check confirms
nothing regressed rather than confirming the fix — the fix matters for anyone travelling or
working from another timezone.

## Step 7 — rollback plan

Only if the API will not boot, or reads 500 after step 2 was re-verified:

```bash
git reset --hard <SHA recorded in step 0>
pm2 restart bbtasks-api
```

**Leave `026` in place.** It only removed two redundant indexes; the old code neither knows
nor cares. If you genuinely need them back (you will not — P13 measured the query plans
either side and they were identical):

```sql
ALTER TABLE comments ADD INDEX idx_comments_task_time (task_id, created_at);
ALTER TABLE task_custom_field_values ADD INDEX idx_tcfv_field (custom_field_id);
```

## What this deploy ships

Everything from test-plan phases **P7 through P13**, plus the artifact rebuild. The full
gate is green: **38 modules · 6,113 tests · 0 failures**.

The ones a person would notice:

- **A task due today no longer shows as OVERDUE for anyone west of UTC (P13).** The due-date
  chip, the shared task filter, the calendar's day bucketing and the space browser all read
  the wire date `"2026-03-20"` through `new Date()` — UTC midnight — and then took the LOCAL
  calendar day off it. In Dhaka (UTC+6) that lands on the same day, which is why it survived
  this long; in New York it lands on the 19th. Every task surface was affected.
- **The form builder is usable on a phone and by keyboard (P11).** Its palette added fields
  by DRAG ONLY, so on a touch device the browser claimed the gesture and a form could not be
  built at all — while the palette went on looking interactive.
- **A missing KPI no longer blanks the whole app (P10).** One undefined tile threw during
  render and took out every route, not just Home.
- **Calendar drag-and-drop drops on the day you aimed at (P10).**
- **Uploads actually store the file (P8).** The only upload path the client uses had no
  tests and, misconfigured, returned a plausible URL while storing nothing.
- **CORS no longer reflects the office LAN in production (P7).**
- **A task created from a template shows its checklist progress (P12).** It read `0/0` on
  the card, the list row, the board and to the assistant until somebody happened to tick an
  item.

Under the surface: the assistant's "today" is now the workspace's day rather than the
company's; the review queues likewise; the jobs all have HTTP-trigger coverage; and the test
gate itself went from 127 to 55 minutes.

**Nothing needs new env vars. Server dependencies did not change.**

## Two things to check on this box after the deploy

Unchanged from the last prompt, and still worth doing:

1. **Does the production workspace have a `Bug` task type and an unarchived `Bug Triage`
   list?** Without either, every bug report returns 409 for everyone.

   ```sql
   SELECT COUNT(*) FROM task_types WHERE name='Bug';                     -- >= 1
   SELECT id, name, archived_at FROM lists WHERE name='Bug Triage';      -- >= 1 unarchived
   ```

2. **Is there an Engineering space head, and is the on-call rota current?** Routing needs at
   least one; with neither, a report is filed but silent (`eng.report_bug.unrouted`).

   ```sql
   SELECT s.name, u.email, u.status FROM spaces s
     LEFT JOIN users u ON u.id = s.head_user_id WHERE s.name='Engineering';
   SELECT week_start, engineer_id FROM on_call_shifts ORDER BY week_start DESC LIMIT 3;
   ```

   The rota lapsed on 2026-08-14. The report-bug fix means S0/S1 now fall back to the
   Engineering space head, so nothing is silently dropped — but the rota should be
   re-populated.

---
