# PHASE 30 — SLA

**Status:** DONE (the plan marks this API + DB only; `SCAN-L4` says there is no UI, and §7 confirms it)
**Methods:** API · DB · CODE
**Issues filed:** ISS-081 (HIGH) · ISS-082 (LOW)
**Deferred item resolved:** SLA end-to-end confirmation of ISS-001 (from P1)
**Data left behind:** none — tasks 51.

---

## 1. Deadline computation — the first half of the phase's finding

`computeSlaDueAt` (`TaskWriteService:55-75`) intends **S0 +2 h, S1 +24 h, S2 +7 days, S3 none**, and
applies only to `Bug` (and `Complaint`, +24 h). A non-dev-type task correctly gets `sla_due_at: null`.

What actually lands in the column:

```
severity   stored      intended    shortfall
S0         -240 min    +120 min    360 min   *** already breached at creation ***
S1        +1080 min   +1440 min    360 min
S2        +9720 min  +10080 min    360 min
S3            null        null     —          correct
```

Every deadline is exactly 360 minutes short, and the **most urgent severity the product has** is
born past its deadline.

## 2. Breach detection — the second half

The endpoint's `minutes_breached` is `TIMESTAMPDIFF(MINUTE, sla_due_at, UTC_TIMESTAMP())`
(`SlaRepo.ts:95`). Swept against a single task:

| how late (truth) | `GET /sla/breached` | `v_breached_sla` |
|---|---|---|
| 1 h | not listed | listed |
| 3 h | not listed | listed |
| 5 h | not listed | listed |
| 6 h | not listed | listed |
| **6.5 h** | **listed**, `minutes_breached = 30` | listed |
| 7 h | listed, `= 60` | listed |
| 12 h | listed, `= 360` | listed |
| 24 h | listed, `= 1080` | listed |

Two things at once: nothing surfaces until **more than 6 hours** past the deadline, and once it does,
`minutes_breached` is under-reported by exactly **360** every time. The view and the endpoint
disagree for that entire six-hour window because the view uses `NOW()`.

Both halves are ISS-081. This supersedes the *scope* of `SCAN-H2`, which described only the detection
half.

## 3. Filters — PASS

```
(none)             -> 200
?severity=S1       -> 200, filtered
?severity=S0       -> 200, 0 rows
?severity=bogus    -> 422 validation.failed
?team=engineering  -> 200   (the dev-type alias works)
?team=ops          -> 200, 0 rows
?team=bogus        -> 422 validation.failed
?limit=1           -> 200
```

Row shape: `{task_id, custom_id, name, task_type_id, sla_due_at, minutes_breached, assignees}` —
assignees hydrated, ordered most-overdue first.

## 4. `PATCH /tasks/:id/sla` — PASS, every guard

| probe | result |
|---|---|
| a future timestamp | 200 (stored with the same 6-hour shift — ISS-081/ISS-001) |
| a past timestamp | 422 `sla.invalid_due_at` |
| `null` | 200, cleared |
| malformed | 422 |
| unknown task | 404 `task.not_found` |
| **a guest** | 403 `auth.forbidden` |
| **an archived task** | 409 `task.archived` |

## 5. Severity change vs a manual override — characterised

```
manual override set to +48 h        -> stored
PATCH the task's bug_severity to S0 -> sla_due_at recomputed, the override is GONE
```

The override is overwritten. This is the documented V1 behaviour (P29's §29 memory note records
`sla_override` tracking as deferred), so it is recorded as characterised rather than filed — but it
is worth knowing: an engineering lead who extends a deadline loses that extension the moment anyone
re-triages the severity.

## 6. Exclusions — PASS

An **archived** task 12 hours past its deadline and a **completed** task 12 hours past its deadline
are both correctly absent from `/sla/breached`.

## 7. `SCAN-L4` — confirmed, with one correction

The scan says there is no SLA UI. Precisely: `SLABadge.tsx` **is** mounted on the task drawer
(`TaskDetailDrawer.tsx:33,419`), so a single task shows its own countdown. But `GET /sla/breached`
has **zero callers** anywhere in the client — there is no breach queue, no SLA page, and Home's
`slaBreaches` KPI is computed independently from `tasks.sla_due_at` rather than from this endpoint.
→ **ISS-082**.

## 8. Coverage vs the plan

All 6 checklist lines executed, including the one the plan called out specifically — *"expect the
`SCAN-H2` 6-hour error; **measure**, do not fix"*. It is measured to the minute in §1 and §2, and
nothing was changed.

One probe was wrong on the first pass and re-run: the breach rows are keyed `task_id`, not `id`, so
the first sweep reported "never listed" at every offset. The corrected sweep is what §2 shows.

**Evidence directory:** `testing/evidence/PHASE-30/` — 2 files.
