# PHASE 03 — Authentication

**Status:** PARTIAL (UI sub-items deferred — §9)
**Methods:** API · DB · CODE
**Issues filed:** ISS-015, ISS-016 (MEDIUM) · ISS-017, ISS-018 (LOW)
**Data left behind:** none — throwaway user and all its rows removed. Verified after the phase:
users 16 (baseline), `p3.*` users 0, invitations 1 (pre-existing), reset tokens 0, TEST- tasks 0.

> **Test-environment note:** this phase ran with `DISABLE_RATE_LIMIT=1`. The 5/min auth bucket makes
> a 40-case login matrix impossible otherwise, and P2 already verified every limiter exactly
> (`auth.rate_limited` at request 6, `Retry-After: 60`, per-user keying). Nothing in P3 depends on
> the limiter being active.

---

## 1. Login matrix — PASS (14 cases)

| case | result |
|---|---|
| valid owner | 200 |
| wrong password | 401 `auth.invalid_credentials` |
| unknown email | 401 `auth.invalid_credentials` — same code, no oracle |
| `OWNER@COMPANY.LOCAL` | 200 — email is case-insensitive |
| `"  owner@company.local  "` | 200 — email is trimmed |
| invited-but-not-accepted user | 401 — correctly cannot log in |
| empty body / missing password / null / numeric password | 422 |
| `email: ["..."]` array injection | 422 |
| `email: {$ne: null}` object injection | 422 |
| `email: "' OR 1=1 --"` | 422 |
| 5,000-char password | 422 (max-length validator fires before bcrypt) |

## 2. User-enumeration timing — PASS

Median wrong-password response, 8 samples each: **known email 57.1 ms · unknown email 57.9 ms
(ratio 0.99×)**. No timing oracle — the service does equivalent work for a missing user.

## 3. Login response + `bb_refresh` cookie — PASS

Body: `access_token`, `expires_in`, `user`. The user object carries no password/hash field
(checked by string search). One `Set-Cookie`:

```
bb_refresh=<jwt>; Max-Age=2592000; Path=/api/v1/auth; Expires=…; HttpOnly; SameSite=Strict
```
HttpOnly ✔ · SameSite=Strict ✔ · Path-scoped to `/api/v1/auth` ✔ · 30 days ✔ ·
`Secure` absent in dev, which is correct (P1 confirmed it appears under `NODE_ENV=prod`).

## 4. Token claims — PASS

```
access : {sub, role, workspaceId, id:<session>, iat, exp, iss:"task-management-server"}   TTL 900s = 15 min
refresh: {…same…, jti:<session>}                                                          TTL 2592000s = 30 days
```
Both HS256. The access token carries `role`, which is what makes role changes stale for up to the
token TTL — see §7.

## 5. JWT attack surface — 11 of 12 correctly rejected

| attack | result |
|---|---|
| expired (exp 1 h ago) | 401 `auth.expired_token` |
| `alg=none` | 401 `auth.invalid_token` |
| wrong signature | 401 |
| signed with the **refresh** secret | 401 |
| HS512 algorithm confusion | 401 |
| empty / `"undefined"` / `"null"` token | 401 |
| nonexistent `sub` (valid signature) | 404 `user.not_found` — the documented "unresolvable actor" path |
| **no `exp` claim** | **200 OK → ISS-016** |

## 6. `Authorization` header handling — PASS

`Bearer` / `bearer` / `BEARER` accepted; `Basic <jwt>`, `Token <jwt>`, a bare token, a
double-space `Bearer  <jwt>`, `Bearer undefined`, and an empty header are all rejected with
`auth.missing_token`. The scheme is pinned exactly as the code comments claim.

## 7. Refresh / session lifecycle — PASS

- Refresh issues a **new session id and a new cookie** — true rotation.
- Replaying the old refresh cookie → **401** (no replay window).
- Every failure mode → 401 `auth.invalid_refresh`: no cookie, empty cookie, garbage, tampered
  signature, and an *access* token presented as a refresh token.
- `expires_at` in the past → 401. Session row deleted → 401.
- **Logout:** 204, `revoked_at` set, live sessions 1 → 0, cookie cleared with an epoch `Expires`.
  Refresh afterwards → 401.
- **Logout-all:** 3 concurrent sessions → 0; all three refresh cookies → 401.

One behaviour recorded rather than passed: the **access token still works after logout** (→ ISS-018).

## 8. Invitation flow — PASS (end to end)

Tokens are stored as `sha256(token)` in `token_hash` — the raw token is never persisted. Good
practice, and it meant the phase injected a known hash to drive the flow deterministically.

| step | result |
|---|---|
| `POST /users/invite` | 201, user row + invitation row created, invitation email actually sent |
| `GET /auth/invitation/<valid>` | 200 |
| `GET /auth/invitation/<unknown>` | 404 `invitation.not_found` |
| `GET` with an expired invitation | 410 `invitation.expired` |
| `POST /auth/accept-invitation` with an expired token | 410 `invitation.expired` |
| `POST /auth/accept-invitation` valid | 200, access token issued, user status → `active` |
| replay the same token | 409 `invitation.already_accepted` |
| new user logs in | 200 |

## 9. Change-password — one failure (ISS-015)

| case | result |
|---|---|
| wrong current password | 422 `auth.incorrect_password` |
| new == current | 422 `auth.password_unchanged` |
| weak new (`abc`) | 422 `validation.failed` |
| empty new | 422 |
| valid change | 204; old password → 401, new password → 200 |
| **other sessions after the change** | **live sessions 4 → 4, other devices still refresh 200** |

## 10. Forgot / reset password — PASS

- Known and unknown email both return **202 with an identical empty body** — no enumeration oracle.
- Wrong token → 400 `auth.reset_token_invalid`; expired token → 400; **replayed token → 400**
  (single-use enforced).
- Valid reset → 204, login with the new password → 200.
- **Reset revokes every session: live 6 → 0**, and a pre-reset device's refresh → 401. This is the
  correct behaviour that change-password is missing.

## 11. Role change & deactivation

**Role change** — owner sets the user to `guest`:
- DB role updates immediately.
- The old access token still *claims* `member` until it expires (by design — `role` is a token
  claim).
- **`GET /auth/me` and `GET /me/permissions` both report the fresh DB role**, so the authoritative
  surfaces are not stale.

**Deactivation** — `POST /users/:id/deactivate`:
- 204, status `deactivated`, **live sessions → 0** (deactivation does revoke sessions).
- The already-issued access token still works — **but refresh is refused immediately (401)**, so the
  window is bounded at ≤ 15 minutes and cannot be renewed.
- A fresh login attempt → 401.

## 12. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| Does a *stale* role claim still pass a role-gated endpoint? | the probe used a malformed upload payload and returned 422 before reaching the gate; building the correct fixture belongs with the role matrix | **P4** |
| UI: reload keeps the session · logout clears store + query cache · a second tab follows · concurrent 401s trigger exactly one refresh | all four are browser-side; this phase was API-only | **P34** (real-time & session) and **P36** (shell) |

## 13. Coverage vs the plan

16 of the 17 checklist lines executed at the API layer; 4 UI lines deferred to their owning phases,
1 line deferred to P4. 12 passed outright, 4 produced findings.

**Evidence directory:** `testing/evidence/PHASE-03/` — 5 files.
