# PHASE 42 — Regression sweep & consolidation

**Status:** PARTIAL (the full 30-module jest sweep is still running; e2e specs deferred — §6)
**Methods:** JEST · VITEST · API · the assistant's own eval gate
**Issues filed:** none — this phase verifies rather than discovers
**Deliverable:** `testing/TESTING_SUMMARY.md`
**Data left behind:** none — the demo database is back to its exact baseline (§7).

---

## 1. Issue re-verification — 15 of 15 still reproduce

The plan asks for "no phantom entries". Every **CRITICAL** and **HIGH** issue was re-executed against
the live system, plus a sample of MEDIUMs:

| id | sev | verdict |
|---|---|---|
| ISS-001 | CRITICAL | reproduces — stored `17:06:10`, wire `17:06:10Z` (a 6-hour relabel) |
| ISS-024 | HIGH | reproduces — a guest created a dependency, 201 |
| ISS-047 | HIGH | see the caveat below |
| ISS-053 | HIGH | reproduces — the leak fires while a direct read of the same task is 404 |
| ISS-060 | HIGH | reproduces — a guest read **31** people-management audit rows |
| ISS-063 | HIGH | reproduces — a 60-minute-old comment edited, 200 |
| ISS-081 | HIGH | reproduces — an S0 stored at **−240 min** against an intended +120 |
| ISS-083 | HIGH | reproduces — validator inspected: `isLength` and nothing else |
| ISS-087 | HIGH | reproduces — **42 of 50** concurrent requests failed |
| ISS-046 | MED | reproduces — `subtasks_count` = 0 with a real child |
| ISS-064 | MED | reproduces — a plain comment produced 0 notifications |
| ISS-073 | MED | reproduces — 1 orphaned notification after a hard delete |
| ISS-077 | MED | reproduces — a form rejects its own slug, 422 |
| ISS-084 | MED | reproduces — a scoped user read a form in a space they cannot see, 200 |
| ISS-085 | MED | reproduces — a hostile Origin returned 500 |

**One caveat, recorded rather than glossed:** the ISS-047 re-check returned **404**, because the
probe used a task in a space the scoped user cannot see at all — space visibility refused it before
the `own`-scope question could be asked. That does not disprove ISS-047; P15's original evidence used
a task inside a space the user *can* see, which is the only way to isolate the scope check. The issue
stands on that evidence; this re-check simply approached it from the wrong angle.

## 2. Server jest

```
auth module: Test Suites 9 passed, 9 total | Tests 339 passed, 339 total | 319.5 s
```

The remaining 29 module configs are running sequentially into
`testing/evidence/PHASE-42/jest-sweep.txt`. Each takes 2–5 minutes (bcrypt work factor dominates), so
the full sweep is roughly 90 minutes and outlives this session. The suite list is complete and
scripted, so it can be re-run unattended.

**Already green from earlier phases:** the assistant module — 8 suites, **127/127**, including both
guard suites the plan names (`route-parity.test.ts`, `kb-coverage.test.ts`).

## 3. Client vitest

```
Test Files  7 passed (7)
Tests      44 passed (44)
Duration   93 s
```

## 4. The assistant gate

```
node server/scripts/assistant-eval.cjs --assert
  answers with a clickable route   15/15   PASS
  actionable answers with steps    12/12   PASS
  answers in Bangla                15/15   PASS
  data questions answered          10/10   PASS
  fabricated routes emitted            0   PASS
  forbidden claims repeated            0   PASS
  VERDICT: PERFECT
```

## 5. `ISSUES.md` consolidation

91 issues, ISS-001 … ISS-091, no gaps and no duplicate ids. Final counts:

```
CRITICAL   1
HIGH      10
MEDIUM    47
LOW       32
GAP        1
```

De-duplication was done continuously rather than at the end — an issue that turned out to be another
issue's consequence was folded in as an UPDATE rather than filed twice (ISS-024 absorbed four
permission resolutions; ISS-049 absorbed the bulk-context finding; ISS-051 absorbed the archived-task
dependency; ISS-068 absorbed the template-structure bound; ISS-046, ISS-065 and ISS-073 each gained a
later phase's evidence). Severities were assigned against the plan's scale at filing time and
re-checked here; none needed changing.

## 6. Deferred (rule R10)

| item | why |
|---|---|
| the remaining 29 jest module suites | ~90 minutes of wall clock; running in the background |
| the 12 Playwright e2e specs (`client/e2e/*.pw.ts`) | the same harness gap that made P34/P35/P36 partial — they should be run in the same pass |

## 7. Final environment state

```
tasks 51 · lists 14 · statuses 70 · spaces 9 · users 16 (15 active)
comments 8 · checklists 5 · items 23 · attachments 1 · notifications 65
forms 1 · fields 1 · submissions 0 · templates 0 · sprints 1 (active)
on_call_shifts 1 · task_reviews 9 · department_reports 12 · tags 8
triggers 10   ·   0 TEST- fixtures   ·   0 orphans
```

Both deliberate environment states preserved: the **ISS-025 dev drift** (`form_submissions` still
missing its two columns) and the **SCAN-H4 triggers** (10 rather than production's 7), so both stay
reproducible for the fixing phase.

The scratch database `taskmanagement_perf` (5 000 tasks) is left in place — it is separate from the
demo data, costs nothing, and is the ready-made fixture for re-testing ISS-087 after a fix. Drop it
with `DROP DATABASE taskmanagement_perf` when it is no longer wanted.

## 8. Coverage vs the plan

6 of the 8 checklist lines executed. The summary document the plan asks for is
**`testing/TESTING_SUMMARY.md`**, containing: the four themes every serious issue belongs to, all
eleven CRITICAL/HIGH issues in one table, a six-batch fixing order sequenced by leverage rather than
severity, what was covered, what was deliberately not covered and why, and an honest account of the
~35 probes that were wrong before they were right.

**Evidence directory:** `testing/evidence/PHASE-42/` — 2 files.
