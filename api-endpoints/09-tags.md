# §9 — Tags

> Source: [API_DESIGN.md §9](../API_DESIGN.md#9-tags)

**4 endpoints.** Workspace-wide tags (per spec §5.10). Tags can be applied to any task in any space; no per-space scoping.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/tags` | List all tags in the workspace | 🔐 | S | ☐ |
| 2 | POST | `/api/v1/tags` | Create a new tag | 👑 | S | ☐ |
| 3 | PATCH | `/api/v1/tags/:id` | Update name / color | 👑 | S | ☐ |
| 4 | DELETE | `/api/v1/tags/:id` | Delete a tag — also removes from any task that had it | 👑 | M | ☐ |

## Dependencies

- DB table: `tags`, plus `task_tags` (cleaned up via FK ON DELETE CASCADE).

## Notes

- Tag name is `UNIQUE(workspace_id, name)` — duplicates return `409 tag.duplicate`.
- Delete cascades to `task_tags` automatically via the FK constraint — no manual cleanup needed.
- Each mutation → `workspace_activity` row.
