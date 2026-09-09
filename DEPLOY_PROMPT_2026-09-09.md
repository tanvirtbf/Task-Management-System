# Deploy prompt — production server (written 2026-09-09, DEADLINE_TIME_PLAN P8)

Run these steps on the DigitalOcean box (209.38.65.61) — either by hand, or by pasting the
part below the line to a Claude session there.

> Replaces `DEPLOY_PROMPT_2026-09-07.md`, which is deleted. Nothing in it was *wrong* — it
> was written carefully and its deploy succeeded — but two things are now stale, and one
> instruction in it is **actively unsafe for this deploy**:
>
> 1. Its canary hash (`index-BufrRhaG.js`) is the bundle production serves *now*, so it can
>    no longer detect a failed deploy. New hash below.
> 2. It said "either order is safe" and "run the SQL first anyway". **That was true of
>    `026`, which only dropped indexes. It is false here.** `027` ADDS two columns that the
>    new server code SELECTs. Restarting before the SQL lands means every task read 500s —
>    the exact failure the 2026-09-03 deploy was written to avoid.
> 3. As always: this prompt asserts nothing about the live DB. It checks.

---

You are deploying an update of the BeautyBooth Task Management app on this server. Work
step by step, verify each step before moving to the next, and report each step's outcome.
If anything deviates from the expectations written here, STOP and tell me instead of
improvising.

## Context (trust this over guesses)

- App repo: `/var/www/html/tasks-beautybooth`, branch `main`.
- **Target: the tip of `origin/main`.** Confirm it matches the SHA in the handover message.
  The build is identified by its entry bundle — after the pull, `client/dist/index.html`
  must reference **`assets/index-DTDutthI.js`**. That hash changes with every rebuild, so
  its presence is the reliable canary. (The bundle being replaced is `index-BufrRhaG.js`.)
- This box has ~560MB free RAM and runs 5 other live apps. **NEVER run `npm run build`,
  `tsc`, or `vite` here.** `server/dist` and `client/dist` are committed in git — deploying
  is: `git pull` → DB upgrade → `pm2 restart` → verify.
- nginx serves `client/dist` statically and proxies `/api/v1` to the Node API on
  `localhost:5501`, which runs under pm2 as **`bbtasks-api`** (single fork instance — keep
  it that way). New client files go live on pull; nginx needs no action.
- MySQL: database **`taskmanagement`**, connected via unix socket. Credentials and
  `DB_SOCKET_PATH` are in `server/.env` (0600 — read it, never print the secrets).
  `DB_TIMEZONE=+00:00` and pm2's `TZ=Asia/Dhaka` are deliberate — do not change either.

## ⚠️ What is shipping, and why the ORDER matters this time

Hourly deadlines. A task's start and due date can now each carry a time of day, there is a
countdown under every task name ("17h left", "5h late", "done 5h late"), and the activity
log shows real timestamps ("5 Sep, 8.09 PM") instead of "13d ago".

`027` adds **two nullable TIME columns** to `tasks` — `start_time` and `due_time`. Add-only,
appended at the end of the table so InnoDB uses `ALGORITHM=INSTANT`, information_schema-
gated so re-running is a no-op, and **no backfill**.

⛔ **The new server code SELECTs both columns.** So:

| order | result |
|---|---|
| pull → **SQL** → restart | ✅ correct |
| pull → restart → SQL | ❌ every task read 500s until the SQL lands |

The SQL file does not exist on the box until the pull, which is why the pull comes first.
That leaves a **short window where the NEW client talks to the OLD API** — expected and
mild: the old API simply does not return a time, so the countdown shows day-level values,
and a bulk edit that tries to set a time gets a 422. Keep the window to a minute or two by
running steps 2 and 3 back to back.

### ⛔ The one thing that must NOT happen to existing data

`due_time IS NULL` means the task is due through the **END** of that day — *not* midnight.
That is what makes this migration invisible: every task that exists today keeps behaving
exactly as it does now. Step 5 checks it on real production rows, and it is the single
check worth stopping the deploy over.

## Step 0 — preflight

```bash
cd /var/www/html/tasks-beautybooth
git status --porcelain                    # expect: empty (no local edits)
git rev-parse --short HEAD                # note this — it is your rollback target
pm2 describe bbtasks-api | head -20       # expect: online, fork mode, 1 instance
df -h / | tail -1                         # expect: some headroom, not 100%
free -m | head -2
```

Report all five. If `git status` is not empty, STOP — someone edited files on the box and a
pull will conflict or clobber their work.

## Step 1 — back up the database FIRST

`027` is add-only and reversible by dropping two columns, so this is precautionary rather
than load-bearing. Take it anyway; it costs a minute.

```bash
Q='s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
SOCK=$(grep -E '^DB_SOCKET_PATH=' server/.env | cut -d= -f2- | sed -E "$Q")
DBU=$(grep -E '^DB_USER=' server/.env | cut -d= -f2- | sed -E "$Q")
DBP=$(grep -E '^DB_PASSWORD=' server/.env | cut -d= -f2- | sed -E "$Q")
DBN=$(grep -E '^DB_NAME=' server/.env | cut -d= -f2- | sed -E "$Q")
M="mysql --socket=$SOCK -u$DBU -p$DBP $DBN"

echo "socket=$SOCK db=$DBN"   # sanity: both non-empty, NO password echoed
mysqldump --socket="$SOCK" -u"$DBU" -p"$DBP" "$DBN" \
  > ~/backup-taskmanagement-$(date +%F-%H%M).sql
ls -lh ~/backup-taskmanagement-*.sql | tail -1
```

> The `sed` line strips surrounding quotes if `.env` has them. **Never paste the password
> as a literal** and never `echo` `$DBP`. If `mysqldump` writes a 0-byte file, STOP.

Expect a file of a few MB. If it is under ~100 KB, the dump failed — STOP.

## Step 2 — pull the code

```bash
git fetch origin main
git log --oneline HEAD..origin/main | head -20    # what you are about to take
git pull --ff-only origin main
git rev-parse --short HEAD                        # must match the handover SHA

grep -o 'assets/index-[^"]*\.js' client/dist/index.html | head -1
#                                    MUST be assets/index-DTDutthI.js
```

If the grep still shows `index-BufrRhaG.js`, the pull did not bring the new dist — STOP.

**From this moment the new client is live.** Move straight on to step 3.

## Step 3 — apply 027 (immediately after the pull)

```bash
# Where is the DB actually at? Check, do not assume.
$M -N -e "
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='tasks'
     AND column_name IN ('start_time','due_time');"
```

- `0` — expected. `027` has not been applied. Continue.
- `2` — already applied (someone ran it, or a previous attempt got this far). Skip the
  apply, go to the verify.
- `1` — STOP and report. A half-applied state should not be possible; something else is
  going on.

```bash
$M < database/upgrades/027_task_deadline_time.sql
```

It is information_schema-gated, so a second run is a no-op. Then verify:

```bash
$M -N -e "
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='tasks'
     AND column_name IN ('start_time','due_time');"       # must be 2

$M -N -e "
  SELECT COUNT(*) FROM tasks WHERE due_time IS NOT NULL OR start_time IS NOT NULL;"
#                                                          must be 0 — no backfill
```

If the second number is anything but `0`, STOP. Something wrote times during the migration,
which the migration does not do.

## Step 4 — restart the API

```bash
pm2 restart bbtasks-api --update-env
sleep 3
pm2 describe bbtasks-api | head -20        # online, restarts incremented by 1
pm2 logs bbtasks-api --lines 40 --nostream
```

Expect `Database connected successfully`, `Permission catalog synced {"permissions":56}`,
`Listening on port 5501`. Any `ER_BAD_FIELD_ERROR` mentioning `due_time` means step 3 did
not take — STOP and re-check it.

```bash
# pm2 must be running the code you just pulled, from the right repo.
readlink -f /proc/$(pm2 pid bbtasks-api)/cwd     # /var/www/html/tasks-beautybooth
```

## Step 5 — verify, with an AUTHENTICATED read

Unauthenticated curls prove almost nothing. Log in and read a real task.

```bash
curl -s localhost:5501/health                          # {"status":"ok",...}
curl -s localhost:5501/health/version                  # note what it reports

# Through nginx, not just the port:
curl -s https://tasks.beautybooth.com.bd/api/v1/health

# The bundle the world is actually being served:
curl -s https://tasks.beautybooth.com.bd | grep -o 'assets/index-[^"]*\.js' | head -2
# must include index-DTDutthI.js — if it still shows index-BufrRhaG.js, a cache is
# serving the old page; hard-refresh and check again before concluding anything.
```

Then the check this deploy exists for — **an existing task must be unchanged**:

```bash
$M -N -e "
  SELECT COUNT(*) AS tasks_total,
         SUM(due_date IS NOT NULL) AS with_due_date,
         SUM(due_time IS NOT NULL) AS with_due_time
    FROM tasks WHERE archived_at IS NULL;"
```

`with_due_time` **must be 0**. Every existing task still has a whole-day deadline, which is
exactly what it had yesterday.

Finally, log in as a real user in a browser and confirm on one screen:

- a task with a due date and **no** time reads exactly as it did before (a date chip, no
  time, no countdown change in meaning);
- the activity feed shows absolute timestamps like `5 Sep, 8.09 PM`;
- opening a task's due-date editor shows a **Time** control in the calendar footer, with
  the placeholder `End of day`.

## Step 6 — cron (no change expected)

The 2026-09-03 deploy installed the cron file including the `*/15` recurrence line, and
`027` adds no jobs. Confirm nothing regressed:

```bash
crontab -l | grep -E 'bbtasks|run-job'      # expect the same lines as before
```

## Rollback

Two independent levers; you rarely need both.

**Code only** (the schema is harmless on its own — the old code ignores the two columns):

```bash
git checkout <the SHA you noted in step 0>
pm2 restart bbtasks-api --update-env
```

**Schema too** (only if something is genuinely wrong with the columns):

```bash
$M -e "ALTER TABLE tasks DROP COLUMN start_time;"
$M -e "ALTER TABLE tasks DROP COLUMN due_time;"
```

Dropping them discards any times people set after the deploy; the dates survive untouched
and every task falls back to the whole-day meaning it had before. If you have to restore the
whole database instead:

```bash
$M < ~/backup-taskmanagement-<timestamp>.sql
```

## What to report back

1. The SHA before and after.
2. The `information_schema` count before the apply (0, 1 or 2) and after (2).
3. `SUM(due_time IS NOT NULL)` on live data — must be 0.
4. The bundle hash nginx is serving.
5. pm2 status and the first 40 log lines after restart.
6. Anything that did not match this document, however small.
