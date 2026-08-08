# PHASE 29 — On-call & Engineering specials

**Status:** PARTIAL (UI deferred — §7)
**Methods:** API · DB · CODE
**Issues filed:** **none** — no new defect survived verification
**Existing issue updated:** ISS-024 (`postmortem.manage` resolved as NOT ENFORCED → **21 of 56**)
**Deferred item resolved:** `postmortem.manage` enforcement (deferred out of P5)
**Data left behind:** none — tasks 51, on_call_shifts 1, postmortems 0.

---

## 1. On-call reads — PASS

```
GET /on-call/current  -> 200, body null        (nobody on call this week — honest null, not an error)
GET /on-call/schedule -> 200, engineer fully hydrated on each row
v_current_on_call     -> 0 rows                (the seeded shift covers Jul 20-26; today is Jul 30)
```

The view's predicate is `CURDATE() BETWEEN week_start AND week_end`. `CURDATE()` evaluates in the
MySQL session zone (`+06:00`), which is the right clock for a Dhaka team — and today `CURDATE()` and
`UTC_DATE()` agree, so the boundary case is not currently exercised. Recorded rather than filed: the
view is only wrong for the six hours after Dhaka midnight, and only if the session zone were ever
left at UTC.

## 2. `PUT /on-call/:weekStart` — PASS, every guard

| probe | result |
|---|---|
| a Monday | 200, `week_end` computed as a full **7-day** span |
| **a mid-week date** | **422** — a shift must start on a Monday |
| the same week again | 200, still exactly **one** row for that week (upsert, not duplicate) |
| unknown engineer | 422 `on_call.invalid_engineer` |
| an **invited** (not active) user | 422 `on_call.invalid_engineer` |
| malformed date / missing `engineer_id` | 422 |
| **a member** | 403 `auth.forbidden` |
| **a guest** | 403 `auth.forbidden` |

`DELETE` → 204, then 404 `on_call.not_found`; deleting a week never set → 404.

Worth noting rather than filing: the validity check is "an **active workspace member**", not "an
engineer" — a guest account can legitimately be placed on the rotation by an admin. Since the write
is admin-only, that is a defensible design choice.

## 3. `POST /eng/report-bug` — PASS, and the routing is right

Body is `{steps, happened, reporter_team, severity?, expected?, url?, screenshots?}`.

```
owner        -> 201   task #5
member       -> 201   task #6
guest        -> 201   task #7     <- bug.report is unenforced (ISS-024)
space-scoped -> 404 list.not_found  <- correct: they cannot see Bug Triage
```

Every bug lands in the **Bug Triage** list of the **Engineering** space with the **Bug** task type
(`is_dev_type = 1`), carries its severity and `reporter_team`, and gets an `sla_due_at`. The
description is assembled from the intake fields into readable markdown:

```
**Steps to reproduce**
1. open checkout 2. pay

**What happened**
TEST-p29b 500 error from owner

**Expected**
…
```

Validation: missing `steps` → 422, bad `reporter_team` → 422, bad `severity` → 422.

## 4. On-call auto-assignment — PASS, exactly as documented

With an engineer placed on call for the current week:

```
GET /on-call/current -> jhankar@beautybooth.com.bd
v_current_on_call    -> 1 row
an S0 bug -> assignees: [jhankar]    auto-assigned
an S3 bug -> assignees: []           correctly NOT auto-assigned
```

The S0/S1-only rule fires on the **supplied** severity, before the create default — which is what the
source comment says it does.

## 5. `GET /eng/home` — PASS

Tiles: `open_bugs`, `my_sprint_tasks`, `prs_awaiting_me`, `open_incidents`, `stale_tickets`,
`current_on_call`, `active_sprint`.

```
open_bugs api: 8   hand-counted in SQL: 8   match
current_on_call: the full engineer object
guest: 200, top rows carry the standard 50-field task shape, custom_field_values redacted to {}
```

**Stale-ticket window measured:** the API reported 0 while a >7-day hand-count found 2 and a
>14-day count found 0 — so the window is **14 days**, confirmed at
`EngineeringRepo.ts:31,231,247` (`STALE_DAYS = 14`, with a comment noting the spec is silent and 14
is the documented default). Not a defect; recorded because the plan asked for the value of `n`.

`eng.not_configured` could not be provoked — this workspace **has** both a "Bug" task type and a
"Bug Triage" list, and removing either to force the error would damage seed data for no gain. The
two guard clauses were read instead (`EngineeringService:176-192`) and are unambiguous.

## 6. Postmortems — PASS, every guard and the case-transform exemption

```
on a Bug (not an Incident)  -> 409 incident.not_incident
on an OPEN incident         -> 409 incident.not_resolved
on a RESOLVED incident      -> 200 {task_id, items, updated_by, created_at, updated_at}
a non-boolean item value    -> 422
re-save                     -> 200, still ONE row (upsert, not append)
GET for a task with none    -> 404
```

`items` is a **label → boolean** map, and the labels survive the request case-transform verbatim —
`"Timeline written"`, `"snake_case_label"` and `"UPPER Label"` all came back exactly as sent. That is
the §22 exemption working as designed.

**A guest saved a postmortem (200).** `postmortem.manage` was one of the five permissions P5 could
not resolve; this settles it as **NOT ENFORCED** and moves ISS-024's measured count to **21 of 56**.

## 7. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| eng home, on-call rotation page, report-bug button, postmortem checklist, git panel | API-only phase | **P35** |
| `eng.not_configured` end to end | needs the Bug type or Bug Triage list removed | **P41** (production-parity phase) |

## 8. Coverage vs the plan

7 of the 8 checklist lines executed. Two probes were malformed and re-run: `report-bug` takes
`{steps, happened, reporter_team}` rather than `{title, description, bug_severity}`, and postmortem
`items` are booleans rather than free text.

The engineering module is well built — correct routing, a real severity-driven auto-assign tied to
the on-call view, precise incident-state guards, an upserting postmortem, and admin-only rotation
writes. Its only weakness is the shared one: two of its three write endpoints have no permission
gate.

**Evidence directory:** `testing/evidence/PHASE-29/` — 2 files.
