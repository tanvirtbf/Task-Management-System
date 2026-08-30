# FULL SYSTEM TEST PLAN — 2026-08-29

**Goal:** after the last phase is green, the sentence *"ei task management system e kono known
bug, error, issue nei"* can be said honestly — because every API endpoint, every screen, every
table, every job, and every permission path has been exercised, every defect found was fixed and
re-verified, and everything deliberately NOT built is written down as a decision rather than
lurking as a surprise.

**How to drive it:** ONE PHASE PER GO. Say **"P0 dhoren"**, then "P1 dhoren", … "P14 dhoren".
Each phase ends with an **Execution Record** appended to this file (what ran, what broke, what
was fixed, proof). A phase is not done until its exit criteria are all ticked.

This plan was written from a fresh scan at local `6d9334a` / origin `876e9cf` on 2026-08-29.
It carries forward the still-open ledger of `SYSTEM_SCAN_2026-08-25.md` — each item re-verified
today where cheap to do so.

---

## §A · Standing rules (read before every phase)

1. **Test + fix only.** A DEFECT found in a phase is fixed immediately, gets a regression test,
   and is re-verified in the same phase. A MISSING FEATURE is never built mid-phase — it goes to
   the **GATE ledger** (§D) as a decision for the user. (Established working rule.)
2. **Scope discipline.** A phase tests its scope. Something broken outside the scope → note it in
   the phase record, schedule it into its owning phase, move on.
3. **Every phase ends with the dev DB back at baseline:** `tasks 47 · spaces 6 · comments 9 ·
   notifications 27 · users 15`, Engineering head = tanvir. Test rows created during a phase are
   removed in FK order (`notifications → tasks → lists → spaces`), or the phase reseeds
   (`npm run db:seed:demo` — DESTRUCTIVE, then re-run `scripts/demo-role-accounts.ts`).
   *(P0: users moved 13 → 15 — the three demo RBAC accounts KI-7 restores, minus a leaked
   `p43user@qa.local` that the auth spec now purges properly. FK order has two traps worth
   naming: `department_reports.space_id` and `tasks.primary_list_id` are both ON DELETE
   RESTRICT, so a Space that has been reported on, or whose Lists still hold tasks, refuses to
   drop — and `DELETE /tasks/:id` ARCHIVES rather than removes, so an API-based teardown never
   returns the row count to baseline. The e2e helpers in `client/e2e/fixtures.ts` do it in SQL
   for exactly that reason.)*
4. **REAL EMAIL DANGER:** dev `MAIL_HOST=live.smtp.mailtrap.io` **actually delivers**. Any test
   that triggers assignment/mention/overdue email must only ever target `*@company.local` /
   `*@qa.local` accounts — **never** `@beautybooth.com.bd` staff.
5. **Jest truth is per-module.** The root config is a known false-failure generator. Never judge
   by it; use `jest.<module>.config.cjs` (33 of them) or the P0 runner. Never run two jest
   modules that share a private DB concurrently; never run assistant eval + role-matrix in
   parallel; pipe exit codes (`; echo exit=$?`) — "failed to run" is otherwise invisible.
6. **Playwright:** dev server on :5173, API on :5501 with `DISABLE_RATE_LIMIT=1` for e2e. SSE
   means **never `waitUntil:"networkidle"`**. After editing any spec file, run `--list` and count
   tests — a deleted test is invisible to a green run. Revert `client/mobile-baseline.json`
   measurement churn after mobile runs unless a re-baseline was intended.
7. **Server lifecycle on Windows:** `pkill` does NOT reliably kill the API. Use PowerShell
   `Get-NetTCPConnection -LocalPort 5501` → `Stop-Process`. After any server-code change,
   verify the NEW process is serving before trusting a test result.
8. **Artifacts freeze until P14.** No `npm run build` into `client/dist`/`server/dist` during
   P0–P13 (prod pulls those from git; mid-plan rebuilds churn the deploy canary). If a build is
   needed for a test, build to a scratch dir or restore with
   `git checkout -- client/dist && git clean -fdx client/dist`.
9. **MySQL eyeballing:** `SET time_zone='+00:00'` first, or timestamps look ~6h off (that is
   session-display, not corruption). `DB_TIMEZONE=+00:00` is the canonical clock.
10. **Record everything.** Each phase's Execution Record lists: date, commands, pass/fail counts,
    defects found (numbered `D<phase>.<n>`), fixes + their commits, and the re-verify proof.

**Amendments added by P0 (2026-08-30) — each one cost something to learn:**

11. **⚠️ Rule 4 has an exception that looks like a trap.** The three demo RBAC accounts —
    `guest@`, `marketing.only@`, `cs.only@` — live on **`@beautybooth.com.bd`**, the very domain
    rule 4 forbids. They are synthetic (created by `scripts/demo-role-accounts.ts`, documented in
    `DEMO_ACCOUNTS.md`), so **signing IN as them is safe**; making one the RECIPIENT of an
    assignment / mention / overdue email is not, because live Mailtrap will attempt real delivery
    to a real domain. P7 leans on these accounts heavily — use them as the ACTOR, never the
    target. (Moving them to `@company.local` is a clean fix but changes a documented artefact;
    raised as a decision rather than done.)
12. **Verify UI against a SERVED PRODUCTION BUNDLE before certifying it.** Two crashes in the
    mobile work existed only in a production build and never in the dev server. Serve
    `client/dist` behind a static server that proxies `/api/v1` (`.env.production` bakes in a
    RELATIVE API base, so without the proxy every call 404s), and point the suite at it with
    `E2E_BASE_URL=http://localhost:4180`.
13. **Raw `curl` speaks snake_case.** The client sends camelCase and an interceptor decamelizes;
    a hand-written probe must send `user_ids`, not `userIds`, or it earns a confusing 422 that
    looks like a product bug.
14. **Windows: Node 20+ refuses to spawn a `.cmd`** (`spawnSync("npx", …)` → EINVAL, bare `npx` →
    ENOENT). Call the package's own JS entry with `process.execPath` instead — this is why
    `scripts/test-all.cjs` invokes `node_modules/jest/bin/jest.js` directly.
15. **A script that prints "done" has not necessarily written anything you can see.** Check the
    row, not the log line: `demo-role-accounts.ts` reported success while its accounts appeared
    absent — they existed all along, on a different email domain than assumed.

**Stack recipe (used by most phases):**

```bash
# API (fresh code guaranteed — NOT nodemon):
cd server && NODE_ENV=dev DISABLE_RATE_LIMIT=1 npx tsx watch src/server.ts   # :5501
cd client && npm run dev                                                      # :5173
# login: owner@company.local / Owner@12345  (all seeded users share Owner@12345)
```

---

## §B · Current truth (scan of 2026-08-29)

**Code state:** local HEAD `6d9334a` (assistant chat privacy fix — **UNPUSHED**);
origin/main `876e9cf` (assignee "Me"/ordering feature); **prod DEPLOYED TODAY** — serves
`assets/index-BsaNyQ79.js`, `/health` ok ⇒ prod DB ≥ upgrade 025. Two client fixes are **not in
the deployed artifact** (built at `98e9eb1`): the assignee feature and the privacy fix. P14 ships
them.

**Inventory (what "everything" means, measured):**

| Layer | Count |
|---|---|
| API endpoints | **209** across 35 routers (full list: Appendix A) |
| DB base tables | **47** (+ views), upgrades **001–025** |
| Cron jobs | **9** (sessionCleanup, attachmentJanitor, r2Purge, snoozeWake, departmentReport, formSubmissionExpiry, overdueAlert, assignmentRequestExpiry, recurrenceSpawn) |
| Client routes | **37** path entries (desktop + mobile shell) |
| Client API methods | ~193 exported (35 currently uncalled — KI-9) |
| Server tests | **199 files / 33 jest configs** (baseline 4,336/4,340 green, 08-25) |
| Client tests | 7 vitest files (49/49), **19 Playwright specs** (4 projects) |
| Permission catalog | 56 keys × roles incl. space-scoped custom roles |
| Dev data baseline | 47 tasks · 6 spaces · 9 comments · 27 notifications · 13 users |

**Standing green (do not re-prove from scratch, re-run as gates):** report-bug suite 44/44 ·
assignee picker 4/4 · assistant-privacy 3/3 · smoke 3/3 · desktop-guard · mobile A1–A14 26/26
at 390+360 · tasks 413/413 ×2 DBs · rbac 346 · assistant 270 (mocked) · live eval 17/17 (08-20).

**Lint baselines today:** server eslint **70 errors** (50 autofixable), client **12 errors + 4
warnings**. tsc clean ×2.

---

## §C · KNOWN-ISSUES ledger (KI) — every open item, mapped to its phase

Re-verified ✔ = probed again today, still true.

| # | Item | State | Phase |
|---|---|---|---|
| KI-1 | Deployed artifact lacks the assignee feature + privacy fix (dist built at `98e9eb1`) | ✔ by canary | **P14** |
| KI-2 | `6d9334a` (privacy fix) is local-only, unpushed | ✔ | **P14** (or earlier on request) |
| KI-3 | The only red in 4,340 tests: 4 stale pre-F23 asserts in `tests/lists/list-all` + `list-by-space` (root-config-only files) + `jest.tagscheck` reset list omits `password_reset_tokens` | carried | **P0** |
| KI-4 | 12 desktop Playwright specs assume plain `db:seed` fixtures ("QA Space") — fail against the demo-seeded dev DB | ✔ (seen live 08-29) | **P0** |
| KI-5 | No single green-test command; root `npm test` = false failures; no CI | carried | **P0** (runner) · CI → GATE |
| KI-6 | `npm run dev` = nodemon (serves stale .ts); working recipe is `tsx watch` | carried | **P0** |
| KI-7 | Demo RBAC accounts (`guest@`, `marketing.only@`, `cs.only@`) missing from DB | ✔ 0 rows | **P0** |
| KI-8 | eslint: server 70, client 12+4 (incl. 2 `set-state-in-effect` in CreateTaskModal, the suppressed hooks pattern in `useAssignmentRequests`) | ✔ counted | **P1** |
| KI-9 | 35/191 client API methods uncalled — incl. the whole rbac-ASSIGN half (no role-assign UI), comment-edit, form-submissions view, sprint writes (8/10), status CRUD, notif prefs, watch/unwatch, templates, onCall.delete | carried | **P1** classify → GATE |
| KI-10 | Deps: server 1 critical + 9 high (tar-via-bcrypt, drizzle-orm, nodemailer majors); client 8 high (one `npm audit fix` away) | carried | **P1** |
| KI-11 | `server/email_test.ts` — committed dev tool that sends a REAL email to a hardcoded gmail | ✔ exists | **P1** |
| KI-12 | No automated `schema.sql ↔ Drizzle ↔ upgrades` parity test; drizzle-kit frozen chain drifted; `_post.sql` misses 2 triggers | carried | **P1** test · **P12** drill |
| KI-13 | `db:seed:demo` leaves `tasks.assigned_by` unfilled (wire falls back to created_by) | ✔ (only `task_assignees.assignedBy` set) | **P1** |
| KI-14 | `/eng/home` leaks Engineering's open-bug **count** to every team (`openCountAndTopByType` has no `listScopeFilter`) | ✔ still absent | **P6** fix · P7 re-verify |
| KI-15 | Assistant chat kept forever, plaintext: no retention job, no DELETE, no history UI (dev: 2,197 convs / 4,393 msgs / 1.6 MB text) | ✔ | **P9** tests what exists · retention/UI → GATE |
| KI-16 | CORS reflects any private-LAN origin in prod (`app.ts:88,95`) | carried | **P7** |
| KI-17 | No `If-Match` anywhere — task PATCH is last-write-wins | carried | **P7** probe → GATE |
| KI-18 | `task.view` scope `own` offered by roles UI but never narrows reads | carried | **P7** |
| KI-19 | R2 unconfigured in prod = silent upload loss; `/health/ready` checks DB only | carried | **P8** + P14 ops |
| KI-20 | Hardcoded `dhakaToday()` at 11 sites (latent while single-workspace) | carried | **P12** |
| KI-21 | 2 redundant indexes (comments, tcfv) | carried | **P13** |
| KI-22 | `v_breached_sla` / `v_current_on_call` latent tz bug | carried | **P12** |
| KI-23 | Desktop `KpiRow` has the same missing-KPI crash exposure its mobile sibling had (KpiStrip was fixed in mobile P8) | carried | **P10** |
| KI-24 | Client-side filtering over the full fetched task list — linear cost growth | carried | **P13** measure |
| KI-25 | `client/mobile-baseline.json` records measurement churn on every A-net run | ✔ | **P0** rule |
| KI-26 | Ops: `/health/version` not proxied by nginx + `git_sha` unfed ("unknown"); Cloudflare Rocket Loader active on prod HTML; upgrades README says 023/024 "pending prod" (stale) | carried | **P14** |
| KI-27 | On-call rota lapsed 2026-08-14 (prod routing falls back to Engineering head by design); prod `Bug` type + `Bug Triage` list existence unconfirmed | carried | **P14** ops checks |

---

## §D · GATE ledger — deliberately not built; the user decides at the end

These are FEATURES, not defects. Phases may add to this list but never build from it.

- Assigned By plan P4–P8 (UI column/editing/etc. — its own plan file continues separately)
- Role-ASSIGNMENT UI (grant/revoke a role from the client) — server fully built
- Comment EDIT UI · Form SUBMISSIONS viewer UI (the two dead-ends users hit first)
- Sprint write UI (start/close/add/remove), status CRUD UI, notification-prefs UI,
  watch/unwatch UI, template apply/manage UI, onCall.delete UI
- Assistant: chat retention job + clear-my-history + history panel (endpoints exist)
- CI pipeline around the P0 runner
- Optimistic-concurrency (`If-Match`) on task PATCH
- Server dependency majors (drizzle-orm, nodemailer, bcrypt/tar chain) upgrade window
- `is_private` decorative — BY DESIGN (documented 2026-07-25), not a gap

---

# THE PHASES

Sizing note: phases are one-session sized. API phases (P2–P6) each carry an explicit endpoint
checklist from Appendix A — **every endpoint line gets ticked in the execution record** with the
matrix it passed (happy / validation / authz / edge).

---

## P0 — Harness trust + environment lock

*If the harness lies, every later green is worthless. This phase makes green mean green.*

**Scope & tasks**
1. Fix **KI-3**: repair the 4 stale asserts in `tests/lists/list-all.test.ts` +
   `list-by-space.test.ts` to the post-F23 contract (100-row default cap, cursor validation —
   `ListController.ts:108-110,160-162`), fix the 2 stale doc comments, give both files a
   per-module config (or fold into `jest.lists`); fix or delete the `tagscheck` runner
   (reset list lacks `password_reset_tokens`).
2. Fix **KI-4**: make the 12 desktop Playwright specs seed-agnostic (create their own fixtures
   via API, or resolve targets dynamically as `assignee-picker.pw.ts` does) — the suite must be
   green against the demo-seeded dev DB. Run `--list` before/after; **no test count may shrink**.
3. Build **the runner** (KI-5): `server/scripts/test-all.cjs` — all 33 jest configs sequential,
   exit-code-piped, flaky-retry ×1 (documented cold-start class only), summary table; plus
   client vitest; plus a `--e2e` flag for the Playwright projects. One command, one verdict.
4. Flip `npm run dev` to `tsx watch` (KI-6, one line). Restore demo RBAC accounts (KI-7):
   `npx tsx scripts/demo-role-accounts.ts`, verify the 3 logins.
5. Adopt the mobile-baseline churn rule (KI-25): runs end with
   `git checkout -- client/mobile-baseline.json` unless re-baselining.
6. Record machine baselines in the execution record: DB row baseline, eslint counts, bundle
   hash, test totals.

**Exit criteria**
- [ ] Full server aggregate via the runner: **0 failures** (was 4,336/4,340)
- [ ] Client vitest 49/49 · all 19 Playwright specs pass on the demo-seeded DB
- [ ] Runner exists, documented at the top of this file's §A
- [ ] Demo accounts log in; dev DB restored to baseline

**Execution record P0** — 2026-08-29/30, anchor `6d9334a`.

### What ran

| | result |
|---|---|
| Server modules (34 jest configs, one private DB each) | see the gate line below |
| Client vitest | **49 / 49** |
| Playwright `chromium` (desktop) | **83 / 83** |
| Playwright `desktop-guard` + `mobile-390` + `mobile-360` | **27 / 27** |
| `tsc --noEmit` server · client | clean · clean |
| eslint server · client | **70** · **16** (12 err + 4 warn) — recorded, owned by P13 |

Gate command, built by this phase: **`npm run test:all`**
(`server/scripts/test-all.cjs`; `--only <substr>`, `--server-only`, `--client-only`,
`--no-retry`, `--e2e`). Every module config is included — the duplicate runners
(`tagscheck`, `tagsreview`) and the deliberate second pass over tasks (`tasks10`) too,
because a config left out of the gate is a config that can rot. Exit code 1 on any red.

### Defects found and fixed

**D0.1 — the three Lists READ suites were in no gate at all.** `jest.lists.config.cjs`
claims only the WRITE suites, so `list-all` / `list-by-space` / `get-by-id` were claimed by
nothing but the root config, which nobody runs on purpose. Nothing had executed them since
F23 (17 days), and four asserts sat red in there the whole time, still encoding the PRE-F23
pagination contract ("no hidden page cap", "a stray ?cursor is ignored") that F23 replaced
with a 100-row default and cursor validation. The two doc comments at `ListController.ts:75,125`
told the same outdated story. Rewritten to the real contract — the cap test now follows the
cursor through all 250 rows and asserts every one arrives exactly once, which is the half a
client actually depends on — plus `jest.listsread.config.cjs` (private DB + truncate-per-test,
which the write config deliberately omits). **156/156.** Orphan test files: now **zero**.

**D0.2 — `jest.tagscheck` ran the auth suite through a tags-shaped reset.** Its table list
omitted `password_reset_tokens` and `invitations`, so tokens leaked between tests and
forgot-password went red — while the same file was 341/341 under its own config. A false red
that made the aggregate look broken when the product was fine. **490/490.**

**D0.3 — the assistant did not know a page the app had shipped.** `route-parity.test.ts` is a
structural guard: it reads the client router and fails when a page exists that the bot cannot
link to. The mobile rebuild added `/spaces`, and nobody taught the knowledge base — 0 mentions.
Worse than a missing link: the KB's standing advice for reaching a List was "open it from the
**Sidebar** Space tree", and a phone has no Sidebar, so the instruction was unfollowable for
the ~70% of this workspace that works from one. Taught in all three places the guard checks
(the route map, the KB, and the eval script's `REAL_ROUTES` allowlist).

**D0.4 — teaching it broke the system-message budget.** 47,970 of 48,000 was the headroom:
thirty characters. The addition was written at 452 and compressed to 172 before the ceiling
was touched at all; what remains to trim is not fat (the sidebar paragraph's duplicate links
are pinned by two other tests). So the ceiling moved 48k → 48.5k **with its reason written
into the test**, as every previous raise in that file has been. Measured after: 48,142.
**assistant 270/270.**

**D0.5 — twenty-one desktop e2e tests were failing on an environment, not a product (KI-4).**
Five specs pointed their raw SQL at `taskmanagement_qa` — a database the dev API never writes —
so their "the row reached the database" assertions were reading a different database from the
one under test and could only ever pass by coincidence. Several more hardcoded a Space id, a
List id, two task ids and a set of `P4xX` names from that hand-seeded database; against the
demo seed not one of those rows exists. Fixed by making each spec provision what it needs
through the API (`client/e2e/fixtures.ts`) or resolve it at runtime, so the suite is green
against ANY seed:

| spec | was | now |
|---|---|---|
| `tasks-views` | 0/10 | **10/10** — own Space/List/tasks, Bug typed |
| `f31-deferred` | 12/16 | **16/16** — same fixture; Beta placed *In Progress* so the drag has a target |
| `sidebar-structure` | 0/9 | **9/9** — resolves the first Space with two Lists |
| `settings-eng` | 4/6 | **6/6** — Bug Triage id resolved, own bug row |
| `auth` | 5/6 | **6/6** — its purge was aiming at the wrong database |
| `assistant` | 5/7 | **7/7** — see D0.6 |
| `forms-search-inbox` | 5/6 | **6/6** — searches a list this workspace has |
| `dept-review` | 2/3 | **3/3** — head resolved from the roster |

**D0.6 — two assistant tests could never have passed.** They waited on
`waitForLoadState("networkidle")` after a reload, and the inbox SSE stream never goes idle:
guaranteed 45-second timeouts, 90 seconds a run, on a rule §A already documents. The
assertions that follow already wait on real elements. 45.1s → 4.5s.

**D0.7 — the suite dirtied the database it tested.** One full run left 40 tasks, 7 Spaces and
22 notifications behind, because `DELETE /tasks/:id` ARCHIVES rather than removes — so an
archived fixture vanishes from the list read, the next run creates another beside it, and the
List and Space it belongs to are then held down by `ON DELETE RESTRICT`. Six specs were
affected (`smoke`, `team-access`, `settings-eng`, `dept-review`, `full`, and the new fixture
helper). Teardown now goes at the tables in FK order, and covers the rows nothing else
reaches — a department report fans `report_ready` out to four people, a public form
submission notifies the owning team, and neither points at a task.
**Proven: the suite now runs 83/83 and leaves the DB at exactly 47/6/9/27/15.**

**D0.8 — a silent catch hid all of D0.7 for a full run.** The first teardown swallowed its
own errors, so `execFileSync is not defined` (a missing import) reported nothing while every
test went green and every fixture survived. The catch logs now.

### Also done in this phase

- **KI-6** `npm run dev` → `tsx watch` (nodemon served stale `.ts`, which is how a fix that
  did not work usually turns out to be a server that never reloaded).
- **KI-7** demo RBAC accounts restored (`NODE_ENV=dev npx tsx scripts/demo-role-accounts.ts`);
  `guest@` / `marketing.only@` / `cs.only@` all log in **200**. ⚠️ They are on
  `@beautybooth.com.bd` — see the new §A rule 11: safe as the ACTOR, never as the recipient.
- **KI-25** the mobile-baseline churn revert is built into the runner's `--e2e` path.
- §A gained five amendments (rules 11–15), each paid for by something that went wrong here.
- The duplicate `SYSTEM_TEST_PLAN_2026-08-29.md` (written before this file was noticed) is
  deleted; its operating rules were merged into §A.

### Left for later phases (noted, not silently dropped)

- `client/src/stores/chat.test.ts` covers error handling and `retryLast` only — the assistant
  chat-privacy fix (`ownerId` / `claimFor`) has **no unit coverage**, only e2e. → **P6**
- `SYSTEM_PROMPT` names `(/)`, `(/search)`, `(/inbox)` as fallback destinations; `/spaces`
  should probably join them, but that changes model behaviour and belongs where
  `assistant-eval.cjs` actually re-runs. → **P6**
- eslint 70 (server) / 16 (client) recorded, not touched. → **P13**

**Exit criteria**
- [x] Full server aggregate via the runner: 0 failures
- [x] Client vitest 49/49 · all Playwright specs pass on the demo-seeded DB (83 + 27)
- [x] Runner exists, documented in §A
- [x] Demo accounts log in; dev DB restored to baseline (47/6/9/27/15, Engineering head = tanvir)

**Signed off:** ✅

---

## P1 — Static gates, build integrity, schema parity, seeds

**Scope & tasks**
1. **eslint to zero-or-frozen (KI-8):** `--fix` the 50 autofixables server-side; hand-judge the
   remaining 20 + client 12+4. Real bugs → fix; deliberate patterns → inline-disable with a
   reason. End state: `npx eslint .` exits 0 in both packages, or a frozen documented baseline
   of ≤5 justified lines.
2. **tsc ×2** clean (server, client) — already true, re-prove.
3. **Dead-code ledger (KI-9):** regenerate the 35-uncalled list, classify each: (a) wire-later
   feature → GATE, (b) genuinely dead → delete now (with grep-proof nothing imports it),
   (c) test-only helper → move under tests. No feature building.
4. **Deps (KI-10):** client `npm audit fix` (non-breaking, then full client gate re-run);
   server audit re-count → majors to GATE with CVE notes.
5. **KI-11:** move `email_test.ts` under `server/scripts/` behind an env guard
   (`MAIL_TEST_TO` required, no hardcoded address).
6. **Schema parity test (KI-12):** new jest suite that (a) spins the throwaway DB via
   `db:setup`, (b) introspects `information_schema` vs Drizzle's table/column/index/FK
   definitions, (c) fails on any drift — this permanently closes the schema.sql-vs-Drizzle
   drift class. Also verify `_post.sql` trigger set vs live dev triggers.
7. **Seeds (KI-13):** `db:seed:demo` fills `tasks.assigned_by` per the 025 backfill rule
   (earliest real assigner, else creator); both seeds run clean end-to-end on a throwaway DB;
   demo-account script becomes idempotent-callable from the seed docs.

**Exit criteria**
- [ ] eslint 0/0 (or frozen ≤5 with reasons inline) · tsc clean ×2
- [ ] Parity suite exists and is green; added to the P0 runner
- [ ] Both seeds + demo accounts verified on a scratch DB; `assigned_by` populated
- [ ] Dead-code dispositions written; deletions committed; GATE updated
- [ ] Client audit: 0 high; server ledger updated

**Execution record P1:** *(empty)*

---

## P2 — AUTH & session (10 endpoints + client auth surfaces)

**Endpoints:** `POST /auth/login · forgot-password · reset-password · refresh · logout ·
logout-all · change-password · accept-invitation`, `GET /auth/me · /auth/invitation/:token`,
plus `GET /me/permissions`.

**Matrix per endpoint:** happy · every validator branch (422 shapes with `details[]`) · wrong
credentials/expired/reused token paths · rate limits (with limiter ON in a dedicated pass) ·
response contract vs client types (snake_case wire, camelize interceptor).

**Special cases that must be covered**
- Refresh rotation + theft detection (reuse of a rotated token), `bb_refresh` cookie flags
- 2FA path (pendingTwoFactor → verify), lockout thresholds
- Forgot/reset: token single-use, expiry, the historical deadlock regression, **password policy
  = exactly the 4 visible rules, server+client mirrored** (no hidden blocklist)
- Invitation lifecycle: create (users.invite) → token read → accept → login; expired/reused
- `logout` vs `logout-all` session table effects; interceptor behaviour on 401 (no
  refresh-retry on auth endpoints themselves — H4 regression)
- Shared-machine hygiene: logout scrubs permissions store, chat store, push subscription
- Browser pass: login page, remember-me, wrong-password message (friendly, not axios), reset
  flow e2e on `*@company.local`

**Exit criteria:** every endpoint line ticked with its matrix; `jest.auth` (341) green; browser
flows recorded; defects fixed + regression-tested.

**Execution record P2:** *(empty)*

---

## P3 — Workspace & org structure APIs (67 endpoints)

**Routers:** users (10) · workspace (2) · teams (6) · spaces (9) · lists (9) · statuses (5) ·
tags (4) · taskTypes (4) · customFields (7) · templates (6) · roles (11, read side — write
matrix deferred to P7).

**Per endpoint:** happy · validation · authz (owner/admin/member/guest/custom×2 via the demo
accounts) · cross-workspace isolation (foreign id = 404, never 403-leak) · archive semantics ·
uniqueness collisions · position/reorder invariants · pagination where present.

**Special cases**
- users: invite→deactivate→reactivate→delete-preflight→delete chain; deactivated user's
  sessions/assignments; role PATCH downgrade of the last owner (must refuse)
- teams: directory shape (camelCase — NOT in SKIP_CAMELIZE), head assignment, primary team,
  visibility grants add/remove; `PATCH /users/:id/team`
- spaces: head_user_id flows (dept review + report-bug routing depend on it), archive cascade
  visibility, review-summary/queue authz
- lists: archive→task visibility, `GET /lists/:listId/tasks` pagination contract (post-F23 cap
  + cursor), statuses reorder edge (concurrent order writes)
- customFields: type matrix (each field type set/cleared on a task), list-scoped vs workspace
- templates: apply idempotence, apply-into-authz

**Exit criteria:** 67/67 ticked; module suites green (spaces 250, membership, taskTypes, tags,
customfields, templates 123, workspace); DB baseline restored.

**Execution record P3:** *(empty)*

---

## P4 — Tasks core APIs (18 + delete-requests 6 + SLA 2 + dependencies 3 = 29 endpoints)

**Routers:** tasks (18) · taskDeleteRequests (6) · sla (2) · taskDependencies (3).

**Per endpoint:** the same 4-way matrix, plus:

- **create:** minimal vs maximal body; every patchable field round-trips; `assigned_by`
  defaults to creator (025); task numbering race (retry loop); business-clock SLA per severity
  (F28 asserts); tz boundary — create at 23:55 vs 00:05 Dhaka
- **read:** serializer completeness (ONE serializer feeds all surfaces — spot-check list vs
  detail vs search parity for the same task); subtasks; activity rows actor-hydrated; reviews
- **patch:** every field incl. clearing (null) paths; **assignees via PATCH must 422 with the
  guidance message** (the ListViewRow regression class); status→done side-effects (dept review
  open); reviewer flows; story points on non-dev type (must refuse)
- **bulk:** delta semantics (`assigneeAdd/Remove`, `tagAdd/Remove`), partial-failure honesty,
  `pending_approval` count on gated targets
- **archive/unarchive/DELETE:** DELETE = archive (bot parity rule); delete-request lifecycle:
  request→approve (Owner/Admin only)→actual removal incl. FK fan-out; reject; cancel; the
  Drizzle `[result]` + camelCase-interceptor traps (023 regression tests)
- **recurrence (024):** config write, `*/15` spawn job (dry-run + real on scratch data),
  clean dated copy — nothing carried over, once-per-deadline guard, `recurring_source_id`
  SET NULL on source delete
- **dependencies:** cycle refusal, cross-list deps, cascade on task delete
- **my-work:** bucket correctness at tz edges; **verify the historical `myTasksByBucket`
  UNSCOPED trap stays fixed** (foreign-workspace rows must never appear)

**Exit criteria:** 29/29 ticked; `jest.tasks` + `jest.tasks10` (413 ×2 DBs), taskdeps, sla
suites green; recurrence spawn proven on scratch rows; baseline restored.

**Execution record P4:** *(empty)*

---

## P5 — Collaboration APIs (35 endpoints)

**Routers:** comments (4) · checklists (9) · attachments (6) · assignmentRequests (7) ·
tasks-membership subset (assignees 2 · watchers 2 · tags 2 · review 1) · notifications (9,
write side — read side re-hit in P6).

**Special cases**
- comments: @mention parse → bell + email + push + inbox deep-link (SAFE accounts only);
  mention-on-edit notifies only NEW mentions; sanitisation of stored HTML/markdown (XSS probe
  here, deep-dive P7)
- checklists: item CRUD, bulk add, toggle counters == recomputed truth (022 counters)
- attachments: sign→upload→finalize→download round-trip; MIME/size refusals; foreign-task 404;
  janitor job on orphaned uploads; R2-unconfigured behaviour surfaced honestly (KI-19 probe)
- assignees: **cross-team approval (Q11)** full lifecycle — direct vs gated, accept/decline/
  query/answer/cancel, expiry job, emails to safe accounts, `pending_approval` honesty;
  inactive assignee 422; the create-time email+push fanout (step 8) minus actor
- watchers: self add/remove, auto-add rules, notification targeting
- notifications: read/unread/snooze (+snooze-wake job), delete, unread-count vs SSE badge,
  preferences PUT respected by every producer

**Exit criteria:** 35/35 ticked; collab/notifications/attachments/checklists/comments suites
green; a full "assign → approve → notify → email" trace documented on safe accounts.

**Execution record P5:** *(empty)*

---

## P6 — Read models & product surfaces APIs (43 endpoints)

**Routers:** home (2) · search (1) · sse (1) · sla read · workspaceActivity (2) · reports (5) ·
engineering (4) · sprints (11) · onCall (4) · forms (13) · dept (spaces review subset).

**Special cases**
- **KI-14 fix lands here:** add the scope filter to `openCountAndTopByType`, prove
  Marketing/CS see 0-count on `/eng/home`, add the regression test, re-verify owner still sees
  truth
- home KPIs + agenda: numbers == SQL truth for 3 different users; timezone "today"
- search: scope enforcement (private/space visibility), operators, unicode/Bangla terms
- SSE `/stream/inbox`: connect, heartbeat, event on new notification, reconnect semantics,
  multi-tab; StrictMode double-connect stays dev-only
- reports: weekly generation (job + manual `POST /generate`), ack flow, HR content == SQL truth
- sprints: full lifecycle via API (UI is read-only — GATE), task add/remove, active/getById
- onCall: schedule write/read, current resolution at week boundaries (tz!), delete week
- forms: builder CRUD, field reorder, public form read+submit (anon path!), encryption
  at rest (005), submission expiry job, spam/abuse limits on the public endpoint, submissions
  list API (feeds the GATE viewer later)

**Exit criteria:** 43/43 ticked; eng/home/search/sse/reports/sprints/oncall/forms suites green;
KI-14 closed with proof; baseline restored.

**Execution record P6:** *(empty)*

---

## P7 — RBAC matrix & security deep-dive (cross-cutting)

**Scope**
1. **The 56-key permission matrix, live:** the role-matrix runner across
   owner/admin/member/guest/marketing.only/cs.only × the endpoint families of P2–P6
   (the 08-22 method: role×endpoint probes, expect exact 2xx/403/404 per policy). Includes
   the roles WRITE endpoints (create/edit/permissions/delete/holders/assign/revoke).
2. **Anti-enumeration:** foreign/unknown ids uniformly 404 (`*.not_found`) across every
   `:id` family — no 403-vs-404 oracle, no count leaks (re-check KI-14 class everywhere:
   any endpoint returning counts derived from rows the caller can't see).
3. **Input abuse:** stored-XSS probes through every free-text field rendered anywhere
   (task name/description, comments, form fields, chat) — verify render-side sanitisation;
   SQLi probes through search/filters/sort params; oversize payloads (413/422 not 500);
   unicode/emoji/Bangla in every name field; path traversal on attachment names.
4. **KI-16 CORS:** env