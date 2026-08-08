# PHASE 06 — Workspace

**Status:** PARTIAL (UI interaction deferred — §7)
**Methods:** API · DB · CODE
**Issues filed:** ISS-028, ISS-029 (MEDIUM)
**Data left behind:** none — the workspace row was backed up before the phase and diffed against the
backup afterwards: **identical**.

---

## 1. `GET /workspace` — PASS

```json
{"id","name","logo_url","timezone","default_locale","week_starts_on",
 "working_days","business_hours_start","business_hours_end","fiscal_year_start_month"}
```

Every DB column is exposed except `permissions_version`, which is correctly kept internal. No
wire-only fields. `working_days` is stored as a MySQL `SET` and correctly serialised as an **array**
on the wire.

## 2. `PATCH /workspace` — per-field

| field | result |
|---|---|
| `name` | 200, persisted |
| `logo_url` | 200, persisted |
| `timezone` | 200, persisted |
| `week_starts_on` | 200, persisted |
| `business_hours_start` / `_end` | 200, persisted |
| `fiscal_year_start_month` | 200, persisted |
| `working_days` | requires an **array** — a comma string is 422 (correct, my first payload was wrong) |
| `default_locale` | **422 `default_locale cannot be updated via this endpoint`** — read-only by design → ISS-028 |

## 3. Validation — 15 of 17 hostile inputs correctly rejected

All 422 `validation.failed`: empty name · 500-char name · `Not/AZone` timezone · empty timezone ·
`week_starts_on` = 7 / −1 / `"monday"` · `fiscal_year_start_month` = 13 / 0 ·
`business_hours_start` = `25:00:00` / `notatime` · `working_days` = `funday` ·
`default_locale` = `!!!` · `logo_url` = `javascript:alert(1)` · `logo_url` = `not-a-url`.

**No mass assignment.** Sending `id` or `permissions_version` returns 200 and the value is
**silently ignored** — neither the primary key nor the RBAC version can be written through this
endpoint. Verified against the DB before and after.

## 4. Business-hours invariant — PASS, including the hard case

| attempt | result |
|---|---|
| start `18:00` → end `09:00` | 422 `workspace.invalid_business_hours` |
| start `12:00` = end `12:00` | 422 `workspace.invalid_business_hours` |
| start `09:00` → end `18:00` | 200 |
| **start `20:00` alone**, with the stored end still `18:00` | **422** — DB unchanged at `09:00–18:00` |

That last one is the good one: the check validates the *resulting* state, not just the fields
present in the payload, so a one-sided PATCH cannot break the invariant.

## 5. Unknown / empty payloads

`{totally_made_up: 1}`, `{}`, and `{name:…, nope:true}` all return **200** and do **not** bump
`updated_at`. Unknown keys are ignored rather than rejected — consistent with ISS-014.

> Corrects a note in PHASE-04 §9: that phase suspected the `{bogus:1}` probe had bumped
> `updated_at`. Measured directly here, it does not.

## 6. Permission gate

`workspace.settings` was confirmed **ENFORCED** in P4 (member/guest 403) and again in P5's
enforcement probe (403 without the grant, 200 with it). Not re-tested.

## 7. Downstream consumption — the phase's main finding

A consumer grep across `server/src`, excluding the workspace module's own schema/validator/
serializer/repo/service/controller:

| setting | real consumers |
|---|---|
| `week_starts_on` | client calendar (`CalendarMonthGrid`, `CalendarView`, `date-utils`) — **used** |
| `working_days` | **none** |
| `business_hours_start` / `_end` | **none** |
| `fiscal_year_start_month` | **none** |
| `default_locale` | seed scripts only |

`computeSlaDueAt` (`TaskWriteService.ts:55-75`) is plain wall-clock arithmetic, so SLA deadlines run
straight through evenings and the Friday–Saturday weekend. Full write-up in **ISS-029**.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/workspace` UI: load, save, validation errors, optimistic vs server state | this phase was API + source level; the browser harness is set up once in the UI phases | **P36** |

The UI's *logic* was still checked statically and is what produced ISS-028 — the component renders
an editable locale control, `workspaceToWire` drops it, and the client payload was replayed against
the live API to confirm the page does still save (200) despite the omission.

## 9. Coverage vs the plan

4 of the 5 checklist lines executed; the UI-interaction line deferred to P36. Both findings are
"configured but not consumed" — the same theme as ISS-010/011 and M1.

**Evidence directory:** `testing/evidence/PHASE-06/` — 1 file.
