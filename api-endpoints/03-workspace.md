# §3 — Workspace

> Source: [API_DESIGN.md §3](../API_DESIGN.md#3-workspace)

**2 endpoints.** Single-workspace API surface — the workspace is whatever the JWT's `workspaceId` claim points to. There's no "create workspace" endpoint here (workspaces are provisioned during owner signup / seeding).

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/workspace` | Return the current workspace's settings | 🔐 | S | ☐ |
| 2 | PATCH | `/api/v1/workspace` | Update workspace name / logo / timezone / business hours / etc. | 👑 | S | ☐ |

## Dependencies

- DB table: `workspaces` — single row keyed by `JWT.workspaceId`.
- Auth: §2 must be in place so middleware can attach `req.auth.workspaceId`.
- No FK or activity side effects.

## Notes

- The PATCH body is a partial — only fields actually supplied are updated. Validate each field that's present (e.g., `week_starts_on` between 0-6, `business_hours_start < business_hours_end`).
- Updates should write a `workspace_activity` row.
