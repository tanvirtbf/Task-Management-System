# §4 — Users

> Source: [API_DESIGN.md §4](../API_DESIGN.md#4-users)

**8 endpoints.** Workspace member management. Admins invite, deactivate, and manage roles; members can read each other; everyone can read self via §2.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/users` | Paginated list of members in the workspace | 🔐 | M | ☐ |
| 2 | GET | `/api/v1/users/:id` | Read a single user | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/users/invite` | Create an invitation row + email link | 👑 | M | ☐ |
| 4 | PATCH | `/api/v1/users/:id` | Update display fields (name, avatar, timezone) | 🔐 (self) / 👑 | S | ☐ |
| 5 | PATCH | `/api/v1/users/:id/role` | Promote / demote between Member ↔ Admin | 🛡️ | S | ☐ |
| 6 | POST | `/api/v1/users/:id/deactivate` | Mark user `deactivated`, revoke all sessions | 👑 | M | ☐ |
| 7 | POST | `/api/v1/users/:id/reactivate` | Reverse #6 | 👑 | S | ☐ |
| 8 | POST | `/api/v1/users/:id/reset-password` | Admin-initiated reset (emails the user) | 👑 | M | ☐ |

## Dependencies

- §2 Authentication — `passwordResetTokens` and `invitations` tables, email flow.
- DB tables: `users`, `invitations`, `password_reset_tokens`, `sessions`.
- Workspace isolation: every query and write must scope by `JWT.workspaceId`.

## Notes

- **#5 role change**: Owner role cannot be assigned via this endpoint (there's only one Owner — the workspace creator). Only Member ↔ Admin transitions are valid.
- **#6 deactivate**: must invalidate every active session (`UPDATE sessions SET revoked_at = NOW() WHERE user_id = ?`).
- **#1 list**: support `?role=`, `?status=`, `?q=` query params + cursor pagination.
- Each mutation should write a `workspace_activity` row.
