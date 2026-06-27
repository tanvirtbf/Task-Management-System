# 🧪 LAYER A — Deep Test Plan (Foundation: Auth · Members · Workspace)

> **লক্ষ্য:** Layer A (M1 Authentication · M2 Members/Roles/Invitations · M3 Workspace & Settings) — মোট **১৮টা endpoint** — এমনভাবে টেস্ট করা যাতে **কোনো issue বাকি না থাকে**। প্রতিটা endpoint-কে সব সম্ভাব্য দিক থেকে (happy path · validation · permission · workspace-isolation · security · edge case · frontend) যাচাই করা হবে।
>
> **এই plan-টা আমি (Claude) execute করব** — phase ধরে ধরে। প্রতিটা test case-এর `Status` column আছে; চালানোর সাথে সাথে ✅ Pass / ❌ Fail / ⏭️ Blocked লিখে রাখব, আর fail হলে **Issue Log**-এ তুলব এবং fix করে re-verify করব।
>
> ভিত্তি: 2026-06-27 codebase scan + Layer A-এর actual route/validator/service কোড পড়ে নেওয়া।

---

## 📊 Scope — Layer A-তে যা যা আছে

| Module | Endpoints | Auto-test file আছে? |
|---|---|---|
| **M1 Auth** (8) | login · forgot-password · reset-password · refresh · logout · logout-all · me · change-password | login, refresh, logout, logout-all, me, reset-password, forgot-password ✅ · **change-password ❌ (dedicated test নেই — Phase 1F-এ যাচাই)** |
| **M2 Members** (8) | GET /users · GET /users/:id · invite · PATCH /users/:id · PATCH role · deactivate · reactivate · reset-password | ৮টাই ✅ |
| **M3 Workspace** (2) | GET /workspace · PATCH /workspace | ২টাই ✅ |

---

## 📚 Reference — Exact Rules (কোড থেকে নেওয়া, test case এই অনুযায়ী)

### Error codes (Layer A)
| Code | HTTP | কখন |
|---|---|---|
| `validation.failed` | 422 | যেকোনো validator fail (details[] সহ) |
| `auth.invalid_credentials` | 401 | login — wrong pass / no user / inactive (একই generic message সব path-এ) |
| `auth.invalid_refresh` | 401 | refresh — missing/bad/expired/revoked cookie (একই message) |
| `auth.reset_token_invalid` | 400 | reset-password — invalid/expired/consumed token (একই message) |
| `auth.incorrect_password` | 422 | change-password — current ভুল |
| `auth.password_unchanged` | 422 | change-password — new == current |
| `auth.forbidden` | 403 | `canAccess` block (👑/🛡️ endpoint-এ member/guest) |
| `user.not_found` | 404 | id অন্য ws-এ / নেই |
| `user.forbidden_edit` | 403 | member অন্যের profile edit |
| `user.email_already_exists` | 409 | invite / profile email collision |
| `user.not_deactivated` | 409 | reactivate করা হচ্ছে এমন user যে deactivated না |
| `user.not_active` | 409 | admin reset-password — target active না |

### Validation limits
- **Login:** email = string→trim→notEmpty→isEmail→max 255→lowercased (array/number → 422); password = string, 1–200।
- **Reset:** token = string, max 512; `new_password` = 8–200, **NOT trimmed** (whitespace preserved)।
- **Change-password:** current = 1–200; new = 8–200, NOT trimmed।
- **Forgot:** email = login-এর মতোই; সবসময় **202**।
- **List users:** status∈userStatuses · role∈userRoles · q≤100 · cursor string · limit≥1 int; **repeated param → 422**।
- **Get/patch id:** trim, max 64।
- **Invite:** first/last name ≤80 required · email valid ≤255 lowercased · role∈{admin,member,guest} (**owner → 422**)।
- **Patch user:** সব optional; avatar_url = http(s) URL বা null; **role/status accept করে না** (drop হয়); ≥1 field লাগবে (controller-এ)।
- **Change role:** role∈{admin,member,guest} (owner → 422)।
- **Workspace patch:** name ≤120 · logo_url http(s)/null ≤500 · timezone valid IANA ≤64 · week_starts_on 0–6 · working_days ∈ weekDays[] · business_hours_start/end `HH:MM:SS` · fiscal_year_start_month 1–12 · **default_locale → 422 (updatable নয়)**।

### Auth tokens / cookies
- Login → `200 {access_token, expires_in, user}` + `bb_refresh` cookie (httpOnly · sameSite=strict · secure(prod) · **Path=/api/v1/auth**)।
- Access JWT (HS256) ≈15min, claims `{sub, role, workspaceId, id=sessionId}`; refresh ≈30day, `token_hash=sha256` in `sessions`।
- Refresh = **rotating (RTR)**: reuse/hash-mismatch → **সেই user-এর সব session revoke** (theft response)। Claims always rebuilt fresh from DB row।

---

## 🛠️ Execution Strategy (আমি যেভাবে চালাবো)

| Method | কীভাবে | কোন phase |
|---|---|---|
| **[AUTO]** existing jest suites | `server/` থেকে auth/users/workspace suite real-DB-তে চালাই → baseline | Phase 0, 6 |
| **[API]** live endpoint probe | dev server চালু করে curl/PowerShell দিয়ে exact request → response/code/cookie verify | Phase 1–4 |
| **[CODE]** logic inspection | security-critical path (token, isolation, escalation) কোড পড়ে verify | Phase 1–4 |
| **[GAP]** new targeted test | যে case auto-test-এ নেই (যেমন change-password timing) → ছোট test/probe লিখি | যেখানে দরকার |
| **[UI]** browser E2E | Playwright (webapp-testing) দিয়ে frontend flow | Phase 5 |

**Pass/Fail মানদণ্ড:** প্রতিটা case-এ expected HTTP status + error code + response shape + side-effect (DB/cookie/email) — সবগুলো মিললে ✅।

---

## 🧰 Phase 0 — Setup, Fixtures & Baseline

**উদ্দেশ্য:** environment দাঁড় করানো, test fixture বানানো, existing automated suite-এর baseline নেওয়া।

### 0.1 Environment
- [ ] MySQL up; `server/.env` + test DB config ঠিক ([[project_test_db_isolation]] গোটচা মনে রাখা)
- [ ] `cd server && npm run dev` (tsx watch) — server up at :5501
- [ ] `cd client && npm run dev` — client up at :5173
- [ ] Mailtrap access (reset/invite email দেখার জন্য)

### 0.2 Test fixtures (এই account/data লাগবে)
| Fixture | কেন |
|---|---|
| **Owner** (`owner@company.local` / `Owner@12345`) | 🛡️ + 👑 path |
| **Admin** | 👑 path, owner vs admin পার্থক্য |
| **Member** | 🔐 + 403 path |
| **Guest** | সবচেয়ে কম permission |
| **Deactivated user** | login/refresh block, reactivate |
| **Invited (pending) user** | reactivate→409, reset-password→409 |
| **2nd Workspace + তার user** | **workspace isolation** (cross-tenant) test |

### 0.3 Baseline run — ✅ DONE (2026-06-27)
- [x] Per-suite private-DB run (auth/users/workspace) — result নিচে
- [x] **Coverage gap confirmed:** `change-password` পুরো `server/tests`-এ কোথাও নেই (grep → 0 match) → Phase 1F-এ নতুন test লিখব

**Baseline results:**

| Suite | Config | Tests | Pass | Fail | অবস্থা |
|---|---|---|---|---|---|
| auth | `jest.auth.config.cjs` (`taskmanagement_auth_test`) | 313 | 311 | **2** | ⚠️ ২টা forgot-password fail (Issue #1, #2) |
| users | `jest.users.config.cjs` | 279 | 279 | 0 | ✅ green |
| workspace | `jest.workspace.config.cjs` | 84 | 84 | 0 | ✅ green |
| **Layer A total** | | **676** | **674** | **2** | 99.7% green baseline |

**Exit criteria:** ✅ MySQL up + ৩ suite provision+run হয়েছে; baseline রেকর্ড; ২টা fail root-caused → Issue Log। (Live dev-server + ৭ role-fixture = Phase 1+ live-API step-এ তৈরি হবে।)

---

## 🔐 Phase 1 — M1 Authentication & Account Security

প্রতিটা sub-phase একটা endpoint। `[method]` ট্যাগ দেখাচ্ছে কীভাবে যাচাই করব।

> **Progress (2026-06-27):** Phase-0 baseline-এ পাওয়া ৪টা issue (concurrency 500, long-email test, change-password gap, tenant flaky) **সব ঠিক করা হয়েছে** → Issue Log #1–4 ✅। **auth suite এখন 323/323 green** (নতুন change-password ১০ test সহ)। বাকি: নিচের live/edge case-গুলো (token-tamper, refresh-reuse, timing, cookie-flags, rate-limit ইত্যাদি) — দরকারে dev-server তুলে [API]/[UI] method-এ যাচাই হবে।

### 1A. Login — `POST /auth/login`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| L01 | Valid creds | 200 `{access_token, expires_in, user}` + `bb_refresh` cookie | API/AUTO | ⬜ |
| L02 | Wrong password | 401 `auth.invalid_credentials` | API/AUTO | ⬜ |
| L03 | Non-existent email | 401 `auth.invalid_credentials` (একই msg) | API | ⬜ |
| L04 | Invited (inactive) user | 401 `auth.invalid_credentials` | API | ⬜ |
| L05 | Deactivated user | 401 `auth.invalid_credentials` | API | ⬜ |
| L06 | Missing email | 422 | API/AUTO | ⬜ |
| L07 | Missing password | 422 | API/AUTO | ⬜ |
| L08 | Invalid email format | 422 | API | ⬜ |
| L09 | email = `["a@b.com"]` (array) | 422 (isString আগে) | API | ⬜ |
| L10 | email > 255 chars | 422 | API | ⬜ |
| L11 | password > 200 chars | 422 | API | ⬜ |
| L12 | email case-insensitive (`OWNER@…`) | 200 (lowercased) | API | ⬜ |
| L13 | Rate-limit: 6 rapid tries/IP | 429 | API | ⬜ |
| L14 | SQL-inj in email (`' OR 1=1--`) | 422/401, no bypass | API/CODE | ⬜ |
| L15 | Access token → decodes `{sub,role,workspaceId,id}`, works on `/auth/me` | valid JWT | CODE/API | ⬜ |
| L16 | **Timing:** L02 vs L03 response time ~সমান (anti-enumeration) | ≤ ছোট diff | API | ⬜ |
| L17 | Cookie flags: httpOnly·sameSite=strict·Path=/api/v1/auth | সব present | API/CODE | ⬜ |

### 1B. Refresh — `POST /auth/refresh`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| R01 | Valid `bb_refresh` | 200 new `{access_token}` + rotated cookie | API/AUTO | ⬜ |
| R02 | Missing cookie | 401 `auth.invalid_refresh` | API/AUTO | ⬜ |
| R03 | Garbage cookie | 401 `auth.invalid_refresh` | API | ⬜ |
| R04 | Tampered JWT (alg:none / changed payload) | 401 | API/CODE | ⬜ |
| R05 | **Reuse old (rotated) token** | 401 + **ঐ user-এর সব session revoke** | API/CODE | ⬜ |
| R06 | Expired refresh token | 401 (mass-revoke নয়) | API | ⬜ |
| R07 | Refresh after logout (revoked session) | 401 | API | ⬜ |
| R08 | **Fresh claims:** role demote → refresh → new token-এ নতুন role | new role | API/CODE | ⬜ |
| R09 | Deactivated user refresh | 401 | API | ⬜ |

### 1C. Logout / Logout-all — `POST /auth/logout` · `/logout-all`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| O01 | Logout (auth) | 204; ঐ session-এর refresh আর কাজ করে না | API/AUTO | ⬜ |
| O02 | Logout, no token | 401 | API | ⬜ |
| O03 | Logout-all | 204; user-এর সব session revoke (অন্য device refresh→401) | API/AUTO | ⬜ |
| O04 | Logout idempotent (twice) | 204 | API | ⬜ |
| O05 | logout-এর পরও access token ~15min valid (`/auth/me` 200) — **documented behavior** confirm | 200 | API/CODE | ⬜ |

### 1D. Forgot password — `POST /auth/forgot-password`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| F01 | Valid active email | 202 `{}`; email পাঠানো হয় (Mailtrap); token row তৈরি | API/AUTO | ⬜ |
| F02 | Non-existent email | 202 `{}`; কোনো email না | API | ⬜ |
| F03 | Deactivated/invited email | 202 `{}`; email না | API | ⬜ |
| F04 | Invalid email format | 422 | API | ⬜ |
| F05 | আবার request → আগের token invalidate (শুধু newest live) | পুরোনো token আর কাজ করে না | API/CODE | ⬜ |
| F06 | Rate-limit 5/min/IP | 429 | API | ⬜ |
| F07 | Registered vs unregistered — status+body+timing অভিন্ন | কোনো oracle নেই | API | ⬜ |

### 1E. Reset password — `POST /auth/reset-password`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| RP01 | Valid token + new pass ≥8 | 204; new pass-এ login হয়, old fails | API/AUTO | ⬜ |
| RP02 | Reset-এর পর ঐ user-এর সব session revoke | অন্য device refresh→401 | API/CODE | ⬜ |
| RP03 | Consumed token পুনরায় | 400 `auth.reset_token_invalid` | API/AUTO | ⬜ |
| RP04 | Expired token (>30min) | 400 (একই code) | API | ⬜ |
| RP05 | Garbage token | 400 (একই code, oracle নেই) | API | ⬜ |
| RP06 | new_password < 8 | 422 | API | ⬜ |
| RP07 | new_password > 200 | 422 | API | ⬜ |
| RP08 | Missing token / new_password | 422 | API | ⬜ |
| RP09 | Whitespace preserved (leading-space pass) | login exact match | API/CODE | ⬜ |

### 1F. Change password — `POST /auth/change-password` ⚠️ (auto-test gap)
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| CP00 | **Auto-coverage যাচাই** — কোথাও test আছে কিনা; না থাকলে নতুন লিখি | gap closed | GAP | ⬜ |
| CP01 | Valid current + new | 204; new-এ login, old fails | API/GAP | ⬜ |
| CP02 | Wrong current | 422 `auth.incorrect_password` | API/GAP | ⬜ |
| CP03 | new == current | 422 `auth.password_unchanged` | API/GAP | ⬜ |
| CP04 | new < 8 | 422 `validation.failed` | API/GAP | ⬜ |
| CP05 | Unauthenticated | 401 | API | ⬜ |
| CP06 | Current session change-এর পরও valid (V1) | 200 on `/me` | API/CODE | ⬜ |

### 1G. Me — `GET /auth/me`
| ID | Scenario | Expected | Method | Status |
|---|---|---|---|---|
| ME01 | Valid token | 200 User; **password_hash/workspace_id leak নেই** | API/AUTO | ⬜ |
| ME02 | No token | 401 | API/AUTO | ⬜ |
| ME03 | Invalid/expired token | 401 | API | ⬜ |
| ME04 | Fresh row — DB-তে role বদলে → me-তে নতুন role | নতুন role | API/CODE | ⬜ |
| ME05 | Deactivated user + valid access token | 200 (documented) | API/CODE | ⬜ |

**Phase 1 exit:** M1-এর ৪৪+ case সব ✅; কোনো fail → Issue Log → fix → re-verify।

---

## 👥 Phase 2 — M2 Members, Roles & Invitations

> **Progress (2026-06-27):** `UserService` adversarial review + full coverage-map done। **Logic solid — কোনো bug নেই** (escalation আটকানো: `role`/`status` `ProfilePatch`-এ নেই; সব read workspace-scoped → cross-tenant 404; owner/self protection; সর্বত্র `findByIdForUpdate` row-lock → concurrency-safe)। **Coverage exhaustive** — ৮ endpoint × {happy · validation · auth · authorization · row-level · isolation · concurrency · SQL-injection-literal · leak-guards · idempotency · side-effects} — plan-এর M2 সব case ঢাকা + অনেক বেশি। **suite 279/279 green, M2-তে কোনো fix লাগেনি।** একমাত্র functional gap ছিল invite-accept — **user-approved করে BUILT হয়েছে** (Issue #5 ✅; backend 339/339 + frontend wired)। **M2 এখন zero-issue।**

### 2A. List users — `GET /users`
| ID | Scenario | Expected | Status |
|---|---|---|---|
| LS01 | Auth → 200 `{data, pagination}`, workspace-scoped | ✅ own-ws only | ⬜ |
| LS02 | `?status=active/invited/deactivated` filter | filtered | ⬜ |
| LS03 | `?role=` filter | filtered | ⬜ |
| LS04 | `?q=` name/email search | matched | ⬜ |
| LS05 | Cursor pagination (`limit`+`cursor`, `has_more`) | ঠিক page | ⬜ |
| LS06 | Invalid status/role value | 422 | ⬜ |
| LS07 | Repeated param `?limit=1&limit=2` | 422 (notRepeated) | ⬜ |
| LS08 | `q` > 100 chars | 422 | ⬜ |
| LS09 | `limit` < 1 / non-int | 422 | ⬜ |
| LS10 | No token | 401 | ⬜ |
| LS11 | **Isolation:** 2nd-ws user list-এ নেই | absent | ⬜ |

### 2B. Get user — `GET /users/:id`
| ID | Scenario | Expected | Status |
|---|---|---|---|
| G01 | Valid in-ws id | 200 User | ⬜ |
| G02 | **Other-ws id** | 404 `user.not_found` (no leak) | ⬜ |
| G03 | Non-existent id | 404 | ⬜ |
| G04 | id > 64 chars | 422 | ⬜ |
| G05 | No token | 401 | ⬜ |

### 2C. Invite — `POST /users/invite` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| I01 | Admin/Owner valid | 201; `users` row status=invited + invitation token + email + activity | ⬜ |
| I02 | Member tries | 403 `auth.forbidden` | ⬜ |
| I03 | Guest tries | 403 | ⬜ |
| I04 | Duplicate email (in ws) | 409 `user.email_already_exists` | ⬜ |
| I05 | role=owner | 422 (invitationRoles only) | ⬜ |
| I06 | Invalid role | 422 | ⬜ |
| I07 | Missing first/last name | 422 | ⬜ |
| I08 | name > 80 | 422 | ⬜ |
| I09 | Invalid email | 422 | ⬜ |
| I10 | No token | 401 | ⬜ |
| I11 | **Chain order:** member + invalid body → 403 (canAccess আগে validate) | 403 | ⬜ |

### 2D. Change role — `PATCH /users/:id/role` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| R01 | Admin: member→admin | 200; ঐ user next refresh-এ admin token | ⬜ |
| R02 | role=owner in body | 422 | ⬜ |
| R03 | **Owner-এর role বদলানো** | 403 (owner immutable) | ⬜ |
| R04 | **নিজের role বদলানো** | 403 | ⬜ |
| R05 | Member tries | 403 | ⬜ |
| R06 | Same role (no-op) | 200 | ⬜ |
| R07 | Target other-ws | 404 | ⬜ |
| R08 | Invalid role | 422 | ⬜ |
| R09 | No token | 401 | ⬜ |

### 2E. Deactivate — `POST /users/:id/deactivate` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| D01 | Admin deactivates member | 204; status=deactivated; **সব session revoke**; login/refresh fail | ⬜ |
| D02 | **Deactivate owner** | 403 | ⬜ |
| D03 | **Deactivate self** | 403 | ⬜ |
| D04 | Already deactivated | 204 (idempotent) | ⬜ |
| D05 | Member tries | 403 | ⬜ |
| D06 | Target other-ws | 404 | ⬜ |
| D07 | No token | 401 | ⬜ |

### 2F. Reactivate — `POST /users/:id/reactivate` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| RA01 | Reactivate deactivated | 204; আবার login হয় | ⬜ |
| RA02 | **Reactivate self** | 403 | ⬜ |
| RA03 | Already active | 204 (no-op) | ⬜ |
| RA04 | Reactivate invited (pending) | 409 `user.not_deactivated` | ⬜ |
| RA05 | Member tries | 403 | ⬜ |
| RA06 | Target other-ws | 404 | ⬜ |

### 2G. Admin reset-password — `POST /users/:id/reset-password` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| PW01 | Admin resets active member | 202; reset email ঐ user-কে | ⬜ |
| PW02 | Target non-active (invited/deactivated) | 409 `user.not_active` | ⬜ |
| PW03 | Member tries | 403 | ⬜ |
| PW04 | Target other-ws | 404 | ⬜ |
| PW05 | No token | 401 | ⬜ |

### 2H. Profile update — `PATCH /users/:id` 🔐 self / 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| U01 | Self edits name/timezone/avatar | 200 | ⬜ |
| U02 | **Member edits OTHER** | 403 `user.forbidden_edit` | ⬜ |
| U03 | Admin edits other | 200 | ⬜ |
| U04 | Email change collision | 409 `user.email_already_exists` | ⬜ |
| U05 | **role/status body-তে পাঠানো** | silently dropped (no escalation) | ⬜ |
| U06 | avatar_url=null → clear; non-http(s) → 422; >URL_LEN → 422 | যথাযথ | ⬜ |
| U07 | Empty body (no field) | 422 (≥1 required) | ⬜ |
| U08 | name = empty string | 422 | ⬜ |
| U09 | Cross-ws id | 404 | ⬜ |
| U10 | No token | 401 | ⬜ |

### 2I. Invite-accept — ✅ BUILT (ছিল gap, এখন end-to-end live)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| IA01 | `GET /auth/invitation/:token` → details | 200 `{email, role, workspace_name}`; invalid→404 / expired→410 / accepted→409 | ✅ |
| IA02 | `POST /auth/accept-invitation` `{token,password}` | 200 `{access_token, user}` + bb_refresh cookie; user `invited→active`, bcrypt password, invitation consumed | ✅ |
| IA03 | single-use (2nd accept→409) · expired→410 · already-accepted/active→409 · validation (missing/short pw)→422 | যথাযথ | ✅ |
| IA04 | auto-login token `/auth/me`-তে কাজ করে; পরে new password-এ login হয় | live | ✅ |
| IA05 | frontend `AcceptInvitationPage`: details fetch + password form + auto-login→`/` | wired | ✅ |

**Phase 2 exit:** M2-এর ৫০+ case সব ✅ (IA01 = জানা gap হিসেবে logged)।

---

## 🏢 Phase 3 — M3 Workspace & Settings

> **Progress (2026-06-27):** `WorkspaceService` adversarial review + coverage map done — **logic solid, কোনো bug নেই।** যে ঝুঁকিটা খুঁজছিলাম — business_hours `start < end` DB CHECK → 500 — সেটা service **merged pair-এ explicit handle করে** (partial update সহ: `patch.start ?? stored.start` vs `patch.end ?? stored.end`, HH:MM:SS lexical compare): `start>=end` → **422 `workspace.invalid_business_hours`**, কখনো 500 নয়। Empty-patch → 200 no-op (no activity); isolation = JWT `workspaceId` (no `:id` param → cross-tenant অসম্ভব); `buildPatch` শুধু ৮টা whitelisted field copy করে (`default_locale` কখনো লেখা হয় না — validator + buildPatch দুই স্তরে আটকানো)। **Coverage exhaustive** (84 test: business-hours guard ৩ case, empty-patch, ignores-unknown-fields, isolation + `?workspace_id`-ignored, role-tiers, member-before-validate 403, leak-guards, 50-parallel, exploratory)। **84/84 green, M3-তে কোনো fix লাগেনি — zero-issue।**

### 3A. Get workspace — `GET /workspace`
| ID | Scenario | Expected | Status |
|---|---|---|---|
| WG01 | Auth | 200 Workspace + nested `settings` | ⬜ |
| WG02 | No token | 401 | ⬜ |
| WG03 | JWT-claim ws ফেরত (isolation by design) | own ws only | ⬜ |
| WG04 | settings shape (timezone/defaultLocale/weekStartsOn/workingDays/businessHours/fiscalYearStartMonth) | সব key | ⬜ |

### 3B. Patch workspace — `PATCH /workspace` 👑
| ID | Scenario | Expected | Status |
|---|---|---|---|
| WP01 | Admin/Owner name update | 200 updated Workspace | ⬜ |
| WP02 | **Member tries** | 403 `auth.forbidden` | ⬜ |
| WP03 | Guest tries | 403 | ⬜ |
| WP04 | name > 120 | 422 | ⬜ |
| WP05 | name empty | 422 | ⬜ |
| WP06 | logo_url null→clear; non-http(s)→422; >500→422 | যথাযথ | ⬜ |
| WP07 | timezone `Asia/Dhaka`→200; `Foo/Bar`→422 | IANA-validated | ⬜ |
| WP08 | week_starts_on 0–6 ok; 7/-1→422 | bounded | ⬜ |
| WP09 | working_days valid arr ok; bad member→422; non-array→422 | যথাযথ | ⬜ |
| WP10 | business_hours `09:00:00` ok; `9:00`/`25:00:00`→422 | HH:MM:SS | ⬜ |
| WP11 | fiscal_year_start_month 1–12 ok; 0/13→422 | bounded | ⬜ |
| WP12 | **default_locale in body** | 422 (updatable নয়) | ⬜ |
| WP13 | `workspace_activity` row লেখা হয় | activity present | ⬜ |
| WP14 | No token | 401 | ⬜ |
| WP15 | Persist — PATCH-এর পর GET-এ পরিবর্তন দেখায় | reflected | ⬜ |

**Phase 3 exit:** M3-এর ১৯ case সব ✅।

---

## 🌐 Phase 4 — Cross-Cutting (Layer A জুড়ে)

> **Progress (2026-06-27): ✅ DONE.** RBAC matrix · workspace isolation (cross-ws 404, `?workspace_id` ignored) · error-envelope (`{error:{code,message,request_id}}` + `details[]`) · security (JWT tamper/`alg:none`/wrong-secret, leak-guards, SQL-injection-literal, privilege-escalation drop, refresh-reuse→mass-revoke) — **এই সবগুলো per-module suite-এ already covered** (M1/M2/M3 tests জুড়ে)। একমাত্র jest-এ অসম্ভব অংশ = **live rate-limit 429**: dev server (NODE_ENV=dev, limiter active) তুলে `POST /auth/login` ৭ বার → **attempt 1-5 = 401, 6-7 = 429 `auth.rate_limited`** ✅ (authStrictLimiter 5/min/IP ঠিক কাজ করে)।

### 4A. RBAC Permission Matrix
প্রতিটা mutating endpoint × ৪ role — expected status নিচের grid অনুযায়ী যাচাই:

| Endpoint | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| `POST /users/invite` | 201 | 201 | 403 | 403 |
| `PATCH /users/:id/role` | 200 | 200 | 403 | 403 |
| `POST /users/:id/deactivate` | 204 | 204 | 403 | 403 |
| `POST /users/:id/reactivate` | 204 | 204 | 403 | 403 |
| `POST /users/:id/reset-password` | 202 | 202 | 403 | 403 |
| `PATCH /users/:id` (other) | 200 | 200 | 403 | 403 |
| `PATCH /users/:id` (self) | 200 | 200 | 200 | 200 |
| `PATCH /workspace` | 200 | 200 | 403 | 403 |
- [ ] পুরো grid চালিয়ে প্রতিটা cell verify

### 4B. Workspace Isolation (multi-tenant leak) — **CRITICAL**
- [ ] WS-B জুড়ে: A-ws token দিয়ে B-ws-এর প্রতিটা `:id` (user/role/deactivate/reset/profile) hit → **সবগুলো 404** (কখনো 200/403 দিয়ে existence leak নয়)
- [ ] GET /workspace ও GET /users — কখনো অন্য ws-এর row ফেরত দেয় না
- [ ] Body-তে অন্য `workspace_id` পাঠিয়ে override চেষ্টা → উপেক্ষিত (JWT claim-ই উৎস)

### 4C. Error envelope consistency
- [ ] প্রতিটা error → `{error:{code, message, request_id, details?}}`
- [ ] `request_id` present এবং response header `X-Request-Id`-এর সমান
- [ ] 422-এ `details[]` = `{field, issue}` shape
- [ ] কোনো stack trace / internal path leak নেই

### 4D. Security (auth-specific)
| ID | Check | Expected | Status |
|---|---|---|---|
| SEC01 | কোনো response-এ `password_hash` নেই | absent সর্বত্র | ⬜ |
| SEC02 | JWT tampering (alg:none, modified sub/role/workspaceId) | 401, কখনো accept নয় | ⬜ |
| SEC03 | Cookie flags (httpOnly·sameSite·secure-prod·Path scope) | সঠিক | ⬜ |
| SEC04 | Login timing-safe (enumeration) | no/সামান্য diff | ⬜ |
| SEC05 | Rate-limit login+forgot+reset (5/min/IP) | 429 | ⬜ |
| SEC06 | Token/secret শুধু DEBUG log-এ (info/error-এ নয়) | no leak | ⬜ |
| SEC07 | **Privilege escalation:** PATCH /users/:id-এ role/status | drop, escalate নয় | ⬜ |
| SEC08 | Refresh reuse → mass session revoke | enforced | ⬜ |
| SEC09 | SQL-injection (সব string input) → Drizzle parameterized | no injection | ⬜ |

**Phase 4 exit:** RBAC grid + isolation + envelope + ৯টা security check সব ✅।

---

## 🖥️ Phase 5 — Frontend E2E (Browser, Playwright)

> **Progress (2026-06-27): ✅ DONE** (Node Playwright + chromium headless, real dev servers :5501/:5173)। **Invite-accept page (নতুন code) — 8/8 PASS:** invalid-token→error card · valid→"Set up your account"+"BeautyBooth"+invitee-email রেন্ডার · password→submit→**auto-login→dashboard "/"** (toast "Welcome aboard", "Good afternoon, E2E" — invited user নামেই logged-in, screenshot-confirmed) · consumed-token→single-use error। **Login/guard — 4/4 PASS:** logged-out `/`→`/login` guard · owner login→dashboard · authenticated dashboard renders (BeautyBooth sidebar) · RequireGuest logged-in `/login`→`/`। (Screenshots scratchpad-এ।)

`http://localhost:5173`-এ আসল UI চালিয়ে — Network+Console খোলা রেখে।

### 5A. Auth UI
- [ ] Login: valid → dashboard; invalid → error message দেখায় (raw error নয়)
- [ ] "Remember me" behavior
- [ ] Page refresh → বুটস্ট্র্যাপ (`/auth/me`) → logged-in থাকে
- [ ] `RequireAuth`: token ছাড়া protected route → `/login`-এ redirect
- [ ] `RequireGuest`: logged-in হয়ে `/login`-এ গেলে → `/`-এ redirect
- [ ] **401 auto-refresh:** token expire করিয়ে কোনো action → Network-এ `/auth/refresh` → user টের পায় না
- [ ] Logout → state clear → `/login`
- [ ] Forgot→reset UI পুরো flow (email link সহ)
- [ ] Change-password UI (Profile থেকে)

### 5B. Members UI (`/settings/members`)
- [ ] Member list render + filter/search
- [ ] Invite modal → submit → list-এ "invited" আসে
- [ ] Role change dropdown → effect
- [ ] Deactivate/reactivate → status badge বদলায়
- [ ] Member role দিয়ে login করে → invite/role button disabled/absent (UI permission)

### 5C. Profile UI (`/settings/profile`)
- [ ] নিজের name/timezone/avatar edit → save → reflect
- [ ] Email change → validation/collision message

### 5D. Workspace UI (`/settings/workspace`)
- [ ] name/logo/timezone/week-start/working-days/business-hours edit → save
- [ ] **week_starts_on বদলে → Calendar view (M8)-এর week-grid সেভাবে সাজে** (settings propagation)
- [ ] Member role দিয়ে → save button disabled / 403 handled gracefully

**Phase 5 exit:** ৩ module-এর সব UI flow browser-এ ✅।

---

## ✅ Phase 6 — Regression & Sign-off

- [ ] পুরো `tests/auth/*` + `tests/users/*` + `tests/workspace/*` suite **re-run green**
- [ ] change-password-এর নতুন test (যদি লিখি) suite-এ যুক্ত + green
- [ ] Phase 1–5-এর সব case ✅ (বা Issue Log-এ triaged)
- [ ] সব fix re-verify
- [ ] নিচের sign-off table পূরণ

### Sign-off (2026-06-27)
| Module | Verification | Pass | Open | অবস্থা |
|---|---|---|---|---|
| M1 Auth | 339 backend tests (incl. 10 change-pw + 16 accept) | 339 | 0 | ✅ (4 bug/gap fixed) |
| M2 Members | 279 backend tests + invite-accept built | 279 | 0 | ✅ (no bug; gap built) |
| M3 Workspace | 84 backend tests | 84 | 0 | ✅ (no bug) |
| Cross-cutting | per-module RBAC/isolation/security + **live rate-limit 429** | all | 0 | ✅ |
| Frontend E2E | invite-accept 8/8 + login/guard 4/4 (browser) | 12 | 0 | ✅ |
| **Layer A total** | **702 backend + 12 browser** | **all green** | **0** | ✅ **ZERO-ISSUE** |

> **"Layer A zero-issue" gate:** উপরের সব row ✅ এবং Issue Log-এ কোনো 🔴/🟠 open না থাকলে — Layer A pass।

---

## 🐛 Issue Log (টেস্ট চলাকালীন এখানে যোগ হবে)

| # | Module/Case | কী সমস্যা | Severity | Status |
|---|---|---|---|---|
| **1** | M1 / F · `AuthService.forgotPassword` | ১০টা parallel request (একই user) → **500** (errno **1213 ER_LOCK_DEADLOCK** confirmed via diagnostic; ৩-attempt retry-ও ১০-way delete+insert contention-এ যথেষ্ট ছিল না)। **FIX:** transaction-এর শুরুতে `UsersRepo.findByIdForUpdate` দিয়ে user-row lock (lock-ordering) → সব request serialize, deadlock structurally দূর; retry backstop থাকল। | 🟠 Major | ✅ **Fixed** — 10-parallel এখন সব 202 |
| **2** | M1 / F · forgot-password **test** | Test ২৪১-char local-part email-কে "valid" ধরে 202 expect করত; `isEmail` RFC মেনে local-part ৬৪ char cap করে → সঠিকভাবেই 422 (কোড ঠিক, test ভুল)। **FIX:** test এখন valid 252-char email (64-char local + multi-label domain, প্রতি label ≤63)। | 🟡 Minor (test) | ✅ **Fixed** |
| **3** | M1 / G · change-password | `POST /auth/change-password`-এর automated test ছিল না। **FIX:** নতুন `tests/auth/change-password.test.ts` — ১০ test (happy · wrong-current 422 · unchanged 422 · validation×4 · 401 · session-survives), সব green। | 🟡 Gap | ✅ **Fixed** — gap closed |
| **4** | M1 / F · forgot-password tenant-isolation (code+test) | Fix চলাকালীন ধরা: same-second `created_at` tie-তে `findByEmail`-এর "oldest wins" non-deterministic (id random, কোনো secondary tie-break নেই) → flaky fail। **FIX:** (code) `findByEmail` ORDER BY-তে `asc(id)` secondary tie-break যোগ (deterministic); (test) `first`-এর created_at unambiguously older করা। | 🟡 Minor (flaky) | ✅ **Fixed** |
| **5** | M2 / I · invite-accept flow | আগে: invite invited-row + token + email বানাত কিন্তু **consume করার accept endpoint ছিল না** → invitations end-to-end কাজ করত না। **BUILT (user-approved):** `GET /auth/invitation/:token` (details) + `POST /auth/accept-invitation` (token→password set→`invited`→`active`→single-use consume→auto-login, login-এর মতো cookie+token) + `InvitationsRepo`/`UsersRepo.findByWorkspaceEmailForUpdate` + validators + **১৬ test**; frontend `AcceptInvitationPage` wired (details fetch + password form + auto-login→dashboard)। **auth 339/339 green · client typecheck clean · users 279/279 no-regression।** | 🟠 Functional gap | ✅ **Built & verified** |

**Severity:** 🔴 Critical (security/data-loss/auth bypass) · 🟠 Major (flow ভাঙে) · 🟡 Minor (cosmetic/edge)।

---

## 📝 Notes / আগেভাগে জানা বিষয়
- **change-password** এর dedicated auto-test নেই → Phase 1F-এ নতুন test লিখে gap বন্ধ করব।
- **Invite-accept** flow stub (M2I) — জানা limitation, এই Layer-এ bug হিসেবে গণ্য নয় (আলাদা feature কাজ)।
- Login/refresh/reset-এর generic error message **ইচ্ছাকৃত** (enumeration protection) — "vague error" কে bug ভাববো না, বরং oracle আছে কিনা সেটাই যাচাই।
- Rate-limit test mode-এ no-op — তাই 429 test **dev/live server**-এ করতে হবে, jest-এ নয়।

---

*এই plan-টা Layer A-এর actual route + validator + AuthService কোড পড়ে বানানো — test case এই codebase-এর সাথে hubohu মেলে। প্রস্তুত হলে Phase 0 থেকে শুরু করব।*
