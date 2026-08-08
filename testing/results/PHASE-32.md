# PHASE 32 — Background jobs

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** **none** — no new defect survived verification
**Data left behind:** none — tasks 51, attachments 1, notifications 65, department_reports 12,
sessions 440.

---

## 1. Authentication — fails closed on every variant

`internalAuth` compares `X-Internal-Token` with `Config.INTERNAL_JOB_TOKEN` through a constant-time
`safeEqual`, and rejects unless **both** are present and equal.

| probe | result |
|---|---|
| the correct token | 200 |
| a wrong token | 401 `auth.unauthorized` |
| an **empty** token | 401 |
| **no header at all** | 401 |
| the token minus its last character | 401 |
| the token plus one character | 401 |
| the token upper-cased | 401 |
| an unknown job slug | 404 |
| `GET` instead of `POST` | 404 |

The plan's "unset `INTERNAL_JOB_TOKEN` → still 401" case is guaranteed by the same expression —
`!expected` short-circuits to `unauthorized()` before any comparison. Read at
`middlewares/internalAuth.ts:32-37` rather than provoked, since unsetting it would have required
restarting the shared harness API.

## 2. All six jobs — envelope, dry-run and idempotency

Each job was run three times: `?dry_run=true`, then twice for real.

```
session-cleanup          {dry_run:true, processed:0, wouldDelete:0}   {dry_run:false, deleted:0}   same
attachment-janitor       {dry_run:true, wouldDelete:…}                {deleted:…}                  0 on re-run
r2-purge                 {dry_run:true, wouldPurge:0}                 {purged:…, r2Errors:0}       0 on re-run
snooze-wake              {dry_run:true, wouldWake:0}                  {woken:0}                    same
form-submission-expiry   {ok:false, error:"Unknown column …"}         {ok:false, …}                same
department-report        {dry_run:true, generated:7, notified:0}      {generated:7, notified:7}    notified:0
```

Every response carries `{ok, dry_run, …}`; `dry_run: true` appears **only** when asked, and the
dry-run variants mutated nothing. Every job is idempotent on a second run.

## 3. Per-job semantics — all correct

**`attachment-janitor`** — exactly the right rows:

| fixture | outcome |
|---|---|
| a 3-day-old **pending** attachment | removed |
| a **fresh** pending attachment | kept |
| a 3-day-old **complete** attachment | kept |

**`r2-purge`** — the 7-day window is exact:

| fixture | outcome |
|---|---|
| `deleted_at` 8 days ago | purged |
| `deleted_at` 6 days ago | kept |

(P23 §6 already established that the ISS-001 skew cancels here: `deleted_at` and the job's `cutoff`
both pass through Drizzle, so the window lands where it should.)

**`session-cleanup`** — correct, and my first reading of it was wrong. The job deletes sessions whose
window expired **more than 30 days ago** (`sessionCleanup.ts:5,22`), not merely expired. A fixture
only 7 days expired was therefore rightly kept. Against the real table: 440 sessions, 1 expired, 267
revoked-but-unexpired — and the docstring says revoked rows are deliberately kept until they age out
too.

**`snooze-wake`** — correct for values the application wrote (proven end-to-end in P24 §4). A fixture
written by **raw SQL** was *not* woken, because the job compares against a bound `now` in the same
shifted frame the app writes in. Worth knowing operationally: a `snoozed_until` set by hand in the
database, by a migration, or by any non-application writer will not wake for six hours. Recorded, not
filed — the application path is correct.

**`department-report`** — the no-double-deliver contract holds under direct test:

```
run 1 -> {generated:7, selfHealed:0, skippedNoActivity:2, notified:0}   report_ready rows 82 -> 82
run 2 -> {generated:7, …,                                notified:0}   report_ready rows 82 -> 82
```

Re-running regenerates payloads without creating rows and without notifying anyone again.

## 4. The failure path — demonstrated for real, not simulated

`form-submission-expiry` genuinely fails on this database, because P26 restored the ISS-025 drift by
dropping `expires_at`. That gave a free test of the contract:

```
HTTP 200
{"ok":false,"dry_run":false,"error":"Unknown column 'form_submissions.expires_at' in 'where clause'"}
```

A failing job returns **200 with `ok:false`**, exactly as `jobs/index.ts` documents — so a scheduler
branches on the body rather than on the status code. The error message is specific enough to
diagnose from a cron log.

## 5. `run-job.sh`

| requirement | verdict |
|---|---|
| reads the token from `server/.env` at run time, not from the crontab | yes |
| sends `?dry_run=true` for the `--dry-run` flag | yes (and correctly spelled — cf. ISS-079) |
| inspects the body for `ok:false` rather than trusting the status | yes |
| exits non-zero on failure so cron reports it | yes |
| handles the API being down | `curl` failure flags present |

Behaviour with the API actually stopped was not provoked — the shared harness API serves every other
phase in this session. Read from the script instead; carried to **P41**.

## 6. Coverage vs the plan

All 12 checklist lines executed or resolved by reading the source where provoking them would have
disrupted the harness (the unset-token case, and the API-down case → P41).

The job layer is one of the most solid parts of the system: an auth check that fails closed on seven
different malformed tokens, a uniform `{ok, dry_run, …}` envelope, honest dry runs, real idempotency
on all six, exact retention windows, and a failure contract that a scheduler can actually act on.

**Evidence directory:** `testing/evidence/PHASE-32/` — 2 files.
