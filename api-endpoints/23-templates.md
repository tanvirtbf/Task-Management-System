# §23 — Templates

> Source: [API_DESIGN.md §23](../API_DESIGN.md#23-templates)

**6 endpoints.** Reusable task structures with pre-built checklists. Per FINAL_REQUIREMENTS.md §5.18, templates are workspace-wide; only `type: "task"` is in V1 scope (list and space templates are V2).

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/templates` | List templates with optional `?type=` filter | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/templates/:id` | Read a single template | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/templates` | Create a new template | 👑 | M | ☐ |
| 4 | PATCH | `/api/v1/templates/:id` | Update metadata / structure | 👑 | M | ☐ |
| 5 | DELETE | `/api/v1/templates/:id` | Delete a template (existing spawned tasks unaffected) | 👑 | S | ☐ |
| 6 | POST | `/api/v1/templates/:id/apply` | Spawn a task + checklist from the template | 🔐 | XL | ☐ |

## Dependencies

- §10 Tasks — #6 creates a task.
- §15 Checklists — #6 creates a checklist + items.
- §13 Task activity — #6 logs `created_from_template`.
- §8 Task types, §9 Tags — #6 validates the template's `taskTypeId` and `tags[]` exist.
- DB table: `templates` (added per FINAL_REQUIREMENTS — already in `database/schema.sql`).

## Notes

- **#3 create**: validate name unique per workspace, structure has ≥ 1 checklist item.
- **#4 update**: `type` is immutable. Editing structure does NOT retroactively change tasks already spawned — those keep their snapshot.
- **#6 apply**: single transaction. Compute `due_date = anchor_date + dueOffsetDays` for each item if `anchor_date` is supplied; else leave null. Increment `templates.usage_count`. Append `task_activity` row with `templateId` in context.
- Error codes: `template.not_found`, `template.duplicate`, `template.empty_structure`, `template.invalid_task_type`.
