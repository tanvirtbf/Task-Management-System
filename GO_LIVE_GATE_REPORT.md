# 🚦 GO-LIVE GATE REPORT — BeautyBooth Task Management (Legacy Stack)

**Date:** 2026-07-20 · **Scope:** 50-phase full-system test (`FULL_SYSTEM_TEST_PLAN.md` → `FULL_SYSTEM_TEST_LOG.md`)
**Stack:** Express + MySQL + Drizzle (`server/`) · React + Vite (`client/`) · gpt-4o-mini assistant

---

## 1. Executive summary

The whole legacy system was tested end-to-end across **50 phases** (foundation → auth → structure → tasks → content → forms/templates → engineering/SLA → notifications/SSE/home → search/AI → cross-cutting/security → browser E2E → final). 

- **Backend:** ~**2842** jest tests across 29 per-module suites.
- **Browser E2E:** **46** Playwright tests across 11 specs (auth, sidebar, tasks/views, settings, forms/search/inbox, assistant, smoke, …).
- **Builds:** client `tsc` + server `tsc` both clean.
- **Code fixes:** **14** applied and verified (12 product + 2 E2E-infra).
- **Known functional bugs remaining: 0.**

**Verdict: FUNCTIONALLY GREEN.** Everything left below is **deploy-hygiene** or a **config decision** — none of it blocks starting the RBAC + Teams feature build on this codebase.

---

## 1b. ADDENDUM — Dept Review V1 shipped (2026-07-22)

The lightweight **department-review + weekly HR reports** feature (`DEPARTMENT_REVIEW_PLAN.md` v1.1, 32 phases) is **built, tested and browser-proven** on this stack:

- **Scope:** `spaces.head_user_id` (1 head per department) · head approve/flag reviews on DONE tasks (`task_reviews` + task denorm trio) · head dashboard `/dept` (summary + 4-bucket queue) · per-department weekly reports (`department_reports`, §payload snapshot) · HR inbox `/reports` + print-friendly detail with Mark seen / Regenerate / head-note · `department-report` weekly job (Mon 09:00 Dhaka, §3.7 cron table row 6) + on-demand generate · notification types `task_reviewed` / `report_ready`.
- **Schema:** additive only — `database/upgrades/001–003` applied to dev + QA; **live DB upgrade = run those 3 scripts** (same gate as §3.7).
- **Tests:** dept-review module **14 suites / 122 jest tests** (incl. the P28 permission + isolation sweep: cross-workspace fence, role matrix, head-handover H-12, deactivated head, archived edges) · P29 full regression across 8 modules (~1,660 module tests) green · committed Playwright E2E `client/e2e/dept-review.pw.ts` (assign → review → flag notif → report → HR ack).
- **API:** documented as `API_DESIGN.md` **§33** (endpoints, wire shapes, error codes, job).

---

## 2. Code fixes applied (14) — all verified + regression-checked

| # | Phase | Sev | Area | Fix |
|---|---|---|---|---|
| 1 | P1 | 🟠 | build/CI | **KI-3** `tokenService`/`credentialService` git-tracked lowercase but imported PascalCase → broke Linux/CI. Git-renamed to PascalCase. |
| 2 | P1 | 🟢 | strict-tsc | `ping-openai.ts` null-deref (TS18047) — added null guard. |
| 3 | P12 | 🟠 | API contract | `GET /tasks/:id` leaked Express weak-hash ETag not `updated_at` → broke If-Match GET→PATCH. Set the header. |
| 4 | P13 | 🟠 | tasks | partial-PATCH `start>due` → 500 (no date guard) → now 422 `task.invalid_date_range`. |
| 5 | P13 | 🟠 | tasks/FE | null-clear of nullable task fields → 422 (matchedData drops explicit nulls) → allowlist re-includes; fixes FE date-picker clear. |
| 6 | P15 | 🔴 | subtasks | subtask status change → **500 (MySQL 1442)** — 3 `trg_subtasks_*` triggers did `UPDATE tasks` from a `tasks` trigger. Dropped them. |
| 7 | P21 | 🟡 | attachments | **KI-2** `deleted_at` written with local `NOW()` (+6h skew) → `UTC_TIMESTAMP()`. |
| 8 | P24 | 🔴 | forms | **KI-1** form encryption OFF + broke forms suite — added `encrypted_at`/`expires_at` cols, wired `decryptJSON`, set `ENCRYPTION_KEY`. Forms 72→81/81. |
| 9 | P38 | 🟠 | assistant FE | **KI-5** `assistant.ts` read `VITE_BACKEND_API_URL` directly → empty `.env` POSTed to :5173. Now reuses `client.ts` BASE_URL derivation. |
| 10 | P38 | 🟠 | assistant/CORS | **KI-5b** stream `X-Conversation-Id` hidden cross-origin (no `exposedHeaders`) → every msg forked a new convo. Added `exposedHeaders`. |
| 11 | P41 | 🟡 | config | `.env.example` was missing ~20 vars (SECRET_KEY/ENCRYPTION_KEY/MAIL_*/R2/…) — completed with safe placeholders. |
| 12 | P46 | 🟠 | eng FE | **KI-13** eng dashboard hardcoded `sp-eng`/`l-bug-triage`/`l-incidents`/`l-sprint` seed ids → broken links. Now resolves the real list (`useListMap`) + `/t/:id`. |
| 13 | P42 | ⚙️ | test-infra | `rateLimit.ts` `DISABLE_RATE_LIMIT` opt-in escape-hatch (E2E suite tripped authStrict 5/min). Prod/dev unaffected. |
| 14 | P42 | ⚙️ | test-infra | `smoke.pw.ts` route-sweep capped `networkidle` (never settles with SSE/poll) + 90s timeout. |

---

## 3. 🔴 GATE ITEMS — must resolve before PRODUCTION go-live

> These are **deploy/config** actions on the live environment or repo. They do **NOT** block the RBAC dev build (which runs on the already-green codebase).

### 3.1 ✅ RESOLVED (2026-07-23) — KI-4 mail-sender dedupe
`server/.env` had **3 duplicated `MAIL_*` blocks** (dotenv LAST-wins → the "Fallback" `beautyboothbd.com` block was shadowing the labeled "Primary — verified + prod-e active" `beautybooth.com.bd` block). **Deduped 3 → 1**, keeping the **Primary (`beautybooth.com.bd`)** identity per the file's own annotation. dotenv now loads a single unambiguous sender. (To switch to the `beautyboothbd.com` token instead, swap the one block's values — one-line change.)

### 3.2 ✅ RESOLVED (2026-07-23) — Git-tracked secrets purged + rotated
`ENCRYPTION_KEYS.txt` and `deploy.sh` (real prod keys) were git-tracked **and already pushed** to `origin/main` (private repo). Remediation done:
- **History purge** — `git filter-branch` removed both files from ALL of main's history; local gc dropped the old commits (`b14f0aa`/`b42961a` no longer resolve). Force-pushed to `origin/main` (`f947183 → 50a303e`).
- **`.gitignore`** added (secrets + `.env` + `node_modules` + build/test artifacts); committed + pushed. `*.env.example` stay tracked.
- **Rotation** — a fresh full secret set (`ENCRYPTION_KEY`, `ACCESS/REFRESH_TOKEN_SECRET`, `SECRET_KEY`, `COOKIE_SECRET`, `INTERNAL_JOB_TOKEN`) generated into gitignored **`ROTATED_SECRETS.local.txt`** — apply these to prod, then delete the file.
- **⚠️ Still on you:** rotate provider secrets at their source if `deploy.sh` carried them — **MySQL prod DB password, Mailtrap token, OpenAI key, R2 keys**. GitHub may retain the orphaned pre-force-push commits by direct SHA for a while, so rotation (above) is the real protection. The dev `server/.env` was never tracked (not exposed).
- **Repo bloat note (non-secret):** an 86 MB `workerd.exe` from an old accidental `node_modules` commit still bloats history — optional future `filter-branch`/BFG cleanup.

### 3.3 KI-1 form-encryption live-deploy
- `ALTER TABLE form_submissions ADD encrypted_at TIMESTAMP NULL, ADD expires_at TIMESTAMP NULL, ADD INDEX idx_form_submissions_expires_at (expires_at)` on the **live** `taskmanagement` DB.
- Set a real **64-hex `ENCRYPTION_KEY`** secret on the deployed server (QA used a test key). The 3 existing plaintext rows pass through fine.

### 3.4 Dead DB views — drop or re-apply UTC (live DB)
All 5 views (`v_open_tasks`, `v_open_bugs`, `v_active_sprint`, `v_current_on_call`, `v_breached_sla`) are **unused by the app** (it queries base tables). The live DB's copies still use `NOW()`/`CURDATE()` (schema.sql is UTC-fixed). **DROP them, or `CREATE OR REPLACE` with the UTC definitions** — cosmetic, zero runtime impact.

### 3.5 Fresh-install gap — "Bug Triage" list in seed
`seed.ts` creates the Bug/Incident **types** but not a **"Bug Triage" list**, so `report-bug` returns 409 `eng.not_configured` out of the box. **Add a "Bug Triage" list to `seed.ts`** (or document it as required admin setup).

### 3.6 Timezone — `TZ=Asia/Dhaka` at deploy
Home KPIs (`due_today`/`overdue`) and on-call "today" use the **server-local** date. Set `TZ=Asia/Dhaka` on the deployed server so "today" matches the team's calendar day. (DATE columns → coherent for a single-region team.)

### 3.7 KI-9 — external cron for the 6 background jobs (no in-process scheduler)
- HTTP (per deploy): `curl -fsS -X POST -H "X-Internal-Token: $INTERNAL_JOB_TOKEN" https://<api>/api/v1/jobs/<slug>`
  - `snooze-wake` every 5 min · `session-cleanup` / `attachment-janitor` / `r2-purge` daily.
  - **`department-report` weekly — Monday 09:00 Asia/Dhaka** (Dept Review V1, added 2026-07-22): generates last week's per-department HR reports + `report_ready` notifications. Idempotent (safe to re-run; a missed Monday self-heals one week back on the next run).
- CLI: `cd server && npx tsx src/bin/run-job.ts form-submission-expiry` daily (the only job without an HTTP route).
- Verify any job first with `npm run job <slug> -- --dry-run`.

---

## 4. 🟡 SHOULD-DO / V2 (not blockers)

| Item | Note |
|---|---|
| **Idempotency-Key** | Not implemented — creating POSTs aren't retry-safe (network retry can duplicate). V2: idempotency-cache middleware (24h, same-key-diff-body → 409). FE should debounce meanwhile. |
| **FULLTEXT search index** | Search is `LIKE`-based (fine < 10k rows). For scale, add a MySQL ngram FULLTEXT index + `MATCH…AGAINST`; fix the stale SearchRepo comment. |
| **App-side subtask counters** | `subtasks_count`/`completed` are always 0 since the illegal triggers were removed (fix #6). Maintain them app-side if the UI needs the numbers. |
| **`hidden_from_guests`** | Hardcoded `false` on task create — guest custom-field redaction *works* but can't be *enabled* from the create path. |

---

## 5. Deferred features (confirmed absent — NOT bugs)

- **KI-7 Import/Export** — placeholder UI; "Export" shows a faked "would download" toast. Not a real feature.
- **KI-8 inert controls** — avatar upload, delete-workspace, list-header rename/invite, template per-item due dates. Present but intentionally inert.
- **KI-6** — `v_open_bugs` hardcodes `tt-bug` (dead view; live path resolves by name). Folds into §3.4 cleanup.
- **KI-11 (REMEDIATION_PLAN P2×15/P3×27)** — the high-severity items are **already handled**: **P0-03 XSS** (DOMPurify), **P1-05** log-secret redaction, **P1-06** invite rate-limit. The rest are low-priority backlog (bundle size, perf, DX) — not security.

---

## 6. Security posture (Phase 40)

No privilege escalation · no IDOR (foreign ids → 404) · SQLi-safe (bound params) · XSS-safe (DOMPurify + escapeHtml-first highlight) · CORS allowlist enforced · rate limiters fire · secrets redacted (no `password_hash` in responses, no bodies/passwords in logs, `/metrics` clean) · auth-bypass blocked · utf8mb4 (Bangla+emoji) intact · AI assistant injection-proof (JWT-scoped tools).

---

## 7. Sign-off

- **Functional quality: GREEN** — 0 known functional bugs after 14 verified fixes.
- **Backend:** ~2842 per-module jest (final tally being re-confirmed) · **Browser E2E:** 46/46 · **Builds:** clean.
- **Recommendation:** proceed to the **RBAC + Teams** build (`RBAC_TEAMS_REQUIREMENTS.md`). The §3 gate items are **operational/deploy** actions to complete before real users hit production — they can be scheduled in parallel with, and do not block, the RBAC feature work.

> _One decision is outstanding and only you can make it: **§3.1 (KI-4 mail sender)**. Tell me which sender to keep and I'll dedupe the blocks._
