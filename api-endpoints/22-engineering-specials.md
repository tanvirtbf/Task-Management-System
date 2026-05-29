# §22 — Engineering specials

> Source: [API_DESIGN.md §22](../API_DESIGN.md#23-engineering-specials)

**3 endpoints.** Cross-team intake into the Engineering space, plus the Eng Home rollup and postmortem checklist on resolved incidents.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/eng/report-bug` | Any team submits a bug — auto-routes to Bug Triage list, auto-assigns to on-call | 🔐 | L | ☐ |
| 2 | GET | `/api/v1/eng/home` | Aggregated counts for the Engineering home page | 🔐 | M | ☐ |
| 3 | POST | `/api/v1/eng/incidents/:id/postmortem` | Submit / update the postmortem checklist on a resolved Incident task | 🔐 | M | ☐ |

## Dependencies

- §10 Tasks — #1 creates a task in the Bug Triage list.
- §21 On-call — #1 looks up the current on-call engineer to assign.
- §20 Sprints — #2 shows active sprint progress.
- Views: `v_open_bugs`, `v_active_sprint`, `v_current_on_call` all read here.

## Notes

- **#1 report-bug**: validate `reporter_team` against the enum (`ops|cs|inventory|listing|marketing|internal`). Apply SLA per severity (handled by §29 logic at task-create time).
- **#2 eng home**: response shape — `{openBugs: {S0, S1, S2, S3}, activeSprint, onCall, prsAwaitingReview, incidentCount}`. All aggregations should be a single round-trip to the DB (use the views).
- **#3 postmortem**: rejects if the task's `task_type_id != 'tt-incident'` or status is not in the `done`/`closed` group. The body shape is `{rootCause, impact, learnings, actionItems[]}`.
