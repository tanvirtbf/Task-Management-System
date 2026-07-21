# Full System Test Plan — BeautyBooth Task Management (Legacy `server/` + `client/`)

**Created:** 2026-07-14 · **Stack:** Express + TypeScript + MySQL 8 + Drizzle (`server/`) · React 19 + Vite + antd + TanStack Query + zustand (`client/`) · jest (131 suites) + Playwright (5 specs)
**Goal:** test the ENTIRE system — backend, frontend, database, API — end-to-end, until **zero issues** remain. Then (separately) the RBAC + Teams build begins.
**Basis:** full 4-agent system scan on 2026-07-14 (backend 158 endpoints, frontend all surfaces, DB 35 tables/5 views/10 triggers live-verified, + all prior test docs & known-issue register).

---

## 0. How to use this plan (Banglish)

- Ami plan ta **50 phase** e vag korsi (Phase 0–49), 12 ta stage e। Prottek phase **chhoto + focused** — "olpo olpo kaj but perfectly test"।
- Apni bolben **"run phase N"** → ami **sudhu oi phase ta** korbo: test → issue pele fix → re-verify → log। Ek phase e ek surface।
- Prottek phase er result **`FULL_SYSTEM_TEST_LOG.md`** e append hobe (Phase 0 e create hobe), severity shoho: 🔴 BLOCKER / 🟠 HIGH / 🟡 MEDIUM / 🟢 LOW।
- **Rule:** test + bug-fix kori (documented-kintu-broken behavior thik kora o allowed)। Kono **notun feature** banabo na — segula RBAC build e jabe। Genuinely-missing feature pele "gate decision" hisebe log korbo, banabo na jotokhon na bolen।
- Shared code (middleware / errorHandler / client.ts / schema) touch korle oi phase e regression o cholbe।
- **⚠️ Phase 0 SOBAR AGE** — apnar **asol data** (`taskmanagement` DB te 32 task, 13 space, real usage) backup + alada QA DB isolate na kora porjonto kono destructive test na. Phase 0 na kore onno phase cholbe na.

---

## 1. Test environment & safety model

- **Live/dev DB `taskmanagement`** — apnar asol data. jest suites ete HATH DEY NA (per-suite alada `*_test` DB use kore — ~43 ta already ache)।
- **jest** — 131 suite, prottek module er nijer isolated DB (`taskmanagement_<suite>_test` / `tms_<suite>_test`), `DB_NAME_OVERRIDE` diye। **Duiटা jest invocation eksathe same DB te calabo na** (provision DROP kore, beforeEach TRUNCATE kore)। Serial `--runInBand`।
- **Browser E2E / manual API** — Phase 0 e ekta **`taskmanagement_qa`** DB banabo (fresh schema + seed + predictable demo fixtures), destructive UI test oitar upor cholbe — asol `taskmanagement` bachiye। Server ke QA DB te point korar toggle Phase 0 e set hobe।
- **Servers:** API `:5501` (`NODE_ENV=dev npx tsx watch src/server.ts` — nodemon `.ts` ignore kore stale hoy, tsx watch use korbo), Web `:5173` (vite)। Login: `owner@company.local` / `Owner@12345`।
- **Never:** DROP/DELETE on `taskmanagement`; two concurrent jest runs on one DB; burst real-email sends (Mailtrap free-tier rate limit — jest mocks the mailer; live sends only when explicitly needed + user's own inbox).

---

## 2. Known-issues register (fold into the relevant phases)

Severity: 🔴 blocker · 🟠 high · 🟡 medium · 🟢 low · ℹ️ by-design. "LIVE" = confirmed in the running system this scan.

| ID | Issue | Sev | Phase |
|---|---|---|---|
| **KI-1** | **LIVE: Form encryption not in effect + it breaks the forms jest suite** — `FormsService` inserts `encrypted_at`/`expires_at`, but `database/schema.sql` (used for BOTH `db:setup` AND test-DB provisioning) lacks those cols (migration `0005` never applied/journaled). **CONFIRMED by running it: `tests/forms/public-submit.test.ts` = 3 tests FAIL now** (unknown-column on insert); any live form submit also fails. Plus `ENCRYPTION_KEY` absent from ALL `.env` (`encryptJSON` throws `Invalid key length`). 3 existing rows = plaintext PII. | 🔴 | 24 |
| **KI-2** | **LIVE: tz-skew in deployed views** — `v_breached_sla` uses `now()`, `v_current_on_call` uses `curdate()` in the live DB (+6h Dhaka skew), though source files were fixed to UTC. Views never re-applied. SLA *API* is safe (SlaRepo bypasses the view w/ `UTC_TIMESTAMP()`), but `OnCallRepo`/`EngineeringRepo` use `CURDATE()`/`NOW()` locally, and `AttachmentsRepo.softDelete` writes local time into `deleted_at`. | 🟡 | 28, 30, 21 |
| **KI-3** | **File-casing bug** — `server/src/services/tokenService.ts` + `credentialService.ts` git-tracked lowercase but imported PascalCase (`TokenService`/`CredentialService`). Works on Windows; **breaks Linux/CI + fresh clone** (TS1261). | 🟠 | 1 |
| **KI-4** | **`server/.env` MAIL_\* block duplicated 3×** — dotenv first-wins; block 1 (`info@beautybooth.com.bd`) is effective, block 3's newer-looking creds silently dead. | 🟢 | 41 |
| **KI-5** | **Client AI-assistant base URL** — `client/src/http/assistant.ts` reads `VITE_BACKEND_API_URL` directly (no auto-derive like `client.ts`). With the shipped empty `.env` it POSTs to same-origin `:5173` (no backend) → **assistant widget likely broken locally**. Verify + fix. | 🟠 | 38 |
| **KI-6** | `v_open_bugs` hardcodes `task_type_id='tt-bug'` (both sources) — never matches real random ids → view always empty. App uses name-based resolution, so view may be dead code; confirm nothing reads it. | 🟡 | 31 |
| **KI-7** | Import/Export = **not built** (FE stubs "coming soon"; export faked; no backend). Assert absent; do NOT test as a feature. | ℹ️ | 46 |
| **KI-8** | Deferred-by-design: LineUp drag-reorder, list-header inline rename, list-header Invite/kebab, Calendar week/day modes, comment @mention/#ref autocomplete, group-by-other-than-status, avatar upload, "Delete workspace" button (all inert). Assert inert, don't file bugs. | ℹ️ | 44–47 |
| **KI-9** | Background jobs = **manual/CLI trigger only** (no in-process scheduler). `form-submission-expiry` has no HTTP route (CLI-only). Prod scheduling = external cron (gate decision). | ℹ️ | 41, 49 |
| **KI-10** | Forms public submit = 2 transactions (non-atomic) — task may survive if 2nd txn fails; possible orphan `form_submissions` row on a failed submit. Verify behavior. | 🟡 | 25 |
| **KI-11** | REMEDIATION_PLAN P2×15 + P3×27 backlog — mostly unverified. Mine before Phase 49; pull anything real into its phase. | 🟡 | 40, 49 |
| **KI-12** | Seed uses **bcrypt** for the owner password while app auth is **argon2** elsewhere — verify login parity (owner login must actually work against seeded hash). | 🟠 | 3 |
| **KI-13** | Eng Home FE uses hardcoded seed IDs (`sp-eng`, `l-bug-triage`, `l-incidents`, `l-sprint`) for "see all" nav → dead-ends on real random ids. | 🟡 | 31 |
| **KI-14** | Prior "3 forgot-password failures" — now fixed in code (tests exist for tie-break/concurrency/email-length); regression-only. | 🟢 | 4 |
| **KI-15** | Transient 401 on hard reload (in-memory token → bootstrap 401 → refresh+retry). Benign console noise. | ℹ️ | 43 |

---

## 3. Status table (flip ⬜→✅ as phases pass; ⚠️ = passed with logged gate item)

### Stage A — Foundation & Safety
| # | Phase | Status |
|---|---|---|
| 0 | Test-env safety: backup live DB + isolate QA DB + harness + log | ✅ |
| 1 | Build & portability health (client+server build, **file-casing KI-3**, lint, dead-code) | ✅ (KI-3 + ping-openai fixed) |
| 2 | Full jest baseline — run all 131 suites, record green/red, triage | ✅ (2833/2842; 9 fails=KI-1) |

### Stage B — Auth & Identity
| 3 | Login / logout / refresh / me / token+cookie lifecycle (**KI-12 argon2/bcrypt**) | ✅ (KI-12 resolved) |
| 4 | Forgot / reset / change password (+ concurrency/tie-break/email-len **KI-14**) | ✅ (KI-14 confirmed) |
| 5 | Invitations: invite→email→accept→auto-login (+ enumeration rate-limit) | ✅ |
| 6 | Users/members: role change, (de/re)activate, profile edit, owner+self guards | ✅ |

### Stage C — Workspace & Structure
| 7 | Workspace settings (get/patch, role gate, tz/locale/hours) | ✅ |
| 8 | Spaces — CRUD, archive, delete (owner-only), is_private, isolation | ✅ |
| 9 | Lists — CRUD, archive, delete, list-in-space, default task type | ✅ |
| 10 | Statuses — CRUD, reorder, status groups, scope (list/space) | ✅ |
| 11 | Task types & Tags — CRUD, system-type + in-use guards | ✅ |

### Stage D — Tasks Core
| 12 | Task create/read/update, validators, ETag/If-Match optimistic concurrency | ✅ (1 bug fixed: GET ETag) |
| 13 | Dates/priority/recurrence/severity/dev-fields + **tz date-boundary** (due_today/overdue) | ✅ (2 bugs fixed: date-500, null-clear) |
| 14 | Assignees / watchers / tags (delta endpoints, N+1 bulk perf) | ✅ |
| 15 | Subtasks + parent-child + dependencies (self-dep guard, same-list) | ✅ (1 bug fixed: subtask-status 500) |
| 16 | Archive/unarchive/soft-delete/hard-delete (admin gate, audit) + bulk ops | ✅ |
| 17 | My Work buckets + task activity feed | ✅ |

### Stage E — Task Content
| 18 | Comments (author edit + 15-min window, delete author-or-admin, @mention/#ref render) | ✅ |
| 19 | Checklists + items (bulk, toggle, assignee validation) | ✅ |
| 20 | Custom fields — defs CRUD + all 6 value types + guest redaction + tenant isolation | ✅ (gate: hidden_from_guests unsettable) |
| 21 | Attachments — sign/finalize/upload/download/delete, size+MIME, guest block, R2 (**KI-2 deleted_at tz**) | ✅ (KI-2 fixed) |
| 22 | Counter-trigger integrity audit (comments/attachments/subtasks/submission counts) — direct DB | ✅ |

### Stage F — Forms & Templates
| 23 | Forms builder — CRUD, fields, reorder, settings/branding | ✅ (submissions-list 500 = KI-1, P24) |
| 24 | **Form encryption + retention — KI-1 LIVE FIX** (apply 0005 cols → un-reds forms jest suite, ENCRYPTION_KEY, decrypt-on-read, expiry) | ✅ **KI-1 RESOLVED** (forms jest 81/81) |
| 25 | Public form render + submit (task_attr + custom-field envelope, default-type fallback, **KI-10 atomicity**) — works after P24 | ✅ (KI-10 = no orphans) |
| 26 | Templates — CRUD + apply (structure, deferred due-date materialization) | ✅ |

### Stage G — Engineering & SLA
| 27 | Sprints — CRUD, lifecycle (start/close), sprint tasks, active sprint | ✅ |
| 28 | On-call rotation — schedule/current/set/clear (+ **KI-2 CURDATE skew**) | ✅ |
| 29 | Report-a-bug flow (Bug Triage resolution, on-call auto-assign S0/S1, fresh-install gap) | ✅ |
| 30 | SLA — breached list + override + **re-apply UTC views (KI-2)** + UTC boundary | ✅ |
| 31 | Eng home rollup + postmortem (**KI-6 v_open_bugs**, **KI-13 hardcoded IDs**) | ✅ |

### Stage H — Notifications, SSE, Home
| 32 | Notifications — list/filters/read/unread/mark-all/snooze/delete/preferences | ✅ |
| 33 | SSE `/stream/inbox` + 60s polling fallback (both paths, auth, backlog replay) | ✅ |
| 34 | Home KPIs + agenda (**tz date-boundary** for due_today/overdue) | ✅ |
| 35 | Workspace activity + recent activity (null-safety KI ISSUE-003 regression) | ✅ |

### Stage I — Search & AI
| 36 | Global search — all buckets, XSS-safe highlight, pagination, workspace scope | ✅ |
| 37 | AI assistant backend — chat/stream, scoped tools, owner-only convos, degradation, prompt-injection | ✅ |
| 38 | AI assistant frontend — **KI-5 base-URL fix**, streaming widget, persistence | ✅ |

### Stage J — Cross-cutting & Security
| 39 | API contract sweep — error envelope, request_id, cursor pagination, Idempotency-Key, soft-delete filter, If-Match | ✅ |
| 40 | Security sweep — authz matrix (every role×action), IDOR/tenant isolation, SQLi, XSS, rate limiters, secret redaction (**KI-11 mine P2/P3**) | ✅ |
| 41 | Config & secrets hygiene — **KI-4 MAIL dedupe**, ENCRYPTION_KEY, effective mail creds, R2 creds, **KI-9 job scheduling** gate | ✅ |

### Stage K — Frontend E2E (browser)
| 42 | Playwright existing 5 specs (smoke/full/sidebar/forms/profile) — run all, fix flakes | ✅ |
| 43 | Browser auth — login/logout/forgot/reset/invite-accept + session-survives-reload (**KI-15**) | ✅ |
| 44 | Browser sidebar/structure — spaces/lists tree, nav, quick-create, favorites, filter | ✅ |
| 45 | Browser tasks — List/Board/Calendar views, drawer all panels, bulk bar, drag-drop | ✅ |
| 46 | Browser settings — all 8 pages, members (Gmail-compose), inert-control audit (**KI-7/KI-8**) | ✅ |
| 47 | Browser forms/search/inbox/eng/AI-widget end-to-end | ✅ |

### Stage L — Final
| 48 | Full regression — re-run all jest + all Playwright + both builds; confirm no fix caused a regression | ✅ |
| 49 | Go-live gate synthesis — issue register, severities, remaining gate decisions, sign-off | ✅ |

---

## 4. Per-phase detail

Each phase lists **Goal · What to test · Method · Pass criteria · Watch (known issues)**. Method codes: **[API]** curl/node scripts in scratchpad, **[JEST]** targeted `jest <path>` with isolated `TEST_DB_SUFFIX`, **[DB]** read-only SQL against live/QA, **[UI]** Playwright/Chrome browser, **[CODE]** source read/fix.

### Stage A — Foundation & Safety

**Phase 0 — Test-env safety & harness**
- **Goal:** protect real data; make testing repeatable.
- **What:** (a) `mysqldump taskmanagement` → timestamped backup in scratchpad (verify restorable); (b) create `taskmanagement_qa` (fresh `db:setup` + `db:seed`) + a small deterministic demo-fixture (a space, 2 lists, a dev-type + non-dev task type, ~5 tasks incl. 1 bug + 1 incident, 2 users of member/guest role, 1 form) so later phases have predictable data; (c) **concrete browser-DB toggle:** for every destructive [UI]/[API] phase, STOP the real-DB API server and start `:5501` with `DB_NAME_OVERRIDE=taskmanagement_qa` (Playwright/Chrome are hardcoded to `:5501`/`:5173`, so they then hit QA, never real data); use the real-DB server ONLY for read-only [DB] inspection. Write both start-commands into the log; (d) create `FULL_SYSTEM_TEST_LOG.md`; (e) confirm both servers healthy + owner login works.
- **Method:** [DB][API][CODE]. **Pass:** backup file exists + restorable; QA DB seeded; log created; `/health`=200, login=200; toggle documented.
- **Watch:** never touch `taskmanagement` destructively after this. **Guardrail: before starting any destructive phase, echo the running `:5501` server's effective DB name and confirm it is `taskmanagement_qa`, not `taskmanagement`.**

**Phase 1 — Build & portability health**
- **Goal:** the code compiles + is deployable to Linux/CI.
- **What:** `client/`: `npm run build` (tsc -b + vite) → 0 errors. `server/`: `npx tsc --noEmit` → 0 errors. **KI-3 file-casing:** confirm `git ls-files` casing vs import casing for tokenService/credentialService; fix (git rename to PascalCase) so a case-sensitive FS builds. eslint both. Confirm mock-api/mocks dead-code excluded (no live import).
- **Method:** [CODE][API]. **Pass:** both builds clean; casing fixed + still builds on Windows; lint acceptable; no live mock import.
- **Watch:** KI-3 is the one true blocker here for any future CI/Linux deploy.

**Phase 2 — Full jest baseline**
- **Goal:** know the true green/red state of 131 suites before touching anything.
- **What:** run the whole suite (`npm test` or per-module with unique `TEST_DB_SUFFIX` to parallelize safely); record pass/fail counts per area; triage every failure (real bug vs env vs flake). Establish the regression baseline number.
- **Method:** [JEST]. **Pass:** baseline recorded; each failure classified; any 🔴/🟠 real failures fixed + re-run green (defer 🟢 with a logged reason).
- **Watch:** don't run two invocations on one DB; KI-14 forgot-password should be green. **Expected-red (NOT a regression): `tests/forms/public-submit.test.ts` (3) + `submissions.test.ts` fail on `encrypted_at`/`expires_at` unknown-column — this is KI-1; root-caused here, fixed in Phase 24, re-verified green in Phase 48.** Any OTHER red is a real triage item.

### Stage B — Auth & Identity

**Phase 3 — Login / session lifecycle**
- **What:** login happy + wrong-pw + unknown-email + deactivated-user; JWT claims (sub/role/workspaceId); access-token TTL + refresh via `bb_refresh` cookie; `/auth/me`; logout + logout-all (session invalidation); cookie flags (httpOnly/secure/sameSite); `authStrictLimiter` 5/min. **KI-12:** confirm owner login works despite bcrypt-seed vs argon2-app (hash-scheme parity).
- **Method:** [API][JEST]. **Pass:** all paths correct codes; refresh rotates; logout kills session; KI-12 resolved (login works or hash path fixed).

**Phase 4 — Password flows**
- **What:** forgot-password always-202 (enumeration-safe); reset-token single-use + TTL + wrong/expired token; change-password (current-pw re-verify, ≥8, mismatch); the edge cases (same-second createdAt tie-break, 10-parallel no-500, 254-char email 422). Mailer spy (no real send in jest).
- **Method:** [API][JEST]. **Pass:** enumeration-safe; tokens single-use; edges hold (KI-14 regression green).

**Phase 5 — Invitations**
- **What:** invite (owner/admin only; role admin|member|guest; not owner); email link build (`/invitation/:token`); GET invitation (valid/expired/consumed); accept → sets password → auto-login → status active; `invitationLimiter` 5/min; re-invite/duplicate handling.
- **Method:** [API][JEST]. **Pass:** full invite→accept→login works; rate-limited; role constraints enforced.

**Phase 6 — Users/members management**
- **What:** role change (owner-immutable, no-self-change); deactivate/reactivate (not owner, not self); profile edit (self-or-admin; role/status/workspace_id in body silently dropped); GET /users + /users/:id workspace-scoped.
- **Method:** [API][JEST]. **Pass:** every in-service guard returns the right 403 code; privilege fields never patchable.

### Stage C — Workspace & Structure

**Phase 7 — Workspace settings**
- **What:** GET /workspace; PATCH (admin/owner only; member→403); tz/locale/week-start/working-days/business-hours (start<end)/fiscal month validation.
- **Method:** [API][JEST]. **Pass:** role-gated; validators enforce ranges.

**Phase 8 — Spaces**
- **What:** CRUD; archive/unarchive; DELETE owner-only + must be archived+empty; is_private accepted (note: not membership-enforced — that's the RBAC project, here just confirm store/serialize); workspace isolation (foreign id→404); position ordering.
- **Method:** [API][JEST]. **Pass:** role gates + owner-only delete + isolation correct.

**Phase 9 — Lists**
- **What:** CRUD; archive/unarchive; DELETE owner-only; list-in-space; default_task_type_id; GET /lists + /spaces/:id/lists; delete-with-tasks blocked (RESTRICT) — the teardown-order edge.
- **Method:** [API][JEST]. **Pass:** RESTRICT on list-with-tasks surfaces a clean error, not a 500.

**Phase 10 — Statuses**
- **What:** per-list CRUD + reorder; status_group (not_started/active/done/closed); scope (list vs space); default statuses auto-created with a list; delete-in-use guard.
- **Method:** [API][JEST]. **Pass:** reorder stable; group semantics correct; guards fire.

**Phase 11 — Task types & Tags**
- **What:** task-types CRUD + is_system delete/edit guard + is_dev_type flag + in-use (409); tags CRUD workspace-wide + unique-per-workspace + in-use behavior.
- **Method:** [API][JEST]. **Pass:** system-type protected; in-use 409; uniqueness enforced.

### Stage D — Tasks Core

**Phase 12 — Task create/read/update + concurrency**
- **What:** create (validators, custom_id gen, task_number per list); read (bare Task, hydrated); PATCH; **If-Match/ETag** optimistic concurrency → 409 on stale; last-write-wins note; bulk create ≤200.
- **Method:** [API][JEST]. **Pass:** ETag 409 works; validators reject bad payloads with 422 details.

**Phase 13 — Dates/priority/recurrence/dev-fields + tz**
- **What:** start/due dates (start≤due), priority, severity (bug), recurrence (none/daily/weekly + days), reviewer/story-points/sprint (dev-type only), estimate/time (non-dev). **tz date-boundary:** create tasks around the Dhaka/UTC midnight and confirm due_today/overdue classification is correct (ties to Home Phase 34).
- **Method:** [API][JEST][DB]. **Pass:** date validation; dev-only fields gated; tz boundary correct.

**Phase 14 — Membership (assignees/watchers/tags)**
- **What:** add/remove assignees (delta endpoints, not PATCH); watch/unwatch self; add/remove tags; bulk assign/tag (replace semantics); **N+1 bulk** batched-membership perf (KI P1-07 regression).
- **Method:** [API][JEST]. **Pass:** delta ops correct; bulk batched (no N+1); notifications fired on assign.

**Phase 15 — Subtasks & dependencies**
- **What:** subtask create (parent_task_id, cascade on parent delete); GET subtasks; dependencies blocks/blocked-by; **self-dependency trigger** (SIGNAL 45000); same-list-only picker (deferred cross-list); subtasks_count/completed trigger accuracy.
- **Method:** [API][JEST][DB]. **Pass:** self-dep blocked at DB; counters accurate.

**Phase 16 — Delete/archive lifecycle + bulk**
- **What:** archive/unarchive (archived_at, default filter); soft-delete; **hard-delete ?hard=true admin/owner gate + audit log**; bulk archive/delete (per-id Promise.all); cascade to children on hard delete.
- **Method:** [API][JEST][DB]. **Pass:** hard-delete gated + audited; cascade clean; archived excluded by default.

**Phase 17 — My Work + activity**
- **What:** /tasks/my-work buckets (today/overdue/next-7/unscheduled/done — assignee-scoped); /tasks/:id/activity feed (actor-hydrated, ordering stable).
- **Method:** [API][JEST]. **Pass:** buckets correct per tz; activity ordered deterministically.

### Stage E — Task Content

**Phase 18 — Comments**
- **What:** create (top-level + 1-level reply); edit (author-only + 15-min window → 403 after); delete (author-or-admin); @mention → notification; #TASK-ID → activity link; comments_count trigger; render-only pills (no autocomplete — KI-8).
- **Method:** [API][JEST]. **Pass:** author/window/admin rules exact; mention notifies; count accurate.

**Phase 19 — Checklists**
- **What:** checklist CRUD; items add/bulk/toggle/delete; item assignee **validation** (must be workspace member — the closed gap); ordering.
- **Method:** [API][JEST]. **Pass:** invalid assignee rejected; toggle updates completion; ordering stable.

**Phase 20 — Custom fields**
- **What:** field defs CRUD (scope workspace/space/list); all 6 types (text/phone/money/date/dropdown/files); set/clear values; **guest redaction** (hidden_from_guests omitted for guest role); **tenant isolation** on upsert (KI P0-04 regression); dropdown option_id_generated virtual index.
- **Method:** [API][JEST]. **Pass:** each type validates (phone BD, money paisa); guest redaction works; no cross-workspace write.

**Phase 21 — Attachments**
- **What:** sign (guest-blocked 403, uploadSignLimiter 60/min); finalize (HEAD verify, real-size vs 25MB cap → 413, MIME allow-list → 415); proxied upload (30MB raw); download 302 signed; delete (uploader-or-admin); R2 stub vs real (env-dependent — mark PUT failures as env); **KI-2:** `AttachmentsRepo.softDelete` writes local `NOW()` into deleted_at — flag/fix vs UTC.
- **Method:** [API][JEST][DB][CODE]. **Pass:** limits + guest block + delete-auth correct; deleted_at tz consistent (or logged).

**Phase 22 — Counter-trigger integrity audit**
- **What:** direct-DB verification that comments_count, attachments_count (only complete + not-deleted), subtasks_count/completed, forms.submission_count match reality after insert/update/delete/soft-delete sequences; GREATEST underflow guards; confirm app never double-writes (trigger-maintained).
- **Method:** [DB][API]. **Pass:** every counter equals a fresh COUNT(*) after churn; no drift; no double-count.

### Stage F — Forms & Templates

**Phase 23 — Forms builder**
- **What:** form CRUD (admin); fields add/update/delete/reorder; settings (require-login, recaptcha, accepting toggle, success msg/redirect); branding (color/layout/hide-branding); by-list + all-forms lists; public_slug uniqueness.
- **Method:** [API][JEST]. **Pass:** admin-gated; field diff-sync correct; slug unique.

**Phase 24 — 🔴 Form encryption + retention (KI-1 LIVE FIX) — MUST come before public-submit testing**
- **Goal:** make form submission work at all (currently every submit fails: unknown-column + missing key). Fixing this un-reds Phase 2's known-red forms suites.
- **What:** (a) add the `0005` columns (`encrypted_at`, `expires_at`) + `idx_form_submissions_expires_at` to **`database/schema.sql`** so `db:setup` AND test-DB provisioning both get them; restore 3-source parity (schema.sql + Drizzle + migration) and journal/fold `0005`; apply to QA + plan the live `ALTER`; (b) provision a real 64-hex `ENCRYPTION_KEY` (document in ENCRYPTION_SETUP.md; via env, NOT committed; **also set in `.env.test`** so jest form-submit tests can encrypt); (c) verify encrypt-on-submit → ciphertext at rest ({ciphertext,iv,authTag}); (d) **wire decrypt-on-read** (`decryptJSON` is currently never called — admin submissions view would show ciphertext) — confirm/fix read path; (e) retention: `form-submission-expiry` job deletes `expires_at < now` (bind-param, tz-safe); dry-run count.
- **Method:** [CODE][DB][API][JEST]. **Pass:** `tests/forms/public-submit.test.ts` + `submissions.test.ts` GREEN; new submit stores ciphertext + returns 2xx; admin read shows plaintext (decrypted); expiry job deletes only expired; key documented; schema parity restored.
- **Watch:** existing 3 plaintext rows — leave or migrate (log decision); no key rotation/versioning (V2 note).

**Phase 25 — Public form render + submit** *(submit now works — Phase 24 fixed the insert path)*
- **What:** GET /public/forms/:slug (public, publicFormLimiter 30/min); POST submit — task_attr fields + custom-field envelope ({text}/{date}/{option_id}/{amount,currency}); required validation; **default-task-type fallback** (ISSUE-001, list w/o default → workspace's first type); files unsupported anonymously (by-design, not a bug); **KI-10 atomicity:** does a failed 2nd txn orphan a submission row? verify count.
- **Method:** [API][JEST][DB]. **Pass:** valid submit creates task+submission; fallback works; orphan behavior documented (fix if it corrupts).

**Phase 26 — Templates**
- **What:** CRUD (admin); apply → spawns task+checklist into a list (structure JSON, skipDecamelize); template type task/list/space; deferred per-item due-date materialization (accepted but not applied — KI-8, assert no crash); sharing field.
- **Method:** [API][JEST]. **Pass:** apply builds correct structure; deferred fields ignored gracefully.

### Stage G — Engineering & SLA

**Phase 27 — Sprints**
- **What:** CRUD (admin write); start/close lifecycle (status planned/active/closed; one active); add/remove sprint tasks; GET /sprints/:id/tasks cross-list; active-sprint view.
- **Method:** [API][JEST]. **Pass:** lifecycle transitions valid; cross-list task list correct.

**Phase 28 — On-call rotation**
- **What:** schedule list; current (week-keyed); set/clear (admin, PUT/DELETE /:weekStart); **KI-2:** `OnCallRepo.findCurrent` + `EngineeringRepo.findCurrentOnCallEngineerId` use `CURDATE()` (local) — test near the 18:00–24:00 UTC boundary; fix to UTC_DATE() for consistency.
- **Method:** [API][JEST][DB][CODE]. **Pass:** current on-call correct across tz boundary; repos UTC-consistent.

**Phase 29 — Report-a-bug flow**
- **What:** POST /eng/report-bug (validator: steps/happened required, severity S0-S3, team enum); resolves "Bug Triage" list by name; **auto-assign current on-call for S0/S1**; reporter as watcher; fresh-install gap (no Bug Triage → 409 eng.not_configured — decide: seed it or document).
- **Method:** [API][JEST]. **Pass:** bug lands in Bug Triage; S0/S1 auto-assigned; error surfaced (not swallowed).

**Phase 30 — SLA + view re-apply (KI-2)**
- **What:** GET /sla/breached (workspace-scoped, hydrated assignees, team=engineering→is_dev_type alias); PATCH /tasks/:id/sla (admin); **re-apply the fixed UTC views to the live/QA DB** (`CREATE OR REPLACE` from current source) so v_breached_sla/v_current_on_call match source; verify near-6h-boundary; confirm SLA API already UTC-safe (SlaRepo bypasses view).
- **Method:** [API][JEST][DB]. **Pass:** views re-applied = UTC in DB; breached list accurate at boundary; override admin-gated.

**Phase 31 — Eng home + postmortem**
- **What:** GET /eng/home rollup (open bugs, in-sprint-mine, PRs-awaiting-me, incidents, stale — EngineeringRepo `staleTicketIds` uses NOW() local, KI-2 flag); postmortem upsert on resolved incident; **KI-6:** confirm nothing reads `v_open_bugs` (tt-bug hardcode dead); **KI-13:** FE hardcoded seed-ID nav is a frontend concern (Phase 47) — note here.
- **Method:** [API][JEST][DB]. **Pass:** rollup buckets correct; postmortem persists; v_open_bugs confirmed unused (or fixed).

### Stage H — Notifications, SSE, Home

**Phase 32 — Notifications**
- **What:** list (paginated {data,pagination}); unread-count; mark read/unread/all-read; snooze (1h/4h/1d) + wake; delete; preferences (per-type channel); notification types fire correctly (assigned/mentioned/comment/status_change/due_soon/overdue/etc); user-scoped isolation.
- **Method:** [API][JEST]. **Pass:** all actions correct; snooze-wake job restores; user can't see others' notifications.

**Phase 33 — SSE + polling**
- **What:** GET /stream/inbox (cookie auth; 401 for unauth before stream); poll-loop delivers new notifications; Last-Event-Id backlog replay; heartbeat; test-idle-close; FE 60s polling fallback (NotificationBell + Sidebar) — both paths coexist.
- **Method:** [API][JEST][UI]. **Pass:** SSE streams + auth-gates; backlog replays; FE badge updates within 60s.

**Phase 34 — Home KPIs + agenda**
- **What:** GET /home/kpis (6 tiles, camelCase-verbatim — skipCamelize); "Open Team Tasks" = workspace-wide (note for RBAC); agenda; **tz date-boundary** for due_today/overdue (uses workspace tz — verify against Dhaka midnight).
- **Method:** [API][JEST][DB]. **Pass:** KPI counts match DB; tz boundary correct; envelope verbatim.

**Phase 35 — Activity feeds**
- **What:** GET /activity + /activity/recent (workspace-scoped, actor-hydrated); RecentActivityCard null-safety (ISSUE-003 regression — null context no crash); ordering.
- **Method:** [API][JEST]. **Pass:** feeds correct; null context safe; ordering deterministic.

### Stage I — Search & AI

**Phase 36 — Global search**
- **What:** GET /search across tasks/lists/spaces/comments/(people); XSS-safe highlight (escapeHtml→mark); workspace scope; notes bucket empty (by-design); pagination; query validation; verify FULLTEXT/ngram indexing actually exists (scan flagged a missing CREATE FULLTEXT).
- **Method:** [API][JEST][DB]. **Pass:** results scoped + safe; search index confirmed present (or logged); no SQLi via q.

**Phase 37 — AI assistant backend**
- **What:** POST /assistant/chat (non-stream + SSE stream via Accept header; assistantLimiter 20/min); 3 tools (get_my_task_counts/get_my_agenda/search) — **JWT-scoped** (model supplies intent only, executor injects userId/workspaceId/role); conversations list (own) + get (:id owner-only → 404 foreign); degradation (no key → 503 on all, 401 for unauth first); prompt-injection resistance; OpenAI error mapping (429→503/timeout→504/else→502, no upstream leak). Needs OPENAI_API_KEY set for live-tool test.
- **Method:** [API][JEST]. **Pass:** tools can't cross tenant; convo isolation; clean degradation; injection resisted.

**Phase 38 — AI assistant frontend (KI-5)**
- **What:** **fix `client/src/http/assistant.ts` base-URL** (auto-derive like client.ts, so empty .env → :5501 not :5173); widget open/close, streaming render (data:{delta}…[DONE]), Stop (abort), New-chat, Escape, Bangla UI, conversation persistence (th-chat).
- **Method:** [CODE][UI]. **Pass:** widget reaches backend + streams a reply on default .env; persistence survives reload.

### Stage J — Cross-cutting & Security

**Phase 39 — API contract sweep**
- **What:** error envelope `{error:{code,message,request_id,details}}` everywhere; request_id == X-Request-Id; 422 details {field,issue}; no stack/path leak; cursor pagination (opaque base64, keyset internal_id, has_more, total_estimate) on list families; Idempotency-Key (cache 24h, same-key-diff-body→409) on creating POSTs; soft-delete default filter + ?include_archived; If-Match/ETag; 404 route.not_found; 1mb JSON limit; malformed JSON→400 (not 500). **App-root health/diagnostics (endpoints 1–4): `GET /health` (200 liveness), `/health/ready` (DB ping → 200/503), `/health/version`, `/metrics` (Prometheus text, no auth — confirm it leaks no secrets/PII).**
- **Method:** [API][JEST]. **Pass:** conventions hold uniformly; no 500 where a 4xx is due; all 4 health/metrics endpoints correct.

**Phase 40 — Security sweep**
- **What:** authz matrix (API_DESIGN Appendix B — every role×action: owner/admin/member/guest); IDOR (foreign-workspace id → 404 not leak); SQLi probes (search, filters, ids); XSS (comment/description rich-text render, TiptapReadOnly sanitize — P0-03 regression); **CORS origin allowlist (allowed origin → ACAO header; disallowed origin → blocked)**; rate limiters all buckets; secret redaction in logs (P1-05); auth bypass attempts; **utf8mb4 content integrity (Bangla/emoji in task names + comments store + render intact end-to-end)**; **KI-11:** mine REMEDIATION P2×15+P3×27, pull real ones in.
- **Method:** [API][JEST][CODE]. **Pass:** no escalation, no IDOR, no injection, no secret in logs; CORS enforced; Unicode round-trips; P2/P3 triaged.

**Phase 41 — Config & secrets hygiene**
- **What:** **KI-4** dedupe MAIL_* (3→1, keep effective block, document); confirm effective mail creds; ENCRYPTION_KEY present (from Phase 24); R2 creds sanity (or documented stub); all required env vars documented in .env.example; INTERNAL_JOB_TOKEN set (jobs fail-closed — **no/blank token → 401**); **functionally trigger each job (endpoints 155–158):** `POST /jobs/{session-cleanup,attachment-janitor,r2-purge,snooze-wake}` with `X-Internal-Token` + `?dry_run=true` → each returns its `{ok,…}` summary + does the right thing; `form-submission-expiry` via CLI (`npm run job form-submission-expiry -- --dry-run`); **KI-9** job scheduling — no in-process scheduler → gate decision (external cron for all 5 jobs) + document the commands; .env not git-tracked (secrets hygiene per repo memory).
- **Method:** [CODE][API]. **Pass:** one MAIL block; env documented; every job triggers + fails-closed without token; job-scheduling decision logged; no secret committed.

### Stage K — Frontend E2E (browser)

**Phase 42 — Playwright existing specs**
- **What:** run all 5 (.pw.ts): smoke (login+reload+16-route sweep+create S/L/T), full (space/list/calendar-create/drawer-edit/attachment-upload/AI-stream), sidebar (overflow scroll), forms (public date+dropdown submit + New-form), profile (name edit persists). Against QA DB + running servers. Fix flakes/selector drift.
- **Method:** [UI]. **Pass:** all 5 green (note: full.pw needs VITE_BACKEND_API_URL + OPENAI key for the AI assertion — set for the run).

**Phase 43 — Browser auth**
- **What:** login/logout, forgot→(seeded token)→reset, invite→accept→auto-login, session survives hard reload (KI-15 transient 401 benign), wrong-pw error toast, guest-route redirects.
- **Method:** [UI]. **Pass:** every flow completes; reload keeps session; errors surfaced.

**Phase 44 — Browser sidebar/structure**
- **What:** spaces tree expand/collapse (persisted), private-space visibility (owner/admin), list active-highlight, per-list star/favorites, filter box, context-menu (rename/new-list/copy-link/archive/delete), quick-create space+list, collapse rail; folders empty (dead, KI); inert list-header rename/invite (KI-8).
- **Method:** [UI]. **Pass:** all live controls work; inert ones confirmed inert (not bugs).

**Phase 45 — Browser tasks**
- **What:** List view (group/sort/filter/Me-Mode/show-closed/drag-status/multi-select→bulk bar); Board (columns/swimlanes/WIP/density/drag); Calendar month (click-create/drag-reschedule/unscheduled) + week/day stubs (KI-8); TaskDetailDrawer all panels (status/assignees/dates/priority/tags/custom-fields/subtasks/deps/checklists/comments/attachments/activity/SLA) — dev-type vs non-dev conditional rendering; drawer kebab (duplicate/archive/delete).
- **Method:** [UI]. **Pass:** every view + drawer panel works; dev-type gating correct; optimistic updates + rollback-on-error.

**Phase 46 — Browser settings**
- **What:** all 8 settings pages CRUD via UI; Members (invite modal, role dropdown, Send-email→**Gmail-compose** verify, deactivate/reactivate); Profile (name/tz save + change-password modal; avatar inert KI-8); Workspace (fields save; Delete-workspace inert KI-8); **KI-7** Import/Export "coming soon" toasts + faked export — confirm absent-as-feature.
- **Method:** [UI]. **Pass:** CRUD works; Gmail-compose opens; inert controls confirmed; import/export not-a-feature.

**Phase 47 — Browser forms/search/inbox/eng/AI**
- **What:** Forms builder (fields/settings/branding/preview/save) + public form submit; Search page (buckets, highlight, nav); Inbox (filters, mark, snooze, route); Engineering (Eng Home tiles + **KI-13 hardcoded-ID nav** — fix or document, Sprint board selector, On-call editor, Report-a-bug modal); AI widget (KI-5 must be fixed — open+ask+stream in Bangla).
- **Method:** [UI]. **Pass:** each surface works E2E; KI-13 nav resolved; AI widget streams.

### Stage L — Final

**Phase 48 — Full regression**
- **What:** re-run the entire jest suite + all 5 Playwright specs + both builds; diff against the Phase 2 baseline; confirm no fix (encryption, tz views, casing, assistant URL, MAIL, etc.) introduced a regression.
- **Method:** [JEST][UI][CODE]. **Pass:** jest ≥ baseline green; Playwright all green; builds clean; zero new failures.

**Phase 49 — Go-live gate synthesis**
- **What:** compile the final issue register (all phases), severities, what was fixed vs deferred; list remaining **gate decisions** (job scheduler for prod, plaintext-row migration, R2 real creds, is_private enforcement = RBAC project, any P2/P3 left); overall zero-issue verdict for the tested surface.
- **Method:** [CODE]. **Pass:** register complete; no open 🔴/🟠 on tested surfaces; decisions listed for user.

---

## 5. Definition of "zero issues" (acceptance)
- Every phase ✅ (or ⚠️ with a user-accepted gate note).
- All 🔴/🟠 found → fixed + re-verified; 🟡 fixed or explicitly deferred with reason; 🟢/ℹ️ logged.
- Full jest suite green; all Playwright specs green; client + server builds clean; Linux/CI-portable (KI-3 fixed).
- No privilege escalation / IDOR / injection / secret-leak on the tested surface.
- Known live bugs KI-1 (encryption) + KI-2 (tz views) + KI-5 (assistant URL) resolved.

*Prepared from the 2026-07-14 full-system scan. Say "run phase 0" to begin.*
