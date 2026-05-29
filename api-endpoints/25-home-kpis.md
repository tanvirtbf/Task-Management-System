# §25 — Home / KPIs

> Source: [API_DESIGN.md §25](../API_DESIGN.md#26-home-kpis)

**2 endpoints.** The numbers on the home page — 6 task-management KPIs (per FINAL_REQUIREMENTS §8) and an agenda for today.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/home/kpis` | 6 KPI tiles for the home page | 🔐 | L | ☐ |
| 2 | GET | `/api/v1/home/agenda` | Today's tasks for the agenda card | 🔐 | M | ☐ |

## Dependencies

- §10 Tasks (every KPI queries `tasks`).
- §29 SLA (`sla_breaches` KPI needs `tasks.sla_due_at`).
- View `v_breached_sla` for the SLA tile.

## Notes

- KPIs returned: `myTasks`, `dueToday`, `overdue`, `awaitingReview`, `openTeamTasks`, `slaBreaches`. Names must match the frontend's `HomeKpiSet` type exactly (camelCase). Each KPI carries `{label, value, valueDisplay, trend, trendDirection, isPositive, sparkline: number[7]}`.
- The sparkline is 7 daily counts ending today. Compute via 7 separate aggregate queries OR one grouped query with `GROUP BY DATE(created_at)`.
- All counts scoped to the user (where the spec says "my") or workspace (where it says "open team").
- Cache the response for 30s per user — these are heavy queries called often.
