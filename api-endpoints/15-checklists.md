# §15 — Checklists

> Source: [API_DESIGN.md §15](../API_DESIGN.md#15-checklists)

**9 endpoints.** A task can have multiple checklists, each with a list of items. Single-level only — no nested checklists.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/tasks/:id/checklists` | All checklists + items for a task | 🔐 | S | ☐ |
| 2 | POST | `/api/v1/tasks/:id/checklists` | Create an empty checklist on a task | 🔐 | S | ☐ |
| 3 | PATCH | `/api/v1/checklists/:id` | Rename a checklist | 🔐 | S | ☐ |
| 4 | DELETE | `/api/v1/checklists/:id` | Delete a checklist (cascades to items) | 🔐 | S | ☐ |
| 5 | POST | `/api/v1/checklists/:id/items` | Add a single item | 🔐 | S | ☐ |
| 6 | POST | `/api/v1/checklists/:id/items/bulk` | Add many items in one go (template apply) | 🔐 | M | ☐ |
| 7 | PATCH | `/api/v1/checklist-items/:id` | Update item text / due / assignee | 🔐 | S | ☐ |
| 8 | POST | `/api/v1/checklist-items/:id/toggle` | Tick / untick the checkbox | 🔐 | S | ☐ |
| 9 | DELETE | `/api/v1/checklist-items/:id` | Remove an item | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks.
- DB tables: `checklists`, `checklist_items`. Trigger `trg_subtasks_*` maintains `tasks.subtasks_count` / `subtasks_completed` based on item state (yes, the trigger spans both subtasks and checklist items — a quirk of the schema, double-check this when implementing).

## Notes

- **#6 bulk** is the workhorse for §23 Templates — receives `[{text, dueOffsetDays?}, ...]` and inserts atomically.
- **#8 toggle** must update `tasks.subtasks_completed` (via the trigger, but verify after wiring).
- Toggling and editing → `task_activity` row.
