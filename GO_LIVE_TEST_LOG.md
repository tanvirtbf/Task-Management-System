# GO-LIVE TEST LOG — BeautyBooth Task Management (astro-app)

Companion to `GO_LIVE_TEST_PLAN.md`. One section per phase run. Severity: BLOCKER / HIGH / MEDIUM / LOW.

---

## Phase 0 — Test environment isolation & baseline

**Status: ✅ PASSED** (2026-07-11)

### Environment facts established
- `astro-app/.dev.vars`: `NODE_ENV=dev` (real Mail/R2 behavior + rate limiters ACTIVE in local dev), `FRONTEND_URL=http://localhost:4321`, DB URL is a remote managed Turso instance.
- Docker Desktop: installed (WSL `docker-desktop` distro present) but daemon not running.
- Turso CLI: **no native Windows binary exists** (Darwin/Linux only; PS installer 404; no scoop). Dashboard/API are the only DB-creation routes on this machine.
- Playwright 1.60 available via `client/` node_modules.
- Astro dev server binds **IPv6 `::1` only** on this machine — use `http://localhost:4321` (or `[::1]`), NOT `127.0.0.1` (connection refused), in all test scripts.
- `@astrojs/cloudflare` adapter logs a `SESSION` KV-binding warning at dev startup (sessions auto-enabled, binding absent from wrangler.jsonc). No runtime error observed — WATCH item; app does not use Astro sessions.
- ⚠️ Runtime-fidelity caveat: `astro dev` runs the backend in **Node** (Vite SSR), not workerd. Fine for functional phases; Workers-specific phases (33 SSE limits, 38 scheduled handler, 46 prod) must also use `npm run preview` (build + `wrangler dev` = real workerd) or the deployed worker.

### Issue P0-1 — `astro dev` broken on every backend request (FIXED)
- **Severity:** HIGH (dev-mode only; production build unaffected — esbuild handles CJS interop, Vite dev module-runner does not)
- **Symptom:** every `/api/*` + `/health` request → 500 Vite SyntaxError: `Named export 'verify' not found. The requested module 'jsonwebtoken' is a CommonJS module...`
- **Root cause:** named ESM imports from CJS `jsonwebtoken` in `src/server/services/TokenService.ts` (`{ JwtPayload, sign }`) and `src/server/services/AuthService.ts` (`{ verify, type JwtPayload }`). `astro dev` had never been exercised (original verification used build+deploy), so this was latent.
- **Fix:** default-import + destructure (`import jsonwebtoken, { type JwtPayload } from "jsonwebtoken"; const { sign } = jsonwebtoken;`) in both files. Behavior identical in dev and build.
- **Re-verify:** `/health` → 200 `{"status":"ok"}`; full login flow works (marker test below). `express-validator` named imports (~35 files) are fine — cjs-module-lexer resolves them.
- **server/ parity:** old stack unaffected (CJS transpilation). No action there.

### Marker test — .dev.vars DB identity (CONFIRMED SAME AS PROD)
- Method: created tag `QA-MARKER-P0-8gsxi6` via LOCAL api → **visible on PROD api immediately** → deleted via LOCAL (204) → gone from PROD.
- **VERDICT: local `.dev.vars` points at the PRODUCTION Turso DB.** No destructive testing permitted until the swap below is complete.
- Residual footprint on prod: the tag was created+deleted (clean); 2 owner sessions created (1 via local login, 1 via prod login — harmless, session-cleanup-eligible); possible `workspace_activity` audit rows for tag create/delete (no delete API — left in place, cosmetic).

### Isolation steps completed
- `.dev.vars` backed up → `astro-app/.dev.vars.prod.bak` (RESTORE = copy back over `.dev.vars`, restart dev server).
- `astro-app/.gitignore` extended with `.dev.vars.*` (backup files can never be committed).

### Test DB — final route taken: local sqld in Docker
User initially chose managed-Turso-dashboard but then said "continue" without supplying creds → autonomous fallback to Docker (Docker Desktop was installed but stopped):
- Started Docker Desktop; ran **`ghcr.io/tursodatabase/libsql-server:latest`** as container **`beautybooth-test-db`**, port **8880→8080**, volume `beautybooth_test_db:/var/lib/sqld`, `--restart unless-stopped`. Verified Hrana-over-HTTP with the app's own `@libsql/client/web` (`select 1`; sqlite 3.47.0).
- `.dev.vars` swapped: `TURSO_DATABASE_URL=http://localhost:8880`, `TURSO_AUTH_TOKEN=local-test` (dummy — local sqld runs authless). Prod values live in `.dev.vars.prod.bak`.
- **Fidelity note:** same engine as Turso (sqld) but no network latency / Turso platform limits — acceptable for functional phases; Phases 33/38/46 use `npm run preview` (workerd) and/or the deployed worker. Switching to a managed Turso test DB later = paste URL+token → swap `.dev.vars` → re-run provisioning (~3 min).

### Provisioning (test DB)
`npx drizzle-kit push --force` (clean apply on fresh DB) → `npx tsx scripts/apply-post-sql.ts` (**32 statements**: 11 triggers + 5 views) → `npm run db:seed` (workspace + owner + 6 task types) → `npx tsx scripts/seed-demo.ts` (**1,958 rows**: 6 spaces, 16 lists, 64 statuses, 12 tags, 3 sprints, 396+40 tasks, 439 assignees, 90 comments, 25 checklists, 4 on-call weeks, 45 notifications, 2 invitations).

### Baseline smoke — ALL GREEN (10/10)
/health 200 · /health/ready 200 · login owner + token · /spaces=6 · /tags=12 · /spaces/:id/lists=3 · /lists/:id/tasks 200 `{data:[…]}` · /tasks/my-work 200 · SPA shell `#root` 200 · unauthenticated /spaces → 401.

### Environment recipe for every later phase
1. Docker Desktop running (container `beautybooth-test-db` auto-starts with it; check `docker ps`).
2. `cd astro-app && npm run dev` → http://localhost:4321 (IPv6 — use `localhost`, never `127.0.0.1`).
3. Logins: owner@company.local / Owner@12345; demo users / Test@12345.
4. **RESTORE PROD CONFIG:** `cp .dev.vars.prod.bak .dev.vars` + restart dev server. (Deploys are unaffected — prod secrets live in Cloudflare, not in `.dev.vars`.)

### Exit checklist
- [x] Prod proven untouched (marker cleaned; test DB is a separate local server)
- [x] Test DB fully provisioned + seeded
- [x] Baseline smoke green
- [x] Issue P0-1 fixed + re-verified
- [x] Log created; restore path documented

### ⚠️ AMENDMENT (found during Phase 1) — Issue P0-2: port-collision zombie (process defect, RESOLVED)
- The Phase-0 dev-server restart did NOT get port 4321: the pre-swap (prod-connected) server survived as a zombie holding 4321, and the new test-DB server silently bound **4322** ("Port 4321 is in use, trying another one"). Original Phase-0 smoke + first Phase-1 run therefore hit the PROD-connected server — undetected because prod and test DB carry identical seed-demo counts.
- **Prod impact: NONE destructive** — all polluted traffic was read-only (health/GETs/logins). Footprint: a few extra owner `sessions` rows on prod (session-cleanup-eligible), zero data writes.
- **Detection:** Phase 1's DB-down test returned live data with the test DB stopped — impossible under isolation.
- **Resolution:** killed both node trees, started ONE fresh server on 4321, then ran a **definitive isolation probe**: `docker stop beautybooth-test-db` → `/health/ready` **503** → `docker start` → **200** (no server restart). Phase-0 smoke re-run on the genuine test server: 10/10 green.
- **RUNBOOK RULE (mandatory from now on):** every phase starts with (1) exactly one dev server listening — check for the port-collision line in its startup log, and (2) the docker-stop isolation probe (ready must flip 503→200). Never trust data-shape equality as isolation evidence.

---

## Phase 1 — Health, diagnostics & boot

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 55 automated checks green (45 Part A + 10 Part B)

### Covered
- **GET /health (liveness):** 200 `{status:"ok",uptime}`; JSON content-type; works with DB fully down (independence proven); uptime monotonic.
- **GET /health/ready:** 200 `{status:"ready",checks:{database:"ok"}}` (365ms first-hit, warm <50ms); **DB down → 503 `{status:"not_ready",checks:{database:"down"}}` in 35ms** (well inside the 500ms ping budget); recovers to 200 after DB returns WITHOUT server restart.
- **GET /health/version:** `{version:"1.0.0", git_sha:"unknown" (GIT_SHA unset in dev — absent-tolerant OK), uptime_seconds:int, node:"v22.21.1"}`.
- **GET /metrics:** exact content-type `text/plain; version=0.0.4; charset=utf-8`; trailing newline; HELP+TYPE for all 7 families; `sse_connections_open 0`; `mysql_pool_connections_in_use` correctly ABSENT (guarded getPool throw on libSQL); process gauges present.
- **Counters live:** `/api/v1/tags/` requests_total +3 and histogram count +3 after exactly 3 hits; bucket lines present.
- **Route-label cardinality:** `GET /tasks/<real-id>` recorded as `route="/api/v1/tasks/:id"` — raw id appears NOWHERE in the exposition; 404s collapse to `(unmatched)`. (Note: router-root routes render with a trailing slash, e.g. `/api/v1/tags/` — Express `baseUrl + "/"` semantics, identical in the old stack; first test run flagged it, corrected as a TEST-side assertion, not an app bug.)
- **Request-id contract:** auto `req_<uuid>` when absent; custom `X-Request-Id` echoed on response AND inside the error envelope (`error.request_id`) on a 404; >200-char incoming id rejected → fresh `req_*`.
- **Limiter exemption:** `/api/v1/*` responses carry draft-6 `RateLimit-Limit: 600`/`Remaining`/`Reset`; `/health`, `/health/ready`, `/health/version`, `/metrics` carry none (outside apiLimiter as designed).
- **DB-down API behavior:** authed `/api/v1/tags` → clean 500 JSON envelope `error.code="internal"` + request_id, no stack leak, server stays healthy afterwards.

### Watch items (deferred by design)
- Turso cold-start 503 on first `/health/ready` cannot reproduce on local sqld (instant ping) → quantify on the deployed worker in **Phase 46**.
- `process.uptime()`/`memoryUsage()` inside `/metrics` + `/health/version` on real workerd (nodejs_compat shims) → verify in **Phase 38/46** (`npm run preview`).
- `sse_connections_open` gauge movement → **Phase 33**.

### Exit criteria: MET (all 4 endpoints correct incl. error paths; metrics counters verified moving)

---

## Phase 2 — Auth: login, sessions, refresh rotation

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 62 automated checks green (2 test-harness fixes, no code changes)

### Preflight (mandatory runbook)
Killed stale node listeners → single dev server on :4321 (no port-collision line) → isolation probe: `docker stop` → /health/ready **503**, `docker start` → **200**. Genuine test-DB confirmed before any auth writes.

### Covered — all green
**A. Login matrix:** owner + demo member/admin login 200 `{access_token, expires_in:900, user}`; **no password hash/field leaked** in user payload; wrong password → 401 `auth.invalid_credentials`; **unknown email → identical 401 code AND message (no user enumeration oracle)**; empty body / malformed email → 422 `validation.failed`.
**A. ciText case-insensitivity:** `OWNER@COMPANY.LOCAL` and `Owner@Company.Local` both log in 200 (email COLLATE NOCASE parity with MySQL).
**B. Refresh cookie contract (`bb_refresh`):** HttpOnly ✓, SameSite=Strict ✓, Path=/api/v1/auth (scoped so it's only sent to /auth/*) ✓, **Secure correctly ABSENT in dev** (NODE_ENV=dev, no FORCE_SECURE — will be Secure in prod) ✓, Max-Age=2592000 (30d) ✓, refresh is a distinct JWT ≠ access token ✓.
**C. /auth/me + JWT tampering (all → 401, never 500):** valid token 200 returning the same user id; no token 401; garbage `abc.def.ghi` 401; non-Bearer scheme 401; **wrong-signature JWT 401**; **expired JWT (signed with the REAL secret) 401**; **`alg:none` forgery rejected 401** (algorithm whitelist holds).
**D. Refresh rotation + reuse detection (RTR):** valid refresh → 200 with a NEW access token AND a NEW rotated cookie; **replay of the OLD cookie → 401 `auth.invalid_refresh` AND triggers mass-revoke** — the just-rotated cookie is then ALSO 401 (theft response revokes every session for the user); no-cookie / garbage / forged-signature refresh all → 401.
**E. Logout / logout-all:** logout → 204 + `bb_refresh` cleared (`Expires=Thu, 01 Jan 1970`), and that session's refresh → 401; logout-all across 3 concurrent sessions → 204 and all 3 refresh cookies → 401.
**F. Deactivated user:** owner deactivates member (204) → login → 401 with the **generic `auth.invalid_credentials`** (no "account disabled" state leak) → the member's pre-existing session refresh also → 401 → reactivate → login 200 again. (Verifies deactivation both blocks new logins and kills live sessions.)
**G. Auth rate limiter (security, observed working):** 5 attempts/min/IP on /auth/login — 6th+ from one IP → 429 `auth.rate_limited`; first 5 not throttled; a different IP is unaffected (per-IP bucket isolation). Full limiter sweep (all buckets, reset windows) deferred to Phase 39.

### Test-harness notes (NOT app bugs)
- The 5/min authStrictLimiter is ACTIVE in dev (only NODE_ENV=test disables it). Functional matrix runs each distinct scenario from a unique `CF-Connecting-IP` (the shim derives `req.ip` from that header) so legitimate multi-login tests aren't throttled — accurate simulation of distinct clients, not a bypass.
- Two harness fixes during the run: cookie parser must accept empty-value clear-cookies (`[^;]*`); the limiter sub-test needs a per-run-unique IP so a prior run's 60s window doesn't bleed in. Both were test-script issues; app behavior was correct throughout.

### Watch / deferred
- PBKDF2 (WebCrypto) password verify works for all seeded users (login succeeded) — hashing internals covered further in Phase 3 (change-password).
- Cookie `Secure` flag under real prod (NODE_ENV=prod) → confirm on deployed worker in Phase 46.
- Full rate-limit matrix (every bucket + RateLimit-* reset headers) → Phase 39.

### Exit criteria: MET — full session lifecycle correct incl. rotation + reuse detection; zero 500s from hostile tokens.

---

## Phase 3 — Auth: password flows (forgot / reset / change)

**Status: ✅ PASSED (code)** (2026-07-11) · **App code bugs: 0** · 38 automated checks green · **1 operational finding (P3-1, HIGH for go-live)**

### Method note
Reset-token raw value is emailed + DEBUG-logged only (DB stores `sha256` only, LOG_LEVEL=info). To test the reset flow deterministically without Mailtrap read-access, tokens were inserted directly into `password_reset_tokens` with a known raw value (exercises the real `/auth/reset-password` endpoint: validation, consume, password update, session revoke). All touched demo passwords restored to `Test@12345` in a `finally` block (verified logging in again). Each strict-limited call used a unique CF-Connecting-IP.

### Covered — all green
**A. forgot-password (enumeration-safe):** active user → 202 `{}` and exactly ONE active token row created; second forgot → still 202 and prior token invalidated (still exactly 1 active — invalidate-prior+insert-new works); **unknown email → identical 202 `{}`** (no enumeration); **deactivated user → 202 but ZERO tokens issued** (no email); missing/malformed email → 422.
**B. reset-password (token lifecycle):** garbage / expired / consumed tokens all → **400 `auth.reset_token_invalid`** (single generic code — no validity oracle); weak password (<8) → 422 (validation before token check); valid token → 204, **new password works + old password rejected + prior session revoked** (refresh 401); **same token again → 400 (single-use enforced)**.
**C. change-password (authenticated):** no token → 401; wrong current → 422 `auth.incorrect_password`; new==current → 422 `auth.password_unchanged`; weak new → 422; valid → 204, new works + old rejected; **a second concurrent session stays valid** (V1 design: self-initiated change does NOT globally sign out — confirmed intentional).

### 🔴 Issue P3-1 — Email delivery BLOCKED by Mailtrap free-tier daily quota (HIGH for go-live; operational/config, NOT a code bug)
- **Observed:** every real send this session returned **HTTP 403 `{"success":false,"errors":["Your account has reached its daily sending limit. ... retry in 17h..."]}`**. `mail.sent` success count = 0.
- **What this proves about the CODE (all correct):** `MailService` makes the real Mailtrap REST call, the `Api-Token` (MAIL_PASSWORD) authenticates (403 is quota, not 401 auth — so creds are valid), the request body is well-formed, and `AuthService.forgotPassword` correctly **swallows + logs** the failure so the endpoint still returns 202 (no 500, no enumeration leak). Error handling is exactly right.
- **The operational problem:** with the quota exhausted, **password-reset and invitation emails are silently NOT delivered.** A real user clicking "forgot password" gets 202 and no email. This is precisely a "user hits an issue" scenario for go-live.
- **These tests used the LIVE prod Mailtrap account** (only TURSO_* were swapped to the test DB; MAIL_* remain the real prod creds) — so the quota consumed is the production account's. The account was already at its limit before/independent of these few sends.
- **Required before go-live (Phase 47 gate):** decide + implement one of — (a) upgrade the Mailtrap plan to a quota that covers expected reset+invite volume for ~100 users; (b) confirm the free-tier daily quota is genuinely sufficient and monitor it; (c) switch the transport to another provider. ALSO consider (code, optional): surface a monitorable signal/alert when sends fail, since the current fail-open is silent (ties into the R2/Mail silent-fail finding from the full scan). Positive end-to-end inbox delivery could NOT be confirmed this run because the quota is exhausted (prior sessions confirmed it delivers when quota is available).

### Watch / deferred
- Invitation email delivery (same transport, same quota risk) → Phase 4.
- Whether a failed INVITATION send should be surfaced to the admin (a broken invite is worse than a silent forgot) → evaluate in Phase 4.
- Positive inbox-receipt confirmation → retry when Mailtrap quota resets, or after a plan decision (Phase 46/47).

### Exit criteria: MET for code behavior (reset via token verified end-to-end; all edges correct). Operational finding P3-1 logged and escalated to the go-live checklist.

---

## Phase 4 — Auth: invitations lifecycle

**Status: ✅ PASSED (code)** (2026-07-11) · **App code bugs: 0** · 41 automated checks green · confirms P3-1 extends to invites; 1 new secondary observation (P4-1, MEDIUM)

### Method
Invite rows created via the REAL `POST /users/invite` (exercises the invited-user + invitation + activity transaction). Accept flow needs the raw token (email-only), so after creation the invitation's `token_hash` was swapped to `sha256(knownRaw)` in the DB and the real `POST /auth/accept-invitation` was called. All QA users used `qa-invite-<rand>-*@qa.test` and were fully deleted (users + invitations + sessions + activity) in a `finally` block — verified 0 QA rows remain.

### Covered — all green
**A. Invite endpoint:** owner invites → 201 with `status:"invited"`; invited user row has **empty password hash** and **cannot log in (401)** before acceptance; invitation row + `workspace_activity` "invited" event written; **member → 403** (admin/owner only) and no user created; no token → 401; inviting an existing ACTIVE email → 409 `user.email_already_exists`; **re-inviting a still-pending email → 409**; validation — `role:"owner"` → 422 (can never mint a 2nd owner), bad email → 422, missing first_name → 422, `role:"guest"` → 201.
**B. GET /auth/invitation/:token:** valid → 200 `{email, role, workspace_name:"BeautyBooth"}` with **no token/hash leaked**; garbage → 404 `invitation.not_found`; expired → 410 `invitation.expired`. (Distinct codes here are intentional — the token holder owns the link, so it's a UX win, not an enumeration risk, unlike password-reset.)
**C. Accept-invitation:** weak password → 422; garbage → 404; expired → 410; valid → **200 with auto-login (access_token + bb_refresh cookie)**, user flipped to `active`, logs in with the new password; **same token again → 409 `invitation.already_accepted` (single-use)**; GET on the consumed invitation → 409.

### P3-1 confirmed for invitations
The invites above made real Mailtrap sends: **3 `users.invite.email_failed`, 0 `mail.sent`** — same free-tier daily-quota 403. Invite endpoint correctly returns 201 (fail-open, like forgot-password). Same go-live requirement as P3-1.

### 🟠 Issue P4-1 — No invitation RESEND path (MEDIUM; robustness, surfaces because of P3-1)
- If an invitation email fails to send (currently 100% of the time due to the exhausted quota), the admin gets 201 "success" but **the invitee never receives the link AND the admin cannot resend** — re-inviting the same pending email returns 409 `user.email_already_exists`. The only recovery today is to delete/hard-remove the invited user row and invite again (no self-service, no UI for it).
- **Impact:** with mail working, invites deliver on the first try and this is a rare edge (transient send failure). With mail broken (P3-1), EVERY invite is stuck. So fixing P3-1 (quota) resolves the common case; a dedicated resend/regenerate-token endpoint would close the transient-failure gap.
- **Recommendation:** primarily fixed by P3-1. Optionally add a resend (re-mint token + re-email) for a pending invitation, or allow re-invite of a `status=invited` email to regenerate+resend rather than 409. Log as an OPEN-DECISION for the go-live checklist (bundle with the P3-1 mail decision).

### Exit criteria: MET for code behavior — full invite→GET→accept→login journey correct incl. every token edge + single-use. Email-delivery + resend items tracked under P3-1/P4-1.

---

## Phase 5 — Users, roles & member administration

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 55 automated checks green · all role/status/profile mutations restored (verified touched users log in with Test@12345)

### Covered — all green
**A. GET /users + GET /users/:id (any member):** `{data:[], pagination:{next_cursor, has_more, total_estimate}}` envelope; 15 demo users; **no password field in any row**; filters `?status=active`, `?role=admin` (returns the 2 admins, owner-role excluded), `?q=rakib`; `?limit=5` + opaque cursor → page 2 has **zero overlap** with page 1; invalid `?status=bogus` / `?limit=-1` → 422; self by-id 200; nonexistent id → 404 `user.not_found`; no token → 401; a plain member CAN list/get.
**B. PATCH /users/:id/role (👑 admin/owner):** member caller → 403 (canAccess); owner promotes member→admin → 200 (DB confirms); **admin demotes admin→member → 200** (admins may manage other admins — design choice, confirmed working); member→member no-op → 200; **owner-protection: admin changing OWNER role → 403 `user.cannot_change_owner_role`**; **self-guard: admin changing OWN role → 403 `user.cannot_change_own_role`**; `role:"owner"` → 422 (can never mint a 2nd owner); nonexistent → 404; bad role value → 422.
**C. PATCH /users/:id profile (🔐 self / 👑 admin):** member edits OWN → 200 (DB confirms); **member edits ANOTHER → 403 `user.forbidden_edit`**; admin edits another → 200; **privilege-escalation blocked: sending `role`/`status` in the profile PATCH body is IGNORED** (role/status unchanged — profile edit can never escalate); email → existing address → 409; no token → 401.
**D. deactivate/reactivate (👑 admin/owner):** member caller → 403; owner deactivates → 204, status flips, **login blocked + prior refresh session revoked** (atomic); re-deactivate → 204 idempotent; **owner can never be deactivated → 403 `user.cannot_deactivate_owner`**; **admin cannot deactivate self → 403 `user.cannot_self_deactivate`**; reactivate → 204, active + login works; reactivate already-active → 204 no-op; nonexistent → 404.
**E. admin reset-password (👑 admin/owner):** member caller → 403; owner resets active member → 202 and mints **exactly 1** active reset token (prior invalidated); nonexistent → 404; **non-active (deactivated/invited) target → 409 `user.not_active`** (the actual password change happens on the shared /auth/reset-password consume endpoint, verified in Phase 3).

### Observations (by design, not bugs)
- **Admins can manage other admins** (demote, deactivate, reset). Only the single `owner` is protected. Standard admin-panel model; flagged for awareness, not a defect. There is exactly one owner and the owner role is immutable via the API, so the workspace can never be orphaned or gain a second owner.
- **Self-guards** consistently prevent lockout: you cannot change your own role, deactivate yourself, or reactivate yourself.
- Admin reset-password uses the same Mailtrap transport → subject to the P3-1 quota (the emailed link won't deliver until P3-1 is resolved; the token is still minted correctly, and an admin could read/forward it if needed).

### Exit criteria: MET — role/permission matrix documented & correct; no privilege-escalation path; owner protections and self-guards all enforced; zero 500s.

---

## Phase 6 — Workspace settings

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 46 automated checks green · original workspace settings restored

### Covered — all green
**A. GET /workspace (any member):** 200 with all fields present (`id, name, timezone, week_starts_on, working_days[], business_hours_start/end HH:MM:SS, fiscal_year_start_month, logo_url`); workspace-scoped from JWT claim (no client id); no token → 401; member can read.
**B. PATCH permissions:** member → 403 (canAccess admin/owner); no token → 401; admin CAN patch.
**C. Valid updates:** all fields applied + echoed + **persisted** (fresh GET matches); **partial PATCH changes only the given field, leaves others intact**; `logo_url` set to URL, then `null` clears it; empty body → 200 no-op.
**D. Validation (422):** invalid IANA timezone (`Mars/Phobos`), empty/whitespace name, name >120, `week_starts_on` 7 and -1, bad `working_days` member, non-array `working_days`, malformed `business_hours` (`9am`), `fiscal_year_start_month` 13 and 0, non-http `logo_url` (`javascript:` blocked), and **`default_locale` present → 422** (explicitly not updatable).
**E. Cross-field business hours:** start≥end (both supplied) → 422 `workspace.invalid_business_hours`; **partial update where the new end is earlier than the CURRENT stored start → 422** (the merged-pair CHECK is enforced against current+patch, so a partial update can't slip an inconsistent pair past it); start==end → 422.
**F. Audit trail:** a successful PATCH writes exactly one `workspace_activity` (entity_type=workspace, action=updated) row; **a failed (422) PATCH writes NO audit row** (validation happens before the transaction).

### Notes
- Timezone validated via `Intl.DateTimeFormat` (real IANA check) — works under Node dev; `Intl` is available on workerd too (re-confirm in Phase 46 if any timezone-dependent behavior looks off).
- `working_days` enum = `sun,mon,tue,wed,thu,fri,sat`; demo workspace ships `week_starts_on=6` (Saturday) + Sun–Thu working days + 09:00–18:00 + fiscal year start month 7 — matches Bangladesh business convention.

### Exit criteria: MET — all fields update with validation + audit row; partial-update safety and the business-hours CHECK both hold.

---

## Phase 7 — Spaces

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 55 automated checks green · all QA spaces + child lists/activity cleaned up (demo spaces still 6)

### Covered — all green
**A. LIST + GET (any member):** GET /spaces → 6 demo spaces (non-archived) with fields `id,name,icon,color,position`; GET /spaces/:id → 200; nonexistent → 404 `space.not_found`; no token → 401; member can list/get; `?include_archived=maybe` → 422.
**B. CREATE (👑 admin/owner):** member → 403; no token → 401; owner/admin → 201 with fields echoed (color, is_private, description, position); missing/empty name → 422; bad color → 422; writes a `created` activity row.
**C. UPDATE (👑 admin/owner):** member → 403; owner patch name+color → 200 applied; partial patch changes only the given field; empty body → 200 no-op; nonexistent → 404.
**D. ARCHIVE / UNARCHIVE — cascade (👑 admin/owner):** member → 403; owner archive → 204, `archived_at` set, **BOTH child lists cascade-archived**, archive activity records `lists_archived:2`; archived space **excluded from default GET**, **included with `?include_archived=true`**, still readable by id (200); archive already-archived → 204 idempotent; unarchive → 204 clears space `archived_at` but **does NOT restore the cascade-archived lists** (per API_DESIGN §5 — verified list stays archived); unarchive already-live → 204 idempotent.
**E. DELETE (🛡️ OWNER only — stricter than every other space mutation):** **admin → 403** (owner-only); delete non-archived → 409 `space.not_archived`; delete archived space that still holds lists → 409 `space.not_empty`; owner delete of an archived + empty space → 204, then GET → 404; delete nonexistent → 404.

### Notable finding (design, plan-assumption corrected)
- **Spaces have NO unique-name constraint** — creating two spaces with the same name → both 201 (verified). The plan's "duplicate name (ciText) rejected" assumption was WRONG for spaces; the service comment states it explicitly ("spaces has no unique constraint"). This is intentional. (Lists/tags/statuses uniqueness is tested in their own phases.)
- **DELETE is owner-only** (API_DESIGN §5 supersedes the 05-spaces.md 👑 table) and requires archived + zero lists (even archived lists block it, to avoid orphaning statuses / RESTRICT-blocking on task FKs) — a deliberately stricter, safe-by-default delete. Confirmed working end-to-end.

### Exit criteria: MET — hierarchy root solid incl. archive cascade semantics, unarchive non-restore, and the owner-only guarded delete.

---

## Phase 8 — Lists

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 58 automated checks green · demo lists/spaces intact (16/6)

### Covered — all green
**A. Reads (any member):** GET /spaces/:spaceId/lists → 200 (3 in demo space 1); bad space → 404 `space.not_found`; GET /lists → 16 demo lists workspace-wide; `?space_id=` filters correctly; GET /lists/:id → 200; nonexistent → 404 `list.not_found`; no token → 401; member can read.
**B. CREATE (👑 admin/owner) + status seeding:** member → 403; owner create → 201 with space_id; **creating a list SEEDS exactly 5 default statuses** (verified in DB, polymorphic `statuses.scope_type='list'`); create in nonexistent space → 404; missing name/space_id → 422; invalid `default_task_type_id` → 422; **create a list in an ARCHIVED space → 409 `space.archived`**.
**C. UPDATE + ARCHIVE (👑 admin/owner):** member → 403; owner patch applied; nonexistent → 404; archive → 204 + `archived_at` set; **PATCH of an archived list → 409 `list.archived` (archived = read-only)**; archive idempotent → 204; unarchive → 204 + editable again; unarchive idempotent → 204.
**D. DELETE (🛡️ OWNER only):** **admin → 403** (owner-only); delete non-archived → 409 `list.not_archived`; **delete an archived list that still has tasks → 409 `list.not_empty`** (tested against a real demo list with tasks, then restored); owner delete of an archived + empty list → 204, GET → 404, and **its seeded statuses were torn down** (0 remain).
**E. GET /lists/:listId/tasks — the filter engine:** `{data:[], pagination}` envelope; **task wire shape complete** — `name` (NOT title), `status_id` (raw id), `priority`, engineering fields, and **reference arrays** `assignees[]`/`watchers[]`/`tags[]` (arrays of IDs — the frontend hydrates via reference data), plus denormalized counters `subtasks_count`/`comments_count`/`attachments_count`; `?limit`+cursor → page 2 no overlap; filters `?status=<id>` (non-empty + all match), `?priority=4`, `?assignee=<uid>`, `?q=`, `?due_before=`, `?status_group=done` all 200; validation `?priority=9`→422, `?due_before=notadate`→422, `?limit=-5`→422; nonexistent list → 404; member can read.

### Notes (contract clarifications)
- **List-tasks hydration = reference IDs, not expanded objects.** `assignees`/`watchers`/`tags` are string-ID arrays; `status_id` is a raw id (no nested status object). This is the intended `{data,pagination}` list contract — the SPA resolves names/avatars/colors from cached reference data (matches the `useReferenceData` design). Full object hydration lives on the single-task GET (Phase 12).
- **Default statuses = 5 per new list** (seeded from a fixed template); `statuses` table is polymorphic (`scope_type` + `scope_id`), no `list_id` column.
- DELETE is owner-only and requires archived + zero tasks — same safe-by-default pattern as spaces.

### Exit criteria: MET — list CRUD, default-status seeding, archive read-only + cascade participation (from Phase 7), owner-only guarded delete, and the full task-listing filter/pagination surface all correct.

---

## Phase 9 — Statuses & reorder

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 40 automated checks green · QA lists+statuses cleaned up (demo lists still 16)

### Covered — all green
**A. LIST (any member):** GET /lists/:listId/statuses → 5 seeded, shape `id,name,status_group,position`, ordered by position, groups ∈ `{not_started, active, done, closed}`; nonexistent list → 404 `list.not_found`; no token → 401; member can read.
**B. CREATE (👑 admin/owner):** member → 403; owner → 201 appended (position ≥ seeded max); **duplicate name (case-insensitive) → 409 `status.duplicate`**; missing name / bad `status_group` → 422; nonexistent list → 404.
**C. UPDATE (👑 admin/owner):** member → 403; owner rename+recolor+regroup → 200 applied; **rename colliding with an existing name in the list → 409 `status.duplicate`**; nonexistent status → 404 `status.not_found`; bad `status_group` → 422.
**D. REORDER (👑 admin/owner) — `PATCH /lists/:listId/statuses/reorder`, bare `[{id,position}]` array:** member → 403; reverse-order permutation → 200 and actually reordered; **partial subset → 200** (unlisted keep position); **duplicate positions allowed → 200** (tie-break by id); **an id from ANOTHER list → 404 `status.not_found` AND the whole batch rolls back** (list A verified unchanged — all-or-nothing); non-array body → 422; nonexistent list → 404 `list.not_found`.
**E. DELETE guards (👑 admin/owner):** member → 403; unused status → 204; nonexistent → 404; **status referenced by a task → 409 `status.in_use`** (tested against a real demo status with tasks — no mutation); **deleting the LAST status of a group → 422 `status.last_in_group`** (reduced a QA group to 1, then the final delete refused — the Board view's ≥1-per-group invariant holds). Precedence confirmed: `in_use` (409) before `last_in_group` (422).
**F. Cross-list isolation:** a status is addressable by bare id within the same workspace; reorder membership is strictly per-list (D's cross-list rejection).

### Notes
- Delete has two race-safe guards inside a group-locked transaction (in_use via task count + FK RESTRICT backstop; last_in_group via group-id lock). Both verified behaviorally.
- `status_group` enum is `not_started / active / done / closed` (4 groups). Seeded 5 statuses map across these; `?status_group=` filtering on tasks (Phase 8) uses the same enum.

### Exit criteria: MET — status workflows stable incl. reorder (partial + rollback), delete-with-tasks refusal, and last-in-group protection.

### Test-harness note (not an app bug)
- One assertion double-read the fetch Response body (`.json()` twice → second returns `{}`), making a correct 200 look like a failure; fixed to read the body once. App behavior was correct.

---

## Phase 10 — Task types

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 33 automated checks green · cleaned up (6 types / 16 lists intact)

### Covered — all green
**A. LIST (any member):** GET /task-types → 6 seeded, shape `id,name,is_system,is_dev_type,is_milestone_type,icon,color,position`; **Bug + Feature are the two `is_dev_type` types** (used by SLA/engineering modules); no token → 401; member can read.
**B. CREATE (👑 admin/owner):** member → 403; owner → 201 appended (position ≥ 6); **`is_system` always forced false**; `is_dev_type` + `is_milestone_type` flags stored; **duplicate name (case-insensitive) → 409 `task_type.duplicate`**; missing name / name >80 → 422; writes `created` activity.
**C. UPDATE (👑 admin/owner):** member → 403; owner update name/color/description → 200; empty patch → 422; rename colliding with "Bug" → 409 `task_type.duplicate`; nonexistent → 404 `task_type.not_found`.
**D. SYSTEM-TYPE PROTECTION** (tested against a directly-inserted `is_system=1` type, since the API can never create one): **renaming a system type → 403 `task_type.system`**; changing its `is_dev_type` → 403; but **editing its icon/color/description → 200 (the only mutable fields on a system type)**; **DELETE of a system type → 403 `task_type.system`**.
**E. DELETE guards (👑 admin/owner):** member → 403; nonexistent → 404; **delete a type referenced by a task → 409 `task_type.in_use`** (real demo type); **delete a type named as a list's `default_task_type_id` → 409 `task_type.in_use`** (created a QA list defaulting to a QA type — verified the list-default reference also blocks, even though the DB FK is SET NULL); unused non-system → 204, gone from list. Delete precedence: not_found → system (403) → in_use (409).

### Notes
- The 6 demo task types are all NON-system (`is_system=0`); system types are a seed/reserved concept, so the protection was exercised via a directly-inserted system row and cleaned up.
- `task_type.in_use` deliberately counts BOTH task references (FK RESTRICT, race-safe backstop) AND list-default references (FK SET NULL, which the DB alone would NOT block) — the explicit count enforces the §8 refusal for both.
- Dev-type flag is the hook the SLA (Phase 30) and Engineering (Phase 28) modules use to identify engineering task types (team=engineering → dev-type alias).

### Exit criteria: MET — type registry correct incl. system-type protections (update field-lock + delete block) and dual-source in-use refusal.

---

## Phase 11 — Tags

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 27 automated checks green · cleaned up (12 tags intact) · **STAGE C (Structure) COMPLETE**

### Covered — all green
**A. LIST (any member):** GET /tags → 12 seeded, shape `id,name,color`; no token → 401; member can read.
**B. CREATE (👑 admin/owner):** member → 403; owner → 201 with name+color; writes `created` activity; **color optional** (default `#94A3B8` applied when omitted); **emoji in name → 201** (`QA-🔥-Priority` stored intact — full unicode); **duplicate name (case-insensitive) → 409 `tag.duplicate`**; missing name → 422; bad color (`reddish`) → 422.
**C. UPDATE (👑 admin/owner):** member → 403; owner rename+recolor → 200; **genuine no-op (same values) writes NO new activity row** (audit stays clean); rename collision → 409 `tag.duplicate`; nonexistent → 404 `tag.not_found`.
**D. DELETE + cascade-detach (👑 admin/owner):** member → 403; nonexistent → 404; **the key behavior — a tag attached to 2 tasks, on delete → 204, `fk_task_tags_tag ON DELETE CASCADE` removes ALL `task_tags` rows, and BOTH tasks still exist** (tag detaches, tasks untouched); tag gone from /tags; writes `deleted` activity.
**E. Workspace isolation:** tag ids are workspace-scoped; a foreign/nonexistent id → 404 (no existence oracle).

### Notes
- Delete is intentionally NOT blocked when the tag is in use (unlike statuses/task-types) — tags are labels, so deleting one simply detaches it from every task via the cascade. Verified end-to-end.
- Tag names accept full unicode/emoji; uniqueness is case-insensitive per workspace (`uq_tags_workspace_name`).

### Exit criteria: MET — tags fully correct incl. cascade-detach on delete, no-op audit suppression, and unicode names.

---

## STAGE C — WORKSPACE STRUCTURE: COMPLETE (Phases 6–11, all ✅)
Workspace settings, Spaces, Lists, Statuses, Task types, Tags — all green, 0 app bugs across the stage. Structural hierarchy (workspace → space → list → statuses/tasks) and its config primitives (task types, tags) are verified solid: CRUD + validation + workspace isolation + role gates + archive/cascade semantics + reference-integrity guards (in_use/last_in_group/cascade-detach) all correct.

---

## Phase 12 — Tasks: create & read

**Status: ✅ PASSED** (2026-07-11) · **47 automated checks green** · **1 REAL BUG FOUND + FIXED (P12-1, MEDIUM-HIGH)** · task count restored to baseline (436)

### 🔴 Issue P12-1 — subtasks_count counter never incremented for API-created subtasks (FIXED)
- **Severity:** MEDIUM-HIGH (data integrity + user-visible: every Board/List/task view shows subtask counts).
- **Symptom:** create a parent, then children via `POST /tasks` with `parent_task_id` → the parent's `subtasks_count` stays **0** (should be N). `subtasks_completed` progress likewise stuck.
- **Root cause:** `TaskWriteService.create` inserted the child with `parent_task_id = NULL`, then set it via a separate `TasksRepo.setParent` UPDATE — a **MySQL error-1442 workaround** carried verbatim into the libSQL port. Result: the `trg_subtasks_after_insert` trigger (fires `WHEN NEW.parent_task_id IS NOT NULL`) never saw the parent, and `trg_subtasks_after_update` only maintains `subtasks_completed` on status changes — so the counter was never bumped. The repo even documented it as "a known pre-existing schema-trigger limitation." Proof it was port-specific: `seed-demo.ts` inserts `parent_task_id` directly (line 545), which is exactly why the seeded counters were correct.
- **Why the workaround is wrong on libSQL:** MySQL error 1442 forbids a trigger from modifying the table its firing statement is operating on. **SQLite has no such rule** — a trigger UPDATE-ing a *different* row of the same table is allowed (and `recursive_triggers` is OFF by default, so no re-fire). So the workaround is unnecessary AND breaks the counter.
- **Fix (`astro-app/src/server/services/TaskWriteService.ts` + `repositories/TasksRepo.ts`):** set `parent_task_id` in the INSERT row (it already set `nesting_depth` there), removed the `setParent` call + the now-unused `setParent` method, and corrected the misleading MySQL-era comments.
- **Re-verify (dedicated run + full Phase 12 re-run):** create 2 children → parent `subtasks_count = 2`; child → done status → parent `subtasks_completed = 1` (after_update trigger intact); hard-delete a child → `subtasks_count = 1` (after_delete trigger intact). No regressions.
- **Old server (`server/`) note:** the same insert-then-setParent pattern exists there on MySQL, so `server/` likely has the same wrong `subtasks_count` for API-created subtasks — but its fix is different (the MySQL 1442 constraint is real there; would need a trigger on the parent-set UPDATE or a manual increment). Out of scope (legacy); logged for awareness.

### Covered — all green (after fix)
**A. CREATE minimal + defaults:** `{primary_list_id, name}` → 201; default status = first list status; default task_type = list's `default_task_type_id`; `task_number` auto-assigned (per-list); `custom_id` null when omitted; `nesting_depth` 0; counters 0; member can create.
**B. CREATE full + validation:** description/status/priority/dates/custom_id/assignees applied; **done-group status sets `completed_at`**; missing name / missing list / bad list / priority 9 → 422; **`ck_tasks_dates` (start > due) → 422**; **status_id not belonging to the list → 422**; **duplicate custom_id → 409 `task.duplicate_custom_id`** (409 Conflict, verified unique index `uq_tasks_custom_id (workspace_id, custom_id)`).
**C. Subtasks + triggers + nesting:** parent starts 0 → **2 after 2 children (FIXED)**; child depth 1, grandchild depth 2 allowed, **great-grandchild (depth 3) → 422**; **parent referenced by custom_id works and increments THAT parent**; invalid parent → 422 `task.invalid_parent`.
**D. GET /:id:** by internal id AND **by custom_id (the `t/:taskKey` resolution) → same task**; fully hydrated (name, status_id, priority, assignees[], tags[], counters); nonexistent → 404 `task.not_found`; no token → 401.
**E. GET /:id/subtasks:** bare `Task[]`; 2 direct children hydrated; leaf → `[]`; nonexistent parent → 404; **archived child excluded by default, included with `?include_archived=true`**.
**F. GET /tasks/my-work:** 5 buckets `today/overdue/next/unscheduled/done`; overdue(-3)→overdue, next(+3)→next, no-due→unscheduled, done-status→done, **far-future(+30)→NO active bucket** (documented "not what needs attention now"); `?bucket=bogus` → 422.

### Exit criteria: MET — create/read solid; counters now match trigger-maintained values exactly (the counter bug is fixed and re-verified).

---

## Phase 13 — Tasks: update, lifecycle, archive/delete

**Status: ✅ PASSED** (2026-07-11) · **52 automated checks green** · **2 REAL BUGS FOUND + FIXED (P13-2 500-on-bad-dates, P13-3 can't-clear-nullable-fields)** · **1 OPEN-DECISION (P13-1 recurrence)** · task count restored to baseline

### 🔴 Issue P13-2 — PATCH with start_date > due_date returned 500 (FIXED)
- **Severity:** MEDIUM (user-visible 500 on a plausible edit; noise in monitoring).
- **Symptom:** `PATCH /tasks/:id` with `start_date` after `due_date` (either both in one patch, or one against the stored other) → **500 `internal`** instead of 422.
- **Root cause:** `TaskWriteService.update` never pre-checked date ordering (only `create` did, at step 5c). The DB `ck_tasks_dates` CHECK rejected the write → raw 500.
- **Fix (`TaskWriteService.update`):** added a merged-pair guard (`effStart = patch ?? current`, same for due; if both present and start>due → 422 `task.invalid_date_range`), mirroring create. Verified: both-in-one-patch, start-after-existing-due, due-before-existing-start → all 422; valid/equal/cleared → 200.

### 🔴 Issue P13-3 — nullable PATCH fields could not be cleared via `null` (FIXED)
- **Severity:** MEDIUM (common operation broken: e.g. "remove this task's due date").
- **Symptom:** `PATCH /tasks/:id` with `{ due_date: null }` (or any of 20 nullable fields) → **422 `validation.failed` "Provide at least one field to update"** — the field never cleared.
- **Root cause:** the controller derived the patch from `matchedData(...)`, and express-validator's `optional({ nullable: true })` (`optNullable`) DROPS explicitly-null values — so a null-only patch reached the controller empty. The service was already built to accept null (clear the field); the null just never survived the controller. The validator even documents "optNullable allows null (clear) on nullable keys" — so this was unintended.
- **Fix (`TaskWriteController.update`):** after `matchedData`, re-add explicitly-null values for the 20 `optNullable` keys from `req.body` (null needs no sanitization), then compute `fields`. Verified: clearing due_date/start_date/description/story_points → 200 and null persisted; a truly-empty `{}` or unknown-only body still → 422; P13-2 date guard still holds.

### 🟡 Issue P13-1 — recurrence fields are set-but-inert (OPEN-DECISION, no spawner)
- `PATCH` accepts and persists `recurrence_pattern` / `recurrence_days` / `recurrence_ends_at` (verified: `weekly` + `["mon","wed"]` stored), but **NO job ever spawns the recurring instances** (confirmed in the full scan — the `recurrence-spawn` job is named-but-unbuilt). So a user can configure recurrence and nothing recurs.
- **Decision needed (Phase 38/47):** either (a) build the recurrence-spawn job + cron, or (b) hide the recurrence UI so it doesn't advertise a non-functional feature. Logged to the go-live checklist. Not a crash — just a dead feature.

### Covered — all green (after fixes)
**A. PATCH scalars:** name/description/priority/is_milestone/story_points/dates applied; member can edit.
**B. Status side-effects:** status→done SETS `completed_at`, status→not-done CLEARS it; **changing `bug_severity` recomputes `sla_due_at`** (§29 policy).
**C. ETag / If-Match:** correct If-Match (=`updated_at`) → 200; **stale If-Match → 409 `task.conflict`**; no If-Match → 200 (unconditional).
**D. Validation:** nonexistent → 404; priority 9 → 422; status-not-of-list → 422 `task.invalid_status`; **start>due → 422 (P13-2 fix)**; **clear nullable via null → 200 (P13-3 fix)**; empty patch → 422.
**F. Archive/unarchive cascade:** archive parent → parent+child+grandchild all archived; **PATCH archived task → 409 `task.archived`**; idempotent; **unarchive restores the WHOLE subtree** (differs from spaces, which don't restore lists); .
**G. DELETE:** soft (default, any member) = archive (row kept, `archived_at` set); **hard (`?hard=true`) by member → 403 `auth.forbidden`**, by owner → 204 with **child cascade-deleted via FK**; nonexistent → 404.
**H. BULK-edit (≤200, fail-atomic):** bulk status+priority on 3 tasks → 200 applied; **one missing id → 404 and NONE changed (fail-atomic verified)**; empty ids → 422; invalid status → 422; `assignee_add` → 200 applied.

### Exit criteria: MET — full mutation surface correct; the two 500/blocked-clear bugs fixed; deletion (soft + hard-cascade) leaves no orphans; recurrence flagged for a product decision.

---

## Phase 14 — Assignees & watchers

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 40 automated checks green · cleanup verified (16 lists, task baseline, mim reactivated)

### Covered — all green
**A. ADD assignees (`POST /tasks/:id/assignees`, body `user_ids[]`) → 204:** single + multiple applied; **AUTO-WATCH — a new assignee is automatically added as a watcher**; `assignee_added` activity written; **NOTIFICATION — each new assignee gets an `assigned` notification, EXCEPT the actor (no self-notify)**; idempotent re-add → 204 with no new activity, no duplicate row, no extra notification.
**B. ADD validation:** nonexistent user → 422 `task.invalid_assignee`; **deactivated user → 422 (must be an ACTIVE member)**; **all-or-nothing — a valid+invalid mix → 422 and the valid one is NOT added** (no partial writes); nonexistent task → 404; member can assign.
**C. REMOVE assignee (`DELETE /tasks/:id/assignees/:userId`) → 204:** unassigned; `assignee_removed` activity; **the auto-added WATCHER is deliberately LEFT INTACT after unassign** (watching has its own lifecycle); idempotent remove of a non-assignee → 204; **NO notification fired** (there is no `unassigned` type).
**D. WATCH/UNWATCH self (`POST`/`DELETE /tasks/:id/watchers/self`) → 204:** self-only (id from JWT — cannot watch on behalf of others); becomes/leaves watcher; **a personal subscription — writes NO `task_activity`, fires NO notification** (verified); both idempotent; nonexistent task → 404.
**E. Archived-task guard:** add assignee to an archived task → 409 `task.archived`; watch an archived task → 409 `task.archived`.

### Notes
- Notification recipient filtering (`recipients = newIds.filter(id => id !== actorId)`) verified end-to-end: self-assign produces zero notifications for the actor; assigning others notifies each of them exactly once. This is a positive slice of the Phase-32 notification matrix.
- Assignee/tag changes bump the task ETag (`touchUpdatedAt`); self-watch changes do NOT (personal state) — consistent with the §11 design.

### Exit criteria: MET — membership edges + notification side-effects correct; auto-watch on assign, watcher-preserved on unassign, active-member-only guard, and all-or-nothing writes all verified.

---

## Phase 15 — Task tags & dependencies

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 34 automated checks green · cleanup verified (16 lists, task baseline)

### Covered — all green
**A. Task tags (`POST /tasks/:id/tags` body `tag_ids[]` / `DELETE /tasks/:id/tags/:tagId`) → 204:** attach multiple, both in `task.tags`, 2× `tag_added` activity; idempotent re-add (no dup, 204); **foreign tag → 422 `task.invalid_tag`**; detach → 204 + `tag_removed` activity; idempotent remove of a non-applied tag → 204; nonexistent task → 404; **archived task → 409 `task.archived`**.
**B. Dependencies — create + directions (`POST /task-dependencies` body `task_id`+`related_task_id`) → 201:** A blocks B returns the hydrated `blocks` edge; `GET /tasks/:id/dependencies` → `{blocks, blocked_by}` with the OTHER end hydrated; **A.blocks contains B AND B.blocked_by contains A (both directions computed from one stored edge)**; `dependency_added` activity on BOTH endpoints; member can create.
**C. Dependency guards (precedence order):** **self-dep → 422 `dep.self`** at the app layer AND **the DB trigger `trg_task_dependencies_no_self_insert` RAISE(ABORT)s a direct-SQL self-insert** (backstop verified independently); **cycle → 422 `dep.cycle`** (BFS: both a 3-node cycle C→A over A→B→C and a direct cycle B→A over A→B); **duplicate edge → 409 `dep.duplicate`**; either endpoint nonexistent → 404 `task.not_found`.
**D. Delete + FK cascade:** `DELETE /task-dependencies/:id` → 204 + `dependency_removed` on both endpoints; nonexistent → 404 `dep.not_found`; **hard-deleting a task in a dependency CASCADE-removes its edges** (FK), leaving no dangling edges; GET deps of nonexistent task → 404.

### Notes
- Dependency integrity is guarded at BOTH layers: the app (self/cycle/duplicate → clean 422/409) and the DB (self-insert trigger + `uq_task_dependencies` unique + FK cascade). The app-layer cycle BFS runs inside the create transaction on a consistent snapshot; the code notes a vanishingly-rare simultaneous-insert race (would need a workspace lock for absolute prevention) — acceptable for this small graph.
- Tag attach/detach shares the §11 membership template (lock → diff → junction write → activity → ETag bump), same as assignees (Phase 14).

### Exit criteria: MET — dependency graph integrity guaranteed at app + DB layer (self, cycle, duplicate, cascade); tag attach/detach correct incl. archived guard and idempotence.

---

## Phase 16 — Task activity feed

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 24 automated checks green · cleanup verified · **STAGE D (Tasks core) COMPLETE**

### Covered — all green
**A. Events recorded:** driving create → status → priority → assign → tag → dependency mutations, the feed captures `task_created`, a status/update event, `assignee_added`, `tag_added`, `dependency_added`; `{data, pagination}` envelope; row shape `{id, task_id, actor, action, context, created_at}`.
**B. Actor hydration:** each row's `actor` is the FULL User object (id + email + …), no password field; system/deleted actors → `actor: null`.
**C. Ordering:** newest-first (`created_at` desc); the most recent mutation (`dependency_added`) is row 0.
**D. `?action=` filter:** `?action=tag_added` → only tag_added rows; unknown action → empty `data`.
**E. Cursor pagination stability (the important part):** `total_estimate` reported; paging with `limit=2` through all rows collected exactly `total` ids with **ZERO duplicates and zero skips**; **KEYSET STABILITY — fetching page 1, then inserting a NEW event mid-pagination, then page 2 via page-1's cursor: page 2 has no overlap with page 1 and the new (higher-internal_id) event does NOT leak into an older page** (opaque `internal_id` keyset cursor is stable under concurrent writes — no offset drift).
**F. Validation + isolation:** malformed cursor → **400 `pagination.invalid_cursor`** (not 422 — an opaque token the client can't fix); nonexistent task → 404 `task.not_found`; no token → 401; **an archived task STILL returns its activity** (soft-delete, detail view links here); feed resolvable by `custom_id` as well as internal id.

### Notes
- Keyset (internal_id) pagination is inherently stable under inserts, unlike OFFSET — verified behaviorally, which is the correctness property the Inbox/task-detail feeds rely on.
- `clampLimit` defends against a non-scalar `?limit` (array from `?limit=1&limit=2`) coercing to NaN and dumping the whole feed — a nice hardening detail (not separately triggered here; the validator's isInt already blocks it upstream).

### Exit criteria: MET — feed complete & stable under concurrent writes; actor hydration, ordering, filter, and 400/404 edges all correct.

---

## STAGE D — TASKS CORE: COMPLETE (Phases 12–16, all ✅)
The central entity is verified end-to-end: create (defaults, subtasks + counter triggers, custom keys, ck_tasks_dates), update (all field groups, ETag If-Match, status/SLA side-effects), lifecycle (archive/unarchive cascade, soft/hard delete + FK cascade), bulk-edit (fail-atomic), assignees/watchers (auto-watch, notifications, active-guard), tags & dependencies (self/cycle/duplicate at app + DB trigger), and the activity feed (stable keyset pagination, actor hydration). **3 real bugs found + fixed in this stage: P12-1 (subtasks_count trigger), P13-2 (500 on bad dates), P13-3 (can't clear nullable fields). 1 open product-decision: P13-1 (recurrence has no spawner).**

---

## Phase 17 — Comments

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 37 automated checks green · cleanup verified

### Covered — all green
**A. CREATE + `comments_count` trigger:** `POST /tasks/:id/comments` (body `body`, optional `parent_comment_id`) → 201; **`comments_count` trigger increments correctly** (1 then 2 — no P12-1-style bypass, since comments insert `task_id` directly); `comment_posted` activity; empty body → 422; nonexistent task → 404; no token → 401; any member can comment.
**B. 1-level threading:** reply to a top-level comment → 201 with `parent_comment_id`; **reply to a REPLY → 422 `comment.reply_to_reply`**; reply to nonexistent/deleted parent → 422 `comment.parent_not_found`; reply to a parent on ANOTHER task → 422.
**C. LIST tree:** `GET` returns a tree — top-level comments with nested `replies[]`; shape `{id, task_id, parent_comment_id, author_id, body, edited_at, deleted_at, created_at, replies}`.
**D. EDIT (author-guard + 15-min window):** non-author → 403 `comment.not_author`; author within window → 200 + `edited_at` set + body applied; **after the 15-min window (created_at pushed back) → 403 `comment.edit_window_expired`**; nonexistent → 404 `comment.not_found`.
**E. DELETE (soft, author-or-admin) + tombstone:** non-author non-admin → 403 `comment.forbidden_delete`; author → 204; **the soft-deleted comment KEEPS its place in the thread as a `[deleted]` tombstone AND keeps its nested reply**; **`comments_count` is UNCHANGED on soft-delete — consistent, because the tombstone stays in the thread** (see design note); re-deleting a tombstone → 404; **an admin can delete another member's comment → 204**.
**F. @mentions + #TASK-ID refs:** `@farhana` → `mentioned` notification for farhana; **a self-mention fires NO notification**; `#QAREF-1` (a task's custom_id) → `comment_referenced` activity on that referenced task.
**G. XSS payload storage:** a `<script>`/`onerror` body is accepted + stored verbatim (201) and returned as a JSON string value — **sanitization is a RENDER concern (frontend TiptapReadOnly + DOMPurify), verified at the browser layer in Phase 43**; the API never executes it (JSON context).

### Design note — comments_count vs soft-delete (verified consistent, NOT a bug)
`trg_comments_after_insert` +1 on insert, `trg_comments_after_delete` -1 on HARD delete; there is NO after-update trigger, so a soft-delete (UPDATE `deleted_at`) does NOT decrement the count. This is CONSISTENT because a soft-deleted comment is not removed from the thread — `listByTask` returns it and the serializer renders its body as `[deleted]`, keeping its slot (so reply structure survives). So `comments_count` == the number of slots shown in the thread (including `[deleted]` tombstones). If a future change hides tombstones, this counter would need an after-update trigger — logged for awareness, not action.

### Note (test-side, not an app bug)
- The `#TASK-ID` ref regex is `#([A-Za-z][A-Za-z0-9]*-\d+)` — it matches the standard `PREFIX-NUMBER` custom-id form (e.g. `#PROJ-42`, `#QAREF-1`), NOT ids with extra hyphens (`QA-REF-1`). A custom_id must be in `LETTERS[...]-DIGITS` form to be auto-linked. Acceptable (matches conventional task keys); a first test run used a non-matching id.

### Exit criteria: MET — comment CRUD + counters + 1-level threading + author/window guards + soft-delete tombstones + mention/ref side-effects all correct; XSS sanitization deferred to the render layer (Phase 43).

---

## Phase 18 — Checklists & items

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 39 automated checks green · cleanup verified (16 lists, task baseline, mim reactivated)

### Covered — all green
**A. Checklist CRUD:** `POST /tasks/:id/checklists {name}` → 201; empty name → 422; nonexistent task → 404; `GET /tasks/:id/checklists` list; `PATCH /checklists/:id` rename → 200; nonexistent checklist → 404 `checklist.not_found`.
**B. Add items + assignee/parent validation (68a5b76 regression):** `POST /checklists/:id/items {text}` → 201; with a valid active-member `assignee_id` → 201; **invalid assignee → 422 `checklist_item.invalid_assignee`**; **DEACTIVATED assignee → 422** (must be active); sub-item with a valid `parent_item_id` in the SAME checklist → 201; **parent from ANOTHER checklist → 422 `checklist_item.invalid_parent`**; empty text → 422; nonexistent checklist → 404.
**C. Bulk add:** `POST /checklists/:id/items/bulk {texts:[…]}` → 201 all inserted atomically (checklist reached 6 items); empty `texts` → 422.
**D. Toggle:** `POST /checklist-items/:id/toggle` → 200 flips `is_completed`, **stamps `completed_by`/`completed_at`**; toggling again → un-completed and both cleared; `checklist_item_toggled` activity written; nonexistent item → 404 `checklist_item.not_found`.
**E. Update item:** `PATCH /checklist-items/:id` text+assignee → 200; **clear assignee via `null` → 200**; invalid assignee → 422; nonexistent → 404.
**F. Delete + cascade:** delete item → 204 (gone); nonexistent → 404; **deleting a checklist → 204 and its items CASCADE-delete** (verified 4 items → 0 rows); deleted checklist gone from the task; nonexistent → 404.

### Notes
- Item-assignee validation mirrors §11 task-assignee (`findActiveIdsInWorkspace`) — cannot assign a checklist item to a non-existent/cross-tenant/deactivated user (would otherwise FK-500). The 68a5b76 regression (validate checklist assignee AND parent) is fully covered.
- Checklist item completion has its own `completed_by`/`completed_at` bookkeeping; there is no denormalized task-level checklist counter (unlike subtasks/comments/attachments), so no counter-trigger concern here.

### Exit criteria: MET — checklists fully correct incl. bulk, toggle bookkeeping, assignee/parent 422 validation, and checklist→items cascade delete.

---

## Phase 19 — Custom fields: definitions & options

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 40 automated checks green · **1 OPEN-DECISION (P19-1: dropdown options are create-only)** · cleanup verified

### Covered — all green
**A. CREATE — all 6 types:** text, phone, money, date, files, dropdown (with inline options) all → 201; **unsupported type → 422 `custom_field.unsupported_type`** (the 6 allowed = text/phone/money/date/dropdown/files); member → 403; **options on a NON-dropdown → 422**.
**B. Scope resolution (3 scopes):** workspace (scope_id must be null, else 422); space + valid space id → 201; space without scope_id → 422; **space + bad scope_id → 422 `custom_field.invalid_scope`**; list + valid list → 201; list + bad scope_id → 422.
**C. GET /custom-fields:** lists all workspace fields (options inline for dropdowns); member can read.
**D. 🔴 list-scope ISOLATION (P0 8ac32aa regression) — CONFIRMED FIXED:** `GET /lists/:listId/custom-fields` resolves to workspace + the list's space + THAT list's own fields. Verified with two lists A & B in the same space: list A sees {workspace, space, list-A} fields; **list A does NOT see list-B's field AND list B does NOT see list-A's field** (the exact isolation the P0 fix restored); both still see the shared workspace + space fields.
**E. PATCH immutability:** name/is_required/config/position editable → 200; **`type` → 422 (immutable)**; **`scope_type` → 422 (immutable)**; nonexistent → 404 `custom_field.not_found`; member → 403.
**F+G. DELETE + cascade:** member → 403; owner → 204; **deleting a field CASCADE-deletes its options** (and its stored task values — the value side is Phase 20); gone from the list; nonexistent → 404.

### 🟡 Issue P19-1 — Dropdown options are CREATE-ONLY (no add/rename/delete after creation) (OPEN-DECISION, MEDIUM)
- **Observed:** `PATCH /custom-fields/:id` has NO `options` field in its validator, the service update only patches name/config/is_required/position, and the repo has only `insertOptions` (create-time) + cascade-delete — there is **no API to add, rename, or delete an individual dropdown option after the field is created**. Sending `{options:[…]}` on PATCH returns 200 but is a silent no-op (option count unchanged, verified 2→2).
- **Impact:** an admin who creates a dropdown custom field (e.g. "Priority: Low/High") and later needs a new option ("Critical") CANNOT add it — the only workaround is to DELETE the field (which cascade-deletes every task's stored value for it) and recreate it. For BeautyBooth's ops teams this is a real workflow gap; the plan explicitly expected "dropdown options add/rename/delete".
- **Decision needed (Phase 47):** either (a) accept create-only options for V1 and document it, or (b) add option add/rename/delete endpoints (small: an `insertOption`/`updateOption`/`softDeleteOption` on the existing `custom_field_options` table, with an "option in use by values" guard mirroring statuses/task-types). Not a crash — a missing capability. Logged to the go-live checklist.
- **Minor sub-note:** PATCH silently ACCEPTING an `options` key (200 no-op) rather than 422-rejecting it is mildly misleading; if option-editing is not added, PATCH should reject unknown keys for clarity.

### Exit criteria: MET for the definition layer — all types, scope resolution, list-scope isolation (P0 regression re-confirmed), type/scope immutability, and field→options cascade all correct. Option-lifecycle capability flagged as P19-1 for a product decision.

---

## Phase 20 — Custom fields: values on tasks

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 42 automated checks green · **1 latent drift (P20-1, LOW)** · cleanup verified

### Covered — all green
**A. Set value per type** (`PUT /tasks/:id/custom-fields/:fieldId`, body = the value envelope): text `{text}`, money `{amount:int,currency}`, date `{date}`, dropdown `{option_id}`, files `{file_ids:[]}` — all → 200.
**B. BD phone validation:** `01712345678` / `01312345678` → 200; **short / wrong-prefix (`02…`) / `+880` international → 422** (config `default_country:"BD"` enforces `01[3-9]XXXXXXXX`).
**C. Per-type validation → 422:** text over `max_length`; money non-integer amount; money missing currency; date bad format; **dropdown nonexistent `option_id` → 422** (option existence checked); files nonexistent attachment id → 422 (attachment ownership checked).
**D. Envelope / type mismatch → 422:** text field sent a money envelope; dropdown sent a text envelope; a non-object body (array).
**E. Hydration:** `task.custom_field_values[fieldId]` holds the typed value (`{text:"hi"}`, dropdown `{option_id}`); `custom_field_value_set` activity written; the stored JSON's `$.option_id` matches (the generated column's source expression is correct).
**F. list-scope guard on values:** setting a LIST-scoped field's value on a task IN that list → 200; **on a task in ANOTHER list → 404 `custom_field.not_found` ("not applicable to this task")**; clearing the same → 404. (Extends the Phase-19 definition-layer isolation to the value layer.)
**G. Clear:** member can set; `DELETE` → 204, value gone from hydration; **idempotent clear (no value) → 204**; `custom_field_value_cleared` activity.
**H. Guards + cascade:** nonexistent task/field → 404; **set on an archived task → 409 `task.archived`**; **deleting a field CASCADE-removes its stored task values** (completes the Phase-19 cascade check).

### 🟡 Issue P20-1 — VIRTUAL `option_id_generated` column declared in schema but NOT created by `drizzle-kit push` (LOW, latent schema drift)
- **Observed:** `schema/custom-fields.ts` declares `task_custom_field_values.option_id_generated` as a VIRTUAL generated column (`json_extract(value,'$.option_id')`) plus an index `idx_tcfv_option`. The test DB (provisioned via `db:push`, same flow as prod) has NEITHER — `PRAGMA table_info` shows only `task_id, custom_field_id, value, updated_at, updated_by`. **`drizzle-kit push` silently skips SQLite generated columns.**
- **Impact today: NONE functional** — no runtime query references `option_id_generated` (only a doc comment in `CustomFieldsRepo.upsertValue` mentions it); dropdown-value filtering is not exposed via the API. So this is pure declared-≠-actual drift.
- **Latent risk:** the moment a query filters/sorts by `option_id_generated` (the intended dropdown-value index), it will 500 `no such column` in prod. And this is another instance of the known "`drizzle-kit push` doesn't create X" class (views/triggers already moved to `_post.sql`).
- **Recommendation (Phase 47 / schema hygiene):** either (a) add the generated column + `idx_tcfv_option` to `drizzle/_post.sql` (where views/triggers already live, since push can't create them), or (b) remove the unused generated column + index from the schema to eliminate the drift. Logged; not a go-live blocker on its own.

### Exit criteria: MET — value layer type-safe (all 6 types + BD phone + dropdown option existence + files ownership), list-scope-isolated at the value layer, hydrated correctly, archived-guarded, and field→values cascade verified. Generated-column drift flagged as P20-1.

---

## Phase 21 — Attachments: R2 presigned flow

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 25 automated checks green · **R2 STUBBED locally (safety) — real bytes deferred to Phase 46**

### R2 isolation decision
`.dev.vars` carries the REAL prod R2 creds (only TURSO_* were swapped to the test DB), and `R2Service` does real bucket operations under `NODE_ENV=dev`. Its S3 endpoint is hardcoded (`<account>.r2.cloudflarestorage.com`) with no override var, so a local S3 mock (MinIO) isn't possible without a code change. Following the same "never touch prod during testing" principle as the DB isolation, R2 was forced into its deterministic no-network STUB by blanking `CLOUDFLARE_R2_ACCESS_KEY` (backup `.dev.vars.r2bak`; NODE_ENV stayed `dev`). This fully exercises the app-side flow/policy/counter/authz; the **real R2 byte round-trip (PUT/GET bytes + the `410 upload_expired` HEAD-missing path) is verified on the deployed worker in Phase 46** (already in the plan, real bucket).

### Covered — all green
**A. SIGN policy (validated BEFORE signing):** valid sign → 201 with `attachment_id` + `upload_url` and a `pending` row; **size > 25 MB → 413 `attachment.too_large`**; **disallowed MIME → 415 `attachment.mime_not_allowed`** (allow-list = jpeg/png/gif/webp/heic/pdf/doc/docx/xls/xlsx/csv/txt); nonexistent task → 404; allowed pdf → 201.
**B. 🔴 attachments_count — P0 pending-exclusion (8ac32aa) CONFIRMED:** a `pending` (signed-but-not-finalized) attachment → **`attachments_count` stays 0** (the exact P0 fix — only COMPLETE uploads count); after `finalize` (pending→complete) → **count = 1**; after soft-delete (complete→deleted) → **count back to 0**. All three transitions verified — the counter triggers (`after_insert`/`after_update_inc`/`after_update_dec`, gated on `upload_status='complete' AND deleted_at IS NULL`) are correct.
**C. LIST excludes pending + deleted:** with 1 pending + 1 complete + 1 (complete-then-deleted), `GET /tasks/:id/attachments` returns ONLY the 1 finalized+non-deleted row; nonexistent task → 404.
**D. DOWNLOAD:** downloading a **pending** attachment → 404 (no object in R2 yet); a **complete** one → **302 redirect** to a fresh signed GET URL; nonexistent → 404.
**E. DELETE authz:** a non-uploader non-admin member → **403 `auth.forbidden`**; the **uploader** deletes own → 204 (soft-delete, `deleted_at` set, row kept for the janitor); re-deleting a soft-deleted row → 404; an **admin** deletes another member's attachment → 204; nonexistent → 404.

### Exit criteria: MET for the app layer — sign policy (413/415/404), finalize status flip, the P0 pending-exclusion counter, list/download exclusions, and delete authz all correct. Real R2 bytes → Phase 46.

---

## Phase 22 — Attachments: proxied upload & janitor

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 19 automated checks green · R2 stubbed (real bytes → Phase 46)

### Covered — all green
**A. PROXIED upload (`POST /tasks/:id/attachments`, raw body Buffer via `express.raw`, filename via `X-Filename`):** → 201 and creates a **COMPLETE** attachment in ONE step (server-side R2 PUT + finalize, no separate sign/finalize); `attachments_count` → 1; the `X-Filename` is stored (DB column `name`); empty body → 400/422; disallowed Content-Type → 415; nonexistent task → 404; **oversized 26 MB body → 413 `attachment.too_large`** (policy enforced on the actual buffer length, inside the 30 MB `express.raw` limit); the upload appears in the task's attachment list.
**B. attachment-janitor (`POST /jobs/attachment-janitor`):** missing `X-Internal-Token` → 401/403; wrong token → 401/403 (internalAuth is the sole guard); with a crafted STALE pending (`uploaded_at` set 2h ago) + a FRESH pending: **`?dry_run=true` → 200 `{processed:1, wouldDelete:1}` and deletes NOTHING**; the **real run hard-deletes the stale pending (>1h)**, while the **fresh pending (<1h) SURVIVES** and a finalized attachment is untouched.

### Notes
- Proxied upload exists specifically because the dev R2 bucket lacks CORS for a browser cross-origin PUT — the server proxies the bytes. Verified the one-step create+finalize path (the `express.raw` body-bytes handling — a ported shim behavior).
- Janitor is idempotent and `pending`-guarded (a row that finalizes between scan and delete is left intact). It is reachable via HTTP `/jobs/*` with the internal token but is NOT scheduled (no cron) — the scheduler gap is Phase 38.
- Attachments-count triggers exclude pending — re-confirmed indirectly (janitor deletes pending without touching the counter, which was already 0 for pending).

### Exit criteria: MET — both upload paths (presigned in Phase 21, proxied here) + the janitor (dry-run/real/pending-guard) all correct.

---

## Phase 23 — Forms: builder (forms & fields)

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 33 automated checks green · cleanup verified

### Covered — all green
**A. Form CRUD + slug:** member → 403; owner create → 201 with an **auto-generated `public_slug`** (`<slugified-title>-<token>`); explicit slug → 201; **duplicate explicit slug → 409 `form.slug_taken`**; missing title → 422; nonexistent list → 404; `GET /forms`, `GET /forms/:id`, `GET /lists/:listId/forms` all work; member can read.
**B. Update (title/slug/publish):** PATCH title → 200; **PATCH `is_public:true` (publish) → 200** and reflected; PATCH slug to a taken one → 409; nonexistent → 404.
**C. Fields CRUD:** add a `task_attr` field → 201 (label + field_key + is_required); a second field with a different key → 201; **duplicate `field_key` → 409 `form_field.duplicate`**; invalid `field_kind` (not `task_attr`/`custom_field`) → 422; member → 403; PATCH field label → 200; nonexistent field → 404.
**D. Reorder fields (`PATCH /forms/:id/fields/reorder`, body `{items:[{id,position}]}`):** valid reorder → 200; a foreign field id → 404/422. (Note: forms-field reorder uses `{items:[…]}`, NOT the bare array that the STATUSES reorder uses — a contract difference between the two reorder endpoints.)
**E. Delete field + form:** delete field → 204 (gone); member deletes form → 403; owner deletes form → 204 and **its fields CASCADE-delete**; nonexistent → 404.

### Notes
- Two `field_kind`s: `task_attr` (maps a submission answer to a task attribute like name/description) and `custom_field` (maps to a workspace custom field). `field_key` is unique within a form.
- Publish state = `forms.is_public` (boolean); the public GET honoring it (draft → 404) is verified in Phase 24.

### Exit criteria: MET — builder API stable (form CRUD, slug uniqueness/auto-gen, field CRUD + key-uniqueness, reorder, publish toggle, field cascade). "New form" button + field palette UI are Phase 45.

---

## Phase 24 — Public form: render, submit, encryption

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 24 automated checks green · 1 design-nuance note (P24-1, LOW) · cleanup verified

### Covered — all green
**A. Public GET (UNAUTHENTICATED):** `GET /public/forms/:slug` with zero auth → 200 returning the form title + fields; nonexistent slug → 404 `form.not_found`.
**B. Public submit (UNAUTHENTICATED) → creates a task:** `POST /public/forms/:slug/submit` `{data:{…}}` with zero auth → 201; **it CREATES a task in the form's bound list** with the `task_attr` mapping applied (name → task.name, priority → task.priority); a missing REQUIRED field → 422.
**C. 🔴 task_attr validation (47d8a30 bypass regression) — CONFIRMED FIXED:** an invalid `priority` value (99, out of 0–4) → **422** (validated, not a 500 / silent corruption); priority as a non-number → 422; **extra undefined data keys (`injected_status:"done"`, `evil:"<script>"`) are IGNORED — the created task keeps the list-default status, no injection/corruption** (only whitelisted TASK_ATTR_KEYS = name/description/priority/due_date/start_date are mapped).
**D. 🔒 Encryption at rest + 90-day expiry:** the `form_submissions.data` column is **CIPHERTEXT** (`{"ciphertext":"004de3…","iv":…,"authTag":…}` — AES-256-GCM) — **none of the submitted plaintext ("QA Submitted Lead", "QA Extra Keys") appears in the stored row**; `encrypted_at` set; **`expires_at` = `encrypted_at` + exactly 90 days** (PII retention window).
**E. submission_count + no-auth:** the form's `submission_count` incremented to exactly 2 (2 successful submits, via trigger); the public GET genuinely needs no auth; **submitting to an `is_public=false` form → 403 `form.submission_closed`**.

### 🟢 Note P24-1 — `is_public` gates SUBMIT, not the public GET (LOW, defensible design)
- `is_public` defaults to **true** and semantically means **"accepting submissions"** (the error on submit is `form.submission_closed` / "not accepting submissions"). The SUBMIT path correctly gates on it (→ **403 `form.submission_closed`**), but the public GET does NOT — an `is_public=false` form's structure is still viewable by its (unguessable) slug.
- This is DEFENSIBLE: a closed form can be viewed (to show "closed") but not submitted; the slug is a secret; there is a separate `settings.submission_open` control too. It is NOT a data/auth bypass. The plan expected "draft → 404" on the GET; the app instead treats `is_public` as submission-gating. **Product decision (optional):** if forms should be fully HIDDEN when unpublished, add the `is_public` gate to `publicView` too; otherwise document that `is_public` = "accepting submissions". Low priority.

### Exit criteria: MET — public intake is safe (unauth GET/submit work; submit gated when closed), correctly maps whitelisted task_attr fields with per-value validation (no injection/500), stores submissions AES-256-GCM encrypted with a 90-day `expires_at`, and increments the submission counter.

---

## Phase 25 — Submissions view & 90-day retention

**Status: ✅ PASSED** (2026-07-11) · **18 automated checks green** · **1 REAL BUG FOUND + FIXED (P25-1, HIGH)** · cleanup verified

### 🔴 Issue P25-1 — Submissions view returned CIPHERTEXT (admin couldn't read submissions) (FIXED)
- **Severity:** HIGH (a core feature broken — the ops teams collect leads/complaints via public forms and could not read any of them).
- **Symptom:** `GET /forms/:id/submissions` returned each submission's `data` as the raw encryption envelope `{"ciphertext":"…","iv":"…","authTag":"…"}` instead of the submitted values — verified against a live submission (`SECRET-CUSTOMER-NAME` never appeared; `ciphertext` did).
- **Root cause:** submissions are correctly encrypted at rest (Phase 24), but the read path never decrypts. `toWireFormSubmission` (formSerializer) passes `s.data` straight through, and neither the repo nor `FormsService.listSubmissions` decrypts — so the authorized reader got the ciphertext.
- **Fix (`FormsService`):** added a fail-safe `decryptSubmissionData` helper (`decryptJSON` the stored envelope; normalise the `text({mode:"json"})` column that a driver may hand back as a string OR object; return `null` on any decrypt error so it NEVER leaks ciphertext and NEVER 500s) and applied it in `listSubmissions` before serializing. The serializer stays pure.
- **Re-verify:** the view now returns **`{"name":"DECRYPTED-CUSTOMER-XYZ"}`** (readable), **no `ciphertext` in the wire response**, and **the DB row is STILL encrypted at rest** (defence intact). No regression to the submit/encrypt path (Phase 24 re-checked: submit still stores ciphertext + 90-day expiry).

### Covered — all green (after fix)
**A. Submissions view (`GET /forms/:id/submissions`, 🔐 any member):** → 200 with all 3 submissions; **`data` DECRYPTED and readable (P25-1 fix)**; no ciphertext in the response; row shape `{id, task_id, submitter_email, data, submitted_at}`; a member can read (route is any-member); nonexistent form → 404; `?limit=2` → cursor pagination.
**B. form-submission-expiry retention job (invoked faithfully via `runJob`, since it has NO HTTP route/cron):** with 3 submissions and 2 marked expired (`expires_at` in the past): **`dry_run` → `{processed:2, wouldDelete:2}` and deletes NOTHING**; the **real run hard-deletes exactly the 2 expired rows** and the **1 fresh submission (future `expires_at`) SURVIVES**. The 90-day PII auto-delete logic is proven correct.

### 🔴 Reminder — this retention job is UNREACHABLE in the running app (ties to Phase 38)
The `form-submission-expiry` job is in the `runJob` registry but has **NO HTTP route** (`routes/jobs.ts` exposes only 4 of the 5 jobs) **AND no cron** (`wrangler.jsonc` has no `triggers.crons`) **AND no CLI** in astro-app. So although the logic is correct (proven here by invoking it directly), **the 90-day PII deletion NEVER runs automatically in production.** It MUST be wired (route + cron `scheduled()` handler) in Phase 38 — otherwise form submissions accumulate forever, violating the retention policy. Already on the Phase 38 / Phase 47 checklist.

### Exit criteria: MET — submissions readable (decryption bug fixed), retention logic proven; the wiring dependency is escalated to Phase 38.

---

## Phase 26 — Templates & apply

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 34 automated checks green · cleanup verified · **STAGE F (Forms/Templates) COMPLETE**

### Covered — all green
**A. Create + structure integrity:** member → 403; owner create (`type`∈task/list/space, `name`, `structure`) → 201; **empty structure (no `checklistItems`) → 422 `template.empty_structure`** (a template must have ≥1 checklist item); **invalid `structure.taskTypeId` → 422 `template.invalid_task_type`**; duplicate name → 409 `template.duplicate`; missing name → 422; invalid `type` → 422.
**B. Read + filters:** `GET /templates` (any member) lists them; `GET /templates/:id` → 200; nonexistent → 404; `?type=task` filter; `?q=Onboarding` search; member can read.
**C. Update (type immutable):** PATCH name/description → 200; **PATCH `type` is silently IGNORED — type stays `task`** (immutable, controller never reads it off the body); PATCH `structure` with empty checklistItems → 422; member → 403; nonexistent → 404.
**D. Apply → spawns task + checklists (any member):** `POST /templates/:id/apply {list_id}` → 201; **the spawned task lands in the target list with the template's `task_type`, `priority`, and its checklist(s) materialised (2 items)**; `task_name` override honored; **`usage_count` incremented** per apply (reached 3); apply to nonexistent list → 404; nonexistent template → 404; missing list_id → 422.
**E. Delete — spawned tasks independent:** member → 403; owner delete → 204; **deleting a template does NOT touch the tasks already spawned from it** (the applied tasks survive — templates are a blueprint, not an owner); nonexistent → 404.

### Notes
- Per-item checklist due dates from `anchor_date` are intentionally NOT materialised (`checklist_items` has no `due_date` column — a documented product decision in `TemplateApplyService`). The `anchor_date` apply param is accepted but per-item scheduling is a future enhancement, not a bug.
- Templates round-trip losslessly: structure (task attrs + checklist items) is captured on create and faithfully instantiated on apply.

### Exit criteria: MET — template CRUD + structure validation + lossless apply (task + checklists + priority + type + tags) + usage tracking + spawned-task independence all correct.

---

## STAGE F — FORMS & TEMPLATES: COMPLETE (Phases 23–26, all ✅)
Forms builder, public form intake (encrypted, task-mapped, task_attr-validated), submissions view (P25-1 decryption bug fixed), 90-day retention logic, and templates+apply — all verified. **1 real bug found+fixed in this stage: P25-1 (submissions view returned ciphertext). Open items: P24-1 (is_public gates submit not view — LOW), and the standing form-submission-expiry wiring gap (Phase 38).**

---

## Phase 27 — Sprints lifecycle

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 33 automated checks green · 1 design note (P27-1) · demo sprints restored

### Test setup note
The demo workspace has an active sprint. To test the single-active invariant + close-rollover cleanly with QA sprints, all demo sprints were temporarily parked to `closed` (original statuses captured) and **restored at cleanup** (verified active count = original).

### Covered — all green
**A. Create + validation:** member → 403; owner create → 201 `status=planned`; `committed_points` stored; **duplicate name → 409 `sprint.duplicate`**; `start_date > end_date` → 422.
**B. Lifecycle (planned→active→closed) + single-active:** start → 200 `active`; start already-active → 200 idempotent; **start a 2nd sprint while another is active → 422 `sprint.another_active`** (single-active-per-workspace invariant); `GET /sprints/active` returns the active one; close → 200 `{rolled_over}`, DB status `closed`; close already-closed → 200 idempotent; **start a CLOSED sprint → 409 `sprint.invalid_status`**; **close a PLANNED sprint → 409**.
**C. Task attach/detach + points:** `POST /sprints/:id/tasks {task_ids:[…]}` → 204, tasks get `sprint_id`; `GET /sprints/:id/tasks` returns them; **`DELETE /sprints/:id/tasks/:taskId` → 204** (detached); the sprint's tasks carry `story_points`+`status_id` so completed-points is derivable — a done 5-pt task yields **derived completed = 5** (committed = 20 on the sprint object).
**D. Reads:** `GET /sprints` + `?status=closed` filter; nonexistent → 404; member can read; PATCH goal → 200.
**E. Close rollover:** closing an active sprint with an unfinished task (and a `planned` next sprint) → **`{rolled_over:1}` and the unfinished task's `sprint_id` moves to the next planned sprint**; **a DONE task is NOT rolled over** (stays in the closed sprint).

### 🟢 Note P27-1 — completed_points is NOT on the sprint read object (LOW, design)
The `WireSprint` returned by `GET /sprints` and `GET /sprints/:id` exposes only `committed_points`; **`completed_points` is derived only at CLOSE time (`sumCompletedPoints`, snapshotted into the close audit row), not on every read.** So the live burndown "completed points" must be derived by the Sprint Board UI from `GET /sprints/:id/tasks` (each task has `story_points` + `status_id`). Verified the derivation data is present and correct (done-task points sum = 5). This is a valid design (data is available via the tasks endpoint), but if the sprint object is expected to carry a live `completed_points` for the board header, that's a small enhancement. Not a bug. Confirm the Sprint Board UI derives it correctly in Phase 45.

### Exit criteria: MET — lifecycle rules (single-active, valid-status transitions, idempotence), task attach/detach, points derivation, and close-rollover (unfinished → next planned, done stays) all correct.

---

## Phase 28 — Engineering specials (report-bug, eng/home, postmortem)

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 33 automated checks green · 1 setup note (P28-1) · cleanup verified

### Covered — all green
**A. report-bug (unconfigured — graceful):** with NO "Bug Triage" list → **409 `eng.not_configured`** ("create a Bug Triage list first") — the demo has a "Bugs" list, not "Bug Triage" (see P28-1). The app degrades gracefully with a clear guiding error, not a crash.
**B. report-bug (configured, any member):** after creating a "Bug Triage" list → 201; **the bug is created as a Bug-type task IN the Bug Triage list**; **severity defaults to S2** when omitted; it gets an **`sla_due_at`** (§29 SLA keys on the "Bug" type name); the task name is derived from `happened`/`steps`; explicit `severity:"S1"` honored; missing `steps`/`reporter_team` → 422; bad `reporter_team` (not ops/cs/inventory/listing/marketing/internal) → 422; bad severity → 422.
**C. eng/home dashboard rollup (any member):** → 200 with all tiles — `open_bugs {count, top}` (count reflected the reported bugs), `my_sprint_tasks`, `prs_awaiting_me`, `open_incidents`, `stale_tickets`, `current_on_call`, `active_sprint`; **`open_incidents.count = 0`** gracefully (no "Incident" task type seeded — see P28-1); member can read.
**D. Incident postmortem (`POST /eng/incidents/:id/postmortem`, body `{items:{label:boolean}}`):** on a resolved (done/closed) Incident-type task → 200 and stored (`task_postmortems` PK=task_id); **on a NON-incident task → 409 `incident.not_incident`**; **on an OPEN incident (not done/closed) → 409 `incident.not_resolved`**; **re-submitting UPSERTs** (still exactly 1 row — PK=task_id); nonexistent task → 404.

### 🟢 Note P28-1 — Engineering module needs a "Bug Triage" list + "Incident" task type NOT in the default seed (LOW, setup)
- `report-bug` resolves the target list by the exact (case-insensitive) name **"Bug Triage"** and the type by **"Bug"**; `eng/home` + postmortem resolve the **"Incident"** type by name. The demo seed provides a "Bug" type and a "Bugs" list but NO "Bug Triage" list and NO "Incident" type — so out of the box `report-bug` returns **409 `eng.not_configured`** and `open_incidents` is always 0.
- This is CORRECT graceful behavior (the app tells the admin to configure the engineering workspace), NOT a bug. But for BeautyBooth's engineering space to use these features, an admin must create a **"Bug Triage"** list and an **"Incident"** task type (or they should be added to the seed / an eng-space setup step). Logged as a go-live setup item, not a code fix.

### Notes
- High-severity (S0/S1) bugs auto-assign the current on-call engineer (only when one is ACTIVE on call); tested via S1 create (no active on-call in the test window → no assignee, which is the correct fallback).
- `report-bug`/`eng/home`/postmortem statuses: `eng.not_configured` is 409 (a precondition conflict), postmortem create/update is 200 (upsert semantics) — both correct.

### Exit criteria: MET — all 3 engineering endpoints behave per API_DESIGN incl. by-name resolution, graceful not-configured, SLA/severity defaults, home aggregation, and postmortem status/type guards + upsert. Setup dependency flagged as P28-1.

---

## Phase 29 — On-call rotation

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 25 automated checks green · demo shifts intact

### Covered — all green
**A. current + `v_current_on_call` view parity (the tz-correct path):** `GET /on-call/current` → 200; **the endpoint's current shift agrees with the `v_current_on_call` view** (both week_start = 2026-07-13); the current shift's week **covers today using UTC `date('now')`** (today 2026-07-13 ∈ [2026-07-13, 2026-07-19]). This is the fix for the SLA-memory's Dhaka-+6 `CURDATE()` bug class — the view uses `date('now') BETWEEN week_start AND week_end` (UTC), so "who's on call now" is correct at the week boundary (today is a Monday — the exact boundary case). Member can read.
**B. PUT — Monday validation + active engineer (👑 admin/owner):** member → 403; owner PUT a future Monday + active engineer → 200; **`week_end` derived = Monday + 6 = Sunday** (verified: 2027-02-08 → 2027-02-14, `getUTCDay()===0`); **PUT a non-Monday → 422**; malformed date → 422; **invalid engineer → 422 `on_call.invalid_engineer`**; **DEACTIVATED engineer → 422 `on_call.invalid_engineer`** (must be active).
**C. Overwrite (upsert):** PUT the same week with a DIFFERENT engineer → overwrites (new engineer stored); **still exactly 1 row for that week** (upsert on `(workspace_id, week_start)`, not a duplicate insert).
**D. Schedule (range window):** `GET /on-call/schedule` includes the future shifts + the 4 demo shifts, **chronological**; `?from&?to` window → only in-range shifts (exactly 2); member can read.
**E. Delete:** member → 403; owner DELETE a set week → 204 (gone); **DELETE a week with no shift → 404 `on_call.not_found`**; DELETE a non-Monday → 422.

### Notes
- All mutations were done on FAR-FUTURE Mondays (30–40 weeks out) to avoid touching the 4 demo shifts; verified the demo shifts stayed intact (count = 4).
- `getCurrent` returns the assigned shift even if that engineer was later deactivated (the rotation still names them) — a deliberate difference from `report-bug`'s auto-assign, which skips a deactivated on-call engineer (Phase 28). Both are intentional.

### Exit criteria: MET — rotation exact at week boundaries (UTC `date('now')`, today-is-Monday edge), Monday-key + active-engineer validation, week_end derivation, upsert overwrite, and endpoint↔view parity all correct.

---

## Phase 30 — SLA (breached list & override)

**Status: ✅ PASSED** (2026-07-11) · **App bugs found: 0** · 25 automated checks green · **STAGE G (Engineering) COMPLETE**

### Covered — all green
**A. `GET /sla/breached` (🔐 any member) — tz-correct + exclusions + hydration:** returns a **bare array** (no pagination envelope, per §29); a **breached** task (past `sla_due_at`, not done, not archived) **appears**; a **future-SLA** task is NOT listed — the breach predicate is **`sla_due_at < NOW_MS` epoch-ms vs epoch-ms**, so it is timezone-neutral (the SLA-memory's MySQL `UTC_TIMESTAMP()`/Dhaka-+6 bug does NOT apply on libSQL); a **done** task past-SLA is EXCLUDED (`completed_at` set); an **archived** task past-SLA is EXCLUDED; `minutes_breached` ≈ 120 for a 2h breach; **`assignees` are hydrated to full `User[]`** (id + email, not just ids); ordered most-breached-first (asc `sla_due_at`); member can read.
**B. Filters — `?team=engineering` → dev-type alias:** the engineering list **includes the dev-type (Bug) breached task** and **EXCLUDES the non-dev (Task-type) breached task** — the "engineering" pseudo-team resolves to `task_types.is_dev_type = true`.
**C. Override (`PATCH /tasks/:id/sla`, 👑 admin/owner):** member → 403; owner set a FUTURE `sla_due_at` → 200 + `sla_overridden` activity, and **the task DROPS OFF the breached list**; **setting a PAST value → 422 `sla.invalid_due_at`** (must be future); **clearing (`null`) → 200** and the task drops off (no SLA); archived task → 409 `task.archived`; nonexistent → 404.
**D. `v_breached_sla` view parity:** the endpoint queries `tasks` directly (workspace-scoped; the view is ws-agnostic) but **replicates the view's breach predicate exactly** — a still-breached task appears in BOTH the endpoint AND the raw `v_breached_sla` view.

### Notes
- The endpoint deliberately does NOT use `v_breached_sla` (the view has no workspace scope and lacks the severity/reporter_team columns the filters need) — it re-implements the 3 breach predicates (`sla_due_at < now` + `completed_at IS NULL` + `archived_at IS NULL`) on `tasks` directly, backed by `idx_tasks_sla`. Verified predicate parity with the view.
- V1: no `sla_override` tracking column — a later `bug_severity` PATCH will recompute and overwrite a manual override (documented decision, not a bug).

### Exit criteria: MET — SLA math provably correct (tz-neutral epoch-ms, done/archived exclusions, minutes math, hydrated assignees, eng-alias filter), override future-only + clear + drop-off, and endpoint↔view predicate parity all verified.

---

## STAGE G — ENGINEERING & SLA: COMPLETE (Phases 27–30, all ✅)
Sprints (lifecycle/single-active/rollover), engineering specials (report-bug/eng-home/postmortem), on-call rotation (UTC tz-correct), and SLA (tz-neutral breach + override) — all verified, 0 app bugs. **1 setup item: P28-1 (eng module needs a "Bug Triage" list + "Incident" task type not in the default seed).** The Dhaka-+6 timezone bug class flagged in the SLA memory is CONFIRMED FIXED in the astro port (on-call uses UTC `date('now')`; SLA uses epoch-ms `NOW_MS`).

---

## PHASE 31 — Notifications: inbox & preferences (Stage H) — ✅ ALL GREEN (27 checks, 0 app bugs)
**Date:** 2026-07-13 · **Method:** temp `.qa-phase31.mjs` (API + DB verify), demo member `farhana` as subject with full capture/restore of her notification read/snooze states + prefs.

**Covered & PASSED:**
- **A. List + unread-count:** `GET /notifications` (200, cursor-paginated, soft-deleted excluded), correct wire shape (id/type/title/is_read/created_at); `GET /notifications/unread-count` → `{unread_count:N}`, increments by 3 after inserting 3 unread; member reads own (no admin).
- **B. Read/unread/mark-all:** `POST /:id/read` (is_read→1, unread-count −1); `POST /:id/unread` (reverses); `POST /mark-all-read` → unread-count 0.
- **C. Snooze:** `POST /:id/snooze {snoozed_until}` → 200, `snoozed_until` persisted (worker wake is Phase 38).
- **D. Soft-delete:** `DELETE /:id` → 204, `deleted_at` set, excluded from list, re-delete → 404.
- **E. Isolation:** another user's notification → **403 `notification.not_owner`** (read AND delete); nonexistent → **404 `notification.not_found`**. (Note: cross-user is 403 not_owner, NOT 404 — IDs unguessable so distinction is safe; matches service doc.)
- **F. Preferences:** `GET /preferences` → map `type → {in_app_enabled,email_enabled}` (defaults all-true); `PUT /preferences` takes the **symmetric map shape** (not an array), upserts to `user_notification_prefs`, unknown type → 422 (no silent drop), GET round-trips the change.

**App bugs:** none. Two initial FAILs were test-side wrong-shape assumptions (unread-count key is `unread_count`; PUT prefs is a map not `{preferences:[...]}`) — corrected, all green. **Cleanup:** QA notifications deleted, farhana's notif states + prefs fully restored.

---

## PHASE 32 — Notification GENERATION matrix (Stage H) — ✅ ALL GREEN (18 checks) + 5 gap findings
**Date:** 2026-07-13 · **Method:** temp `.qa-phase32.mjs` — drove each real action and asserted the exact notification ROW generated in DB (type/entity/actor/title/body), plus negative "no-notif" proofs. Full cleanup (QA tasks + form hard-deleted, all test notifications swept by internal_id baseline, farhana pref restored, task count back to 436).

**LIVE emit sites (only 3 — mapped from source):** `TaskWriteService.create` + `TaskMembershipService.addAssignees` → **assigned**; `CommentsService` → **mentioned**; `FormsService.submit` → **form_submitted**. All go through `NotificationsRepo.createMany` (a plain multi-insert).

**Positive matrix — PASSED:**
- **assigned:** create-with-assignee AND add-assignee both emit 1 per NEW assignee (entity_type=task, actor set, title "You were assigned to …"); actor never self-notified (own-create + self-assign both → 0); re-adding an existing assignee emits NO duplicate.
- **mentioned:** `@<email-local-part>` in a comment → mentioned user gets 'mentioned' (entity_type=comment, body=140-char slice, title "mentioned you in a comment"); self-mention → author NOT notified; multi-mention → every mentioned user notified.
- **form_submitted:** public form submit → form owner (`created_by`) gets 'form_submitted' (entity_type=form).

**GAP FINDINGS (proven with live evidence — none are crashes; all internally consistent; all added to Phase 47 gate):**
- **P32-A (LOW, product):** status change emits NO notification (no `status_change` live path) — assignees/watchers not told when status flips.
- **P32-B (LOW, product):** a plain comment (no @mention) notifies NO watcher/assignee (no `comment`-type emit; only @mentions notify).
- **P32-C (MEDIUM):** `in_app_enabled` preference is a **dead toggle** — proven: set farhana's 'assigned' in_app_enabled=0, assigned her a task, she STILL got the notification. The flag is read only by the prefs serializer; `createMany` never gates on it.
- **P32-D (MEDIUM):** notification **emails are never sent** — `email_sent_at` never stamped, no notification-email job; `email_enabled` pref is therefore also dead.
- **P32-E (MEDIUM):** `due_soon`/`overdue` reminders **never generated** — no scanner job in `jobs/`; demo seeds these types but no live/job path emits them, so due-date reminders silently never fire (→ Phase 38 to build, or accept).

**App bugs:** none (all generated notifications are correct). The findings are missing/incomplete features + two misleading-but-functional pref toggles — decisions for the user, logged on the Phase 47 gate.

---

## PHASE 33 — SSE & real-time streaming (Stage H) — ✅ ALL GREEN (17 checks, 0 app bugs)
**Date:** 2026-07-13 · **Method:** temp `.qa-phase33.mjs` — streaming `fetch` + a hand-rolled SSE frame parser (split on `\n\n`, parse `event:`/`data:`/`id:`), `AbortController` to bound each read; dev server started with **`SSE_POLL_MS=1000 SSE_HEARTBEAT_MS=2000`** so live delivery + heartbeat are observable in seconds. Endpoint: **`GET /api/v1/stream/inbox`**.

**Covered & PASSED:**
- **Auth:** no token → **401 `auth.missing_token`** as a JSON envelope (auth runs BEFORE header flush, so it's a normal error, not a broken stream); **Bearer** → 200 `text/event-stream` with `connected` as the first frame; **Cookie `accessToken`** (the ONLY auth a browser `EventSource` can send) → 200 + connected. ✅
- **Live delivery:** a notification inserted while connected is pushed as a `notification` event within the poll window; `data` = full wire notification (id/type/title); SSE `id:` = the row's `internal_id` (the resume cursor). ✅
- **Last-Event-Id resume:** connecting with `?last_event_id=N` replays the missed backlog **oldest-first** (internal_id ascending); a fresh connect (no cursor) does NOT replay old notifications (goes live from current max). ✅
- **Per-user isolation:** farhana's stream delivers her own new notification but NEVER rakib's. ✅
- **Heartbeat:** an idle stream emits periodic `heartbeat` keep-alives (2 in ~5s at 2s cadence). ✅
- **Robustness:** an absurd Last-Event-Id (> BIGINT ceiling) and a non-numeric one both degrade to a fresh connect (200 + connected, no backlog flood, no crash). ✅

**App bugs:** none. **Cleanup:** all SSE test notifications swept by internal_id baseline.

**Prod caveat → P33-1 (added to Phase 46 + gate):** all of the above is the NODE runtime (`astro dev`, raw sockets). The express-shim DOES implement real streaming for workerd (first `res.write` resolves a `Response` whose body is a `ReadableStream`, enqueues each subsequent write, closes on `end()`, `cancel()` handles SSE disconnect) — so the architecture is prod-sound — but it MUST be re-verified on the deployed worker with a real browser `EventSource`: incremental (non-buffered) delivery, Cloudflare connection longevity, and clean auto-reconnect+resume when the platform cuts a long connection. Not a bug; a runtime-difference verification.

---

## PHASE 34 — Search (Stage I) — ✅ ALL GREEN (39 checks, 0 app bugs)
**Date:** 2026-07-13 · **Method:** temp `.qa-phase34.mjs` — QA rows created via real API (task/comment/space/list) with a unique run marker, plus direct-DB inserts for a **second workspace** to prove tenant isolation. Endpoint: **`GET /api/v1/search?q=&types=&limit=`** (any member, bare `{tasks,lists,spaces,users,comments,total}` envelope).

**Covered & PASSED:**
- **Per-type matching:** task by name substring; list/space by name; comment by body; user by first/last/email fragment; `total` = sum of the 5 arrays; case-insensitive; user results never leak `password_hash`.
- **Task specifics:** `custom_id` **EXACT** match resolves a task whose name doesn't contain q; custom_id **substring does NOT** match (exact-only by design); archived task excluded + its comments excluded (consistency) + unarchive → searchable again.
- **types CSV:** `types=task` → only tasks; `task,comment` combo; uppercase normalized; **all-unknown tokens ⇒ dropped ⇒ empty result** (200 total=0 — not 422, not fallback-to-all; frontend's stale `note` type safe).
- **LIKE escaping:** q containing `%`/`_` matches **literally** (`100%_literal` found, `100 done` control NOT matched); `q=%` alone returns only rows with a literal `%` — **no table dump / no wildcard injection**.
- **Edge/validation:** missing q → 200 empty (frontend contract); whitespace-only q → trimmed ⇒ empty; q>200 chars → 422; limit=0 → 422; limit=100 → 200 silently clamped (service max 50); limit=2 truncates; no auth → 401.
- **Exclusions:** tombstoned (soft-deleted) comment excluded (§14: body never returned); deactivated user IS searchable with `status` on the wire (by design — UI can badge them).
- **Workspace isolation (all 5 kinds):** second workspace + user/space/list/task/comment inserted directly → ws-1 caller sees NONE of them (direct `workspace_id` scope for tasks/users/spaces; join-scope via space for lists, via task for comments). total=0.

**App bugs:** none. **Cleanup:** all QA + ws2 rows deleted; baseline verified (436 tasks / 16 lists); no marker rows anywhere.

---

## PHASE 35 — Home dashboard: KPIs & agenda (Stage I) — ✅ ALL GREEN (34 checks, 0 app bugs) + 1 tz finding
**Date:** 2026-07-13 · **Method:** temp `.qa-phase35.mjs` — every KPI **recomputed independently in SQL with identical predicates** and compared EXACTLY against the API, then per-tile delta proofs with QA tasks (subject: farhana). Endpoints: `GET /home/kpis`, `GET /home/agenda`.

**Covered & PASSED:**
- **Shape/contract:** exactly 6 camelCase tiles `myTasks/dueToday/overdue/awaitingReview/openTeamTasks/slaBreaches` (SKIP_CAMELIZE contract); each = `{label, value, valueDisplay, trend:0, trendDirection:"flat", isPositive:false, sparkline[7]}`.
- **Exactness vs SQL:** all 6 values matched an independent SQL recompute (farhana: my=15, dueToday=1, overdue=1, review=0, team=287, sla=15).
- **Delta proofs:** +3 assigned open tasks → myTasks+3/openTeamTasks+3, dueToday+1 (only today's), overdue+1 (only yesterday's), tomorrow's in neither; status→done drops the task from open tiles; archive drops it (unarchive restores); reviewer+`pr_status=open` → awaitingReview+1, merged → back (open-PRs-only proven — **the review tile is REAL, not the mock's placeholder-0**); past `sla_due_at` → slaBreaches+1, consistent with `GET /sla/breached`; owner's tiles unmoved by farhana's deltas (user-scoping); sparkline sum tracks value (created-day bucketing).
- **Agenda:** default=today → bare array of FULL wire tasks (name/status_id/due_date/assignees hydrated), contains only today's open tasks (overdue/tomorrow/done excluded); stable order (internal_id asc); user-scoped; `?date=2026-02-30` → 422 (calendar-valid), malformed → 422; kpis unauth → 401.

**🟡 P35-1 (MEDIUM, prod-only, OPEN — added to gate):** `today` is `ymd(new Date())` = **server-local** in HomeService AND TaskWriteService.myWork. Dev box = Asia/Dhaka so all checks are exact locally, but the deployed worker runs **UTC**: between 00:00–06:00 Dhaka, prod "today" = Dhaka's yesterday → Due Today/agenda/my-work day buckets shift. Suggested fix: workspace-tz today via `toLocaleDateString("en-CA",{timeZone})` in one shared helper. Cosmetic: sparkline buckets are UTC-day while `today` is local.

**App bugs:** none in tested (local) behavior. **Cleanup:** QA tasks deleted, notifications swept, baseline 436 verified.

---

## PHASE 36 — Workspace activity feed (Stage I) — ✅ ALL GREEN (37 checks, 0 app bugs)
**Date:** 2026-07-13 · **Method:** temp `.qa-phase36.mjs` — drove **5 real workspace-level mutations via API** and asserted each records an audit row visible in the feed, plus full pagination/filter/isolation/hydration coverage and a whole-feed cursor walk. Endpoints: `GET /activity/recent` (`{data}`), `GET /activity` (`{data, pagination}`). Reads `workspace_activity` ONLY (task-level §13 activity is the separate Phase 16 feed).

**Covered & PASSED:**
- **recent shape/hydration:** `{data:[...]}` (no pagination), newest-first, actor hydrated to full wire `User` OR `null` (never a bare id), `internal_id` NEVER on the wire; `?limit=3`→3, `?limit=0`→422, any member (no role gate), unauth→401.
- **Audit completeness (real mutations record events):** space create→`space/created`, list create→`list/created`, tag create→`tag/created`, workspace PATCH→`workspace/updated`, user role change→`user/role_changed` — each with `actor=owner` and `entity_id` = the mutated entity.
- **Feed pagination:** `{data, pagination:{next_cursor, has_more, total_estimate}}`; `limit=5`→5+has_more; **keyset(internal_id) cursor stable under concurrent insert** (inserted a newer event between page1 and page2 — page2 has no overlap and the newer event never leaked into the older page); created_at continuity page1→page2; malformed cursor→400.
- **Filters:** `entity_type` (only matching kind; invalid→422), `actor_id` (only that actor; empty→422), `from`/`to` ISO time-range (from=t0 includes post-t0 events, to=t0 excludes them; non-ISO→422).
- **Actor hydration edges:** system event (`actor_id` NULL)→`actor:null`; **since-deleted actor** — real user acts, then user deleted → FK `ON DELETE SET NULL` flips `actor_id` to NULL → `actor:null`, event survives, no crash (verified the DDL: `actor_id`→users SET NULL, `workspace_id`→workspaces CASCADE).
- **Workspace isolation:** a 2nd workspace's activity is INVISIBLE to the ws-1 caller; filtering by a foreign actor_id → empty (no cross-tenant leak).
- **Consistency + volume:** recent's top-N == feed's first page; full cursor walk of the entire feed (144 rows) had ZERO duplicates, count == `total_estimate` exactly, and created_at monotonically non-increasing throughout.

**App bugs:** none. **Cleanup:** all QA entities + ws2 removed, shakil role + workspace setting restored, `workspace_activity` back to baseline 136.

---

## PHASE 37 — AI assistant (Stage I) — ✅ ALL GREEN (43 checks, 0 app bugs) — FULLY BUILT & WORKING
**Date:** 2026-07-13 · **Correction:** the assistant is **fully built in astro-app** (the memory note "planned not started" was pre-port). Backed by real OpenAI **gpt-4o-mini** (key present in `.dev.vars`, model + 800-token cap). **Method:** HTTP suite (`.qa-phase37.mjs`, real chat calls) + a deterministic tsx tool-scoping harness (`.qa-phase37-tools.ts`, no LLM) + two `.dev.vars`-edit server restarts for the degradation branches.

**Endpoints:** `POST /assistant/chat` (JSON `{reply,conversationId}` OR SSE stream when `Accept: text/event-stream`), `GET /assistant/conversations` (`{conversations}`), `GET /assistant/conversations/:id` (`{...,messages}`). Tools fire **only in the streaming path**. Rate limit `assistantLimiter` 20/min keyed by user (`u:<sub>`).

**Covered & PASSED:**
- **Auth/validation (no cost):** all 3 routes unauth→401; message missing/empty/non-string/>2000→422; history>20→422; history bad-role→422.
- **Real chat (non-stream) + Bangla + persistence:** a Bangla question → 200 `{reply,conversationId}`, conversation + 2 messages (user+assistant) persisted; reply stays on-topic (KB/system-prompt guardrail — even an off-topic "just say OK" instruction was politely refused in the connectivity probe).
- **Context continuation:** re-posting with the same `conversationId`+history reuses the conversation and appends (4 messages).
- **Streaming (SSE):** 200 `text/event-stream`, 117 `data:{delta}` chunks, terminated by `data:[DONE]`, assistant reply persisted.
- **Tool loop end-to-end (stream):** a tool-inviting prompt completes 200 + [DONE] with a non-empty reply (multi-round tool loop runs live, no crash).
- **Conversations list/get/ownership:** `{conversations}` newest-first; `/:id` → ordered messages (oldest-first, roles present); **a foreign user reading another's conversation → 404 `conversation.not_found`**; unknown id → 404.
- **Rate limit:** 23 rapid calls (invalid bodies, zero OpenAI cost) → first is 422, limiter trips → 429 appears.
- **🔒 Tool scoping (deterministic, tsx harness — the key security property):** `get_my_task_counts` returns each caller's OWN KPIs (owner=17, farhana=15) via `ctx` injected from the JWT; **adversarial model params naming another user (`userId`/`user_id`/`assignee`/`workspaceId`) are IGNORED → still the caller's data** — prompt-injection cannot cross scope because no tool exposes a user-identity parameter (get_my_task_counts: none, get_my_agenda: only `date`, search: only `query`); agenda + search likewise ctx-scoped; unknown/hallucinated tool → `{error}` no crash.
- **Degradation — not_configured (503):** disabled `OPENAI_API_KEY` → restart → every `/assistant/*` route returns **503 `assistant.not_configured`** (clean envelope), while unauth still → 401 (authenticate runs before the 503 shim). Server boots fine (the null-client guard prevents a boot crash).
- **Degradation — bad key (no crash, regression ddf0d12):** invalid `OPENAI_API_KEY` → chat → OpenAI 401 mapped to **502 `assistant.upstream_error`** (generic message, no upstream leak, has request_id) and **the server stays alive (health 200)** — no unhandled 500 crash.

**App bugs:** none. **Cleanup:** all chat_conversations/messages deleted (baseline 0), `.dev.vars` restored to the real key, server back up, QA files + backup removed.

---

## PHASE 38 — Background jobs + cron wiring (Stage J, pre-live FIX phase) — ✅ ALL GREEN (33 job checks) + SCHEDULER BUILT & workerd-verified
**Date:** 2026-07-13 · **Method:** `.qa-phase38.mjs` (jobs on real crafted data via HTTP + internalAuth, R2 creds blanked so janitor/purge never touch the prod bucket) + two source FIXES + a `wrangler dev --test-scheduled` end-to-end scheduler proof.

**Jobs tested (dry_run vs real, DB state verified) — all 5, 33 checks:**
- **internalAuth:** no token → 401; wrong token → 401 (fails closed, `timingSafeEqual` constant-time); correct → 200; unknown slug → 404.
- **session-cleanup** (hourly): `>30d`-expired sessions deleted, unexpired survive; dry_run deletes nothing.
- **attachment-janitor** (hourly): `pending & uploaded_at>1h` deleted; fresh pending + finalized (`uploaded`) survive; dry_run makes no R2 calls.
- **r2-purge** (daily): soft-deleted `>7d` row deleted; `<7d` survives (R2 stubbed).
- **snooze-wake** (5-min): elapsed snooze → `is_read=0` + `snoozed_until=NULL`; future snooze untouched.
- **form-submission-expiry** (daily): `expires_at`-past submission deleted (PII retention), fresh survives.
- **idempotency:** re-runs return `ok:true` (no-op), never crash.

**FIX 1 — missing route added:** `POST /api/v1/jobs/form-submission-expiry` (the job was in the registry + CLI but had no HTTP route) — now internalAuth-guarded like the others. Resolves the "unreachable" half of P25-1.

**FIX 2 — the scheduler (the phase's core deliverable) — BUILT & VERIFIED:**
- New **`src/worker.ts`** — a custom Cloudflare `workerEntryPoint` exporting `createExports(manifest) → { default: { fetch, scheduled } }`. `fetch` is the adapter's default behaviour (unchanged); `scheduled(controller,env,ctx)` mirrors the fetch bootstrap (`setRuntimeEnv(env)` → lazy `initDb()` → `runJob`) and dispatches per `controller.cron` via a `CRON_JOBS` map.
- **`astro.config.mjs`** — `cloudflare({ workerEntryPoint: { path: "src/worker.ts" } })`.
- **`wrangler.jsonc`** — `triggers.crons: ["*/5 * * * *", "0 * * * *", "0 3 * * *"]` (5-min / hourly / daily-03:00-UTC), kept in sync with CRON_JOBS.
- **Verified:** `astro build` succeeds; the built worker chunk contains `scheduled` + all 3 cron patterns + 5 job slugs; `astro dev` (test harness) unaffected. **End-to-end through workerd** via `wrangler dev --test-scheduled` on the built worker: firing `/cdn-cgi/handler/scheduled?cron=…` for each pattern ran the right jobs — `job.snooze-wake.ok` (5-min; + the crafted notification's real `is_read 1→0` flip confirmed), `job.session-cleanup.ok`+`job.attachment-janitor.ok` (hourly), `job.r2-purge.ok`+`job.form-submission-expiry.ok` (daily). All 5 dispatch `.ok` under their correct `requestId: cron:<pattern>`.

**⚠️ Not deployed yet:** the scheduler is wired IN CODE + verified locally, but the LIVE worker has no scheduler until the next `wrangler deploy` — jobs stay dormant in PROD until Phase 46 deploys + `wrangler tail` confirms real Cron Triggers fire. (Deploy also gated on the secrets-in-git cleanup.)

**Still DECISIONS (NOT built — the scheduler is now ready to host them, each = write the job + one CRON_JOBS line):**
- **P13-1** recurrence-spawn job (or hide recurrence UI).
- **P32-E** due_soon/overdue scanner (depends on P32-C/D delivery decisions — it only generates notification rows).
- **P32-D** notification-email dispatch job honoring `email_enabled` (or hide the email prefs column).

**App bugs:** none. **Cleanup:** all crafted rows removed (attachments 0 / form_submissions 0 baseline), crafted notification deleted, R2 creds restored, `wrangler dev` killed, temp files removed, astro dev restored (health 200). **Source changes:** `src/worker.ts` (new) + `astro.config.mjs` + `wrangler.jsonc` + `routes/jobs.ts` (all uncommitted).

---

## PHASE 39 — Security sweep (Stage J) — ✅ ALL GREEN (all security checks) — 2 shim bugs FIXED + 2 header findings
**Date:** 2026-07-13 · **Method:** `.qa-phase39.mjs` — hostile-input fuzzing + JWT crafting (real ACCESS_TOKEN_SECRET) + a 2nd-workspace IDOR fixture. R2 untouched.

**Covered & PASSED:**
- **Secret exposure:** login response, /users list, error bodies (401/500), /health, /metrics — NONE leak password_hash/token_hash/secrets/stack/file-paths. Error 500 body is generic `{internal,"Internal server error"}` (verified branch-5 hides internals).
- **Hostile input → never 500:** malformed JSON → **400** (was 500 — FIXED), body >1mb → **413** (was unenforced — FIXED), `__proto__`/`constructor` pollution → no crash + `Object.prototype` clean + server stays healthy, oversized field → 422, wrong types → 422/400, malformed/traversal/null-byte/unicode/5k-char task ids → 404/422 (never 500).
- **SQL injection:** classic payloads (`' OR '1'='1`, `'; DROP TABLE tasks;--`, UNION, `%' OR 1=1`) in search q / login email / `?role` filter → treated as literals (parameterized), clean results, **tables intact** after `DROP TABLE` attempts, login SQLi → 422.
- **JWT:** no/garbage/tampered/`alg:none`/wrong-secret token → 401; expired validly-signed → 401 `auth.expired_token`; stateless token scopes to its own `workspaceId` claim (fake ws → empty, no cross-tenant leak).
- **Authz + mass-assignment:** member → admin-only (create space, workspace PATCH, role change) → 403; profile PATCH with `role`/`status`/`workspace_id` → IGNORED (no escalation).
- **Cross-workspace IDOR:** a 2nd workspace's task/space/list/comments/conversation/user id → **404** for the ws-1 caller; its notification read/mark → 403/404 (never 200).
- **CORS:** allowed origin (localhost) → ACAO echoed + credentials; foreign origin (evil.example) → not allowed.
- **XSS storage:** `<script>`/`onerror` payloads stored raw at the API (201, no 500) — render-layer neutralizes (Phase 43).
- **Rate limiting:** auth login brute-force from one IP → 401×5 then **429** (limiter active in non-test env). Note: per-isolate best-effort — hard global limits need DO/KV (OPEN-DECISION for prod).

**🔧 FIXED (2 shim contract gaps — the express shim wasn't faithfully implementing body-parser, causing hostile-input 500s):** `src/server/shim/express.ts` `jsonMiddleware` — (1) added `expose: true` to the malformed-JSON 400 error (body-parser sets it; without it the errorHandler's expose-gated branch skipped it → 500); (2) now honors the `limit` option (`express.json({limit:"1mb"})`) → 413 for oversized bodies (was accepted + parsed). Both re-verified: 400 and 413 respectively.

**🔸 FINDINGS → Phase 47 gate:**
- **P39-3 (LOW-MEDIUM):** missing security headers (no `nosniff`, `X-Frame-Options`/CSP, `Referrer-Policy`, HSTS). `X-Powered-By` correctly absent. Add a header middleware (safe set now; CSP after Phase 43; HSTS may come from CF edge — verify P46).
- **JWT stateless note (not a bug):** access tokens validated by signature only (not re-checked vs user existence/status per request); deactivation is TTL-bounded ≤15m. Standard; decide at gate if tighter revocation wanted.

**App bugs:** 2 fixed (both shim, above). **Cleanup:** ws2 fixture + all QA rows removed, baseline 436 restored (one stale "proto" orphan from the pre-fix first run also swept). **Source change:** `src/server/shim/express.ts` (uncommitted).

---

## PHASE 40 — Browser E2E: auth journeys (Stage K) — ✅ ALL GREEN (10/10 checks)
**Date:** 2026-07-13 · **Tool:** Playwright 1.60 + real Chromium (headless, `client/node_modules`) against the dev server. Screenshots in scratchpad. **The Claude-in-Chrome MCP browser could NOT reach the local dev server (remote/sandboxed Chrome), so used Playwright per the plan.** Also had to restart the dev server with `--host` — it binds IPv6-only by default (`localhost`→`::1`), which a local Chromium (`127.0.0.1`) can't reach.

**Covered & PASSED (owner@company.local):**
- **Route guard:** deep-link `/inbox` while logged out → redirected to `/login`.
- **Invalid login:** wrong password → stays on `/login` + shows an error message.
- **Valid login:** → leaves login, lands on the app; the **dashboard renders fully with real data** — sidebar (BeautyBooth workspace, 6 spaces, Engineering section), "Good evening, Owner" greeting, and the 6 Home KPI tiles show the exact Phase-35 values (My Open 17 / Overdue 5 / Open Team 287 / SLA 16), My Work buckets, Agenda, AI-assistant FAB.
- **Session restore:** hard reload → still authenticated (refresh-cookie bootstrap, not bounced to login).
- **Logout:** → back to `/login`.
- **Forgot-password:** link present → navigates to `/forgot-password` → submit → enumeration-safe success message (no crash; real email delivery blocked by P3-1 Mailtrap quota).
- **Console:** zero unexpected errors across the journey (the only messages are expected 401 auth-probes on logged-out pages + a DEV-ONLY antd deprecation warning, all filtered).

**🔸 FINDINGS → gate:** P40-1 (LOW) login page branded "TaskHub" vs app "BeautyBooth" — branding inconsistency (cosmetic). antd `Alert.message` deprecation warning (dev-only, stripped in prod).

**App bugs:** none. **Harness notes for Phases 41-45:** dev server must run with `--host`; selectors `#email`/`#password`/`button:has-text("Sign in")`; Astro dev-toolbar injects extra buttons (Menu/Inspect/Audit/Settings) — use specific selectors; use `waitUntil:"domcontentloaded"` (networkidle never settles with HMR); filter benign console (401 auth-probes, antd/React dev deprecations); a fresh `browser.newContext()` avoids post-logout render races.

---

## PHASE 41 — Browser E2E: shell & navigation (Stage K) — ✅ ALL GREEN (32/32 checks)
**Date:** 2026-07-13 · **Tool:** Playwright + Chromium (headless) vs the `--host` dev server. Screenshots in scratchpad.

**Covered & PASSED:**
- **Deep-link sweep — all 20 authed routes mount clean, zero console errors:** `/`, `/inbox`, `/search`, `/eng`, `/eng/sprint`, `/eng/on-call`, `/settings` + all 9 settings tabs (profile/workspace/members/task-types/tags/statuses/custom-fields/templates/import-export), `/s/:spaceId`, `/s/:spaceId/l/:listId`, `/t/:taskKey`, `/forms`. Each: not bounced to login, app shell present, no error-boundary/crash text, no per-route console errors.
- **404 catch-all:** unknown route → redirect to Home (no crash).
- **Sidebar tree:** click a space → expands to show its lists (sidebar-scroll regression clean) → click a list → list view loads (`/s/../l/..`); nav shows an active-state indicator.
- **Browser back/forward:** client-side nav Home→Inbox, browser BACK → Home, FORWARD → /inbox — SPA popstate integrity confirmed (no navigation-blocking code exists; React Router handles history natively).
- **Error boundary:** a forced 500 on `/home/kpis` (Playwright route-intercept) → the shell survives, no white-screen/crash (graceful degradation).
- **Responsive:** zero horizontal overflow at 1366×768 AND 1920×1080.
- **Console:** zero unexpected errors across the ENTIRE sweep (38 messages, all benign — 401 auth-probes, dev-only antd deprecations, the injected 500).

**🔸 FINDING → gate:** P41-1 (LOW) the advertised **⌘K is a dead shortcut** — sidebar hint + search-page "Press ⌘K anywhere to open the command palette", but no keydown handler exists and there's no palette modal (the trigger just navigates to /search on click). Search works via the pill click. Minor: `/search` seems to add a duplicate history entry (back needs two presses).

**App bugs:** none. **Investigation note:** browser-back initially looked broken, but a minimal clean test (`/`→`/inbox`→back→`/`) proved it works — the earlier failure was history pollution from the 20-route `page.goto` sweep + a /search-specific duplicate entry.

---

## PHASE 42 — Browser E2E: task views List/Board/Calendar (Stage K) — ✅ ALL GREEN (21/21 checks)
**Date:** 2026-07-13 · **Tool:** Playwright + Chromium (headless) vs `--host` dev server, with direct DB verification of DnD persistence (@libsql dynamic-imported from astro-app into the client/ CJS script). List used: "Order Issues" (48 tasks, statuses To Do/In Progress/Review/Done). Screenshots in scratchpad.

**Covered & PASSED:**
- **List view:** renders the grouped task table (50 row checkboxes visible), controls Group/Filter/Sort present, multi-select a row → bulk-action bar appears, Sort control opens a menu.
- **Board view:** all 4 status columns render (TO DO / IN PROGRESS / REVIEW / DONE with counts), quick-add ("Add task") per column.
- **🎯 Board DnD — status PERSISTS (the exit criterion):** dragged a To Do card ("Address change request for order #1345") to the In Progress column via @dnd-kit pointer drag (down → 10px activation move (>4px constraint) → move to target column → up) → **the task's `status_id` changed to In Progress IN THE DB** and was confirmed, then restored to To Do.
- **Calendar view:** month grid renders with task events on due dates + Today highlighted; Month/Week/Day toggle present; Unscheduled panel ("21 tasks without dates · drag to schedule") present; month nav next → August 2026, "Today" → back to July 2026.
- **View switching:** clicking the List/Board/Calendar tabs changes the URL (`/board`, `/calendar`, back to list) and renders each view.
- **Stability:** zero page errors across all three views.

**App bugs:** none. **New findings:** none. **Cleanup:** the dragged task's status restored to To Do (verified + finally-block backstop); demo data intact.

---

## PHASE 43 — Browser E2E: task drawer + XSS render-sanitization (Stage K) — ✅ ALL GREEN (21/21 checks)
**Date:** 2026-07-13 · **Tool:** Playwright + Chromium (headless) vs `--host` dev server, DB-verified mutations. Drawer = antd `Drawer` (right slide-over, `.ant-drawer-body`, single-scroll panel — no tabs). A QA task was seeded with stored XSS payloads in name + description.

**🔒 XSS render-sanitization — ALL SAFE (the critical security verify; pairs with Phase 39 "stored raw"):**
- Stored `<script>window.__xssDesc=1</script>`, `<img src=y onerror="window.__xssImg=1">`, `<img onerror>` in the name, and `javascript:` — **NONE executed** (no `window.__xss*` flags ever set; zero alert/confirm dialogs fired).
- Task **name** and **description** both render the payload as **inert escaped text** (visible literally, no image load, no script run). DOMPurify strips `<script>`/`onerror`; no live `<script>`/`<img onerror>` element exists in the DOM.
- **Search-result title** (SearchPage `dangerouslySetInnerHTML` + `highlight()`): `highlight()` calls `escapeHtml()` BEFORE wrapping matches in `<mark>`, so a task named `<img onerror=…>` renders escaped and does NOT execute (verified in the browser). `TiptapReadOnly` uses a strict DOMPurify whitelist (b/i/em/strong/p/br/a/h1-3/ul/ol/li/blockquote/code/pre + href/title/target only).

**Drawer interactions — PASSED:**
- Opens via `/t/:taskKey` (→ `?task=` on the list URL). All 8 sections render: Status, Priority, Assignees, Due date, DESCRIPTION, CHECKLISTS, ATTACHMENTS (Upload + drag-drop zone), COMMENTS.
- **Comment add:** typed into `textarea[placeholder*="comment"]` → **⌘+Enter → persists in DB** (0→1).
- **Checklist add:** "Add checklist" → name + Enter → **persists in DB** (0→1).
- **Status change:** clicked the status pill in the drawer → antd Dropdown → picked a different status → **persists** (To Do→In Progress).
- No page errors during any interaction.

**Coverage note:** the remaining drawer widgets (description TipTap edit, assignee/watcher/tags pickers, dependencies, custom-field widgets, subtask create/navigate, archive/delete) render correctly and their APIs were exhaustively tested in Phases 12-20; three representative UI mutations (comment/checklist/status) confirm the drawer→API wiring persists. **Real attachment upload deferred to Phase 46** (would hit the prod R2 bucket; the Upload affordance + drop zone render).

**App bugs:** none. **New findings:** none. **Cleanup:** XSS QA task + its comments/checklists deleted, baseline 436 restored.

---

## PHASE 44 — Browser E2E: Settings UI, all 9 tabs (Stage K) — ✅ ALL GREEN (20/20 checks) + 1 honesty finding
**Date:** 2026-07-14 · **Tool:** Playwright + Chromium (headless) vs `--host` dev server, DB-verified CRUD. Screenshots in scratchpad.

**Covered & PASSED:**
- **Render sweep — all 9 tabs mount clean:** profile, workspace, members, task-types, tags, statuses, custom-fields, templates, import-export (heading present, no crash); `/settings` (index) → redirects to `/settings/profile`.
- **Profile / Workspace:** "Change password" + "Save changes" present; workspace has its settings inputs + "Save changes" + "Delete workspace".
- **Members:** "Invite member" opens an invite modal (email + role).
- **Tags CRUD:** "New tag" → create → **persists in DB** (then cleaned).
- **Task types CRUD:** "New task type" → create → **persists in DB** (then cleaned).
- **Statuses / Custom fields / Templates:** per-list status groups render; per-list "Add field" builder renders; templates empty-state + "New template".
- **Import honesty:** "Start import" → honest toast "{source} importer — coming soon".
- **Stability:** zero unexpected console/page errors across all tabs (401 auth-probes + antd dev deprecations filtered).

**🔸 FINDING → gate:** **P44-1 (LOW-MEDIUM):** the Import/Export **"Export" (JSON/CSV/SQL) buttons FAKE success** — the handler shows a toast "{format} export ready — file would download here." but **no file downloads** (verified: zero Playwright `download` events). Dead button pretending to work — exactly what the phase warns against. (The "Start import" buttons are honest.) Fix: implement export, or make Export an honest "coming soon"/disabled state.

**App bugs:** none. **Cleanup:** QA tag + task-type deleted, no QA44 rows leaked.

---

## PHASE 45 — Browser E2E: forms, engineering, inbox, search, home (Stage K FINALE) — ✅ ALL GREEN (15/15 checks) + 2 findings
**Date:** 2026-07-14 · **Tool:** Playwright + Chromium (headless) vs `--host` dev server, DB-verified, two browser contexts for the SSE test, a clean no-auth context for the public form. Screenshots in scratchpad.

**Covered & PASSED:**
- **Home:** 6 KPI tiles (My Open/Due Today/Overdue/Review/Team/SLA) + My Work buckets + Agenda render.
- **Search:** typing "order" → 62 highlighted (`<mark>`) results → clicking a result **deep-links to the task** (`?task=…`).
- **Engineering:** Eng Home widgets (Open bugs / In sprint / PRs / incidents / on-call) render; Sprint Board (active Sprint 14, tasks, committed pts) renders; On-call weekly rotation renders.
- **Inbox:** renders with tabs All/Unread/@Mentions/Assigned + "Mark all as read"; the new notification **is present after reload** (data path works).
- **Forms:** "New form" → opens the antd **create-form modal** (title + list — works, not the old regression); a **published public form submitted from a clean no-auth context → a task appeared in the bound list** (51→52, then cleaned) — the full public-intake E2E.
- **Stability:** zero page errors across every surface.

**🔸 FINDINGS → gate:**
- **P45-1 (MEDIUM):** the **SSE realtime stack is UNUSED by the frontend**. `NotificationBell` comment: "SSE is auth-blocked (EventSource can't send the in-memory Bearer); poll the badge as the realtime substitute." So `/stream/inbox` + sseHub + NotificationStreamRepo (built + tested Phase 33) are effectively dead code from the UI. Realtime = badge polling unread-count every 60s; the inbox list updates on nav/reload, NOT live (verified: a new notification did not appear without reload). **Makes P33-1 (SSE-on-workerd) moot/low** — nothing consumes SSE. Decide: accept 60s polling for V1 (don't call it "realtime") or wire SSE with an EventSource-compatible auth (accessToken cookie / `?token=`).
- **P27-1 (LOW, confirmed):** the Sprint Board shows tasks + total pts + committed pts but **no live completed/velocity counter** (completed_points snapshots only at close).

**App bugs:** none. **Cleanup:** QA form + spawned task + notification removed; baseline 436.

## STAGE K — BROWSER E2E: COMPLETE (Phases 40–45, all ✅)
Auth journeys, shell/navigation (20 routes), task views (List/Board/Calendar incl. DnD persistence), task drawer + XSS render-sanitization, settings (9 tabs), and forms/eng/inbox/search/home — all verified in a real Chromium via Playwright. UI findings for the gate: P40-1 (TaskHub/BeautyBooth branding), P41-1 (dead ⌘K), P44-1 (fake Export), P45-1 (SSE unused → 60s polling), P27-1 (no sprint velocity). Zero app crashes; the XSS render-sanitization (DOMPurify + escapeHtml) is confirmed safe.

---

## PHASE 46 — Production (deployed worker) verification (Stage L) — ✅ read + R2 DONE (cron/deploy → Phase 47) — 4 findings
**Date:** 2026-07-14 · **Target:** https://beautybooth-tasks.tanver018765.workers.dev + PROD DB, CAREFUL mode. User chose: **R2 round-trip only** for prod writes; **defer** cron-live + the health/ready deploy to Phase 47 (blocked by secrets cleanup). Every prod side effect was cleaned up.

**Read-only verification — GREEN:**
- Worker up: `/health`→200, `/health/version`→200 (v1.0.0, git_sha "unknown", node v22.14.0). SPA shell serves. Unauth API → 401.
- **Authenticated read smoke (owner login):** all 13 GET families → **200** (home/kpis, home/agenda, my-work, spaces, users, search, notifications, unread-count, activity/recent, sla/breached, tags, task-types, sprints). **Latency:** p50 ~0.7s, p95 ~1.5s (fast reads 0.28-0.42s; heavy 1.0-1.5s). Session cleaned (logout 204).
- **PROD = the demo seed CONFIRMED:** home KPIs = openTeamTasks 287 / myTasks 17, identical to the demo baseline.

**🎯 PROD R2 byte round-trip — GREEN (the only thing never verified anywhere; R2 was stubbed in all local tests):**
- `POST /uploads/sign` → 201 + presigned PUT URL → **PUT bytes to real R2 → 200** → object present at storage_key (direct aws4fetch HEAD 200) → `finalize` → 200 (worker HEAD-verifies) → `download` → 200, **downloaded bytes EXACTLY match uploaded**. R2 store+retrieve integrity confirmed on prod. storage_key pattern = `workspaces/<wsId>/attachments/<fakeId>.<ext>` (the worker generates its own id; ignores any client id). **Cleanup:** attachment + R2 object deleted (HEAD 404) + task hard-deleted; a broad sweep of the `workspaces/` prefix confirms **0 QA objects remain in prod R2**.

**🔸 FINDINGS → gate:**
- **P46-3 (HIGH, go-live blocker):** PROD runs the demo seed + `owner@company.local / Owner@12345` logs into the public prod URL. Clean demo data / delete-rotate demo accounts before go-live.
- **P46-1 (MEDIUM, FIXED-pending-deploy):** `/health/ready` persistent 503 — the 500ms DB-ping timeout is too tight for prod Turso latency (readiness false-negative while real queries work). Fixed 500→2500ms in `health.ts`; verify →200 on prod after deploy.
- **P46-2 (LOW-MED):** `/metrics` publicly exposed on prod (no auth) — protect it.
- **P39-3 (confirmed on prod):** the CF edge adds NO security headers (no HSTS/nosniff/X-Frame).

**DEFERRED to Phase 47 (blocked by the git-secrets cleanup → deploy):** cron-trigger live verification (`wrangler tail` + `background_job_runs_total`), and deploying the P46-1 health/ready fix. **App bugs:** 1 fixed (P46-1). **Source change:** `src/server/routes/health.ts` (uncommitted).

---

## PHASE 47 — Final regression & go-live gate (Stage L) — ✅ REGRESSION ALL GREEN (33 checks) + gate synthesis
**Date:** 2026-07-14 · **Method:** isolation-probed test env; verified all 9 code fixes intact in source; ran one compressed critical-path regression (auth → structure → task-lifecycle → shim-hardening → forms → eng → notifications → search → home → security).

**Regression — GREEN (no fix broke anything):** auth (login/refresh/invalid/no-token); structure (spaces/lists/tags/types + create); task lifecycle (parent+subtask, **P12-1 subtasks_count=1**, comment, checklist, assignee, status→done, **P13-2 start>due→422**, **P13-3 nullable-clear→200**, archive); **P39 shim (malformed JSON→400, >1mb→413)**; forms public submit + **P25-1 decrypt-on-read**; eng/home + sprints + on-call + sla; notifications list/count/prefs; search + home 6-tile kpis + agenda; security (member→admin 403, IDOR→404, SQLi literal + tables intact). Baseline 436 restored.

**Fix inventory verified intact (source + behavioral):** P0-1 jwt default-import, P39 shim expose:true + parseByteLimit, P46-1 health/ready 2500ms, P25-1 decryptSubmissionData, P38 form-expiry route + `src/worker.ts` scheduled() + wrangler crons.

**GO-LIVE VERDICT:** FUNCTIONALLY GREEN — ~1690 checks across 48 phases, 9 code bugs fixed, zero regressions, XSS/injection/IDOR/isolation all safe. **NOT yet safe to declare live** until the deploy + cleanup blockers are closed (see the go-live readiness report). Blockers: (1) rotate git-tracked secrets + rewrite history [blocks deploy]; (2) deploy the scheduler + fixes (health/ready P46-1; **fix+deploy tz P35-1** — still unfixed in code) so cron runs + readiness passes + day-boundaries are correct; (3) clean demo data + demo accounts off prod (P46-3, known-password owner live). Plus MEDIUM product decisions (notification-prefs honesty P32-C/D/E, SSE-vs-polling P45-1) and LOW cosmetic items (P40-1/P41-1/P44-1/P27-1) for the user to resolve. Security hardening (P39-3 headers, P46-2 /metrics) recommended.
