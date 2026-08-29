# FULL SYSTEM SCAN — 2026-08-25 @ `b090667`

Scope: frontend, backend, database, API, security, dependencies, tests, live behaviour, production.
Method: five parallel deep-analysis passes (server static, client static + production build, full
test suite, database, security/deps) plus live probing — a booted dev stack, **4 roles × 27
endpoints of live API calls**, a create/patch/permission write battery, a headless-Chromium UI
smoke (login → Home → List view, console captured), and read-only probes of production.

Supersedes `SYSTEM_SCAN_2026-08-22.md`. Delta since that baseline: 4 commits, all of them the
**Assigned By plan P0–P3** (29 files, +1,034 lines — upgrade 025, serializer, create-path
stamping, tests, types).

---

## 0) Headline

**The engine is still clean at HEAD.** Zero 5xx at every role on every endpoint tried, zero
data-integrity defects, zero new lint/type errors, the permission model held under direct attack
again, and the new Assigned By work is verified end-to-end (SQL → Drizzle → serializer → wire →
client type) with a clean attack surface — nothing since `c357ccf` introduced a single defect
this scan could find. For the first time the **entire** test suite was aggregated in one session:
**4,336 of 4,340 unique tests pass**, and the 4 failures are pre-existing test debt (§1b), not
product code.

What changed in the risk picture is one thing: **the deploy prompt on disk is now actively
dangerous.** It pins `c357ccf` and applies only upgrades 023+024, but HEAD requires **025** —
deploying HEAD with it would 500 every task read in production, and its canary (F1, still
unfixed) is blind to exactly that failure. Everything else open on 08-22 is still open,
unchanged.

---

## 1) Verified healthy — do not re-audit

| Area | Evidence from this run |
|---|---|
| Typecheck | `tsc --noEmit` **0 errors** server and client (server config excludes `tests/` — ts-jest covers those at run time) |
| Lint | Server **70 errors + 0 warnings**, client **12 + 4** — reconciles exactly with the accepted 08-18 baseline; **zero problems in any file touched since `c357ccf`** |
| Client build | Production build succeeds (3,647 modules, 65s); output `index-BTa8KcQk.js` is **byte-identical to the bundle production serves** — independent proof prod runs this code |
| Client unit tests | vitest **49/49 pass** (7 files) |
| API surface | **209 endpoints / 35 route files**, unchanged; public set still exactly the deliberate 11 + `/health*`; every other route carries `authenticate` |
| Live behaviour | 27 GET endpoints × 4 roles (owner/admin/member×2): **zero 5xx**. `/roles` and `/delete-requests` correctly 403 for members; cross-space reads 404 (anti-enumeration intact); member PATCH on another's task → **403 `task.forbidden`** (own-scope writes still enforced) |
| Database | 47 tables / 5 views / 9 triggers / **108 FKs** (+1 = 025's). **0 orphans** (12 checks), **0 counter drift** (7 counters), **0 status contradictions**, only the 2 known redundant index pairs (204 indexes total) |
| Schema parity | Three-way (live ↔ `schema.sql` ↔ Drizzle): **466/466 columns matched**, 0 drift; the 3 live-only columns are documented deliberate VIRTUAL ones |
| Upgrade 025 | Column + index + FK live in dev; backfill formula (`earliest assigner, else creator`) — **0 NULLs, 0 deviations of 47**; `schema.sql`, `025_assigned_by.sql`, and Drizzle all match (mirror rule held) |
| Assigned By, code | One serializer emits `assigned_by` (`taskSerializer.ts:188`, fallback `?? created_by`) reaching **all 11 call sites** = List/Board/Calendar/detail/space browser/Home/search/dependencies/eng/reviews/my-work/bulk. Both task-insert sites stamp it; all five entry funnels pass a sane actor (API=caller, public form=form **owner**, recurrence=template creator, assistant=asking user, report-bug=reporter) |
| Assigned By, live | CREATE → `assigned_by` = creator on the wire (201 probe); present in list-tasks 2/2, task detail, my-work buckets, search results, eng-home previews. **Not writable**: absent from every validator + `matchedData` whitelists drop it (live PATCH probe → 422); forgery impossible, anti-enumeration trivially holds |
| UI smoke | Headless login → **Home renders fully** (KPI cards, My Work, Agenda, LineUp, activity, 6 spaces) → **List view renders fully** (status groups, filter bar, tabs, avatars). Console: only 3 pre-login 401 bootstrap lines + 1 antd deprecation warning; **zero failed requests after login** |
| Auth posture | httpOnly+secure+strict cookies, 15m/30d tokens, 5/min/IP on login+forgot+reset, hashed reset tokens with TTL — all re-verified at file:line |
| Secrets | No `.env*` tracked; credential-pattern grep over tracked files clean; password policy still exactly mirrored server↔client (4 rules, no blocklist) |
| Uploads | Declared-size 413 + MIME allow-list 415 at sign, **re-checked against the real R2 object at finalize**, server-built keys, 30 MB raw cap + 60/min limiter |
| Headers/deploy | Hand-rolled security headers incl. CSP `default-src 'none'`; nginx `/metrics` deny-all intact; no source maps in dist |
| Jobs | 9 job modules, 9 routed behind `internalAuth`, 9 cron lines present (recurrence-spawn `*/15`, overdue `*/10`, Monday-09:00-Dhaka report, expiry daily). Baseline's "10 modules" was a miscount — nothing is missing |
| Cleanup | The scan's one probe task was permanently deleted through the real 023 approval-flow machinery; dev DB left at exactly its pre-scan 47 tasks |

## 1b) Tests — the first single-session aggregate of the whole suite

All **33 per-module jest configs** + the three root-only lists-read files (per-file, raised
timeout) + the client vitest suite, run sequentially with one retry allowed. Result:

- **Server: 4,287 passed / 4 failed / 0 skipped across 199 test files in 31 directories** (197/199
  suites green; every directory claimed by a config, zero orphans). **Client: 49/49.**
  **Grand total: 4,336 of 4,340 unique tests pass.**
- The Assigned By epicenter is fully green: tasks **413/413 — run twice on two private DBs**
  (jest.tasks + jest.tasks10), forms 85, jobs 54, rbac 346, templates 123, assistant 270.
- 3 modules were FLAKY-PASS (health, tags, taskTypes) — first run died only on the documented
  cold-start `Exceeded timeout` class, 100% green on retry. Zero pool-flake occurrences.
- The 08-18 "~673 green" baseline was a 4-module subtotal; the same four today sum to **719** —
  nothing shrank anywhere.

**The 4 failures are pre-existing test debt, not product bugs — but they are load-bearing debt:**

1. `tests/lists/list-all.test.ts` + `list-by-space.test.ts` — the same 2 asserts each,
   deterministic: they still encode the **pre-F23 contract** ("no hidden page cap", "stray
   `?cursor` ignored"), while F23 (2026-08-08) deliberately added the 100-row default cap and
   cursor validation (`ListController.ts:108-110, 160-162`). These two files are claimed **only by
   the root config**, so no gate has run them since F23 — the stale asserts (and the stale doc
   comments at `ListController.ts:75,125`) went invisible for 17 days. Fix the 4 asserts and give
   the two files a per-module config.
2. `jest.tagscheck.config.js` (throwaway regression runner) turns `forgot-password.test.ts` red
   because its table-reset list omits `password_reset_tokens` — tokens leak across tests. The same
   file is green under its canonical `jest.auth.config.cjs` (341/341). Fix the reset list or
   delete the runner (its sibling is already marked "safe to delete").

Deliberately not run: `assistant-eval.cjs` (needs live stack + paid OpenAI; its jest suite with a
mocked client is green, and nothing in the assistant path changed since its 17/17 live pass on
08-20) and the 15-spec Playwright e2e suite (writes to the dev DB and can trigger **real**
assignment/mention emails to @beautybooth.com.bd staff — replaced this scan by the read-only UI
smoke in §1).

---

## 2) 🔴 Fix first

### N1 — NEW · The deploy prompt on disk will break production if reused for HEAD

`DEPLOY_PROMPT_2026-08-19.md` pins **`c357ccf`** and applies **only 023+024**. HEAD (`b090667`)
compiles `tasks.assigned_by` into every task read (Drizzle full-row `$inferSelect` + serializer),
so running that prompt against HEAD = *code restarts, upgrade 025 never runs, every list/board/
calendar/home read 500s* — precisely the failure class the prompt itself warns about for 024. And
its step-4 canary is still the F1 one that **cannot see this** (`GET /api/v1/tasks` is 404-by-design,
healthy or broken). The file is also untracked, so the box never receives updates to it via git.

**Before the next deploy: write a fresh prompt targeting the chosen SHA, applying 023+024 (verify)
+ 025, with a canary that logs in and reads one list** (`/auth/me` → 401 proves mount; authed
`GET /lists/:id/tasks` proves the schema). The Assigned By plan already schedules exactly this as
P8 — this scan just confirms nothing else does it for you.

### F2 — Chat history still kept forever, in plaintext, with no way to delete (and it's bigger than recorded)

Unchanged since 08-22: no retention job (9 jobs, none chat), no DELETE endpoint (assistant routes =
1 POST + 2 GET), no clear-history UI. Corrected size: **4,393 messages / 2,197 conversations,
5,184 KB allocated, 1,668 KB of raw message text** (the baseline's "848 KB" was stale InnoDB
stats). Zero new rows since 08-20 only because the dev assistant sat idle. The fix remains a
`chat-retention` job on the existing cron pattern + a clear-my-history action.

### F3 — `/eng/home` still leaks Engineering's bug count to everyone (re-proved live today)

`EngineeringRepo.openCountAndTopByType` (`EngineeringRepo.ts:161-185`) still has no
`listScopeFilter`. Live probe today: owner sees `open_bugs.count=2` with 2 previews; Marketing and
Customer Service members see **`count=2` with 0 previews** — same leak, same visible
inconsistency, same one-line fix as 08-22.

### F4 — The RBAC-proving demo accounts still don't exist

Live `users` = owner@company.local + 11 @beautybooth.com.bd. `guest@`, `marketing.only@`,
`cs.only@` (the guest + space-scoped custom-role accounts that DEMO_ACCOUNTS.md documents) are
still missing, and nothing re-creates them (`db:seed:demo` doesn't, the script is manual). Fix
remains one command: `npx tsx scripts/demo-role-accounts.ts`.

---

## 3) 🟠 Built on the server, unreachable in the app — now an exhaustive 35

The client exports **191 API methods; 35 are called by no component** (the baseline's "~20" was
the same state, incompletely enumerated — nothing regressed, nothing got wired up either). All 25
previously-named dead functions stand (comment **edit**, form **submissions**, sprint write set,
status CRUD, notification prefs, watch/unwatch, templates, resetPassword, logoutAll,
spaces.delete/unarchive, lists.unarchive, checklists.bulkAddItems, folders.listBySpace), plus 10
that were always dead but unlisted:

- **`rbacApi.assign / revoke / assignmentsFor / holders / spaceMembers / updateRole`** — the
  entire role-*assignment* half of RBAC has no UI. Roles can be created and edited, but **nobody
  can be granted a role from the client** (the long-standing "no role-assign UI" gap, now
  precisely located).
- `sprintsApi.active` + `getById` — sprint deadness is 8 of 10 methods, not 6.
- `onCallApi.delete` — a rotation week can be assigned but never cleared.
- `usersApi.getById`.

For the 100-person rollout the first two user-facing dead-ends are still comment-edit and
form-submissions-view.

---

## 4) 🟡 Security and correctness, smaller — all standing, none new

| # | Finding | State |
|---|---|---|
| S1 | CORS reflects any private-LAN origin in prod too (`app.ts:88,95`, no env gate) | OPEN |
| S2 | R2 unconfigured in prod = silent upload loss; `/health/ready` checks only the DB | OPEN |
| S3 | Client never sends `If-Match`; task PATCH is last-write-wins (`api.ts:810`) | OPEN |
| S4 | `task.view` scope `own` offered by the roles UI but never narrows reads | OPEN |
| S5 | Hardcoded `dhakaToday()` — 11 sites (7 runtime, 1 seed, 3 comments), latent while the single workspace is Asia/Dhaka | OPEN |
| S6 | The same 2 redundant indexes (comments, tcfv) | OPEN |

New, small, from this scan's deeper client pass:

- **Entry bundle root cause found**: eager `TaskRedirect` (router.tsx:17) statically drags
  `TaskDetailDrawer` → TipTap editor into the entry graph, so `dist/index.html` modulepreloads the
  375 KB editor chunk at startup. Real first-load ≈ **670 KB gzip**, not 444. Lazy-loading that
  one import is the single biggest perf win available.
- `client/src/hooks/useAssignmentRequests.ts:100` — genuine rules-of-hooks violation
  (`useMutation` inside a plain closure); the eslint-disable at :109 suppresses nothing.
- `maplibre-gl` is a dead dependency (zero imports; its vendor chunk never materializes).
- `/forms` overview page is reachable only by typed URL (no menu entry links it).
- `server/email_test.ts` is committed, tsc-excluded, and defaults to sending a REAL reset email
  to a hardcoded gmail — fine as a dev tool, wrong place for it.
- `db:seed:demo` doesn't populate `tasks.assigned_by` (the wire falls back to `created_by`, which
  is identical in demo data — but a reseeded DB tests the fallback, not the column; P7 should
  reseed *then* run the backfill, or the seed should set it).
- drizzle-kit's retired migration chain (`src/db/migrations/`, frozen at 0005) drifted one more
  column from reality — harmless while nobody runs `db:migrate`, which remains the standing rule.
- 4 stale asserts in the lists-read tests + a broken reset list in the `tagscheck` runner — the
  only red in 4,340 tests; details and fixes in §1b.

Dependencies (npm audit, read-only): server **1 critical + 9 high** (unchanged set: `tar`-via-bcrypt
critical — its advisory pile grew by a post-baseline DoS CVE — plus drizzle-orm <0.45.2 and
nodemailer ≤9, both majors); client **8 high, all still one non-breaking `npm audit fix` away**.

---

## 5) 🟡 Process and UX — unchanged

- **No single green-test command, no CI.** Root `npm test` is still the false-failure config;
  truth lives in per-module runs. Every release still rests on memory.
- **`npm run dev` is still nodemon** (serves stale .ts) — the working recipe is `tsx watch`; one-line fix.
- **Desktop-only stands**: exactly 6 responsive rules (Home, Eng home, auth, sidebar 640px,
  assistant, topbar chip); List/Board/Calendar/task drawer/Settings have none.
- Client-side filtering over the full fetched list — fine at 47 tasks, linear from here.

---

## 6) Production — what the outside world says (probed today)

- Site **200**; `/health` **200**, uptime 413,427s ⇒ **no restart since ~2026-08-20 15:00 Dhaka** —
  nothing deployed since the insights release.
- Serves **`assets/index-BTa8KcQk.js`** — byte-identical to a fresh local build of HEAD's client
  (the 4 new commits changed no client-visible code), i.e. prod = `89cafdb`-era bundle =
  `c357ccf`-equivalent. `/api/v1/auth/me` → 401 (API mounted).
- Since that code reads the 023/024 schema on every task read and the site works, **prod's DB is
  at ≥024**. The upgrades README still marks 023/024 "pending prod" — stale bookkeeping worth a
  one-line correction next deploy. **025 is genuinely pending prod** (ships with the next deploy —
  see N1).
- Two small ops observations: `/health/version` isn't proxied by nginx (returns the SPA; and its
  `git_sha` reads "unknown" unless the env stamps it — worthless as a deploy check until fed), and
  Cloudflare **Rocket Loader is active** on the prod HTML (it rewrites the module script tag;
  works today, but it's one more variable during any future "site won't load" debugging — consider
  excluding the app from it).

---

## 7) Suggested order of work

1. **N1** — regenerate the deploy prompt for the next deploy (025-aware, real canary). Five
   minutes now; prevents the one outage this scan can see coming. (= Assigned By P8's first item.)
2. **F4** — restore the demo RBAC accounts (one command), so permission QA can run again.
3. **F3** — the `/eng/home` scope filter (one line + a test).
4. **F2** — chat retention job + clear-history (half a day; the record stops growing the day it ships).
5. Continue the Assigned By plan (P4 UI next) — P0–P3 are verified sound by this scan.
6. Comment-edit UI, then form-submissions UI — the two dead-ends people will actually hit.
7. Client `npm audit fix`; schedule the three server majors behind a green test run.
8. The single-command test gate, then CI; flip `npm run dev` to `tsx watch` while in there —
   and first fix the 4 stale lists-read asserts + the `tagscheck` reset list so the gate is
   born green (§1b).
9. Mobile (List + Board first), and the `TaskRedirect` lazy-load for first-paint.

Everything in §4 remains a small, self-contained edit that can ride along with any of the above.
