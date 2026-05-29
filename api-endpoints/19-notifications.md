# §19 — Notifications

> Source: [API_DESIGN.md §19](../API_DESIGN.md#19-notifications)

**9 endpoints.** Per-user inbox feed with read/unread state, snooze, and preferences. The actual `notifications` row inserts happen as side effects of other endpoints (task created, comment mentioned, etc.) — these endpoints are read + state-management only.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/notifications` | Paginated feed (unread-first) | 🔐 | M | ☐ |
| 2 | GET | `/api/v1/notifications/unread-count` | Number of unread for the bell badge | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/notifications/:id/read` | Mark one read | 🔐 | S | ☐ |
| 4 | POST | `/api/v1/notifications/:id/unread` | Mark one unread | 🔐 | S | ☐ |
| 5 | POST | `/api/v1/notifications/mark-all-read` | Bulk mark every unread → read | 🔐 | S | ☐ |
| 6 | POST | `/api/v1/notifications/:id/snooze` | Push `snoozed_until` into the future | 🔐 | S | ☐ |
| 7 | DELETE | `/api/v1/notifications/:id` | Soft-delete a notification | 🔐 | S | ☐ |
| 8 | GET | `/api/v1/notifications/preferences` | Read this user's prefs | 🔐 | S | ☐ |
| 9 | PUT | `/api/v1/notifications/preferences` | Update per-notification-type prefs | 🔐 | S | ☐ |

## Dependencies

- DB table: `notifications`. Insertions live in many other endpoints (§14 mentions, §11 assignments, §10 status changes, §16 file finalize, §18 form submit, §28 jobs).
- Tied to §27 SSE — when a notification is inserted, the stream pushes it to any connected client for that user.

## Notes

- All mutation endpoints (#3-#7) check that `notification.user_id === req.auth.sub`. Cross-user mutation → `403 notification.not_owner`.
- Snooze worker (in §28 background jobs) flips snoozed rows back to unread when `snoozed_until <= NOW()`.
- Preferences are a JSON column on the user (or a small `user_notification_prefs` table — TBD when implementing). Default = all channel types on.
- Notification `type` enum: `assigned | mentioned | comment | status_change | due_soon | overdue | form_submitted | automation_failed | pr_review | incident_alert`. Do NOT add `reminder_due` — reminders are out of scope (FINAL_REQUIREMENTS §2).
