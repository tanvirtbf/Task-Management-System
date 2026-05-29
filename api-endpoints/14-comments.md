# §14 — Comments

> Source: [API_DESIGN.md §14](../API_DESIGN.md#14-comments)

**4 endpoints.** Per-task comments with 1-level threading (replies). Soft delete only — no hard delete on comments.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/tasks/:id/comments` | All comments for a task (with replies nested) | 🔐 | M | ☐ |
| 2 | POST | `/api/v1/tasks/:id/comments` | Add a comment or reply | 🔐 | L | ☐ |
| 3 | PATCH | `/api/v1/comments/:id` | Edit comment body (own only, < 15 min after create) | 🔐 (own) | M | ☐ |
| 4 | DELETE | `/api/v1/comments/:id` | Soft-delete (own, or admin) | 🔐 (own) / 👑 | S | ☐ |

## Dependencies

- §10 Tasks.
- DB table: `comments`. Replies use `parent_comment_id`. Trigger `trg_comments_*` maintains `tasks.comments_count`.

## Notes

- **#2 create**: detect `@mentions` and `#TASK-ID` references in the body. Each mention fires a `mentioned` notification to the user; each cross-task reference is logged in `task_activity` for both tasks.
- Replies (`parent_comment_id NOT NULL`) cannot themselves have replies — 1-level only. Validate in #2.
- Edit window (15 min) is configurable in env; after the window the endpoint returns `403 comment.edit_window_expired`.
- Deleted comments stay in the DB with `deleted_at` set, but the body must not be returned to the API — render as `[deleted]`.
