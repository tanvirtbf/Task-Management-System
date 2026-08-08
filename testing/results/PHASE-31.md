# PHASE 31 — Department review & weekly HR reports

**Status:** PARTIAL (UI deferred — §9)
**Methods:** API · DB · CODE · **background job triggered for real**
**Issues filed:** **none** — every candidate finding turned out to be a tester error (§10)
**Deferred items resolved:** `review.perform` enforcement (P5) · `space.has_reports` delete guard (P8)
**Data left behind:** none — tasks 51, spaces 9, task_reviews 9, department_reports 12,
notifications 65. (The job legitimately generated 8 new reports and 7 notifications; all were removed,
keeping the 12 seeded rows by `internal_id`.)

---

## 1. `POST /tasks/:id/review` — PASS, every guard

| probe | result |
|---|---|
| an **incomplete** task | 409 `review.not_completed` |
| a plain member | 403 `review.not_head` |
| **another department's head** (non-admin) | **403 `review.not_head`** |
| a guest | 403 `review.not_head` |
| **the space's own head** | 201 |
| an owner/admin on any space | 201 — the documented override |
| an invalid `status` value | 422 |
| unknown task | 404 |

The denormalised trio is written on the task (`review_status`, `reviewed_at`, `reviewed_by`), and
**re-opening a reviewed task auto-resets the verdict to null** — verified.

## 2. `GET /tasks/:id/reviews` — PASS

Full history returned to the head (2 rows after an approve + an admin override), and **403
`review.forbidden`** for a plain member and for a guest.

## 3. Review summary and queue — PASS, numbers match by hand

`GET /spaces/:id/review-queue` takes **`?bucket=`** (not `?filter=`):

| bucket | API | hand-counted in SQL |
|---|---|---|
| `needs_review` | 7 | 7 |
| `flagged` | 0 | 0 |
| `overdue` | 4 | 4 |
| `due_today` | 0 | 0 |
| `bogus` | 422 | — |

Access: head 200 · owner 200 · member **403 `review.not_head`** · guest **403**.
`review-summary` behaves the same and returns per-member rows with their counts.

## 4. `POST /reports/generate` — PASS

```
a past week          -> 200
the same week again  -> 200, the SAME report id, still one row   (idempotent upsert)
the CURRENT week     -> 422 report.invalid_week
a FUTURE week        -> 422 report.invalid_week
a mid-week date      -> 422 report.invalid_week
unknown space        -> 404 space.not_found
by the head          -> 200
by a plain member    -> 403 report.forbidden
an ARCHIVED space    -> 409 space.archived
```

Only **completed** weeks can be reported, which is the sensible reading of a weekly HR report.

## 5. Report statistics — recomputed by hand, correct

For Marketing, week 2026-07-20 → 2026-07-26:

```
payload.totals: {flagged:0, approved:0, completed:0, overdue_now:4,
                 completed_late:0, done_unreviewed:7}
hand-counted:    completed=0    overdue_now=4    done_unreviewed=7
```

Every figure matches, and `done_unreviewed` agrees with the `needs_review` queue count from §3 — the
two surfaces are consistent with each other. The payload also carries a per-member breakdown with
each person's `assigned_open`, `completed`, `overdue_now` and flags.

## 6. Read / note / ack — PASS

| action | owner | the space's head | another head (admin) | member |
|---|---|---|---|---|
| `GET /reports` | 13 rows | **3** (own dept only) | — | 200, **0 rows** |
| `GET /reports/:id` | 200 | 200 | 200 (admin) | 403 `report.forbidden` |
| `PATCH` head note | — | **200** | **403** | 403 |
| `POST /:id/ack` | **200** | **403 `auth.forbidden`** | — | 403 |

Two deliberate splits worth naming: the **head note is head-only** (an admin is refused — it is the
head's voice), and **ack is owner/admin-only** (`requirePermission("report.ack")`, documented on the
route as HR "Mark seen"). Ack is idempotent — the first actor and timestamp stick.

## 7. Edge cases — PASS

```
a space with NO head and NO tasks -> 200, head_user_id null,
                                     4 report_ready notifications still sent to the admins  (H-2)
an ARCHIVED space                 -> 409 space.archived
```

**`space.has_reports` (the P8 deferral) — resolved.** Deletion is a two-step guard:

```
a live space                          -> DELETE 409 space.not_archived
archived, no reports                  -> DELETE 204
archived, WITH a report               -> DELETE 409 space.has_reports
```

Both guards fire, in that order. A department's report history cannot be silently orphaned.

## 8. The `department-report` job — PASS, and the no-double-deliver contract holds

```
?dry_run=true -> {dry_run:true, processed:8, generated:7, selfHealed:1,
                  skippedNoActivity:2, notified:0}    rows unchanged
run for real  -> {dry_run:false, processed:8, generated:7, selfHealed:1,
                  skippedNoActivity:2, notified:7}    rows 14 -> 21
run AGAIN     -> {generated:7, selfHealed:0, skippedNoActivity:2, notified:0}   rows still 21
```

The second run re-generates the payloads (an upsert, no new rows) and notifies **nobody** — the
"generate can never suppress, and never duplicate, the weekly notification" contract in the source
comment is real. It self-healed one missing report, skipped two departments with no activity, and
targeted the correct week (last Monday, 2026-07-20).

Note the contrast with ISS-079: here `?dry_run=true` was spelled correctly and behaved correctly.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/dept` (queue + summary) and `/reports` (list + detail), nav visibility per role | API-only phase | **P36** |
| the job's Monday-09:00-Dhaka **schedule** (the cron line, not the job body) | needs the deployed crontab | **P41** |

## 10. `review.perform` — the P5 deferral, resolved with a distinction

`review.perform` exists in the 56-permission catalog, but `POST /tasks/:id/review` does **not** carry
a `requirePermission` gate. Authorization is decided inside `ReviewsService.guard` — owner/admin, or
`isHeadOfSpace(userId, space)` — a role-and-ownership test, not a permission test.

So the RBAC toggle for `review.perform` is **inert**: granting or withholding it changes nothing.
But — unlike the 21 entries in ISS-024 — **the action is not unprotected**. A member, a guest and
another department's head are all correctly refused. This is the same category P5 assigned to
`space.view` and `task.view`: *enforced by another mechanism*. Recorded here rather than added to
ISS-024's count, because adding it would overstate the exposure.

## 11. Coverage vs the plan

All 10 checklist lines executed. **Four** candidate findings were investigated and all four were my
own errors, not the product's — worth listing because each looked convincing:

| what it looked like | what it was |
|---|---|
| "another department's head can review a Marketing task" | that head (`tanvir`) has the legacy role **admin** — the documented override. Re-tested with a non-admin head: **403** |
| "`review-queue` returns 422 for every filter value" | the query param is **`bucket`**, not `filter` |
| "the head cannot acknowledge their own report" | ack is `requirePermission("report.ack")`, **owner/admin by design**; the owner acks fine and it is idempotent |
| "cleanup left 8 extra reports" | my cleanup filtered on `generated_at > NOW() - 1 HOUR`, and that column is written 6 h behind (ISS-001), so the filter missed its own rows |

The dept-review module is the most complete feature in Block E: correct head/admin/member/guest
separation on six endpoints, statistics that reconcile exactly with hand-written SQL, an idempotent
generator, a job with a real no-double-notify guarantee, and a two-stage delete guard protecting
report history.

**Evidence directory:** `testing/evidence/PHASE-31/` — 3 files.
