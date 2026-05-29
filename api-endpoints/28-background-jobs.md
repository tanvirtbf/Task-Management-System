# §28 — Background jobs

> Source: [API_DESIGN.md §28](../API_DESIGN.md#30-background-jobs)

**7 internal jobs.** Not called by end users — invoked by cron (or k8s `CronJob`) and protected by the `X-Internal-Token` header that matches `INTERNAL_JOB_TOKEN` from `.env`. Each job is a POST so the request body can carry overrides like `?dry_run=true`.

## Endpoints

| # | Method | Path | Schedule | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/jobs/recurrence-spawn` | hourly | Spawn the next instance of recurring tasks past their due date | 🤖 | M | ☐ |
| 2 | POST | `/api/v1/jobs/email-digest` | daily 09:00 BD | Send each user's daily email digest (overdue + assigned-to-me) | 🤖 | L | ☐ |
| 3 | POST | `/api/v1/jobs/attachment-janitor` | hourly | Hard-delete `attachments` rows whose upload never finalised after 1 h | 🤖 | M | ☐ |
| 4 | POST | `/api/v1/jobs/r2-purge` | daily | Hard-delete R2 objects whose `attachments.deleted_at > 7 days ago` | 🤖 | M | ☐ |
| 5 | POST | `/api/v1/jobs/session-cleanup` | hourly | Hard-delete `sessions` rows past `expires_at + 30 days` | 🤖 | S | ☐ |
| 6 | POST | `/api/v1/jobs/snooze-wake` | every 5 min | Flip snoozed notifications back to unread when `snoozed_until <= NOW()` | 🤖 | S | ☐ |
| 7 | POST | `/api/v1/jobs/sla-breach-scan` | every 5 min | Read `v_breached_sla` → fire `due_soon` / `incident_alert` notifications, escalate S0 bugs | 🤖 | L | ☐ |

## Dependencies

- Each job touches the same DB tables as its corresponding feature. Specifically:
  - #1: §10 Tasks (recurrence)
  - #2: §19 Notifications + §10 Tasks + SMTP
  - #3, #4: §16 Attachments + R2
  - #5: §2 Sessions
  - #6, #7: §19 Notifications

## Notes

- **Auth**: a single `internalAuth` middleware should check `X-Internal-Token === Config.INTERNAL_JOB_TOKEN`. Reject anything else with `401 auth.unauthorized`.
- All jobs accept `?dry_run=true` — execute the same query path but log what they would do instead of writing. Response = `{processed, wouldUpdate, wouldNotify}` etc.
- Jobs must be **idempotent** — running #6 twice in the same minute should not double-deliver notifications.
- Failures should not crash the process — catch + log + return `{ok: false, error}` so cron can decide what to do.
- For local dev, expose a `bin/run-job.ts` runner so you can fire `npm run job recurrence-spawn` and watch the output.
