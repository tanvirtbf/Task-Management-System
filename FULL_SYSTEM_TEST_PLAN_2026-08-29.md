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
| KI-8 | eslint: server 70, client 12+4 (incl. 2 `set-state-in-effect` in CreateTaskModal, the suppressed hooks pattern in `useAssignmentRequests`) | ✅ **CLOSED P1** | **0 / 0**, nothing frozen — and over a surface 321 files LARGER than the one the baseline was counted on (D1.12). 8 set-state sites converted to render-adjust; the hooks suppression deleted by fixing the violation (D1.6–D1.7) |
| KI-9 | 35/191 client API methods uncalled — incl. the whole rbac-ASSIGN half (no role-assign UI), comment-edit, form-submissions view, sprint writes (8/10), status CRUD, notif prefs, watch/unwatch, templates, onCall.delete | ✅ **CLASSIFIED P1** | regenerated: 67/222. 32 dead → **deleted** (5,844-line mock layer, D1.2); 35 are shipped endpoints with no UI → **GATE**, itemised in the P1 record |
| KI-10 | Deps: server 1 critical + 9 high (tar-via-bcrypt, drizzle-orm, nodemailer majors); client 8 high (one `npm audit fix` away) | ✅ **P1: client 0** | client 11 → **0** (in-range only, re-gated). Server 15 → **9**, all four majors + CVEs → **GATE** |
| KI-11 | `server/email_test.ts` — committed dev tool that sends a REAL email to a hardcoded gmail | ✅ **CLOSED P1** | moved to `server/scripts/email-test.ts`; `MAIL_TEST_TO` required, no address in the repo |
| KI-12 | No automated `schema.sql ↔ Drizzle ↔ upgrades` parity test; drizzle-kit frozen chain drifted; `_post.sql` misses 2 triggers | ✅ **TEST EXISTS P1** | `jest.schema.config.cjs` — parity 6/6 + session-clock 4/4, in the gate (35th module). **P12** still owns the restore drill |
| KI-13 | `db:seed:demo` leaves `tasks.assigned_by` unfilled (wire falls back to created_by) | ✅ **CLOSED P1** | 46/46 tasks + 46/46 assignee rows filled with a real assigner, verified on a throwaway DB (D1.10) |
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
- [x] eslint **0 / 0**, nothing frozen — server now lints `tests/` (312 files), `scripts/`
      and every config, which `.eslintignore` had excluded (D1.12); client lints everything
      but `dist`
- [x] tsc clean ×2 — plus a NEW `npm run typecheck` that covers all 312 test files, which
      `tsc --noEmit` never has (D1.13)
- [x] Parity suite exists and is green (**10/10** with the session-clock suite); in the runner as the 35th module — auto-discovered, no runner edit needed
- [x] Both seeds + demo accounts verified on the scratch DB `tms_p1_seedcheck`; `assigned_by` **46/46 + 46/46**
- [x] Dead-code dispositions written; the 5,844-line mock layer deleted; the 35 wire-later methods itemised to GATE
- [x] Client audit **0**; server 15 → 9 with the four majors + CVEs on the GATE ledger

**Execution record P1** — 2026-08-30, anchor `510a728`.

### What ran

| | before | after |
|---|---|---|
| eslint server | 70 problems — **142** once the 321 files `.eslintignore` hid are counted (D1.12) | **0** |
| eslint client | 16 (12 err + 4 warn) | **0** |
| `tsc --noEmit` server · client | clean | clean |
| Schema module (`jest.schema.config.cjs`) — new | did not exist | **10 / 10** (parity 6, session-clock 4) |
| Client vitest — after the dep bumps and the mock deletion | 49 / 49 | **49 / 49** |
| Production `vite build` (to a scratch `--outDir`; `client/dist` untouched) | — | exit 0, main chunk hash **unchanged** |
| Client `npm audit` | 11 (8 high, 2 mod, 1 low) | **0** |
| Server `npm audit` | 15 (1 crit, 9 high, 4 mod, 1 low) | **9** — every one major-only, ledgered below |
| Seeds on a throwaway DB (`tms_p1_seedcheck`) | — | `db:setup --drop` · `db:seed` · `db:seed:demo` · demo accounts ×2 |
| Server module count in the gate | 34 | **35** (schema added; auto-discovered, no runner edit) |
| eslint SURFACE (files actually linted, server) | 321 hidden by `.eslintignore` | **all of them** — `tests/` 312 + `scripts/` + configs |
| Type-check surface (server) | `src` only | `src` + **all 312 tests**, via new `npm run typecheck` |
| **Full gate** `npm run test:all` | — | **36 modules · 5,405 passed · 0 failed · 0 flaky · 107.9 min · ALL GREEN** |

### Defects found and fixed

**D1.1 — `npm run db:seed` printed one line of driver complaint, seeded nothing, and exited
`0`.** This one was made and caught inside this phase, and it is the most useful thing P1
found, because of *why* nothing else could have caught it.

The floating-promise cleanup turned

```ts
c.query("SET time_zone = ?", [dbTimezone]);            // failure dropped on the floor
```

into `void c.query(…).catch(…)`. That is wrong, and the compiler agreed with it. mysql2's
**promise** pool forwards this event through `lib/promise/inherit_events.js`, which re-emits
the driver's arguments **untouched** — so `c` is the RAW callback connection, whatever the
typings claim. Calling `.catch()` on its `query()` hits mysql2's "that is not a promise"
guard, which throws inside an emitter callback: the pool never finishes connecting and the
process ends without one line of our own logging.

Why 5,405 green tests said nothing: **`.env.test` does not set `DB_TIMEZONE`.** So
`dbTimezone` is `undefined` under jest, the handler is never registered, and every one of the
35 module configs runs a code path dev and production do not — and skips one they always
take. The suite was not wrong; it was blind by construction, and had been since F3.

Fixed with the callback form (which also keeps the reporting the cleanup was for), and the
typings' lie stated once at the boundary instead of being worked around per call. The gap is
now closed permanently by **`tests/schema/session-clock.test.ts`**, which builds a pool the
way *dev* builds one and asks the server what time zone it is actually in. Two offsets on
purpose: `+00:00` is the canonical value, but on a UTC server it would pass even if the
statement never ran, so `+05:30` — a value nothing here produces by accident — proves the
`SET` really executed. Ratchet-proved: with the bug put back, all 10 schema tests go red.

**D1.2 — 5,844 lines of dead mock layer, and two config entries whose only job was to keep
it quiet.** `client/src/lib/mock-api.ts` (2,496 lines) plus `client/src/mocks/` (27 files) are
the pre-integration data layer. Nothing imported them: the only code references in the entire
repository were `mock-api.ts` importing its own fixtures. Three earlier documents had already
said so and none had acted (`FULL_SYSTEM_TEST_LOG.md` "confirmed ZERO live imports",
`FULL_SYSTEM_SCAN_2026-07-29` L7, `LOCAL_RUN_GUIDE.md` "you can delete that folder whenever
you like"), and `FRONTEND_INTEGRATION_PLAN.md` listed the deletion as its own last step.
Deleted, along with the `globalIgnores` in `eslint.config.js` and the `exclude` in
`tsconfig.app.json` that existed only to hide it — so eslint now lints everything but `dist`.
Proof it was truly unreferenced: after the deletion the production build emits a **byte-identical
main chunk** (`index-z2KEM8lf.js`, 1,232.28 kB / 378.38 kB gz), i.e. it was already being
tree-shaken; tsc, eslint and vitest all stay green.

**D1.3 — every client dependency advisory, closed.** 11 → **0**, all in-range: `axios`
1.16.1→1.20.0, `react-router`/`react-router-dom` 7.15.1→7.18.3, `vite` 7.3.3→7.3.6,
`dompurify`, `nanoid`, `postcss`, `js-yaml`, `form-data`, `brace-expansion`, `esbuild`.
`package.json` did not change — only lock resolutions moved, inside the ranges the project
already declared. Re-proved afterwards: tsc 0, eslint 0, vitest 49/49, production build ok.

**D1.4 — server advisories: the six that could be closed without a major, closed.** 15 → 9
(`body-parser`, `brace-expansion`, `form-data`, `ip-address`, `js-yaml`, `shell-quote`). The
remaining nine are four major upgrades; they are in the GATE ledger below with their CVEs
rather than taken unilaterally, because each one changes a runtime the whole product sits on.

**D1.5 — the earlier `eslint --fix` had silently deleted two directives.** It replaced
`/* eslint-disable no-undef */` at the top of `client/public/sw.js` and
`// eslint-disable-next-line no-console` in `ErrorBoundary.tsx` with lines of whitespace.
Neither shows up as a lint failure today, which is exactly why it would have gone unnoticed:
the service worker's `self`/`clients` globals and the boundary's deliberate `console.error`
both lost the note that says they are intentional. Both restored. (The third removed directive,
the `rules-of-hooks` disable in `useAssignmentRequests.ts`, went on purpose — see D1.6.)

**D1.6 — a `rules-of-hooks` suppression was hiding a real violation.** `useAssignmentRequests.ts`
carried a blanket disable over a local factory named `make` that called hooks. Renaming it
`useAction` makes the same five calls legal under the rule, so the suppression could be
deleted rather than re-justified — the lint rule is now actually protecting that file.

**D1.7 — eight `set-state-in-effect` sites, two patterns, no effects needed.** Six components
synchronised a prop or query result into local state through `useEffect`, which renders once
with the stale value, paints it, then sets state and renders again. Converted to React's
documented render-time adjustment (`CreateTaskModal` ×2, `InlineNameEdit`, `SprintBoardPage`,
`FormBuilderPage`, `ProfileSettings`, `TaskDescription`). Two of them — defaulting a selector
once its data arrives — needed no state-tracking at all, because the condition is self-limiting.
The visible effect is on `ProfileSettings`: a hard reload no longer flashes an empty form
before the name appears.

**D1.8 — 42 `as X` assertions on validated request bodies, deleted rather than moved.**
`matchedData<T>(req, opts): T` is generic; the shape belongs in the type parameter. Six
controllers were casting the result instead. (An automated `--fix` had earlier tried to
"solve" these by removing the casts, which silently dropped every validated body to `any` and
took the error count 61 → 156 — the reason this phase hand-judges rather than autofixes.)

**D1.9 — KI-11: the mail smoke-test carried a hardcoded recipient.** `email_test.ts` moved
out of the repository root to `server/scripts/email-test.ts` and now requires `MAIL_TEST_TO`.
Dev mail is `live.smtp.mailtrap.io` — it really delivers — so a script that ships with an
address in it is a script that eventually mails a real person by accident.

**D1.10 — KI-13: `db:seed:demo` left `tasks.assigned_by` empty.** A reseeded demo database
therefore exercised the *fallback* path of upgrade 025 rather than the column, which is the
one shape the feature must not be tested in. Both the task row and the `task_assignees` row
now carry the assigner. Verified on the throwaway DB: **46/46 tasks and 46/46 assignee rows
populated, every one pointing at a real assigner** (six different people) rather than
defaulting to the creator.

**D1.11 — `db:seed` needed no flag but `db:seed:demo` refuses without one.** Confirmed
working as designed, not a defect: the demo seed truncates all 47 tables and correctly
refuses unless `ALLOW_DEMO_SEED=1`. Recorded here because the refusal reads like a failure
in a deploy log. `scripts/demo-role-accounts.ts` is genuinely idempotent — run twice, same
guest id, exit 0 both times.

**D1.12 — `.eslintignore` was hiding 321 source files, and 72 real violations with them.**
The exit criterion for this phase is "eslint exits 0". It did — but only over the files eslint
was still allowed to see. `server/.eslintignore` excluded, with no recorded reason:

| entry | what it hid |
|---|---|
| `tests/` | **312 files** — the entire test suite |
| `scripts/` | every operator script, including the P0 gate runner itself |
| `*.spec.ts` | anything named that way |
| `jest.statuses.config.cjs` | one config file, singled out; byte-for-byte the shape of its 34 siblings |

Why they were excluded is visible the moment the entries come out: the type-aware parser
cannot resolve a file outside `tsconfig.json`'s `include` and reports one parse error each —
320 of them, which looks like a catastrophe and is a configuration mistake. The fix is an
`overrides` block with `project: null` and `plugin:@typescript-eslint/disable-type-checked`,
the exact pattern this config already used for its root config files. Applied to
`tests/**/*.ts` (plus `jest` globals, and `no-console` off — a test that prints while
diagnosing is doing its job) and to `scripts/*.ts`, with `no-var-requires` off for `.cjs`,
where `require` is the module system rather than a lapse.

`.eslintignore` now holds only generated output — `dist`, `node_modules`,
`src/db/migrations` — and says in the file itself why nothing else belongs there: an ignore
entry does not mean "this file is fine", it means nobody will ever find out.

With the 321 files visible, eslint found **72 real violations across 33 files**: 62
`no-unused-vars`, 5 `dot-notation`, 5 `no-var-requires`. All benign on inspection — names
pulled out of a destructure and never read (`const { perms, roles } = repos()` twelve times in
one file; `const { client, workspaceId, u } = await setup()` nine times in another), unused
imports, and bracket access on a record. None hid a test that had quietly stopped asserting
something, which was the thing worth checking. Disposed at the exact line and column eslint
reported, from its own JSON output rather than by pattern-matching the source:

- **49 removed** from a destructuring pattern or an import list (a statement left with empty
  braces goes entirely),
- **13 renamed** to `_name`. This distinction is the whole point: `const otherOwner = await
  makeUser({…})` is unused as a *value*, but deleting the statement deletes the call, and that
  call writes a row the rest of the test needs. Renaming keeps the side effect and satisfies
  `varsIgnorePattern: "^_"`,
- 5 `dot-notation` by `--fix`, 5 `no-var-requires` by the config above.

**D1.13 — `tsc --noEmit` has never type-checked a single test file, and P1 needed to know
that within the hour.** `tsconfig.json` includes `src/**/*.ts` and explicitly excludes
`tests`. So "tsc clean ×2", which every phase records, says nothing about the 312 files in
`tests/`; their type safety rests entirely on ts-jest's diagnostics, which only speak when a
test is *run* — 35 module configs, about two hours.

This stopped being theoretical immediately. Two attempts at the D1.12 cleanup were wrong,
and the two failed differently in the way that matters:

- One renamed identifiers inside **multi-line imports** — a name on its own line has no brace
  beside it, so a line-local check called it a plain declaration. Result: 10 files importing
  members their modules do not export (`_makeSpace`, `_signAccess`). **eslint reported zero
  problems.** It could not do otherwise: the `tests/` override runs without type information,
  so whether a module exports a name is a question it cannot ask. `npm run typecheck` found
  all ten.
- The next removed the name from `const otherOwner = await makeUser(…)`, because scanning
  backwards for an enclosing `{` always finds one eventually — namely the `describe(() => {`.
  Result: 2 files reading `const  = await …`. eslint did catch these, as parse errors.

So lint alone would have shipped ten broken test files, and the two-hour gate would have been
the thing that discovered it. A type-check found them in ninety seconds, before any jest
process started.

So the capability is now permanent rather than a thing someone remembers to improvise:
`server/tsconfig.tests.json` (committed, with `rootDir` widened to the package root, which the
base config pins to `src`) and **`npm run typecheck`**. Green over `src` + all 312 tests.

### KI-9 — dead-code ledger, regenerated and dispositioned

222 exported client API methods; **67 had no caller**. Regenerated by parsing every
`export const xxxApi = {…}` and searching all of `client/src` for each `object.method` plus
destructured use, so the list is conservative.

| disposition | count | what |
|---|---|---|
| **(b) genuinely dead — DELETED this phase** | 32 | the whole `mockApi` surface (D1.2) |
| **(a) wire-later feature — to GATE** | 35 | see below |
| **(c) test-only helper — move under tests** | 0 | none found |

The 35 that stay are not dead code: each is the client half of a **shipped, tested server
endpoint** that has no UI yet. Deleting them would destroy working code and hide the gap;
they are the honest inventory of what the API can do and the screens cannot.

| area | uncalled | reading |
|---|---|---|
| `rbacApi` | 6/12 — `assign`, `revoke`, `holders`, `assignmentsFor`, `spaceMembers`, `updateRole` | the entire role-**assignment** half. There is still no role-assign UI, the open item carried since the dynamic-RBAC build |
| `sprintsApi` | 8/10 — every write (`create`, `update`, `start`, `close`, `addTasks`, `removeTask`, `active`, `getById`) | the sprint board is read-only in the UI |
| `statusesApi` | 3/5 — `create`, `update`, `delete` | no status-CRUD screen |
| `templatesApi` | 3/7 — `byType`, `getById`, `apply` | templates can be listed but not applied |
| `notificationsApi` | 2/9 — `getPreferences`, `updatePreferences` | no notification-preferences screen |
| `tasksApi` | 2/18 — `watch`, `unwatch` | no watch control on the task drawer |
| `spacesApi` · `listsApi` | 3 — `unarchive` ×2, `spaces.delete` | archive is one-way in the UI |
| `usersApi` · `authApi` | 3 — `getById`, `resetPassword`, `logoutAll` | admin-side actions with no surface |
| the rest | 5 — `comments.update`, `checklists.bulkAddItems`, `forms.submissions`, `folders.listBySpace`, `onCall.delete` | one missing control each |

**Minor hygiene, not fixed:** `client/e2e/f5-edited-marker.pw.ts` rewrites the committed
binary `fixing/evidence/F05/edited-marker.png` on every run, so any e2e run dirties the working
tree. Left alone — the file is genuine evidence and regenerating it is the point.

### To the GATE — server major upgrades (D1.4)

Four majors, nine advisories. None taken in P1: each changes a runtime the entire product
depends on, and the call belongs to the gate, not to a lint phase.

| upgrade | clears | why it is a real decision |
|---|---|---|
| **`bcrypt` 5.1.1 → 6.0.0** | the **critical** and 2 high — `tar` GHSA-23hp-3jrh-7fpw (decompression DoS) plus the node-tar path-traversal chain, and `@mapbox/node-pre-gyp` | `tar` is a *build-time* dependency of bcrypt's native install, not a request-path one, which lowers the real exposure — but this is the only upgrade that clears the critical, and bcrypt 6 drops old Node targets. **Recommended first.** Password hashes are unaffected by the major. |
| **`drizzle-orm` 0.44.x → 0.45.2** | 1 high — GHSA-gpj5-g38j-94v9, SQL injection via improperly escaped SQL identifiers | the ORM every query in the system goes through. Needs the full 35-module gate behind it, and this project passes user input to identifiers in very few places — worth checking which before or after. |
| **`nodemailer` 8.0.11 → 9.0.6** | 1 high — GHSA-p6gq-j5cr-w38f, the message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess` | this system never uses `raw`, so exposure is close to nil; the major changes the transport typings, which `MailService.ts` now names explicitly. |
| **`drizzle-kit` → 0.31.10** | 4 moderate — `esbuild` GHSA-67mh-4wv8-2f99 and the `@esbuild-kit/*` chain | **dev tooling only** (migration generation). The esbuild advisory is a dev-server issue and does not ship. Lowest urgency of the four. |

### Closing state

- **`npm run test:all` — 36 modules · 5,405 passed · 0 failed · 0 flaky · 107.9 min · ALL GREEN.**
  The 25 modules that had also run BEFORE the lint cleanup came back with byte-identical
  counts, which is the proof that removing 62 unused identifiers removed no test.
- eslint **0 / 0** · `tsc --noEmit` **0 / 0** · `npm run typecheck` (src + 312 tests) **0**.
- Client `npm audit` **0**. Server **9**, all four majors on the GATE ledger with CVEs.
- Dev DB back at baseline: **47 / 6 / 9 / 27 / 15**, Engineering head = tanvir. The phase
  never wrote to it — every seed ran against the throwaway `tms_p1_seedcheck`, now dropped.
- `client/dist` and `server/dist` untouched (§A rule 8); every client fix in this phase is
  source-only until P14 rebuilds them.

**Signed off:** ✅


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
4. **KI-16 CORS:** `app.ts:88,95` reflects any private-LAN origin. Prove the current
   behaviour with a request carrying `Origin: http://192.168.x.x`, then pin production to an
   explicit allowlist and add the regression test. Also check credentialed preflight, and that
   the public form endpoint's own CORS story is deliberate.
5. **KI-17 `If-Match`:** probe only. Two concurrent PATCHes to one task, last-write-wins
   demonstrated and written down with the exact field that silently disappears. Optimistic
   concurrency is a FEATURE → GATE; the probe is what makes the gate decision informed.
6. **KI-18 `task.view` scope `own`:** the roles UI offers it and no read narrows by it. Prove
   it (grant a role with `own`, read a foreign task, expect the task back), then decide with
   the user: enforce it, or remove it from the catalog so the UI stops promising it. Removal
   is a defect fix; enforcement is a feature → GATE.
7. **The 7 endpoints P3 deferred here:** the six `roles` WRITE endpoints
   (`POST /roles`, `PATCH /roles/:id`, `PUT /roles/:id/permissions`, `DELETE /roles/:id`,
   `POST /users/:id/roles`, `DELETE /users/:id/roles/:assignmentId`) plus
   `GET /me/permissions` — the endpoint the whole client gates on.
8. **Session & token hardening:** refresh rotation + reuse detection, logout-all, a
   deactivated user's live session, JWT `exp`/`nbf`/alg-confusion probes, rate-limit behaviour
   under `DISABLE_RATE_LIMIT=0`.

**Exit criteria**
- [ ] Role×endpoint matrix run across all 6 personas × the P2–P6 families — 0 unexpected
      2xx, 0 unexpected 5xx; the 7 endpoints above ticked
- [ ] Anti-enumeration: no `:id` family distinguishes "forbidden" from "absent"
- [ ] XSS/SQLi/oversize/unicode/traversal probe sheet — every one either safe or fixed here
- [ ] KI-14 re-verified closed · KI-16 fixed with a test · KI-17 and KI-18 decided and written
- [ ] `npm run test:all` green; baseline restored

**Execution record P7:** *(empty)*

---

## P8 — Files, storage & platform health (7 endpoints)

*Everything the product does that leaves the database.*

**Endpoints:** health (4 — `/health`, `/health/ready`, `/health/version`, `/metrics`) ·
push (3 — `public-key`, subscribe, unsubscribe).

**Scope & tasks**
1. **KI-19, the honest half:** R2 unconfigured must not lose an upload silently. Trace the
   sign → PUT → finalize path with storage deliberately misconfigured and record exactly what
   the user sees. If the answer is "a success toast and no file", that is a DEFECT and is
   fixed here. `/health/ready` currently checks the DB only — extend it to report storage, or
   write down why it deliberately does not.
2. **Attachment lifecycle depth** (P5 proves the happy path; this proves the edges): MIME
   sniffing vs declared type, size ceilings, zero-byte and 1-byte files, duplicate names,
   unicode/Bangla filenames, path traversal in the key, expired signed URL, finalize without
   upload, upload without finalize (→ the janitor), download authz on a foreign task.
3. **Web push, end to end on SAFE accounts:** VAPID key fetch, subscribe, receive on
   assignment/mention/overdue, unsubscribe, a stale subscription (410 → pruned), and the
   `pushSvc()` withholding rule under `NODE_ENV=test` that keeps VAPID out of jest.
4. **Service worker:** `sw.js` install/activate/update, the shell cache, and the offline
   message — mobile P8 fixed it lying once; prove it still tells the truth.
5. **`/metrics` and `/health/version`:** shape, no auth leak, and `git_sha` — which reports
   `"unknown"` today (KI-26). Feed it here, verify in P14 against the box.

**Exit criteria**
- [ ] 7/7 endpoints ticked; attachments edge sheet complete
- [ ] KI-19 resolved: an upload can no longer fail silently, or the honest failure is proven
- [ ] Push round-trip demonstrated on safe accounts only; SW update path verified
- [ ] `/health/version` reports a real `git_sha`

**Execution record P8:** *(empty)*

---

## P9 — AI assistant, end to end (3 endpoints)

*The one surface that can answer with data the asker is not allowed to see.*

**Endpoints:** `POST /assistant/chat` · `GET /assistant/conversations` ·
`GET /assistant/conversations/:id`.

**Scope & tasks**
1. **The two standing gates, both green, never in parallel** (they share a database):
   `node scripts/assistant-eval.cjs --assert` and `scripts/assistant-role-matrix.cjs`.
   Both need the dev stack up and `DISABLE_RATE_LIMIT=1`.
2. **Permission scoping re-proved at the SQL layer,** not just the answer layer: for each of
   the 12 tools, a persona who must not see a row asks a question whose honest answer would
   contain it. The 08-18 scan found the repo-layer ALS scoping load-bearing — re-prove it,
   because a tool added later would not inherit it automatically.
3. **Anti-enumeration in prose:** the bot must not confirm existence through phrasing
   ("I can't show you *that task*") — deny uniformly.
4. **`create_task`, the only write:** goes through the real `TaskWriteService`, honours the
   dup guard and `@me`, refuses when the asker lacks `task.create` in that list.
5. **Route/KB drift guards:** `route-parity.test.ts` + `kb-coverage.test.ts` green, and the
   KB budget re-measured (P0 raised the ceiling to 48.5k with a paper trail — confirm the
   headroom is still real).
6. **KI-15, chat privacy and retention:** the `6d9334a` fix means a thread carries `ownerId`
   and an owner-less thread is dropped. Re-prove on a shared browser profile. Then measure
   what is still stored: dev holds ~2,197 conversations / 4,393 messages in plaintext with no
   retention job, no DELETE endpoint and no history UI. Tests cover what exists; the retention
   job, the clear-my-history endpoint and the history panel are FEATURES → GATE.
7. **Bangla-script rule:** the bot answers in Roman-script Banglish, never Bangla Unicode —
   the terminal and several surfaces break on it. Assert it.

**Exit criteria**
- [ ] 3/3 endpoints ticked; eval `--assert` PERFECT; role-matrix ALL-PASS
- [ ] Per-tool permission asserts pass for all 12 tools × the 6 personas
- [ ] Chat privacy re-proved cross-user; retention gap quantified and sent to GATE
- [ ] `assistant` module green (270+); KB budget headroom recorded

**Execution record P9:** *(empty)*

---

## P10 — Frontend deep-dive: desktop

*Every screen a person actually opens, in a real browser, against the production bundle.*

**Rule that outranks convenience:** test the **built** bundle, not only the dev server. The
mobile rebuild found two crashes that existed only in production (`entryFor`'s optional chain
and `KpiStrip`) because dev never reproduced them. Build to a scratch `--outDir` and serve
that — `client/dist` stays frozen until P14.

**Scope & tasks**
1. **Every route in `router.tsx`** loads for each of the 6 personas: no blank screen, no
   console error, no unhandled rejection, correct empty state when the persona legitimately
   sees nothing.
2. **KI-23:** desktop `KpiRow` carries the same missing-KPI crash exposure that `KpiStrip` had
   on mobile. Reproduce it (a workspace where one KPI is absent), fix it the same way, add
   the regression test.
3. **The four task views** — List, Board, Calendar, Table — create/edit/move/filter, the
   shared `taskFilters` popover on all three surfaces, drag-and-drop on Board, the Calendar
   "+N more" day panel, and the SpaceTasksBrowser.
4. **Forms that write:** every modal and drawer — create task, assign (all four assign
   surfaces including the new `Me` button and the teammates-first ordering), comments with
   @mention, checklists, custom fields, attachments, delete-requests, report-a-bug.
5. **Error handling from the user's side:** a 403, a 404, a 409, a 422 and a 500 from the API
   each produce a readable message — not a raw axios string (the P-report-bug fix found three
   of those; look for the rest).
6. **State edges:** back/forward, deep links to every `:id` route, refresh mid-drawer, two
   tabs writing the same task, sign-out with a dirty draft, session expiry mid-action.

**Exit criteria**
- [ ] Every route × 6 personas: no crash, no console error, correct empty states
- [ ] KI-23 fixed with a test; Playwright `chromium` green (83+, plus the new specs)
- [ ] The five API error shapes all render human text
- [ ] Run performed against a production build, and that is stated in the record

**Execution record P10:** *(empty)*

---

## P11 — Frontend deep-dive: mobile, PWA & accessibility

*~70% of this workspace works from a phone; the mobile rebuild is complete (P0–P8) and this
is the phase that keeps it true.*

**Scope & tasks**
1. **The A1–A14 net** at `mobile-390` and `mobile-360`, including the `test.fail()` ratchet —
   a ratchet that has quietly gone all-green is a ratchet that needs tightening, so confirm
   each entry still fails for the reason it was written.
2. **The desktop guard** — the specs that prove a mobile fix did not move a desktop control.
   Key-by-key comparison, absent controls skipped (the `/dept` false positive).
3. **Touch reality:** 44px targets, no iOS auto-zoom (16px inputs), no `touch-action:none`
   anywhere (it kills scroll), keyboard-open layouts, the comment composer's position with the
   keyboard up, bottom-sheet drawers, and the fact that **drag-and-drop is deliberately absent
   on touch** — verify the alternative path exists for every DnD-only action.
4. **The public form** — the one screen customers see: numeric keyboard, BD phone validation,
   scroll-to-error, and the honest note where the upload box used to lie.
5. **PWA:** installability, real icons, the SW shell cache, offline message, and the
   first-load budget (P8 landed 470 KB gz / 1.68 s to a usable Home on 4G — re-measure, and
   fail if it has regressed past 500 KB gz).
6. **Accessibility pass:** keyboard-only navigation of the six core screens, focus traps in
   modals, visible focus rings, form labels, and colour contrast on the status/priority chips.

**Exit criteria**
- [ ] `mobile-390` + `mobile-360` + `desktop-guard` green; A1–A14 all meaningful
- [ ] First-load budget re-measured and within bound; PWA install verified on a real device
- [ ] No DnD-only action without a touch alternative
- [ ] Accessibility findings either fixed or written to GATE with the screen named

**Execution record P11:** *(empty)*

---

## P12 — Jobs, the clock & data-integrity drills (9 endpoints)

**Endpoints:** the nine `POST /jobs/*` triggers — `session-cleanup`, `attachment-janitor`,
`r2-purge`, `snooze-wake`, `department-report`, `form-submission-expiry`, `overdue-alert`,
`assignment-request-expiry`, `recurrence-spawn`.

**Scope & tasks**
1. **Each job three ways:** manual trigger (the endpoint, with authz — these must not be
   callable by a member), the cron schedule that production actually installs, and
   idempotence (run it twice; nothing doubles). Overdue-alert must stay once-per-deadline;
   recurrence-spawn must produce a clean dated copy carrying nothing over.
2. **KI-20 — `dhakaToday()` hardcoded at 11 sites.** Latent only while there is one
   workspace. Prove the latency (a second workspace with a different `workspaces.timezone`
   gets the wrong "today"), then either route all 11 through the workspace timezone or write
   the single-workspace assumption down as an enforced invariant with a test that fails the
   moment a second workspace exists.
3. **KI-22 — `v_breached_sla` / `v_current_on_call` latent tz bug.** The F3 clock fix pinned
   sessions to UTC; these two views still carry `NOW()`-shaped assumptions. Reproduce at a
   boundary (23:55 vs 00:05 Dhaka), fix, and add the view-level assertion.
4. **The canonical clock, end to end:** `DB_TIMEZONE=+00:00` is now covered at the pool level
   by P1's `session-clock` suite. Extend outward — a task created at 23:55 Dhaka appears on
   the right day in Home, Calendar, the weekly report and the overdue job.
5. **KI-12's other half — the restore drill.** Take a real backup of the dev database, drop
   it, restore it, and run the full gate against the restored copy. A backup nobody has
   restored is a backup nobody has.
6. **Data integrity:** the 9 triggers and 5 views re-asserted against `schema.sql` (P1's
   parity suite pins the trigger set — extend it to view definitions), FK behaviour on the two
   `ON DELETE RESTRICT` paths (`department_reports.space_id`, `tasks.primary_list_id`), and
   the 022 checklist counters recomputed from truth.

**Exit criteria**
- [ ] 9/9 job endpoints ticked; each job idempotent and authz-correct
- [ ] KI-20 and KI-22 both resolved with tests
- [ ] Backup → restore → full gate green on the restored database
- [ ] Triggers, views and RESTRICT paths asserted

**Execution record P12:** *(empty)*

---

## P13 — Performance, scale & code health

*The system is correct by P12. This asks whether it stays correct at size.*

**Scope & tasks**
1. **KI-24 — client-side filtering over the full fetched task list.** Cost grows linearly with
   the list. Measure at 500, 2,000 and 5,000 tasks (mobile P0 measured a 500-task list at
   22,826 DOM nodes / 7.4 s per 20 scroll frames before virtualisation). Fix or GATE with the
   number attached.
2. **Server-side query cost:** the slowest endpoints under a seeded 5,000-task workspace —
   `GET /lists/:id/tasks`, search, home KPIs, `/eng/home`, reports. `EXPLAIN` the top five;
   any full table scan on a hot path is a defect.
3. **KI-21 — two redundant indexes** (comments, tcfv). Prove they are redundant, drop them in
   an upgrade script, re-run the gate.
4. **N+1 sweep** across the repositories that hydrate actors and assignees.
5. **Bundle:** re-measure against P11's budget; check the eager `TaskRedirect` import that put
   real first load at 670 KB gz in the 08-25 scan.
6. **Code health, now that eslint is at 0/0 (P1):** keep it there, and add the CI question to
   GATE — there is still no pipeline running the P0 gate on push.

**Exit criteria**
- [ ] Scale measurements recorded at 500 / 2,000 / 5,000 tasks
- [ ] No full table scan on a hot path; KI-21 dropped; N+1s named
- [ ] eslint still 0/0; bundle within budget
- [ ] Anything not fixed carries a number, not an adjective

**Execution record P13:** *(empty)*

---

## P14 — Production deploy & ops certification

*The last phase. Nothing here is optional, because everything before it was tested on a
laptop.*

**Scope & tasks**
1. **Unfreeze the artifacts (§A rule 8):** rebuild `client/dist` and `server/dist`, commit
   them, and record the new canary filename. Everything the plan fixed in client source is
   source-only until this happens — KI-1 (the deployed bundle predates the assignee feature
   and the chat-privacy fix) closes exactly here.
2. **KI-2:** push. `6d9334a`, `510a728` and the P1 commit are local-only; `origin/main` is at
   `876e9cf`.
3. **Database:** production sits at upgrade **022**. HEAD needs **023, 024 and 025**, and
   **025 is non-idempotent and backfills** — read it before running it, take a backup first,
   and verify row counts after. Regenerate `DEPLOY_PROMPT` against the real HEAD so it is not
   025-blind the way its predecessor was.
4. **Cron:** the `*/15` recurrence-spawn line and the other job schedules must exist on the
   box. A job that only ever ran because someone triggered it by hand is not deployed.
5. **KI-26 ops:** proxy `/health/version` through nginx, feed `git_sha`, decide on Cloudflare
   Rocket Loader against the prod HTML, and correct the upgrades README that still calls
   023/024 "pending prod".
6. **KI-27 ops:** the on-call rota lapsed 2026-08-14. The report-bug fix means S0/S1 fall back
   to the Engineering space head by design — but the rota should be re-populated, and the
   production `Bug` task type and `Bug Triage` list must be confirmed to exist, since routing
   depends on them.
7. **Post-deploy verification, on production:** the canary asset is served; a login works;
   one task read (which is what a missing 025 would 500 on); one task create; the assistant
   answers; an email sends; a push arrives; `/health/ready` is 200.
8. **The GATE conversation.** Every deferred item in §D, presented with what it costs and what
   it buys, for the user to decide — the server dependency majors from P1 among them.

**Exit criteria**
- [ ] `origin/main` == local HEAD; dist rebuilt, committed, canary recorded
- [ ] 023 + 024 + 025 applied to production after a verified backup; row counts checked
- [ ] All cron lines present on the box; `/health/version` reachable with a real `git_sha`
- [ ] The 8-point production smoke passes on the live site
- [ ] GATE ledger presented and every item explicitly decided

**Execution record P14:** *(empty)*

---

# APPENDIX A — every endpoint, by phase

**210 endpoints across 36 route modules.** Generated from `src/app.ts`'s mount table and each
router's own declarations, not typed by hand, so this cannot drift from the code.

> **Correction to §B:** the header count of **209** was one short, and had been in every prior
> scan. `GET /health` — the liveness endpoint — is declared inline on the app (`app.ts:127`)
> rather than in `routes/health.ts`, so a router-only inventory loses it. It is the endpoint an
> uptime monitor hits, which makes it a poor one to have never counted. True total: **210**.

**Phase allocation** (each endpoint belongs to exactly one phase; P5 and P6 additionally
re-exercise endpoints owned by P3/P4 from a different angle, which is not double-counted):

| phase | endpoints | routers |
|---|---|---|
| **P2** | 10 | auth |
| **P3** | 67 | users 10 · workspace 2 · teams 6 · spaces 9 · lists 9 · statuses 5 · tags 4 · taskTypes 4 · customFields 7 · templates 6 · **roles read-side 5** |
| **P4** | 29 | tasks 18 · taskDeleteRequests 6 · sla 2 · taskDependencies 3 |
| **P5** | 35 | comments 4 · checklists 9 · attachments 6 · assignmentRequests 7 · notifications 9 |
| **P6** | 43 | home 2 · search 1 · sse 1 · workspaceActivity 2 · reports 5 · engineering 4 · sprints 11 · onCall 4 · forms 13 |
| **P7** | 7 | **roles write-side 6** · me 1 |
| **P8** | 7 | health 4 (incl. the inline `/health`) · push 3 |
| **P9** | 3 | assistant |
| **P12** | 9 | jobs |
| | **210** | |

The full endpoint list — one line each, in mount order — lives in
`server/scripts/endpoints.cjs`, which prints it on demand:

```
node scripts/endpoints.cjs            # grouped by router, with the total
node scripts/endpoints.cjs --phase P3 # just that phase's checklist
```

Printing it rather than pasting it is deliberate: a pasted list is a second description of the
system that can rot, which is the exact failure KI-12 exists to prevent.
