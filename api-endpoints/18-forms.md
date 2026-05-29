# §18 — Forms

> Source: [API_DESIGN.md §18](../API_DESIGN.md#18-forms)

**11 endpoints.** Public-facing intake forms that create a task when submitted. Each form maps fields to task attributes or custom fields and lives at a `publicSlug` URL.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/forms` | List all forms in the workspace | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/lists/:listId/forms` | Forms attached to a specific list | 🔐 | S | ☐ |
| 3 | GET | `/api/v1/forms/:id` | Read a single form definition (admin view) | 🔐 | S | ☐ |
| 4 | POST | `/api/v1/forms` | Create a new form | 👑 | M | ☐ |
| 5 | PATCH | `/api/v1/forms/:id` | Update form metadata / settings / branding | 👑 | M | ☐ |
| 6 | DELETE | `/api/v1/forms/:id` | Delete a form (cascades to fields + submissions) | 👑 | M | ☐ |
| 7 | POST | `/api/v1/forms/:id/fields` | Add a field to the form | 👑 | M | ☐ |
| 8 | PATCH | `/api/v1/form-fields/:id` | Update a field | 👑 | S | ☐ |
| 9 | DELETE | `/api/v1/form-fields/:id` | Remove a field | 👑 | S | ☐ |
| 10 | PATCH | `/api/v1/forms/:id/fields/reorder` | Reorder fields in bulk | 👑 | M | ☐ |
| 11 | GET | `/api/v1/forms/:id/submissions` | List submissions for a form | 🔐 | M | ☐ |

## Also under §18 — public submission endpoint (not numbered above because it's not in the §18 table)

| Method | Path | Purpose | Auth | Size |
|---|---|---|---|---|
| POST | `/api/v1/public/forms/:slug/submit` | Submit a form from the public web — creates a task | 🔓 | L |

## Dependencies

- §6 Lists — every form is attached to a list.
- §10 Tasks — submission creates a task.
- §17 Custom fields — form fields can be `field_kind: 'custom_field'`.
- DB tables: `forms`, `form_fields`, `form_submissions`.
- Public submit must use `publicFormLimiter` (30/min/IP).

## Notes

- **Public submit** is the only `🔓` endpoint in this group — it must rate-limit aggressively (already wired in middleware).
- Validate each field's value against its `fieldKind`:
  - `task_attr` → matches a field on the task model (`name`, `description`, etc.)
  - `custom_field` → resolve `fieldKey` to a `custom_fields` row and validate per §17.
- Submission must run in a transaction: insert task → insert form_submission row → fire `form_submitted` notification to form's notification recipients.
- Per FINAL_REQUIREMENTS.md §13 Q1, the cross-team intake form mechanism is generic — no auto-populate of customer data.
