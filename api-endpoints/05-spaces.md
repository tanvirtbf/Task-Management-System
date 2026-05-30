# §5 — Spaces

> Source: [API_DESIGN.md §5](../API_DESIGN.md#5-spaces)

**7 endpoints.** Spaces are the top-level grouping inside a workspace (one space per team). Soft-deletable via archive; hard-deletable by Admin only when empty.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/spaces` | List all spaces in the workspace | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/spaces/:id` | Read a single space | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/spaces` | Create a new space | 👑 | M | ☐ |
| 4 | PATCH | `/api/v1/spaces/:id` | Update name / description / icon / color | 👑 | S | ☐ |
| 5 | POST | `/api/v1/spaces/:id/archive` | Soft-delete (sets `archived_at`) | 👑 | S | ☐ |
| 6 | POST | `/api/v1/spaces/:id/unarchive` | Reverse #5 | 👑 | S | ☐ |
| 7 | DELETE | `/api/v1/spaces/:id` | Hard-delete (must be archived + empty) | 🛡️ | M | ☐ |

## Dependencies

- §2 Auth (every endpoint).
- DB tables: `spaces`, plus `lists` (to check empty-ness on delete).
- Tier 2 — recommended right afte/ y6r auth/users so Tier 3+ has spaces to put lists/tasks into.

## Notes

- Default-include archived rows on the list endpoint with `?include_archived=true`; otherwise `archived_at IS NULL`.
- Hard delete (#7) MUST refuse with `409 space.not_empty` if any non-archived list still references the space.
- Updates → `workspace_activity` row.
