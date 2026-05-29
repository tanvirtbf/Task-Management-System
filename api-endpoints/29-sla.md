# §29 — SLA management

> Source: [API_DESIGN.md §29](../API_DESIGN.md#32-sla)

**2 endpoints.** Wraps `tasks.sla_due_at` and the `v_breached_sla` view. SLA is a pure-task feature per FINAL_REQUIREMENTS §5.19.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/sla/breached` | Tasks past their SLA window that aren't done | 🔐 | M | ☐ |
| 2 | PATCH | `/api/v1/tasks/:id/sla` | Manually set or clear the SLA on a task (override) | 👑 | S | ☐ |

## Implicit SLA assignment (no endpoint — happens automatically)

The §10 task-create code is expected to set `sla_due_at` based on this hard-coded policy at creation time. Update this block whenever the spec changes — the same logic lives in the §22 `report-bug` flow.

| Task type / condition | SLA window |
|---|---|
| Complaint task | `created_at + 24h` |
| Bug, severity S0 | `created_at + 2h` |
| Bug, severity S1 | `created_at + 24h` |
| Bug, severity S2 | `created_at + 7d` |
| Bug, severity S3 | NULL (no SLA) |
| All other types | NULL |

When `bug_severity` is updated post-create (§10 PATCH), recompute `sla_due_at` UNLESS it was manually overridden via #2 (track with a separate `sla_override` column if needed — TBD).

## Dependencies

- §10 Tasks — `tasks.sla_due_at` is the column.
- View: `v_breached_sla`.

## Notes

- **#1 query params**: `?team=cs|engineering&severity=S0,S1`. Default = all breaches the caller can see.
- **#2 body**: `{sla_due_at: "2026-05-29T12:00:00Z"}` or `{sla_due_at: null}` to clear. Validate the timestamp is in the future (else `422 sla.invalid_due_at`).
- Both endpoints write a `task_activity` row when they change the SLA.
