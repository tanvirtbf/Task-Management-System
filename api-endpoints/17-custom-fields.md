# §17 — Custom fields

> Source: [API_DESIGN.md §17](../API_DESIGN.md#17-custom-fields)

**7 endpoints.** Per FINAL_REQUIREMENTS.md §5.11, exactly 6 field types are supported: `text | phone | money | date | dropdown | files`. Fields are scoped to workspace, space, or list.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/custom-fields` | All custom fields in the workspace | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/lists/:listId/custom-fields` | Fields that apply to a list (workspace + space + list scope) | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/custom-fields` | Create a new custom field | 👑 | M | ☐ |
| 4 | PATCH | `/api/v1/custom-fields/:id` | Update name / config / required / position | 👑 | M | ☐ |
| 5 | DELETE | `/api/v1/custom-fields/:id` | Delete a custom field (cascades to all values) | 👑 | M | ☐ |
| 6 | PUT | `/api/v1/tasks/:id/custom-fields/:fieldId` | Set a value on a task | 🔐 | M | ☐ |
| 7 | DELETE | `/api/v1/tasks/:id/custom-fields/:fieldId` | Clear a value | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks, §6 Lists.
- DB tables: `custom_fields`, `custom_field_options` (for dropdown choices), `task_custom_field_values`.
- The VIRTUAL `option_id_generated` column on `task_custom_field_values` powers "filter tasks where Dropdown = X" lookups via `idx_tcfv_option` — make sure your SET query uses the JSON path the column expects.

## Notes

- **#3 create** must validate `type` against the 6 supported values — reject anything else with `422 custom_field.unsupported_type`.
- **#6 set value** validates the value's shape matches the field's `type`:
  - `text` → `{text: string}` (respect max_length from config)
  - `phone` → `{text: string}` (validate format via `bd-phone` helper if `default_country=BD`)
  - `money` → `{amount: number, currency: string}`
  - `date` → `{date: ISO string}`
  - `dropdown` → `{option_id: string}` (must exist in `custom_field_options`)
  - `files` → `{attachment_ids: string[]}` (each must exist + belong to same workspace)
- Mutations → `task_activity` row.
