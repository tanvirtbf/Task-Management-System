# SYSTEM STATE SCAN — 2026-08-08

> **Purpose:** full current-state picture of the system before the next work block.
> **Method:** 5 parallel deep scans (backend architecture · data layer · frontend · quality/ops · docs+ledger), working tree as truth.
> **Baseline:** last commit `5fa8418` (deploy: nightly mysqldump). Everything after it is **uncommitted**.
> **Snapshot time:** 2026-08-08 ~11:30–11:50 (+06). At scan time a **live jest F32 regression sweep was still running** on this machine (15 node PIDs, `fixing/evidence/F32/jest-sweep.txt` appending, module `tasks` in progress).

---

## 1. TL;DR

- The product is **feature-complete** against `FINAL_REQUIREMENTS.md` and has been through a full two-campaign QA cycle: **TESTING** (42 phases, 2026-07-29→30, 93 issues filed) → **FIXING** (F1–F34, 2026-08-03→08).
- **Ledger ground truth** (`testing/ISSUES.md`, 98 unique ISS entries): **94 FIXED · 1 closed does-not-reproduce (ISS-005) · 1 WON'T FIX by decision D4 (ISS-018) · 1 duplicate (ISS-093=ISS-087) · 1 genuinely OPEN = ISS-095** (tag routes carry no permission gate — verified live in `server/src/routes/tasks.ts:235-255`).
- **The single biggest risk is git state:** 358 files changed (+10,119/−1,954, excl. `client/dist`) + ~30 untracked files/dirs — the ENTIRE fixing campaign — sit uncommitted on `main`. One bad `git checkout` loses a week of work. Commit as soon as the live F32 sweep settles.
- **F32 (full regression sweep) is the only unfinished phase:** first pass covered 24/30 modules with **9 red suites**; a re-run is in progress right now. F32 + F34 have evidence but no `fixing/results/` docs; `fixing/STATUS.md` header/table are stale (say "Next: F31" while F34 already ran).
- **Deploy:** 6 of 7 blockers closed. Still open: B7/H3 (`db:migrate` trap fenced by prose only), Cloudflare Full-strict + real-IP snippet, firewall check on :5501, 9 box-only checks (F33 §5), provider-secret at-source rotation (user-gated), RBAC posture decision (user-gated).

**System size (current truth):** ~184 `/api/v1` endpoints across 31 route files · 42 tables / 5 views / 9 triggers · 41 services / 38 repos · 165 server test files / 34 jest configs · 7 vitest files · 14 playwright specs · 39 client routes/pages · 56 RBAC permissions · 6 background jobs · 0 CI.

---

## 2. The uncommitted working set (what's sitting on top of `5fa8418`)

| Area | What changed |
|---|---|
| `server/src` | 121 files, +3,769/−667 — the fixing campaign's security+correctness sweep (details §4) |
| `server/dist`, `client/dist` | Rebuilt prod artifacts (dist is committed **on purpose** — the 512MB droplet can't build); 60 old client asset files deleted by the F30 re-chunk |
| `client/src` | 33 modified + 3 untracked — SLA page, gating, a11y, checklist sub-items, dependency direction, activity verbs, KPI truthfulness |
| `database/` | `schema.sql` updated in sync; upgrades **005–013 all new/untracked**; `upgrades/README.md` tracker updated |
| New modules (untracked) | `server/src/middlewares/allowQuery.ts` · `server/src/rbac/scopeGuard.ts` · `server/src/utils/pagination.ts` · `server/src/validators/passwordPolicy.ts` · `server/scripts/f3-run-dept-report.ts` · `client/src/pages/sla/` · `client/e2e/f31-deferred.pw.ts` + `f5-edited-marker.pw.ts` · `server/tests/sprints/delete.test.ts` · `server/tests/test-utils/dates.ts` |
| Campaign ledgers (untracked) | `FIXING_MASTER_PLAN.md` · `TESTING_MASTER_PLAN.md` · `FULL_SYSTEM_SCAN_2026-07-29.md` · `fixing/` (STATUS, FIX-LOG, DECISIONS, FIXING_SUMMARY, results F01–F33, evidence F01–F34) · `testing/` (ISSUES 240KB, STATUS, TESTING_SUMMARY, 42 result files, 122 evidence files) |
| Docs | `API_DESIGN.md` +452/−49 (contract updated for F23/F28/F29 — response families, sprint delete, dev-field gating, error catalog 129→135) · `DEPLOY_READINESS_SCAN_2026-07-28.md` §6 runbook corrected by F33 (42/5/9, upgrades 001–013, DB_TIMEZONE) |

---

## 3. Architecture map (verified current)

### Backend (`server/`)
- Express + TS (tsx), layered: routes → controllers → services (41) → repositories (38) → Drizzle/MySQL. Wire = snake_case, lists = `{data, pagination}`, errors = `{error:{code,message,request_id}}`.
- **Middleware chain:** requestId → requestLogger → securityHeaders (CSP/COOP/CORP added F13) → metrics → CORS → cookieParser → json(1mb). `/api/v1` router: `apiLimiter` (600/min) → `rbacContext` (ALS) → routes. `/health`, `/health/ready`, `/health/version`, `/metrics` mounted at app root OUTSIDE the limiter.
- **Auth:** access JWT (Bearer or cookie; `exp` now mandatory) + `bb_refresh` cookie rotation with reuse detection (`TokenService`, insert-before-revoke). Boot guard hard-fails on missing secrets.
- **RBAC (two layers):** route verb = `requirePermission(key)`; service object = `scopeGuard.assertScoped/hasFullReach` + `assertCan` (`rbac/can.ts`); repo visibility = `spaceScopeFilter/listScopeFilter` driven solely by `space.view`. Synthetic actors: system, public-form, **intake** (new, F28 — bug-report path after Guest lost `task.create`). `liveLegacyRole()` kills the 15-min stale-JWT-role window on sensitive paths.
- **Rate limiters (7):** api 600/min · authStrict 5/min/IP · invitation 5/min · publicForm 30/min · assistant 20/min · reportGenerate 10/min · uploadSign 60/min. ALL become no-ops under `NODE_ENV=test` or `DISABLE_RATE_LIMIT=1`.
- **Jobs (6):** session-cleanup, attachment-janitor, r2-purge (+ drains new `r2_purge_queue`), snooze-wake, form-submission-expiry, department-report. NO in-process scheduler — external cron hits `POST /api/v1/jobs/<slug>` (internalAuth, constant-time token) or `npm run job <slug>`. `?dry_run` parsing hardened (bare flag = true, garbage = 422).
- **Integrations:** MailService (nodemailer, log-only fallback) · R2 (presigned PUT + proxied raw upload fallback, 25MB/MIME allow-list) · SSE `/stream/inbox` (cookie auth, Last-Event-Id resume) · AI assistant (gpt-4o-mini, KB-in-prompt, 3 read-only tools, Bangla, SSE streaming over POST).

### Data layer
- **42 tables** (schema.sql ↔ Drizzle verified 42/42 in sync, including all uncommitted edits). New this cycle: `r2_purge_queue`; dropped: `workspaces.fiscal_year_start_month`, `user_notification_prefs.email_enabled`; notification enum 12→7; 3 unique keys (space/list/role names); 4 perf indexes (F30).
- **Provisioning:** fresh DB = `npm run db:setup` (applies schema.sql whole) → **42 tables / 5 views / 9 triggers** (F33's new canonical shape). Existing DB = hand-apply `database/upgrades/001–013` in order. **Drizzle migration chain is FROZEN** — `db:migrate` is a trap (see §6).
- **The canonical clock:** `DB_TIMEZONE=+00:00` (session UTC), prod boot guard enforces it. Dhaka business calendar via `utils/dhakaTime.ts` (now also: workspace-zone calendar F5 + business-hours SLA clock F28). Raw `NOW()`/`CURDATE()` eliminated from live queries except one benign `NOW()` at `EngineeringRepo.ts:258`.

### Frontend (`client/`)
- React **19.2** + antd **6** + react-query 5 + zustand 5 + vite 7. One env var: `VITE_BACKEND_API_URL` (prod = relative `/api/v1`).
- 39 routes; NEW `/sla` breach-queue page (60s auto-refresh, linked from sidebar + home KPI tile). Vendor chunking added (F30) — antd deliberately NOT bucketed (measured regression).
- **Permission pipeline:** `GET /me/permissions` → zustand → `usePermissions().holds/can`; `<RequirePermission>` on 9 routes; sidebar/settings/drawer/assistant gate on `holds()`. **Legacy `user.role === "owner"|"admin"` checks remain in 7 places** (SpacePage, SidebarSpaceTree, Reports×2, ReviewSection, DepartmentPage, Sidebar `canSeeDept`, MembersSettings owner-disable).
- **MembersSettings is still the legacy 4-role UI** — role changes go through `usersApi.updateRole`; the dynamic-RBAC assignment surface (`rbacApi.assign/revoke/holders/spaceMembers`) has ZERO callers. You can define custom roles in `/settings/roles` but cannot assign them from any UI (P27 backlog).
- Mock layer (~5,000 lines: `lib/mock-api.ts` + `src/mocks/`) confirmed dead — excluded from tsc+eslint, zero importers.

### Quality / Ops
- **Tests:** 165 server test files; per-suite private DBs via 34 jest configs (`--testTimeout=60000` mandatory; never 2 runs on one `*_test` DB). Client vitest 7 files (44 tests). Playwright 14 specs (needs BOTH dev servers running + API with `DISABLE_RATE_LIMIT=1`; `workers:1`). Assistant gate: `node server/scripts/assistant-eval.cjs --assert` (live model, costs money).
- **NO CI.** Every gate is manual. Deploy = `git pull` + `pm2 restart` on the box.
- **Deploy artifacts** (`deploy/`): nginx vhost (single 80+443 block, SSE location, `/health` proxied, `/metrics` denied, SPA fallback) · pm2 (fork ×1, 400M cap, TZ=Asia/Dhaka) · cron (6 jobs, UTC times) · logrotate (copytruncate, 14d) · nightly mysqldump (01:00 UTC, `--routines --triggers`, 14d retention, 3 guards).
- **Env contract:** ~38 Config vars + 11 raw `process.env` flags. Removed as dead: `SECRET_KEY`, `COOKIE_SECRET`, `CLOUDFLARE_TOKEN_VALUE`. `db:seed:demo` now requires `ALLOW_DEMO_SEED=1` (+ `ALLOW_DEMO_SEED_OVER_DATA=1` over non-demo data) — three stacked guards.

---

## 4. What the fixing campaign changed (F1–F34, by block)

| Block | Sessions | Delivered |
|---|---|---|
| A — the clock | F1–F5 | `DB_TIMEZONE=+00:00` canonical + boot guard; views realigned (upgrade 005); workspace-zone "today" (F5); seed date fixes; `(edited)` comment marker. F2 (dead-code trim) optional, never run |
| B — authorization | F6–F10 | Route gates on ~34 previously-open routes (checklists ×9, tasks ×8, sprints, deps, custom-field values, form submissions, activity, assistant); `scopeGuard.ts` service layer; forms space-visibility; JWT `exp` required; revoked-session prune (ISS-017) |
| C — production safety | F11–F14 | Pool exhaustion → 503+Retry-After; password policy (`passwordPolicy.ts`); CORS 500 fix; CSP/COOP/CORP; `x-powered-by` off; seed-demo triple guard; `dry_run` parsing; dead env keys removed; SMTP fallback tier documented |
| D — data integrity | F15–F18 | Counter triggers rebuilt + backfills (upgrade 006, MySQL-1093-safe); stale subtask triggers dropped; `r2_purge_queue` (007); form-submission 90d retention (008); space unarchive restores lists; head validation on space create |
| E — behaviour | F19–F23 | Notification enum 12→7 + prefs cleanup (009); blocked-task completion enforced (ISS-011); real before/after activity diffs (ISS-049); admin-only email change (ISS-030); last-admin lockout guard (ISS-020); `allowQuery` unknown-param 422 (ISS-014); real pagination + strict cursors (`pagination.ts`, ISS-007/008) |
| F — UI truthfulness | F24–F27 | KPI trend/sparkline lies removed; agenda time lie removed; archive-vs-delete split (restore + hard-delete confirm); dependency direction + workspace-wide picker; checklist sub-items UI; status reorder UI (ISS-038); nav/action gating (F26); name uniqueness (010) |
| G — decisions | F28–F30 | All 7 D12 decisions: guest 19→7 grants (011) + intake principal, business-hours SLA clock, `DELETE /sprints/:id`, list move between spaces, locale frozen, fiscal-year dropped (012), checklist assignees; F29 LOW sweep (eng-field gating by `is_dev_type`, `pr_url` URL check, phone/money depth, 200-caps); F30 perf (4 filesort indexes = 013, bundle split, ISS-005 re-measured, ISS-092 seed fix) |
| H — verification | F31–F34 | F31 deferred-interaction e2e (`f31-deferred.pw.ts`: DnD, calendar drag, offline, ⌘K, focus trap, 5 viewports, axe) → filed ISS-096/097/098; **F33 runbook re-check (42/5/9 canonical, DEPLOY_READINESS §6 corrected)**; F34 fixed all three F31 findings + final proof (15/15 no-repro, 72/72 playwright green); **F32 sweep = still in progress** |

---

## 5. OPEN ITEMS (merged ledger)

### Code — genuinely open
| ID | Sev | Item | Where |
|---|---|---|---|
| **ISS-095** | MED (security) | `POST /tasks/:id/tags` + `DELETE /tasks/:id/tags/:tagId` have NO `requirePermission` — any authenticated persona incl. guest can re-tag any task | `server/src/routes/tasks.ts:235-255` |
| F2 | LOW | Optional dead-code trim (unreachable DATE branches in `taskSerializer`/`onCallSerializer`) | `FIXING_MASTER_PLAN.md:183` |
| ISS-098 residue | LOW | axe color-contrast "serious" rows (7–22/page) — deferred themed design pass | `fixing/FIXING_SUMMARY.md:87` |

### Process — fixing campaign closure
- **F32 sweep incomplete/red:** first pass 24/30 modules, 9 failing suites (custom-fields/list, dept-review/head-assignment, dept-review/reports-actions, lists/create, membership/assignees.remove, notifications/preferences, rbac/can, sla/breached, spaces/create). **Re-run live at scan time.** Plan boxes all `[ ]`.
- `fixing/results/F32.md` + `F34.md` missing; `fixing/STATUS.md` header/table stale ("Next: F31", table PENDING from F28); `FIXING_MASTER_PLAN.md` traceability still totals 93; `testing/ISSUES.md:2439` stale OPEN line under FIXED ISS-058; FIXING_SUMMARY claims "0 silently open" with no slot for ISS-095.
- **Nothing committed to git** (see §2).

### Deploy — before go-live
| Item | Owner | Detail |
|---|---|---|
| B7/H3 `db:migrate` trap | repo | `db:generate/migrate/push/drop` still shipped in `server/package.json`; `PRE_DEPLOYMENT_CHECKLIST.md` still teaches the wrong path (ordered deleted/rewritten twice, never done). `_post.sql` drift makes it worse (§6) |
| Cloudflare SSL → **Full (strict)** | operator | Under Flexible the edge→origin hop is plaintext (vhost header instruction) |
| Real-IP snippet | operator | `sudo deploy/nginx/cloudflare-realip.sh && nginx -t && reload` — else all per-IP limits share one bucket |
| Firewall :5501 (ISS-089) | operator | Is TCP 5501 exposed on 209.38.65.61? Decides if the bind was exploitable |
| `nginx -t` | operator | Vhost never validated (no nginx on dev box) |
| 9 box-only checks | operator | `fixing/results/F33.md:77-86` (runbook end-to-end, cookie flags, R2 unreachable, run-job with API down, eng.not_configured, Dhaka midnight rollover, assistant upstream fail, SPA headers) |
| Provider secrets at-source | **user** | MySQL / Mailtrap→real SMTP / OpenAI / R2 — local rotation done 2026-07-23 (history purge commit `50a303e` IS in the log), provider-side rotation unconfirmed |
| RBAC posture | **user** | Launch open (everyone sees everything, dormant RBAC) vs. spend a session on P12–15+P27 first — "chosen, not inherited" (`DEPLOY_READINESS_SCAN_2026-07-28.md:266`) |
| B5 residue | LOW | `client/.env.example` still hardcodes `http://localhost:5501/api/v1` |

### RBAC backlog (pre-existing, out of campaign charter — `RBAC_DYNAMIC_PLAN.md`)
- **P12–15** own-scope on remaining writes · **P20–22** repo visibility (forms/statuses/custom-fields/task-content/no-join-path incl. **tags**, notifications, sprints, templates, assistant tool scoping) · **P27** space-members UI + **role-assign UI (rbacApi surface has zero callers)** · **P29–30** rest of client action-gating · **P32–35** sweeps/e2e/preset/Bangla admin guide.

---

## 6. NEW findings from this scan (not in any ledger)

1. **`_post.sql` trigger drift — `db:migrate` builds a wrong DB.** `server/src/db/migrations/_post.sql` has 7 of 9 triggers: missing `trg_comments_after_update` + `trg_form_submissions_after_delete` (the 006 fixes), missing `r2_purge_queue`, missing the `DROP TRIGGER trg_subtasks_after_*` cleanup. It got the 005 view updates but not the 006 trigger work. Anyone running `db:migrate` reproduces ISS-065/ISS-080 exactly. → Either sync `_post.sql` or finally remove the `db:migrate` script (B7).
2. **`RecentActivityCard.tsx:20` still uses the mock-era verb map.** F21/ISS-061 rewrote `TaskActivitySection`'s vocabulary (28 real codes) but the home-page card kept its own stale 9-case `actionVerb()` switch — same bug, second call site.
3. **`AgendaCard.tsx` vestigial filter:** after F24 removed all `dueDate` use, `.filter(t => t.dueDate)` remains — silently hides today-bucket tasks that have no due date.
4. **`drizzle.config.ts` has no `DB_SOCKET_PATH` support** — `db:push`/`db:studio` fail on MySQL 8.4 while the app connects fine. Also reads `.env.dev`, not `.env`.
5. **`allowQuery` covers 5 of ~20 collection GETs** — the ISS-014 class (unknown params silently ignored) still exists on `/notifications`, `/search`, `/activity`, `/forms`, `/sprints`, `/reports`, `/templates`, `/on-call/schedule`, `/lists/:listId/tasks`.
6. **`notifications.email_sent_at` orphan column** — survives after F19/D8 declared there is no per-type email channel ("declared but no producer" class).
7. **Dead code inventory:** server `canAccess.ts` / `parseRefreshToken.ts` / `validateRefreshToken.ts` (zero importers, stale doc-comment references in 3 controllers); client `Trend.tsx` + `Sparkline.tsx` (newly orphaned by F24), `useUnarchiveTask` (added this cycle, zero callers), `notificationsApi.get/updatePreferences` (zero callers), `rbacApi` assignment methods (zero callers), ~5,000-line mock layer.
8. **`EngineeringRepo.ts:258`** — last raw `NOW()` in a live query (benign under UTC session, but the exact pattern 005 rolled back elsewhere).
9. **No in-DB upgrade tracker** — applied-state for `upgrades/001–013` lives only in a markdown table; 001–004 are single-apply; prod's first run is 13 hand-applied scripts. **`010` will fail loudly on duplicate names** (QA needed 6 renames; no pre-flight collision query exists).
10. **Doc staleness for the next operator:** `LOCAL_RUN_GUIDE.md` never mentions `db:seed:demo` (+ its new `ALLOW_DEMO_SEED=1` requirement), says nodemon `npm run dev` (stale-code trap — use `npx tsx watch src/server.ts`), omits `DB_TIMEZONE`, says 150 endpoints (now ~184). `FINAL_Technical_Requirements.md` doesn't exist — the real file is `FINAL_REQUIREMENTS.md`.
11. **Playwright infra is machine-bound:** `f31-deferred.pw.ts` (and others) shell out to `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe` with root/root — breaks on any other machine.
12. **`jest.tags`/`jest.tagscheck`/`jest.tagsreview` configs have no private-DB pin** (legacy) — collision risk if run concurrently with anything.

---

## 7. Where truth lives (doc map)

**Canonical / current:** `API_DESIGN.md` (contract, modified) · `testing/ISSUES.md` (issue ledger) · `fixing/FIXING_SUMMARY.md` (campaign closure) · `fixing/DECISIONS.md` (D1–D12.7) · `DEPLOY_READINESS_SCAN_2026-07-28.md` **§6 only** (runbook, F33-corrected) · `RBAC_DYNAMIC_PLAN.md` (backlog) · `DEMO_ACCOUNTS.md` · `LOCAL_RUN_GUIDE.md` (with §6.10 staleness caveats) · `ASSISTANT_TEAM_NOTE.md`.

**Actively WRONG — do not follow:** `PRE_DEPLOYMENT_CHECKLIST.md` (teaches broken DB provisioning; twice ordered deleted) · `FULL_SYSTEM_SCAN_2026-07-29.md` H2 advice (`UTC_TIMESTAMP()→NOW()` — explicitly rejected by F4) · `GO_LIVE_GATE_REPORT.md` "0 bugs" verdict (pre-campaign) · `DEPLOY_READINESS_SCAN` §2/§5 (pre-fix state, never annotated) · `fixing/STATUS.md` header/table (3 phases stale).

**Historical chains:** LAYER_* / MODULE_* / SYSTEM_TEST / FULL_QA → `FULL_SYSTEM_TEST_PLAN.md` → `TESTING_MASTER_PLAN.md`. `REMEDIATION_PLAN.md` → `FIXING_MASTER_PLAN.md`. AI_ASSISTANT_{PLAN,GAP,UPGRADE,SCAN} → `AI_ASSISTANT_PERFECT_PLAN.md`. `RBAC_TEAMS_REQUIREMENTS.md` → `RBAC_DYNAMIC_PLAN.md`.

---

## 8. Traps for whoever works next (hard-won, verified)

- Dev server: `NODE_ENV=dev npx tsx watch src/server.ts` (NOT `npm run dev`/nodemon — serves stale .ts). Kill stuck :5501 via PowerShell `Get-NetTCPConnection`, not `pkill`.
- Jest: always `--testTimeout=60000`; one module per invocation; never two runs on one `*_test` DB; a red serial-chain row is not evidence until re-run solo (pool-drain flake).
- Playwright: needs vite:5173 + API:5501 already running, API with `DISABLE_RATE_LIMIT=1` (never in prod); specs are `.pw.ts` so vitest ignores them.
- DATE fixtures: only via `server/tests/test-utils/dates.ts` — never `new Date(y,m-1,d)` (lands a day early under the +00:00 driver).
- Raw SQL sessions: `SET time_zone='+00:00'` first or every timestamp looks 6h off — not a bug.
- MySQL 1093: backfills join a derived table, never a correlated subquery on the same table.
- Schema changes ship as THREE synchronized edits: `database/schema.sql` + Drizzle TS + `database/upgrades/NNN_*.sql` (chain frozen; never `drizzle-kit generate`).
- Assistant KB strings: no backticks/`${}` in the literal; `route-parity.test.ts` fails if KB links drift from `router.tsx`.
- `db:seed:demo` is DESTRUCTIVE and now needs `ALLOW_DEMO_SEED=1`; after re-seed run `npx tsx scripts/f3-run-dept-report.ts` to restore the 12-report baseline.
- pm2 must keep `instances: 1` (in-process rate limits, metrics registry, SSE registry).
