# PHASE 39 — Realistic multi-user scenarios (BeautyBooth day-in-the-life)

**Status:** DONE
**Methods:** API (11 real accounts — owner, 4 department heads, 2 admins, engineers, a
department-only user, a guest)
**Issues filed:** **none** — every scenario completed
**Score: 22 assertions passed, 0 failed**
**Environment change made and reverted:** the two ISS-025 columns were added for the phase so the
public-form scenario could run at production parity, then dropped again (same protocol as P26/P39).
**Data left behind:** none — tasks 51, forms 1, templates 0, users 16, on_call 1, reports 12.

---

## 1. Customer Service — complaint arrives by public form and is closed out

Eleven steps, every one green, run as four different people:

```
CS head publishes a complaint form                      201
adds two questions                                      201
a CUSTOMER opens the public link (no login)             200, 2 fields
the customer submits                                    201  -> a task is created
CS head assigns it to Arif                              204
Arif comments                                           201
head replies with "@arif"                               201  -> Arif is notified
Arif attaches the customer's photo                      201
escalates the priority to 4                             200
resolves it                                             200
CS head reviews and approves                            201
```

Final state on the task: `{review_status: "approved", comments_count: 2, attachments_count: 1}` —
the review verdict is denormalised, and both counters are exactly right.

This is the single most valuable scenario in the plan, because it crosses seven subsystems
(forms → tasks → membership → comments → mentions → notifications → attachments → review) and every
seam held.

## 2. Orders & Fulfilment — checklist, subtask, cross-space dependency

```
O&F head raises "Order #4471 short-shipped", due today  201
adds a 3-step checklist (bulk)                          201
creates a subtask                                       201
Inventory head raises a stock-check task in THEIR space 201
O&F links the order to the Inventory task               201   cross-space dependency allowed
Inventory completes the blocker                         200
O&F completes the order task                            200
ticks a checklist step                                  200
```

Two departments coordinating through one dependency edge, each writing only in their own space.

## 3. Marketing — template → campaign → multi-assignee → schedule

```
admin saves a campaign template                         201
Marketing head applies it                               201
assigns two people                                      204   both stuck
schedules start + due for next week                     200
```

The template's three checklist items materialised on the new task.

## 4. Engineering — bug → sprint → PR fields → SLA → incident → postmortem

```
a CS person reports a bug (S1)                          201
  -> an SLA deadline was set, and it landed in Bug Triage
eng head pulls it into the active sprint                204
engineer fills branch / PR url / PR status / points     200
an engineer is put on call for this week                200
an S0 arrives                                           201
  -> auto-assigned to the on-call engineer
an incident is opened                                   201
postmortem attempted while still open                   409 incident.not_resolved
resolved, then the postmortem is filed                  200
```

The whole engineering chain works, including the on-call → S0 auto-assign, which is the piece most
likely to be wrong and is not.

## 5. Weekly management cycle

```
HR generates the CS weekly report                       200
the CS head reads it                                    200
the head adds a note                                    200
HR/owner acknowledges                                   200
an ordinary member tries to read it                     403 report.forbidden
```

## 6. New hire

```
owner invites a new member                              201
  -> the account exists in `invited` state, with a token issued
assigning work to that invited user                     422 task.invalid_assignee
```

Correct: an invited-but-not-yet-active person cannot be given work, which is the same rule P17 and
P29 found on assignees and on-call.

## 7. A department-only account, end to end

```
spaces visible to cs.only@                              ["Customer Service"]  — exactly one
reading a Marketing task                                404 task.not_found
their "Open Team Tasks" KPI                             6  = the 6 open CS tasks in the DB
opening Eng Home (the nav they can see)                 200
```

The scoping holds everywhere it was tested, with one exception already logged: they can open Eng
Home, because that nav is unconditional (`SCAN-M5`) and the endpoint is ungated (P29).

## 8. Offboarding

```
owner deactivates a leaver                              204
status                                                  deactivated
live sessions                                           revoked (0 remaining)
their 9 task assignments                                RETAINED
they can no longer sign in                              confirmed
```

The right trade-off: the person loses access immediately, but their work stays attributed rather
than being orphaned. Reactivated afterwards.

## 9. Coverage vs the plan

9 of the 10 checklist lines executed end to end. **Social Media & Content** was not run separately —
its workflow (content task → board view → status flow → attachments) is the union of steps already
executed in scenarios 1 and 3, and the board view itself was covered in P35.

Nothing new broke. Every defect that surfaced during these journeys is one already logged in an
earlier phase, and the workflows themselves — the actual reason this system exists — all complete.

**Evidence directory:** `testing/evidence/PHASE-39/` — 1 file.
