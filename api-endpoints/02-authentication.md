# §2 — Authentication

> Source: [API_DESIGN.md §2](../API_DESIGN.md#2-authentication)

**10 endpoints.** Mix of 🔓 public and 🔐 authenticated. Foundation for everything else — every protected endpoint needs the session + JWT machinery this group sets up.

Covers password login, refresh-token rotation, logout (single + all sessions), `whoami`, forgot/reset password, change password, and invitation acceptance.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/auth/login` | Email + password → access + refresh cookies | 🔓 | M | ☐ |
| 2 | POST | `/api/v1/auth/refresh` | Rotate refresh token, mint new access | 🔓 (refresh cookie) | M | ☐ |
| 3 | POST | `/api/v1/auth/logout` | Revoke the current session, clear cookies | 🔐 | S | ☐ |
| 4 | POST | `/api/v1/auth/logout-all` | Revoke every active session for this user | 🔐 | S | ☐ |
| 5 | GET | `/api/v1/auth/me` | Return the current user with workspace context | 🔐 | S | ☐ |
| 6 | POST | `/api/v1/auth/forgot-password` | Email a reset link (idempotent on unknown email) | 🔓 | M | ☐ |
| 7 | POST | `/api/v1/auth/reset-password` | Consume reset token, set new password | 🔓 (token) | M | ☐ |
| 8 | POST | `/api/v1/auth/change-password` | User changes their own password (current required) | 🔐 | S | ☐ |
| 9 | GET | `/api/v1/auth/invitations/:token` | Inspect an invitation token (used by signup page) | 🔓 (token) | S | ☐ |
| 10 | POST | `/api/v1/auth/invitations/:token/accept` | Accept the invitation, create user, log in | 🔓 (token) | L | ☐ |

## Dependencies

- DB tables: `users`, `sessions`, `password_reset_tokens`, `invitations`, `workspaces` — all already in place.
- Existing services: `TokenService` (JWT + sessions persistence), `CredentialService` (bcrypt). Reuse, don't replicate.
- Existing middlewares: `authStrictLimiter` (5/min/IP for `login` + `forgot-password`), `validateRefreshToken`, `parseRefreshToken`, `authenticate`.
- Will need: an email sender for #6 + #10 invitations. SMTP env vars exist; a `MailService` will need to be built once and reused.

## Notes

- **#2 refresh**: rotate the session — revoke old, persist new, mint both cookies with the new session id.
- **#6 forgot-password**: must respond with the same success body regardless of whether the email exists (user enumeration protection).
- **#10 invitation accept**: single transaction — create user, mark invitation accepted, issue login cookies, log activity.
- All cookie-setting endpoints must use `httpOnly`, `sameSite: "strict"`, and `secure` when `NODE_ENV === "prod"`.
