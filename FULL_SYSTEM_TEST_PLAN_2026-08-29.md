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
| KI-14 | ~~`/eng/home` leaks Engineering's open-bug **count** to every team.~~ **CLOSED by P6** — measured live (the tile said 2 where the viewer could see 1, next to a preview of one), fixed with the same predicate the hydrator already applied, and pinned by five tests incl. an unrestricted-admin control. `staleTicketIds` had the same shape (LIMIT before scope) and was fixed with it | closed | P7 re-verify |
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
| KI-28 | **Opened by P2.** One `/auth/refresh` returned 500 under full-module load, once; not reproduced in 346 concurrent requests, 5 isolated runs or 3 further full runs. Cause discarded by the silenced test logger (now fixable with `TEST_LOG_ERRORS=1`) | open | **P13** load · any phase meeting an unexplained 5xx |
| KI-29 | **Opened by P2.** 30 of 32 test setups still reset with `TRUNCATE` (509 ms per 9 tables vs 1.9 ms for `DELETE`, and it takes an exclusive metadata lock). Plausibly the majority of the gate's 127 min; auth already converted | open | **P13** |
| KI-30 | **Opened by P2.** `client/public/sw.js` is shipped code no lint rule touches — `eslint.config.js` matches only `**/*.{ts,tsx}` | open | **P11** |
| KI-31 | **Opened by P2.** `assistant` is the gate's first module and so pays the cold ts-jest cache inside a test; it went FLAKY-PASS once. `setup-each-auth.ts` shows the fix (warm the app in `beforeAll`) | open | **P9** |
| KI-32 | **Opened by P3.** Custom fields are the only named entity with no uniqueness rule — no unique index and no service check, so one workspace can hold two fields called "Priority". Behaviour is now pinned by a test; whether to constrain it is a decision | open | **GATE** |
| KI-33 | ~~Opened by P4: three notification endpoints no test has ever called.~~ **VOID — the mapper was wrong, not the suite.** All three have their own test files, named after them. It resolved URL constants in one flat namespace shared by every test file; `BASE` is declared in three files, and the last writer won. Fixed in P5, which measures **35/35**. The bug, and the self-check added to catch the next one, are the finding | closed by P5 | — |
| KI-34 | **Opened by P4** (same measurement). Three job endpoints no test has ever called: `POST /jobs/department-report`, `POST /jobs/assignment-request-expiry`, `POST /jobs/recurrence-spawn` — the last one's JOB is covered by `jobs/recurrence-spawn.test.ts`, but its HTTP trigger is not | open | **P12** |
| KI-35 | ~~`GET /search` does not hydrate `delete_request_pending`.~~ **CLOSED by P6**, which took the decision: search hydrates it like every other task surface. Nothing visible changes today (no component renders the badge in results), but P4 showed what a `false` default does once one does, and search is a primary way people reach a task. The serializer-parity test now compares the whole payload with no exceptions | closed | — |
| KI-37 | **Opened by P5.** §19 Notifications answers **403** `notification.not_owner` for another user's id, where every other `:id` endpoint in the system answers 404. It is deliberate and documented (ids are unguessable, so the existence oracle is not usable) and is now pinned in the isolation sweep's `EXPECTED_STATUS` map rather than tolerated. P7 owns the security deep-dive and should confirm the decision or change it — not inherit P5's acceptance of it | open | **P7** |
| KI-38 | **Opened by P6.** `GET /sprints/:id/tasks` used to answer `200 []` for a sprint that does not exist, was deleted, or belongs to another workspace, while `GET /sprints/:id` answered 404 — so a stale sprint board rendered as "no tasks" rather than an error. Fixed here (the route resolves the sprint first); logged because the SHAPE — a list endpoint that never validates its parent — is worth sweeping for elsewhere | fixed, class open | **P7** |
| KI-36 | **Opened by P4** (`sla`, `spaces`, `taskTypes` green only on retry; evidence destroyed by the capture bug, since fixed). **The repaired capture answered it in the P6 gate, and the three do not share a cause.** `taskTypes` was never machine load: `countWorkspaceActivity()` counted the WHOLE table in a module that deliberately runs no per-test reset, so it read `expected 0, received 32` once earlier tests had left rows behind — order-dependent, and the retry passed only because a fresh run provisions a fresh DB. **Fixed** (scoped to the workspace under test), and a sweep found the identical latent helper in three `lists` files, now scoped too. `sla`'s failure was a bare `401 without a token` — no count, so cold-start. `spaces` DOES reset per test, so order cannot explain it. Two thirds still open | 1 of 3 fixed | **P13** |

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

**Added by P2 (auth):**

- **Two-factor authentication.** No server route exists. The client carries dead
  scaffolding for it (`pendingTwoFactor`, `setPendingTwoFactor`, a `requires2fa` arm on
  `LoginResponse`, a `/auth/2fa` exemption in the 401 interceptor) — grep-proven never
  called. Kept as the shape a real implementation would take.
- **Account lockout.** Absent. With the item below, brute-force protection is exactly one
  IP-keyed bucket, and an attacker rotating IPs has none.
- **`authStrictLimiter` sizing (D2.2).** 5/min/IP shared by login + forgot-password +
  reset-password + accept-invitation — one bucket per office NAT. Raise it, key it on
  IP+email, or split the four routes.
- **Refresh-rotation serialisation (D2.8).** Concurrent reuse of one cookie is undetected
  and mints a session per use (measured: 10 → 10 active sessions). Closing the window
  costs signing out users whose tabs race.
- **A short "do not keep me signed in" session (D2.10).** The inert checkbox is removed;
  the capability was never built. Needs a chooseable session TTL, cookie `maxAge`, and a
  decision on the duration.

**Added by P3 (org structure):**

- **Custom-field name uniqueness (D3.3).** Every other named entity — spaces, lists, tags,
  task types, statuses, templates — refuses a duplicate name in its scope. Custom fields do
  not, so two fields can both be called "Priority" and any picker showing them by name is
  ambiguous. Constraining it means a unique index plus a migration for whatever duplicates
  already exist; leaving it means the inconsistency is deliberate. Either way it should be
  a decision, which is why the current behaviour is now pinned by a test.

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
| `tsc --noEmit` server · client | clean · clean — ⚠️ **the client half was vacuous**, see D2.9 (P2): the client's root tsconfig is a solution file, so `tsc --noEmit` without `-b` compiles nothing and exits 0 whatever the code says |
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
      `tsc --noEmit` never has (D1.13). ⚠️ The CLIENT half of "×2" was later found to have
      been a no-op all along (D2.9); the client got its own `npm run typecheck` in P2, and
      both are now in the gate.
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
| `tsc --noEmit` server · client | clean | clean — ⚠️ client half vacuous until D2.9 (P2) replaced it with `npm run typecheck` (`tsc -b --noEmit`) |
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

⚠️ **Corrected in P2.** Restoring them was half right. The intent was worth keeping, but both
directives were INERT — `eslint.config.js` applies rules only to `**/*.{ts,tsx}`, so `sw.js`
matches no config block at all, and the client never enables `no-console`. eslint reported both
as unused disable directives, which the gate's new `--max-warnings 0` then failed on. P2 kept
the explanation as a plain comment and dropped the directive syntax, because a disable comment
that suppresses nothing tells the next reader something untrue.

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

**Exit criteria**
- [x] All **10/10** endpoints ticked with their matrix (table at the top of the record)
- [x] `jest.auth` green — **363 / 363**, up from 341, and in **1.6 min** rather than ~5.5
- [x] Browser flows recorded — Playwright `auth.pw.ts` **6/6**, run twice, one spec
      strengthened so it can no longer pass on a request the browser refused to send
- [x] Defects fixed + regression-tested — 11 fixed, each with a test; 2 open with their
      evidence; 7 decisions to the GATE
- [x] Rate limiters exercised with the limiter **ON**, in a dedicated pass (the plan's
      one explicitly-unmet matrix column)
- [x] Dev DB back at baseline 47/6/9/27/15

**Execution record P2** — 2026-08-31, anchor `41525b6`.

### Endpoints — 10 / 10

| | endpoint | happy | validation | authz / negative | edge |
|---|---|---|---|---|---|
| 1 | `POST /auth/login` | ✔ | ✔ 12 branches | ✔ wrong password · deactivated · invited · cross-workspace email collision | ✔ unicode pw · 200-char pw · `+` alias · 50 parallel · **rate limit (new)** |
| 2 | `POST /auth/forgot-password` | ✔ | ✔ 7 branches | ✔ enumeration-proof — same 202 for unknown / deactivated / invited | ✔ one email in two workspaces · repeat invalidates prior · mailer throws · **rate limit (new)** |
| 3 | `POST /auth/reset-password` | ✔ | ✔ 10 branches | ✔ never-issued · expired · consumed · single-use under a 50-way race | ✔ 8- and 200-char bounds · whitespace preserved · **policy parity (new)** · **rate limit (new)** |
| 4 | `POST /auth/refresh` | ✔ | ✔ | ✔ absent / empty / garbage / wrong-secret / alg-none / expired cookie · revoked-session mass-revoke · token_hash corruption | ✔ 1 s either side of expiry · UA preserved · **concurrent rotation (new)** |
| 5 | `POST /auth/logout` | ✔ | ✔ body ignored | ✔ 7 token-failure shapes | ✔ idempotent · hard-deleted session · 50 parallel |
| 6 | `POST /auth/logout-all` | ✔ | ✔ | ✔ the same 7 shapes | ✔ 5 devices · pre-revoked caller · tenant isolation |
| 7 | `GET /auth/me` | ✔ | n/a | ✔ 6 token-failure shapes · deactivated holder · missing user row | ✔ unicode / RTL / max-length names · HEAD · cookie-only auth · **wire ↔ `User` type parity (new)** |
| 8 | `POST /auth/change-password` | ✔ | ✔ 6 branches | ✔ wrong current · unchanged · unauthenticated | ✔ the calling session survives |
| 9 | `GET /auth/invitation/:token` | ✔ | ✔ | ✔ unknown 404 · expired 410 · accepted 409 | ✔ **its own rate-limit bucket (new)** |
| 10 | `POST /auth/accept-invitation` | ✔ | ✔ 3 branches | ✔ unknown / expired / consumed / already-active | ✔ single-use · invited role preserved · **rate limit (new)** |

`GET /me/permissions` is touched here (the camelize-skip test) but is **owned by P7**, which runs
it against all six personas.

### What ran

| | before | after |
|---|---|---|
| `jest.auth` module | 341 tests · ~5.5 min | **363 / 363** · 11 suites · **1.6 min** |
| Client vitest | 49 | **87 / 87** (+24 interceptor, +14 auth store) |
| Playwright `auth.pw.ts` | 6 / 6 | **6 / 6** (run twice; one spec strengthened) |
| `npm run typecheck` server (src + 313 tests) · client (new) | server only | clean · clean |
| eslint server · client, `--max-warnings 0` | 0 · 0 | **0 · 0** |
| Dev DB baseline | 47/6/9/27/15 | **47/6/9/27/15** — the e2e user purged, nothing left behind |

### Defects found and fixed

**D2.1 — the rate limiters had never once executed, in any test, ever.** `/auth/login` has no
account lockout in this system — no failed-attempt counter, no per-account cooling-off — so
`authStrictLimiter` is the only thing between a known email address and an unlimited guessing
loop. It was unreachable by construction:

```ts
const rateLimitOff = process.env.NODE_ENV === "test" || …;
export const authStrictLimiter = rateLimitOff ? noop : rateLimit({ … });
```

Under jest the limiter was not disabled, it was **never constructed** — all seven limiters in
the file were the literal function `noop` for the entire 5,400-test suite. A limiter mounted on
the wrong route, with the wrong ceiling, or keyed on the wrong thing would have looked exactly
like a correct one.

The same shape as P1's D1.1, fixed the same way: the bypass is decided **per request**, so the
middleware is real everywhere and only whether it *runs* varies. Precedence is explicit —
`ENABLE_RATE_LIMIT=1` beats `NODE_ENV=test`, which beats `DISABLE_RATE_LIMIT=1`. Production is
untouched.

Why an opt-in and not "run the tests in dev mode": `MailService` picks a **real SMTP transport**
whenever `NODE_ENV !== "test"`, and `.env.test` does not override `MAIL_HOST` — it inherits
`live.smtp.mailtrap.io`, which delivers. Flipping NODE_ENV to test a rate limiter would have
mailed actual people. §A rule 4, through a door nobody had marked; the new suite asserts
`Config.NODE_ENV === "test"` in its own `beforeAll` so it cannot drift.

`tests/auth/rate-limit.test.ts` — **11 tests, green, the first execution of this code under
test.** Each test claims its own client IP via `X-Forwarded-For`, which keeps the shared
MemoryStore from leaking counters between tests and incidentally proves `trust proxy` is
honoured. Established: five attempts pass and the sixth is `429 auth.rate_limited` with the spec
envelope, `Retry-After` and the `RateLimit-*` headers; **successful** logins count toward the
ceiling; a different IP has its own bucket; `GET /auth/invitation/:token` has a **separate**
bucket, so a new hire accepting an invitation is not blocked by someone else's mistyped
password; and `/auth/refresh` + `/auth/me` are outside the strict bucket, which matters because
one page load touches both.

**D2.2 — the four auth-strict routes share ONE bucket, and one office shares one IP.** Not a
code defect — a sizing decision nobody had written down, now measured. `authStrictLimiter` is a
single instance mounted on login, forgot-password, reset-password and accept-invitation, keyed
purely on IP, so its five per minute is a **total across all four**; and `trust proxy` resolves
to the real client address, which for this workspace is one office NAT. Proven in the suite: one
login + two forgot-passwords + one reset + one login exhausts it, and the sixth request — an
invitation accept, a different person, a different intent — is refused with "Too many login
attempts."

Left as configured and raised as a decision: five per minute per office is defensible against
brute force and awkward on a Monday morning. That is a threshold with an operational cost on one
side and a security cost on the other, so it is the user's call. → **GATE**.

**D2.3 — the two copies of the password policy had no guard, and had already drifted.**
`server/src/validators/passwordPolicy.ts` decides what is accepted; `client/src/lib/passwordPolicy.ts`
decides what the person sees while typing. Two copies of one rule set, kept in step by nothing
but a comment in each asking the next reader to remember.

That arrangement has failed here before. The server used to apply a hidden common-password
blocklist against a *normalised* form of the candidate, so `Dhaka@1234`, `Welcome@123`,
`Admin@123` and `Password1!` were refused — while the client showed a strength bar reading
"Strong" in green and the API said only "One or more fields failed validation". People saw
green, were refused, told nothing, and some could not finish accepting their invitation.

`tests/auth/password-policy-parity.test.ts` (10 tests) now compares the real implementations —
the client module has no runtime imports, so a server test can load it directly. Same bounds,
same four rules in the same order, identical labels and error fragments, and identical verdicts
*and messages* across a 23-value corpus: every rule alone and in combination, both boundaries,
whitespace, accents, emoji (code-point length, so `🙂🙂🙂🙂` is four characters on both sides),
Bangla digits, CJK, and the four passwords the old blocklist refused.

It found a live divergence: over-length produced **"New password must be at most 200 characters"**
from the API and **"Password must be at most 200 characters"** in the browser — one refusal
described two ways, in the one file whose entire purpose is that they never are. Client aligned
to the server.

(Cross-package import needed `rootDir: ".."` in `tsconfig.tests.json`; nothing is emitted from
that config, so widening it costs nothing.)

**D2.4 — the axios layer, which every request in the app passes through, had no test at all.**
`client/src/http/client.test.ts` — **24 tests**. The behaviour most needing a guard is gap-scan
H4: a 401 from `/auth/login` must NOT be refresh-retried. It is four lines of string matching,
and nothing would have noticed a refactor dropping one. If it were dropped, a wrong password
would re-POST the credentials, replace the precise `auth.invalid_credentials` with whatever the
refresh failure said, and — for someone already signed in in that browser — end by purging a
healthy session. Now covered, with: `/auth/refresh` exempt (no recursion), the single-retry
`_retry` guard, one shared in-flight refresh across concurrent 401s, local-only purge when the
refresh itself fails, non-401s untouched, and the `SKIP_CAMELIZE_URLS` rule for
`/me/permissions` — where camelizing `catalog.task_types` to `catalog.taskTypes` would make
every permission lookup miss and hide controls the person actually holds.

**D2.5 — `logout()` performs seven scrubs and none was tested.** On the shared machines this
workspace runs on, sign-out is the entire boundary between one person's data and the next
person's. `client/src/stores/auth.test.ts` — **14 tests**, asserted against the REAL stores with
only the network edges mocked: the server session is revoked (and is *not* when the caller
passes `revoke: false`, because the interceptor's session is already dead); the device's push
subscription is torn down; the react-query cache is emptied; the permission snapshot is dropped;
the assistant thread, its `ownerId` and its conversation id are wiped and the panel closed; UI
state is reset. And separately: the access token is **never** written to localStorage — which
matters most here, because `partialize` keeps only `user`, so a reload re-earns the token from
the httpOnly cookie rather than handing the next person a working credential out of devtools.

**D2.6 — an unhandled 500 anywhere in the suite is undiagnosable by construction.** Found while
chasing D2.7. When a request 500s the client body is deliberately opaque
(`{error:{code:"internal"}}`, real message withheld) and the cause — name, message, stack — goes
to `logger.error`. Under `NODE_ENV=test` **all three winston transports are silent**, so it goes
nowhere. The failing assertion reads "Expected 401, Received 500" and there is, anywhere in the
system, no way to learn why. `TEST_LOG_ERRORS=1` now un-silences the console transport at error
level only. Off by default, so no suite's output changes.

**D2.9 — the client's `tsc --noEmit` is a NO-OP, and has been for the whole plan.** Found while
checking that the two new client test files were type-checked. They were not; nothing in the
client has been. `client/tsconfig.json` is a *solution* file — `"files": []` plus two
`references` — and without `-b` there is nothing to compile. Proven, not inferred: a deliberate
`export const broken: number = "not a number";` in `src/` gave

```
tsc --noEmit      → exit 0     (with the error sitting in the tree)
tsc -b --noEmit   → exit 2     src/zz-typeprobe.ts(1,14): error TS2322 …
```

So **every "client tsc clean" in P0 and P1 was vacuous**, including P1's own exit criterion.
What kept the client honest in practice was `npm run build` (`tsc -b && vite build`), which §A
rule 8 forbids during P0–P13; the scratch-directory build P1 ran was `vite build` alone, which
strips types without checking them. Both records are annotated in place.

Fixed with `npm run typecheck` (`tsc -b --noEmit`) on the client, mirroring the server's — and
then fixed properly, because a script nobody runs is the same failure in a different costume
(P1's own lesson about `.eslintignore`). **`scripts/test-all.cjs` now opens with a static
phase**: eslint and a real type-check for both packages, `--max-warnings 0` on each, run before
a single test and stopping the run on failure — a tree that does not compile makes the test
results meaningless, and 100 minutes is too long to spend learning that afterwards.
`--no-static` skips it; so does `--only`, which means "I am iterating on one module". Two static
checks had already rotted unnoticed — this one, and the 321 files `.eslintignore` hid in P1 —
which is the argument for the phase existing.

`--max-warnings 0` immediately caught two inert `eslint-disable` directives P1 had restored
believing they were protective. They were not: `eslint.config.js` applies rules only to
`**/*.{ts,tsx}`, so `public/sw.js` matches no config block at all, and the client never enables
`no-console`. Their explanations were worth keeping and are now plain comments; the directive
syntax, which suppressed nothing, is gone.

**D2.10 — "Keep me signed in" did nothing, and did nothing in the dangerous direction.** The
plan names *remember-me* in P2's browser scope, which is the only reason anyone looked. The
login page carried a checkbox with that label, **checked by default**, whose value went nowhere:
`authApi.login` posts `{ email, password }` and drops `values.remember`. The server has no
short-session concept either — every sign-in issues the same ~30-day refresh cookie, which
`login.test.ts` has been asserting all along.

What makes it worth fixing rather than noting is which way it was inert: on a shared machine, a
person who **unchecked** "Keep me signed in" had every reason to believe the session would end
with the browser, and instead got the full thirty days. That is the same boundary D2.5 is about,
undone by a checkbox. Removed, with the reasoning left in the file. Varying the session lifetime
is a feature — validator, token TTL, cookie `maxAge`, and a decision about how short "short" is
— so it goes to the gate rather than being built mid-phase. (Precedent: the report-bug fix
removed a fake "Auto: X's team" placeholder for exactly this reason.)

**D2.11 — the login form was stricter than the API it posts to.** The password field carried
`{ min: 8 }` — the composition policy's minimum, applied to *sign-in*. `loginValidator` accepts
1–200 characters, and `login.test.ts` has an explicit test for it: "accepts a single-character
password (login enforces no min)".

A client stricter than its server on a login screen protects nothing and risks one thing: an
account whose password is shorter than eight characters cannot sign in through the UI at all.
The form refuses to send it and says "At least 8 characters", which a person reads as *your
password is wrong* rather than *this form is refusing to submit it*. Not hypothetical —
`SEED_OWNER_PASSWORD` is operator-chosen and nothing length-checks it, so a production owner
account is exactly the kind that could land in this state, and it is the one account you cannot
afford to lose.

Rule removed; `required` stays. Regression guard in the spec that already existed: `auth.pw.ts`
› "wrong password → error surfaced" now signs in with a **five-character** wrong password and
asserts `.ant-alert-error` specifically — that element is rendered only from
`getApiErrorMessage(err)`, so seeing it proves the request reached the server and came back. The
old version used a 21-character password and counted `.ant-form-item-explain-error` as proof of
"an error", so it passed whether the request was sent or refused in the browser. Still 6 tests
in the file (`--list` verified, §A rule 6).

**D2.12 — the per-test reset was 268× more expensive than it needed to be, and that is what made
the module flaky.** Chasing a `beforeEach` hook that blew its 30-second budget — in a run with
nothing else on the machine — led to the reset itself. `setup-each-auth.ts` cleared its nine
tables with `TRUNCATE`. Measured here, 60 iterations each:

| | median | p95 | max |
|---|---|---|---|
| `TRUNCATE` ×9 | **509 ms** | 589 ms | 601 ms |
| `DELETE` ×9 | **1.9 ms** | 4.7 ms | 18.8 ms |

TRUNCATE is DDL: InnoDB drops and recreates each tablespace file and holds an exclusive metadata
lock while it does. Two consequences, and the second failed a run:

- **Cost.** 432 tests × 509 ms ≈ **220 seconds** — over half the module's runtime — spent
  emptying nine tables holding a handful of rows.
- **Fragility.** That lock can queue behind any other session on this shared MySQL server, and
  when it does the hook has no ceiling short of its 30-second budget. Seen twice.

Switched to `DELETE`. Verified rather than assumed: none of the nine tables has an AUTO_INCREMENT
column (ids are application-generated strings), no test holds a transaction across the hook, and
reclaiming disk pages is meaningless at this scale.

Result: the auth module went from 341 tests in ~5.5 minutes to **363 tests in 1.6 minutes**,
with the flake gone. `me.test.ts` alone: 104 s → 17.5 s. `login.test.ts`: 57 s → 6.7 s.

**Scoped deliberately.** 30 of the other 32 setup files still TRUNCATE, some of 25 tables — at
roughly 57 ms per table, the tasks module's 23-table reset costs about 1.3 s per test across 413
tests. Extrapolated across the 5,405-test gate, the reset is plausibly the majority of its
runtime. That is a large and attractive change, and precisely why it is not being made here: a
phase should not quietly alter the isolation semantics of 30 modules it is not testing. → **P13**.

**D2.13 — the login page read "PasswordForgot password?".** Found by looking at the page rather
than at the code, after removing the checkbox. The markup is correct — a flex row with
`justifyContent: "space-between"` and `width: "100%"` — but antd renders a `Form.Item` label as
`<label style="display:inline-flex">`, which shrink-wraps to its content, so `width: 100%`
resolves against the label's own content width and `space-between` gets no room. Measured: label
wrapper 334 px, label 172 px, inner row 158 px.

Fixed with one opt-in CSS rule (`.form-label-row .ant-form-item-label > label { width: 100% }`)
so it cannot reflow any other form. After: label 334 px, inner row 321 px, and the link sits at
the field's right edge. Checked across the codebase — Login is the only form using this pattern.

### Open — recorded, not fixed

**D2.7 — one `/auth/refresh` returned 500 under full-module load, once.** Seen in
`refresh.test.ts` › Concurrency › "10 parallel refreshes with the same cookie" during a complete
`jest.auth` run. Not reproduced since, and the attempt was not casual:

- 3 isolated runs of that one test — green;
- 2 full runs of `refresh.test.ts` alone — 51/51 both;
- a purpose-built probe firing **346 concurrent refreshes** (8 rounds of 12, 4 rounds of 60, a
  final 10) — every one returned 200;
- **3 further complete `jest.auth` runs with `TEST_LOG_ERRORS=1`** — zero `Unhandled error`
  lines in any of them.

It is **not** pool exhaustion: the error handler already maps that family to a 503 with
`Retry-After` (F11), and this was a 500. The cause went only to the silenced logger, so nothing
survives from the single occurrence — which is exactly what D2.6 now prevents. Carried as an
open observation with its evidence rather than closed on a guess. → re-check in **P13** (load)
and in any phase that meets an unexplained 5xx.

*(Two of those three hunt runs did fail — one 30 s timeout on a test's first assertion, one on
the `beforeEach` hook. Both were self-inflicted: heavy lint and type-check work was running on
the same machine. Recorded because it is the honest reading of the evidence, and because D2.12
turned out to be the real reason that hook could stall at all.)*

**D2.8 — concurrent reuse of one refresh cookie is not detected, and mints one session per use.**
Reproducible, measured, now pinned by a test. Sequentially the control works exactly as designed:
replaying a rotated token returns 401 and mass-revokes every session for that user. Concurrently
it does not fire at all — the requests arrive before any has committed its rotation, all read the
session as live, and all succeed. Measured: **one cookie, 10 concurrent uses → 10 active
sessions** (11 rows: the original revoked, ten new). At 60-way parallelism, 240 of 240 returned
200.

Pinned rather than "fixed", because the fix is a real decision and not an obvious one.
Serialising the rotation (`SELECT … FOR UPDATE` inside a transaction) would close the window —
and would also sign people out for the entirely ordinary reason that two of their tabs refreshed
in the same instant, which is the false positive a rotation grace-window exists to avoid. What
was *not* defensible was the state of the record: the suite asserted the sequential case, said
nothing about the concurrent one, and a reader would reasonably assume both were covered. That
is now explicit. → **GATE**.

**D2.14 — `assistant` went green only on retry, and the runner had thrown away the reason.**
The gate reported `FLAKY-PASS assistant 270/270` and nothing else. It could not report more: on
a successful retry the runner replaced the failed attempt's result wholesale, and the retry's
output is green by definition — so the only evidence there was had already been discarded. P0's
own justification for naming flakies ("a flake nobody names is a flake nobody investigates") was
only half-served by naming one without its reason.

`scripts/test-all.cjs` now keeps the first attempt's tail and prints it under the FLAKY-PASS
line.

The flake itself is recorded, not chased: `jest.assistant` passes alone, twice, in 55–58 s, and
`assistant` is the module the gate runs **first** — so it is the one that pays the cold ts-jest
transform cache (every other module reads it warm), immediately after the new static phase has
just had `tsc` and `eslint` saturating the CPU. P2 demonstrated the fix pattern for exactly this
in `setup-each-auth.ts` — import the app in a `beforeAll` so no test's clock pays for it — but
`assistant` is **P9's** module and a phase should not reshape another's setup on a single
observation. → **P9**, with the evidence the runner will now keep.

### To the GATE

- **`authStrictLimiter` sizing (D2.2)** — 5/min/IP shared across four auth routes, one bucket per
  office NAT. Options: raise the ceiling; key on IP+email so one person's failures do not spend
  everyone's quota; or split the four routes into separate instances.
- **Refresh-rotation serialisation (D2.8)** — close the concurrent-reuse window, at the price of
  signing out users whose tabs race.
- **A short "do not keep me signed in" session (D2.10)** — the checkbox is gone because it was
  inert; the capability behind it was never built. Needs a session TTL the login request can
  choose, a matching cookie `maxAge`, and a decision on the duration — session-only (the cookie
  dies with the browser) being the option that actually helps on a shared machine.
- **Two-factor authentication.** The server has no 2FA route of any kind. The client carries
  scaffolding for one — `pendingTwoFactor` in the auth store, `setPendingTwoFactor`, a
  `requires2fa` arm on the `LoginResponse` union, and a `/auth/2fa` exemption in the 401
  interceptor. Grep-proven dead: `setPendingTwoFactor` is never called, `pendingTwoFactor` is
  only ever set to `null`, and no login call site branches on `requires2fa`. Kept rather than
  deleted (six lines, and the shape a real implementation would take) — but it is a feature that
  does not exist, so the plan's "2FA path (pendingTwoFactor → verify)" cannot be tested. The
  interceptor exemption is correct regardless and is now covered.
- **Account lockout.** Also absent. With D2.2 that means brute-force protection is exactly one
  IP-keyed bucket, and an attacker rotating IPs has none.
- **The other 30 `TRUNCATE`-based test resets (D2.12).** Mechanical, measured, and the single
  largest lever on the gate's runtime — but it changes how 30 modules isolate themselves, so it
  wants its own pass with a full gate behind it. → **P13**.
- **Lint coverage for `public/sw.js`.** Shipped code that no rule currently touches. → **P11**,
  with the rest of the PWA work.

### Closing state

- **`npm run test:all` — 36 modules · **5,487 passed · 0 failed** · 127.1 min · ALL GREEN (one FLAKY-PASS: `assistant`, green on retry — D2.14)**
- Static phase (new, runs first): eslint + type-check, both packages, `--max-warnings 0` — 4/4 pass.
- Dev DB at baseline **47 / 6 / 9 / 27 / 15**; the e2e fixture user purged; the throwaway
  work all ran on private test databases.
- `client/dist` and `server/dist` untouched (§A rule 8) — every client fix in this phase is
  source-only until P14 rebuilds them.

**Signed off:** ✅

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

**Exit criteria**
- [x] **67 / 67** endpoints reached — measured against the live route table, not assumed
- [x] All 16 P3 module suites green: **2,963 passed, 0 failed** (spaces 250 · users 308 ·
      statuses 209 · lists 187 + listsread 156 · tags 149 · taskTypes 184 · templates 123 ·
      customfields 103 · workspace 83 · membership 102 · rbac 358 · isolation 57)
- [x] Cross-workspace isolation proved for **every** `:id` endpoint in the phase, and for every
      body field that can carry another workspace's id — in one sweep that cannot fall
      behind the route table
- [x] Defects fixed + regression-tested — 2 fixed, 1 recorded to GATE
- [x] DB baseline restored: 47 / 6 / 9 / 27 / 15 (untouched — private test DBs only)

**Execution record P3** — 2026-08-31, anchor `56deda6`.

### Endpoints — 67 / 67

Reach was measured, not assumed. A script extracts every URL the suite actually constructs —
resolving each file's `const` declarations, its `helpers.ts` exports, and arrow helpers built on
another constant — and matches them against the live route table. Run over the earlier phases as
a control it reports P2 10/10 and P6 43/43, which is what makes its P3 answer worth believing:

**66 of 67 were already exercised somewhere. One was not: `GET /roles/:id/holders`.**

That is a better starting position than the phase assumed, and it moved P3's work from *reach*
to *depth* — the four dimensions the plan asks for per endpoint (validation, authz,
cross-workspace isolation, archive/uniqueness/position invariants), which is where the two
findings below came from.

### What ran

| | before | after |
|---|---|---|
| **`isolation` module** — new, the tenant-isolation sweep | did not exist | **57 / 57** (48 URL probes + 8 body probes + a completeness check) |
| `rbac` | 346 | **358** (+12, `GET /roles/:id/holders`) |
| `customfields` | 102 | **103** (+1) |
| `users` · `spaces` · `lists` · `listsread` · `statuses` · `tags` · `taskTypes` · `templates` · `workspace` · `workspaceActivity` · `membership` · `tagscheck` · `tagsreview` | green | green, unchanged |
| eslint · typecheck, both packages | 0 / 0 | 0 / 0 |
| Dev DB | 47/6/9/27/15 | untouched — every P3 test ran on a private DB |

### Defects found and fixed

**D3.1 — `GET /users/:id/roles` answered 200 for a user in another workspace.** Found by the new
isolation sweep, which is the only thing that asked: `rbac` had no cross-workspace assertions at
all, and the per-module suites each check their own corner.

The query underneath was correctly workspace-scoped, so no foreign data was ever returned — the
response was `200 {data: []}`. The defect is what that says. It is *exactly* the response a real
colleague with no roles produces, so the caller cannot tell "this person holds nothing" from
"this id is not yours"; the roles panel shows the reassuring one either way. Every sibling on
`/users/:id` answers 404, and the POST on this very URL resolves the user first
(`findByIdInWorkspace` → `user.not_found`) before doing anything. The read path simply skipped
that step.

Fixed by giving the read the same guard as the write. `rbac` stays 346/346 on top of it, so
nothing depended on the old shape.

**D3.2 — `GET /roles/:id/holders` had no test of any kind.** Not a happy path, not a guard,
nothing — the single endpoint in P3 that no test ever called. Its neighbours in `roles.ts` are
covered by `roles-api.test.ts`, and the LIST endpoint's `holders` **count** is asserted there,
which is likely how it stayed invisible: the word appears in the suite and looks covered.

It deserves more care than its size suggests. It is what a role-assignment UI calls before
deleting or re-granting a role — the answer to "who will this affect?" — and it reports on the
permission system itself, so a scoping mistake in it discloses who holds power in a workspace.

`tests/rbac/role-holders.test.ts` — **12 tests**, green on the first run (the endpoint was
correct; only unwatched). They pin: a workspace-wide holder with a null space; a space-scoped
grant reporting the space it is limited to; the empty case; several holders on one role; **one
person appearing twice when they hold the role in two spaces** (a caller deduplicating by
user_id would under-report the blast radius); `role.manage` reachable by a custom role and
refused for member/guest/anonymous; 404 for an unknown id, 404 for another workspace's role, and
no foreign holder ever appearing in a legitimate list.

### The tenant-isolation sweep — `tests/isolation/cross-workspace.test.ts`

The one structural addition. Tenant isolation was being checked per module and unevenly —
`lists` had fourteen cross-workspace assertions, `workspace` and `rbac` had **none** — which is
the wrong shape for the property. It is not a per-endpoint feature; it is one question asked of
every endpoint that takes an id, and it takes exactly one endpoint answering differently for a
customer's data to be reachable from another workspace.

So: build two complete workspaces, then walk the whole P3 surface as workspace A's **owner** —
the most powerful principal there is, so a 404 cannot be explained away as "that role could not
have done it anyway" — holding B's ids. **404 every time, 48 endpoints.**

404 specifically, not merely "refused". A 403 would be a smaller leak and still a leak: it
separates "exists, forbidden" from "does not exist", and that difference is enough to enumerate
a neighbour's spaces, lists and users one id at a time.

It is a new gate module rather than a file inside an existing one because it builds two entire
object graphs — users, spaces, lists, statuses, task types, tags, custom fields, templates,
tasks, roles — and so needs a reset that clears everything rather than one module's table list.
Its reset uses `DELETE` (P2's D2.12), and it warms the app in `beforeAll` so no test pays the
cold ts-jest compile.

**It cannot fall behind the code.** The probe table is checked against the live route table — the
same one `npm run endpoints` prints, now exported from `scripts/endpoints.cjs` for the purpose —
so adding a route with an `:id` and no probe fails the suite and names it. Later phases extend
the filter rather than starting again: P4–P6 add their own endpoints to the same sweep.

Writing it also cost four wrong guesses about request shapes, each of which the suite reported
as a 422 rather than a pass — `bucket` is a required query param on `review-queue`, the status
reorder takes a bare array rather than a named field, visibility grants want `target_space_id`,
and the home-team endpoint wants `space_id`. Worth recording only because a probe that 422s
proves nothing while looking like a test.

**And then the same question from the other direction — the one that actually hides bugs.**
Above, the neighbour's id is in the URL. That is the case everyone remembers to guard, because
the resource lookup is the first thing the handler does. The dangerous version is a foreign id in
the **body** of a request about something you legitimately own: my new list pointed at their
space, my space given their user as its head, my template applied into their list. That is the
confused-deputy shape — the handler resolves the thing it was asked about, authorises the caller
for it, and then writes a foreign id into a column without ever asking whether the caller can see
*that*. Nothing about the request looks suspicious.

Eight such probes, across the fields that can carry another workspace's id:
`POST /lists` (`space_id`, `default_task_type_id`) · `PATCH /lists/:id` (move into their space) ·
`PATCH /spaces/:id` (`head_user_id`) · `POST /spaces/:id/members` (`user_id`) ·
`POST /spaces/:id/visibility-grants` (`target_space_id`) · `PATCH /users/:id/team` (`space_id`) ·
`POST /custom-fields` (`scope_id`).

**All eight refused. Not one 2xx.** Three answer 404 and five answer 422, and the split is
informative rather than untidy: a 404 means the service resolved the referenced row inside the
caller's workspace and found nothing; a 422 means the validator rejected the field before the
service ever looked. Both are safe. The codes are pinned so a change of layer becomes visible,
while the property that matters — never a success — is asserted separately and does not depend on
which code arrives.

This is the part of P3 that could most easily have gone the other way, and it did not. Worth
saying plainly: on this surface, the multi-tenant boundary holds in both directions.

### Verified already covered — no new tests needed

The plan named seven special cases. Six were already covered, several more thoroughly than the
plan expected:

- **"role PATCH downgrade of the last owner (must refuse)"** — subsumed by a stricter rule that
  is already tested: the owner's role cannot be changed *at all*
  (`user.cannot_change_owner_role`, by an admin or by themselves). Checking the other two routes
  to an owner-less workspace found both closed and tested as well —
  `user.cannot_deactivate_owner` and `user.cannot_delete_owner`. All three paths are shut.
- **statuses reorder under concurrent writes** — `reorder.test.ts` has an "Idempotency &
  concurrency" block including two parallel reorders of one list.
- **custom-field type matrix** — `set-value.test.ts` covers each of the six types on the happy
  path *and* a per-type validation refusal (BD phone, money currency, dropdown option id, file
  id in-workspace).
- **template apply idempotence and authz** — `apply.test.ts` covers usage_count incrementing
  once per apply, the archived-list 409, and four business refusals that write no task.
- **spaces `head_user_id` flows** — `dept-review/head-assignment.test.ts`.
- **teams directory shape** — the wire is snake_case and `/teams` is deliberately *not* in the
  client's `SKIP_CAMELIZE_URLS`, so the interceptor camelizes it into the client's types. `/roles*`
  and `/members` are in that list on purpose, because their payloads carry identifiers as keys.
- **lists pagination (post-F23 cap + cursor)** — rewritten and proved in P0 (D0.1).

### Recorded, not fixed

**D3.3 — custom fields are the only named entity with no uniqueness rule.** Spaces, lists, tags,
task types, statuses and templates all refuse a duplicate name in the same scope. `custom_fields`
has no unique index (only `uq_cf_options_field_label`, on a dropdown's option labels) and
`CustomFieldsService.create` has no check — so a workspace can hold two fields both called
"Priority", and every picker that shows them by name becomes ambiguous.

That may be intentional: a field is identified by id everywhere that matters. But nothing
recorded the decision and nothing tested either behaviour, so it was equally likely to be an
oversight. Now pinned by a test that states what actually happens; if a unique constraint is ever
added, it fails there and the change becomes conscious rather than a surprise. → **GATE**.

### Closing state

- **`npm run test:all` — 37 modules · **5,557 passed · 0 failed** · 126.2 min · ALL GREEN, no flakies**
- Static phase 4/4; eslint 0/0 and a real type-check on both packages.
- Dev DB at baseline **47 / 6 / 9 / 27 / 15** — P3 never wrote to it.
- `client/dist` and `server/dist` untouched (§A rule 8).

**Signed off:** ✅

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

**Exit criteria**
- [x] **29 / 29** endpoints reached — measured, and the mapper corrected first
- [x] `jest.tasks` + `jest.tasks10` green at **423 each** (413 + 6 misdirected-field
      + 4 serializer-parity); `taskdeps`, `sla`, `membership`, `home` green
- [x] Recurrence spawn covered by `jobs/recurrence-spawn.test.ts`
- [x] Tenant isolation extended to all 23 of P4's `:id` endpoints plus 7 more body
      probes — the sweep now stands at **87** and still cannot fall behind the route table
- [x] Defects fixed + regression-tested — 2 fixed with tests, 1 surface fixed on a
      sibling phase's endpoint and recorded for it
- [x] DB baseline restored: 47 / 6 / 9 / 27 / 15

**Execution record P4** — 2026-08-31, anchor `ff939b4`.

### Endpoints — 29 / 29

The reach mapper P3 built was run first, and it began by correcting itself. It reported
`GET /delete-requests` as never called; the endpoint is in fact exercised four times, through
`` `${QUEUE}?box=pending` `` — and the mapper was not stripping the query string, so a tested
route looked untested. Fixed, and then re-run across every phase as a control:

| | P2 | P3 | **P4** | P5 | P6 | P7 | P8 | P9 | P12 |
|---|---|---|---|---|---|---|---|---|---|
| reached | 10/10 | 67/67 | **29/29** | ~~32/35~~ **35/35** | 43/43 | 7/7 | 7/7 | 3/3 | **6/9** |

So P4 had **no reach gap at all**, and the phase was entirely depth. Two gaps that matter came
out of it, and one of them was a live defect.

> **Corrected by P5.** The P5 column read 32/35 when this record was written, and it was wrong —
> a second mapper bug, of the same family as the query-string one. It is **35/35**; KI-33 is
> void. The P12 column survives re-measurement and KI-34 stands. Left visible rather than
> quietly overwritten, because "the tool that measures reach was wrong twice" is the more
> durable finding.

### What ran

| | before | after |
|---|---|---|
| `tasks` · `tasks10` (the same suite on two private DBs) | 413 | **423** each (+6 misdirected-field, +4 parity) |
| `isolation` — extended to P4 | 57 | **87** (71 URL probes + 15 body probes + completeness) |
| `home` — after the agenda hydration fix | green | green |
| `taskdeps` · `sla` · `membership` · `rbac` | green | green |
| eslint · typecheck, both packages | 0 / 0 | 0 / 0 |
| Dev DB | 47/6/9/27/15 | untouched |

### Defects found and fixed

**D4.1 — `PATCH /tasks/:id` accepted an assignment, answered 200, and silently discarded it.**
This is the plan's named regression class, and it was still live.

Four task fields are managed by their own endpoints and are not accepted here: `assignees`,
`tags`, `parent_task_id`, `primary_list_id`. F23 added a message naming the right door, because
"you sent no fields to update" is a lie when the caller sent a real field that lives elsewhere.
But the check sat **inside** the empty-body branch:

```ts
const fields = Object.keys(b);
if (fields.length === 0) {
    …name the misdirected field…
}
```

So it only ever fired when the misdirected field was the ONLY thing in the body. A patch of
`{ name: "Renamed", assignees: [...] }` has one field this endpoint accepts, so it took the
normal path: renamed the task, dropped the assignees on the floor, and returned **200** with a
task the caller had every reason to believe was assigned.

Measured, not inferred — the test was written expecting a 422 and got a 200.

That is exactly the shape that shipped once: the list-row assignee editor sent this PATCH and
never worked. The client was fixed at the time; the API was not, so the next caller would have
walked into the same silence. The check now runs before the empty-body branch, so a request that
cannot be honoured in full is refused in full. Verified that no client call site currently sends
assignees or tags in a task patch, so nothing depended on the lenient behaviour.

Covered by six new tests: each of the four fields alone → 422 naming its route; two together →
both named, not just the first; and the mixed case → 422 with **the task unchanged in the
database**, which is the assertion that would have caught the original bug.

### Extended — the isolation sweep now covers P4

The sweep P3 introduced grew rather than being duplicated, which is how it was designed:
`PHASES_COVERED` gained `"P4"` and the completeness check follows it, so all 23 of P4's `:id`
endpoints had to be given a probe or the suite would fail naming them.

- **URL direction** — 23 more endpoints, from `GET /tasks/:id` through the whole membership and
  review surface to `POST /delete-requests/:id/approve`. Workspace B now also owns a task
  dependency and a pending delete request so those ids are real. **404 every time.**
- **Body direction** — 7 more probes, and these are the ones worth naming: a task created into
  **their** list; a task in my list carrying **their** `status_id`, then **their**
  `task_type_id`; **their** user added as an assignee to **my** task; **their** tag put on my
  task; a dependency linking my task to theirs; and `POST /tasks/bulk` run over **their** task
  ids. Every one refused.

The bulk probe is the one that would have hurt most: it is the endpoint that mutates many rows
in one call, and the only one where a scoping miss would be a mass edit rather than a single
one.

**D4.3 — the "deletion pending" badge was missing on the Home page.** Found by the parity test
below, which is the only thing that compared surfaces against each other.

`delete_request_pending` is not a column; every surface has to look it up. The serializer
documents `false` as the "honest default" for surfaces that do not — and that reasoning holds
exactly as long as no such surface renders the badge. Two of them did: `TaskRow`, which the Home
page's My Work card uses, renders it from this flag, precisely as `ListViewRow` and `BoardCard`
do in the List and Board views.

So the same task, for the same person, warned "this is queued for permanent deletion" in the
List view and said nothing on Home — which is where most people look first, and the badge exists
to stop someone working on a task that is about to be destroyed.

Fixed in `TaskWriteService.myWork`: one batched, indexed lookup over ids already in hand, exactly
what `TasksService.listByList` has always done. The repo is injected optionally, mirroring the
existing pattern, so a caller that has not wired it degrades to `false` rather than failing to
construct.

The identical gap exists in `HomeService.agenda` (`GET /home/agenda`), which is **P6's**
endpoint. It was fixed here rather than left: the change is the same one line, it was already
under the cursor, and knowingly shipping a half-fixed inconsistency to satisfy a phase boundary
would be the wrong trade. Recorded so P6 verifies it rather than rediscovers it.

`GET /search` still reports `false`. That endpoint is P6's, and whether search results should
carry the badge at all is a decision for the phase that owns it — the parity test now states the
current answer rather than leaving it to be found.

### D4.2 — one serializer, and nothing checked that the surfaces agreed

`toWireTask` is used by seven services, deliberately: the `assigned_by` fallback, the date
formatting and the wire shape live at one boundary instead of in seven places that would each
have to remember them.

But the serializer takes a `TaskHydration` alongside the row, and **each surface builds that
itself**. `assignees`, `watchers`, `tags` and `custom_field_values` are not derived from the
task row — they are four separate lookups, and a surface that skips one returns an empty array.
An empty array reads as "this task has no assignees", not as "I did not look". Two surfaces can
call the same serializer and still disagree, and no single endpoint's tests can see it: each one
asserts its own payload is correct, and they can all be correct about different things.

`tests/tasks/serializer-parity.test.ts` populates one task as fully as the API allows — every
hydrated collection non-empty, a custom field value set through the real endpoint, a pending
delete request — then reads it back through **detail**, **list**, **my-work** and **search**
(the plan names search by name; it is P6's endpoint but the same serializer) and compares key
set and values.

Result: the key sets are identical across all four, and every value matches except the one
named exception — which turned out to be D4.3 rather than a documented default.

Writing it cost one lesson worth keeping: the first run failed on `cf: 0`, and the cause was the
fixture, not the product. The custom-field envelope is the type's own shape (`{text}` for a text
field), not a generic `{value}`, and the seed did not check the response — so the assertion
below it was comparing empty against empty and would have passed for the wrong reason if the
count assertion had not been there. The fixture now asserts its own 200. Same shape as the P3
lesson about probes that 422 while looking like tests.

### Verified already covered — no new tests needed

- **my-work's historical `myTasksByBucket` UNSCOPED trap** — the plan asked for this
  specifically. `my-work.test.ts` has a "Workspace isolation → only counts the caller's own
  workspace tasks" block; the trap is shut and guarded.
- **recurrence (024)** — `jobs/recurrence-spawn.test.ts` covers the spawn job.
- **bulk `pending_approval`** — asserted in `rbac/p8-approval.test.ts` (a gated bulk assign
  reporting 2) and `p9-delivery.test.ts`.
- **delete-request lifecycle** — request → approve (destroys the task and leaves an audit trail
  that outlives it) → reject → withdraw, the atomic claim ("a second decision is refused, not
  re-run"), member-cannot-approve, and cross-workspace isolation.
- **dependencies** — direct 2-cycle refused with `dep.cycle`, self-dependency, not-found and
  isolation.
- **business-clock SLA and the Dhaka boundary** — `create.test.ts` computes against the seeded
  sun–thu 09:00–18:00 Asia/Dhaka calendar; `sla/breached.test.ts` covers the severity filter.

### The gate named which modules flaked, and could not say why

Three modules — `sla`, `spaces`, `taskTypes` — went green only on retry. P3's gate had no
flakies at all, so this was worth opening rather than waving through.

The recorded evidence turned out to be useless:

```
● GET /api/v1/task-types › Side effects › writes no workspace_activity rows
√ renders the spec error envelope with matching request_id on 401 (3 ms)
```

Passing lines, inside a block whose whole purpose is to explain a failure. The capture
filtered line-by-line on `/●|✕|Cannot|ERR|error/i`, and `/error/i` matches every test merely
NAMED "…error envelope…" — of which these suites have many. The twelve-line budget filled
with green tests and pushed out the assertion diff, the only part anyone would act on. The
comment above it read *"keep the tail so a red module explains itself without a re-run"*. It
did not do that, and nothing checked that it did.

Replaced with `failureReport()`: take jest's own contiguous report from the bullet, strip the
colour codes, stop at the seam where jest resumes listing suites. Validated rather than
assumed — a deliberately failing test was planted, named "…Error envelope…" so it would have
tripped the old filter, and the gate was run against it. It now prints the assertion, the
expected/received diff, the offending source line and the file:line. Probe deleted, `health`
back to 14/14 through the gate.

**The flakes themselves did not reproduce.** Each module was run three times standalone:
**9/9 green** — 24/24, 250/250, 184/184 every time. None of the three is code P4 touched.

Two things narrow it. All three failing assertions read *global* state —
`countWorkspaceActivity()` counts the whole table with no workspace filter, `total_estimate: 1`
counts spaces, and the third is a bare 401 — so each depends on the per-test reset having
finished and on nothing arriving afterwards. **The obvious explanation is ruled out, though:**
every `activity.record()` call site is `await`ed inside the request, so the row is committed
before the response returns; there is no fire-and-forget write to land late. And the runner's
own header already documents a cold-start class for `health`, `tags` and **`taskTypes`** — the
first test in a file paying for the ts-jest transform, the first bcrypt hash and the first pool
connect on a busy machine — which fits `sla` (its failure was the file's first test) but not
`taskTypes` here, whose failure was 631 lines in.

So: cause still unknown, tests not known-bad, async-write theory eliminated, and the harness can
now answer the question the next time it happens instead of destroying the evidence. Carried as
**KI-36**.

### The reach mapper now lives in the repo

It did not. P3 wrote it, this phase fixed it, both phases quote its numbers, and the plan tells
every later phase to run it first — but the file itself sat in a scratch directory under
`%TEMP%`, hardcoded to one absolute path. Half of that directory was deleted earlier the same
day to free disk. A method that depends on a tool that a cleanup can erase is not a method.

Promoted to `server/scripts/reach.cjs` with `npm run reach -- P5`, its root derived from
`__dirname` instead of `E:/…`, and the query-string lesson written into its own header so the
next person distrusts it before distrusting the suite. Verified from the repo: **P4 29/29**,
**P5 32/35** — the same numbers this record quotes. *(P5 then found a second bug in it and
re-measured that column at 35/35 — see the corrected table above. Promoting it is what made
that fixable at all.)*

### Closing state

- **`npm run test:all` — 37 modules · 5,607 passed · 0 failed · 120.7 min · ALL GREEN**
- Static phase 4/4; eslint 0/0 and a real type-check on both packages.
- Dev DB at baseline **47 / 6 / 9 / 27 / 15** — P4 never wrote to it. (Five phases have quoted
  that tuple without once saying what it counts, which is long enough: it is
  **tasks / spaces / comments / notifications / users**. `lists` is 18 and is not in it.)
- `client/dist` and `server/dist` untouched (§A rule 8).

*(The first attempt at this gate went red across seven modules and the whole client suite,
with jest reporting "no summary" and vitest unable to load three files. None of it was the
product: the C: drive had reached **0 bytes free**, so nothing could write. Cleared 3.7 GB of
regenerable cache — npm's (3.5 GB) and jest's transform cache (951 MB), both of which rebuild
on demand — and re-ran. Worth recording because a full disk fails in a shape that looks
exactly like a broken test suite.)*

**Signed off:** ✅

---

## P5 — Collaboration APIs (35 endpoints)

**Routers:** comments (4) · checklists (9) · attachments (6) · assignmentRequests (7) ·
notifications (9, write side — read side re-hit in P6). **= 35.**

> The sketch also listed a *tasks-membership subset* (assignees 2 · watchers 2 · tags 2 ·
> review 1) here. Appendix A — which is generated, not typed — puts all seven in **P4**,
> and P4's isolation sweep covered them. The behaviour those bullets care about reaches P5
> through the seven `assignment-requests` endpoints, which ARE P5's. Corrected rather than
> silently dropped, because the prose and the generated allocation disagreeing is the kind
> of thing that gets an endpoint tested twice or not at all.

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

**Exit criteria**
- [x] **35 / 35** endpoints reached — measured, and the mapper corrected first (again).
      KI-33's three "never called" endpoints were a mapper bug; they are tested
- [x] `collab` **77**, `notifications` **108**, `attachments` **108**, `jobs` **69**,
      `isolation` **119** — all green
- [x] The cross-team `assign → approve → notify → email` trace documented, on the
      existing safe-account coverage in `rbac/p8-approval` + `p9-delivery`
- [x] `assignmentRequestExpiry` — the only job in the system with no test — covered, 15
      tests, through its HTTP trigger (so part of KI-34 closes too)
- [x] Tenant isolation extended to all 28 of P5's `:id` endpoints plus 4 more body probes
- [x] Defects fixed + regression-tested; DB baseline restored

**Execution record P5** — 2026-09-02, anchor `0e559df`.

### Endpoints — 35 / 35, after the tool that counts them was wrong again

The mapper ran first, as the method requires, and reported **32/35**: three notification
endpoints "no test has ever called" — `mark-all-read`, `:id/unread`, `:id/snooze`. P4 had
already written that up as **KI-33**.

It was wrong, and the giveaway was sitting in the directory listing:
`tests/notifications/mark-all-read.test.ts`, `read-unread.test.ts`, `snooze.test.ts`. Files
named after the endpoints they were said not to call.

The cause was worse than a missing pattern. Constants were collected into **one flat table
shared by every test file**, so a name declared in more than one place kept only the last
writer's value:

| constant | declared in | value kept |
|---|---|---|
| `BASE` | `notifications/push.test.ts` | `/api/v1/push` |
| `BASE` | `notifications/_helpers.ts` | `/api/v1/notifications` |
| `BASE` | `workspace-activity/_helpers.ts` | **`/api/v1/activity`** ← last writer |
| `PATH` | **forty different files** | whichever was walked last |

The notifications suite builds its URLs as `` `${BASE}/${id}/snooze` ``. That resolved against
workspace-activity's `BASE`, producing an activity URL for a notifications route, which matches
nothing — so a thoroughly tested endpoint was reported as never called. And `PATH`, held in a
single global slot by forty files, was mis-attributing URLs everywhere.

Constants are now resolved **per file**: own declarations first, then relative imports followed
to their source, expanded to a fixpoint with a cycle guard. Call sites go through the same
resolver, which also picks up two forms the old passes missed — a plain const built on another
const (`const PATH = ${BASE}/mark-all-read`, the exact shape that failed) and an inline template
with a leading interpolation.

Re-measured across every phase, the correction moves **only P5**:

| | P2 | P3 | P4 | **P5** | P6 | P7 | P8 | P9 | P12 |
|---|---|---|---|---|---|---|---|---|---|
| before | 10/10 | 67/67 | 29/29 | 32/35 | 43/43 | 7/7 | 7/7 | 3/3 | 6/9 |
| after | 10/10 | 67/67 | 29/29 | **35/35** | 43/43 | 7/7 | 7/7 | 3/3 | 6/9 |

**KI-33 is void.** KI-34 survives re-measurement: `tests/jobs/recurrence-spawn.test.ts` and
`dept-review/report-generation.test.ts` call `runJob(...)` directly and never the HTTP trigger,
so those routes really are unreached.

**The tool now checks itself.** Both of its failures had the same shape — a wrong answer that
looked like a finding — so a run ends by grepping the suite for the distinctive segment of every
endpoint it just called untested, and reporting a hit as **SUSPECT** rather than as a gap. On
P12 it flags two of the three, correctly, and the read confirms the gap is real for the route
even though the job behind it is covered. Had it existed a day earlier, KI-33 would never have
been written.

### The one job in the system with no test

`assignmentRequestExpiry` — every other job had between one and five test files; this had zero.
It is the job that closes a cross-team negotiation nobody answered, and its HTTP trigger was
one of KI-34's three unreached routes, so driving the job through the route covers both.

**15 tests**, `tests/jobs/assignment-request-expiry.test.ts`:

- a lapsed pending request flips to `expired`; one whose `expires_at` is still ahead does not
- the decision is recorded as the **system**: `decided_by` stays NULL, `decided_at` is set
- exactly one `expired` ledger row, `actor_id` NULL
- the **requester** is told, and the person who was asked is not — with the task's NAME in the
  title, because a bell that says "expired" about an id is not readable
- the task is **not** assigned: an unanswered ask leaves it unassigned, which is the honest
  outcome and the one the service header promises
- `accepted` / `declined` / `cancelled` / `expired` rows past their expiry are left alone (a
  table-driven case each) — only `pending` is claimable
- `?dry_run=true` counts and writes nothing: no status change, no ledger row, no notification
- a second run expires 0 and does **not** re-notify — the requester hears once, not once per tick
- the janitor is workspace-blind by design: two workspaces, both expired in one run, each
  requester told about their own only
- 401 without the internal token; JSON + `X-Request-Id`

### The jobs suite's per-test reset was a hand-written list, and it had gone stale

The first run of those tests failed on `uq_tar_one_pending` — a duplicate pending request. The
seed looked wrong; it was not.

`setup-each-jobs.ts` reset "the tables the seven jobs touch", written by hand. The eighth job
writes `task_assignment_requests`, which was not on the list. And because the reset runs with
`FOREIGN_KEY_CHECKS = 0` — deliberately, so delete order does not matter — the
`ON DELETE CASCADE` from `tasks` does **not** fire to cover the omission. Rows survived every
reset, and the second test in the file collided with a request the first had left behind.

A hand-written list of tables is a list that goes stale in silence. The RBAC suite has always
derived its list from `information_schema`; the jobs suite now does the same, with the single
exception **named** rather than assumed (`permissions` — the 56-row catalog the schema install
seeds, whose `role_permissions` FK is RESTRICT). A table created tomorrow is covered tomorrow.
All 54 pre-existing job tests stayed green through the change.

*(`TEST_LOG_ERRORS=1`, which P2 built, is what turned "the job returns `expired: undefined`"
into the duplicate-key message in one run. The controller answers **200** even when a job
throws — so cron reads the body, not the status — which means a failing job looks like a passing
request until you ask the log.)*

### Mention-on-edit: implemented, and never once tested

`CommentsService.update` diffs the old body against the new and gives the mention treatment only
to people the EDIT added. The rule is right, and nothing checked it. It is the half of the
feature a person notices when it breaks in either direction: re-pinging on every typo fix is
spam, and not pinging at all makes editing-to-mention silently useless.

**8 tests** (`tests/comments/mention-on-edit.test.ts`) — an edit that adds a mention notifies,
with the same wire shape the create path produces (entity = the TASK, so the inbox deep-link
opens something that exists); every added mention, not just the first; an edit that KEEPS an
existing mention does not re-notify; an edit that keeps one and adds another notifies only the
added one; removing a mention notifies nobody and does not retract the ping already sent;
self-mention on edit stays silent; `comment_updated` is recorded either way; an unknown
`@handle` is not an error.

### What actually happens to markup in a comment

The plan asks for an XSS probe here (deep-dive P7). The answer is deliberate, and reads like a
hole until you follow the body to where it is rendered:

- the API stores and returns the text **verbatim** — escaping at write time would corrupt a
  comment about `<Button>` or a JSON snippet, permanently and invisibly;
- the UI renders it as **text** — `MentionRenderer` emits React text children, and nothing calls
  `dangerouslySetInnerHTML` on a comment body;
- the one place it becomes HTML is the **mention email**, and that template escapes it.

So the contract has two halves and **7 tests** (`tests/comments/body-injection.test.ts`) pin
both: one hostile string (`<script>`, `<img onerror>`, quotes, backticks, a `${}` sequence)
round-trips byte-for-byte through create, storage, read and edit, and reaches the notification
body unchanged; and `sendMentionEmail` escapes the excerpt, the actor name and the task name,
leaving no tag intact, while the plain-text part is left alone because it is not a markup
context.

*(One assertion had to be corrected: `not.toContain("onerror=")` fails on correctly-escaped
output, because the characters survive inside `&lt;img …&gt;`. What makes it safe is that no
TAG survives, which is what it asserts now.)*

### The notification preferences switch was wired — nothing proved it

`preferences.test.ts` covers the setting: stores, reads back, validates, stays per-user. Nothing
covered the half that matters to the person using it — that turning a type off stops the
notification arriving. A preferences screen whose value nothing reads is a switch connected to
nothing, and it would pass every test in that file.

It IS read: `NotificationsRepo.createMany` drops rows whose recipient disabled that type, so
every producer inherits the suppression from one place. **6 tests**
(`tests/notifications/preferences-respected.test.ts`) drive a REAL producer
(`POST /tasks/:id/assignees`) rather than inserting rows, because inserting rows bypasses the
very filter under test: default delivery as a control; nothing created for someone who turned
the type off; **the assignment itself still happens** — a preference silences the notification,
it does not veto the work; only the person who opted out is silenced within one call; only the
type that was turned off; delivery resumes when it is turned back on; one person's preference
does not silence anybody else.

### The checklist rollup, against recomputed truth

`counters.test.ts` walks a known sequence and checks the counter equals what that sequence
should produce — which catches a broken step, but not a write path nobody put in the sequence.
The rollup is maintained by hand inside every write transaction, which is exactly the shape that
drifts when a new path forgets to recompute.

**3 tests** (`tests/checklists/counter-truth.test.ts`) ask the other question: after a mixed run
of every mutating path, does `checklist_items_total / _done` still equal a **live COUNT** over
the task's items? Asserted at eleven points through one run, again where the DELETED item is a
COMPLETED one (both numbers have to move, not just the total), and again across two tasks so one
task's items never count toward another's. The counter is a cache; this asserts the cache has
not gone stale without encoding what the answer should be.

### The isolation sweep now covers P5 — 87 → 119

`PHASES_COVERED` gained `"P5"`, so the completeness check demanded a probe for all 28 of P5's
`:id` endpoints or it would fail naming them. Workspace B now also owns a notification, an
attachment, a pending assignment request, a comment, a checklist and a checklist item.

- **URL direction, 28 more.** All refused.
- **Body direction, 4 more** — the direction that hides bugs: replying to **their** comment from
  **my** task (it would splice my thread onto theirs, and neither side asked for it); assigning
  **their** user to **my** checklist item, on both the create and the patch path; nesting a new
  item under **their** item. All refused.

Two things had to be got right rather than worked around:

- **`POST /tasks/:id/attachments` is a proxied raw upload**, not JSON — bytes, with the name in
  `X-Filename`. A JSON probe returns 422 from the body parser, which proves nothing about whose
  task it is. `Probe` gained a `headers` field and the probe now sends real bytes.
- **Notifications answer 403, not 404,** to a stranger's id — and that is deliberate and
  documented in `NotificationsService`: a missing row is 404 `notification.not_found`, another
  user's is 403 `notification.not_owner`, per the spec, on the reasoning that notification ids
  are unguessable so the distinction is not a usable enumeration oracle. Rather than loosen the
  assertion to "any 4xx" — which would stop the sweep noticing a real 403 anywhere else — the
  four endpoints are listed in a named `EXPECTED_STATUS` map with the reasoning attached. The
  exception stays a decision somebody made, visible in one place.

### KI-19 probed, and handed to P8 with evidence

The plan gives P8 the fix and asks P5 only to probe. Traced: `R2Service`'s constructor treats
missing `CLOUDFLARE_R2_*` config as a stub — `client = null` — and in production logs
`r2.transport.stub_in_prod` at **error** level, saying uploads "will return fake URLs and store
NOTHING". That log is honest to an operator reading logs. **The API is not honest to the person
uploading**: sign still returns a `https://r2.fake/...` URL, the round-trip still answers
success, and the file is gone. `/health/ready` still checks the DB only. KI-19 stands exactly as
written, now with the mechanism and the log key for P8 to start from.

### Verified already covered — no new tests needed

- **Attachment MIME and size refusals** are thorough: `413 attachment.too_large` above 25 MB,
  **201 at exactly 25 MB**, `415 attachment.mime_not_allowed`, `400 scope_unsupported`, no row
  written and nothing presigned on a policy rejection, `404 task.not_found` winning over 413/415
  for a missing task with a bad payload, and the storage-key extension derived from the MIME
  type rather than the filename.
- **The cross-team approval lifecycle and its email fanout** — `rbac/p8-approval.test.ts` and
  `p9-delivery.test.ts` cover request → accept/decline/query/answer/cancel, `pending_approval`
  honesty, `409 request.user_inactive` for an inactive target, and the delivery layer: mail on
  creation to the target AND their Head but never the requester, a distinct mail kind per
  decision, and the bulk-assign bell + email that used to be silent.
- **snooze-wake** (`jobs/snooze-wake.test.ts`), **attachment janitor**, **r2Purge**,
  **formSubmissionExpiry** — all have job tests; `assignmentRequestExpiry` was the only gap.

### Closing state

- **`npm run test:all` — 37 modules · 5,678 passed · 0 failed · 119.2 min · ALL GREEN, no flakies**
- Static phase 4/4; eslint 0/0 and a real type-check on both packages.
- Dev DB at baseline **47 / 6 / 9 / 27 / 15** (tasks / spaces / comments / notifications /
  users) — P5 never wrote to it.
- `client/dist` and `server/dist` untouched (§A rule 8).
- **No FLAKY-PASS — not one module needed a retry.** Evidence for **KI-36**: the three that
  flaked in P4 (`sla`, `spaces`, `taskTypes`) all passed first time here, on the same tests
  and the same machine, which points at load rather than at the tests. Still open, because
  "it did not happen again" is not a cause; the repaired capture will say why if it does.

**Signed off:** ✅

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

**Exit criteria**
- [x] **43 / 43** endpoints reached — measured; the phase was entirely depth
- [x] `eng` 83 · `home` **33** · `search` **42** · `sse` **15** · `deptreview` 122 ·
      `sprints` 164 · `oncall` 81 · `forms` **92** · `isolation` **145** — all green
- [x] **KI-14 closed with proof** — the leak measured live (count said 2 where the viewer
      could see 1), fixed, and pinned by five tests including an unrestricted-admin control
- [x] **KI-35 decided** — search hydrates the badge; the parity test now compares the whole
      payload with no exceptions left
- [x] Tenant isolation extended to P6: 119 → **145**, with the two routes it cannot ask
      named and asked a different way instead
- [x] Defects fixed + regression-tested; DB baseline restored

**Execution record P6** — 2026-09-03, anchor `4a19b35`.

### Endpoints — 43 / 43

The mapper ran first and came back clean, so — like P4 — the phase was entirely depth. It also
now checks itself, and had nothing to flag.

### KI-14, closed with proof

Opened by the 2026-07-29 scan and carried through three more of them: *"`/eng/home` leaks
Engineering's open-bug count to every team (`openCountAndTopByType` has no `listScopeFilter`)"*.
Still exactly true.

**Measured before touching anything.** A viewer clamped to one team, holding one visible bug and
one invisible one:

| | tile said | viewer could see |
|---|---|---|
| `open_bugs.count` | **2** | 1 |
| `open_incidents.count` | **1** | 0 |

The preview ids beside those counts were fine — they go through
`TasksRepo.findManyByIdsInWorkspace`, which applies the scope filter, and the invisible ones drop
out during hydration. So the endpoint returned **a count of 2 over a list of one**, which is both
the leak and the tell: a tile is a single claim, and this one disagreed with itself on screen.

Fixed by giving the count the same predicate the hydrator already used. Five tests, in
`rbac/p5-leak-closure.test.ts` where the scoped-user fixture lives: the count excludes another
team's bugs; the count equals its own preview length; incidents likewise; **an unrestricted admin
still sees the whole workspace** (the control — a fix that just returned zero would pass the
first three); and the stale-tickets bucket.

**`staleTicketIds` had the same shape and is fixed too.** Not a leak — invisible rows were
dropped downstream — but the `LIMIT` was applied *before* scoping, oldest-first. Another team's
ancient tickets could spend the whole budget and hand the caller an empty bucket while their own
stale work sat there. Same predicate, same fix.

*(Checked rather than assumed: `HomeRepo`'s two workspace-wide KPI series were already scoped —
RBAC P19 did that. `/eng/home` was the one that got missed, which is precisely what KI-14 said.)*

### KI-35 decided: search hydrates the badge

P4 left this to P6, which owns the endpoint. The decision is **yes**, and the reasoning matters
more than the outcome:

No component renders the "deletion pending" badge in the search results list today, so nothing
visible changes. But P4 had already found what happens when a surface defaults `false` and a
component later renders it — My Work said nothing while the List view warned that the same task
was queued for permanent deletion. The serializer calls `false` an "honest default"; it is
honest only until someone reads it. Search is a primary way people reach a task, and the cost is
one batched, indexed lookup over ids already in hand.

So `SearchService` takes `TaskDeleteRequestsRepo` optionally, exactly as `TasksService` and
`TaskWriteService` do, and the parity test's exclusion list is now **empty** — it compares the
whole payload across detail / list / my-work / search with no exceptions left.

*(The assistant builds its own `SearchService` without that repo. Checked, not assumed: the
assistant's tools project their own compact shapes and never emit the flag, so nothing there
defaults to a wrong answer.)*

### A read endpoint that answered 200 for a sprint that does not exist

Found by the isolation sweep. `GET /sprints/:id/tasks` never resolved the sprint — it went
straight to a task query filtered on `sprint_id` **and** `workspace_id`. Tenant-safe, so no data
crossed; but a foreign sprint id, a deleted one and a typo all returned `200 []`, while the
sibling `GET /sprints/:id` returned 404.

"This sprint has no tasks" and "there is no such sprint" are different sentences, and a board
rendering the first for the second is the same quiet lie as P4's patch that reported success for
an assignment it discarded. The route now resolves the sprint first, reusing `getById`'s own 404
rather than inventing a second one. `sprints` stayed green at 164.

### A test that asserted the endpoint answered, not that it was safe

`rbac/p6-switch-matrix.test.ts` carried the comment *"Search cannot surface the other team"* over
this:

```ts
const found = await s.mktMember.client.get(`/api/v1/search?q=${…}`);
expect(found.status).toBe(200);
```

Which is equally true of a search that leaks everything. It also queried an **id prefix**, which
is not what a person types. Now it searches by name and checks both directions — their team's
tasks are absent AND the caller's own two are present — so it cannot pass because search happens
to be returning nothing. It passes; the property was real, nothing was checking it.

### The dueToday tile and the agenda are one claim

`GET /home/kpis`'s `dueToday` and `GET /home/agenda` are the same sentence twice, computed by two
repo methods from two queries, and nothing had ever compared them. **10 tests** that never assert
a number — only that the two AGREE — across the rows that separate the definitions: done,
archived, unassigned, someone else's, due tomorrow, due yesterday, and a realistic mix.

Plus the timezone half the plan asked for. Both read `todayInZone(workspaces.timezone)`, so a
workspace in **Pacific/Kiritimati** (UTC+14, a different calendar day from Dhaka for part of every
day) is where they would part company if one asked the OS instead. They agree. And the one case
where disagreement is CORRECT is pinned too: `?date=` moves the agenda while the tile still means
today, so a future "fix" cannot make the tile follow the query string.

They agreed everywhere. This is a property pinned, not a bug found — which is the honest outcome
and worth the same care.

### Search, in the language people actually type

The suite had **no non-ASCII term anywhere**, in a product whose staff name tasks in Bangla. And
`escapeLike` escapes three characters (`\`, `%`, `_`) while only `%` was ever tested — `_` is
SQL's single-character wildcard, so an unescaped one turns a search for `Q3_report` into a search
for `Q3?report`.

**10 tests.** Bangla by full name, by substring, a different Bangla word not matching, mixed
Bangla+English found from either half, an emoji, ASCII case-insensitivity; then `_`, `%` and `\`
each proven literal against decoys that a wildcard would have matched, and a query of only
wildcards. All correct as built. Test names stay ASCII deliberately, so a jest run remains
readable in a terminal that cannot render Bangla — the data carries the script, not the output.

### Two things the plan asked about the public form, both untested

**Encryption at rest.** Every existing test asks the API, and the API decrypts on the way out, so
a regression that stopped encrypting would have left all of them green — and the reader is
deliberately lenient, returning the stored value unchanged on any failure "so a single bad row
never 500s the whole page". Correct for legacy rows, and exactly why plaintext would go
unnoticed. These forms carry customer names, phone numbers and addresses. **3 tests** read the
raw column: the `{ciphertext, iv, authTag}` envelope is there, none of the three secrets appears
in it, not even the field name `phone`; two identical submissions produce **different** ciphertext
(a per-row IV — without it the store leaks which customers said the same thing); and the admin
read path still returns the plaintext, because encryption nobody can read gets removed by the
next person.

**The abuse limit.** `publicFormLimiter` (30/min/IP) guards the only unauthenticated surface in
the system, where each submission creates a real task and notifies a real team — and it had never
executed in a test, the same shape P2 found across the auth limiters. **4 tests**, opting in with
`ENABLE_RATE_LIMIT=1` and leaving `NODE_ENV` alone (§A rule 4): 30 pass and the 31st is
`429 rate.exceeded`; the view and submit routes share ONE bucket, so alternating cannot buy 60;
it is keyed per IP, so one abuser does not lock out a customer on another connection; and a 429
creates no task — the expensive path never runs.

### Two tabs

The SSE suite was thorough on one connection, and a single connection cannot see the failure that
matters: a registry keyed on the USER rather than the CONNECTION delivers to whichever tab
registered last and the other goes quiet — reported as "the inbox is flaky", invisible to every
existing test. **3 tests**: both connections receive the same notification, each gets its own
`connected` frame, and closing one does not stop the other.

### The isolation sweep now covers P6 — 119 → 145

`PHASES_COVERED` gained `"P6"`; the completeness check named all 26 endpoints needing a probe and
they were written. Four things were decided rather than worked around:

- **Two routes are excluded, with the reason written down** — `GET/POST /public/forms/:slug` are
  PUBLIC by design (the slug IS the capability; answering 404 to a stranger would break the
  feature for every customer), and `PUT/DELETE /on-call/:weekStart` take a **date**, identical in
  every workspace, so there is no foreign id to hold. A new `NOT_AN_ID_PROBE` set carries both,
  with the reasoning, so the exclusion stays a decision instead of a silent gap.
- **Both are then asked the question that DOES apply**, in the effect direction: writing my
  on-call week leaves the neighbour's row byte-identical, and a public submit made by somebody
  signed into another workspace lands the task in the FORM's workspace, never the caller's.
- Two more body probes: pulling **their** task into **my** sprint, and creating a form in
  **their** list. Both refused.
- The three probes that first came back 422 were **my** bodies, not the product's answer —
  `items` shapes for the field-reorder and postmortem endpoints. A probe the validator rejects
  proves the body parser works and nothing about whose data it is, so they were corrected rather
  than accepted.

### A trap fixed at the source instead of remembered

`makeLoggedInClient` signs a JWT over `{sub, role, workspaceId, id: "pending"}` plus a
one-second `iat`, so signing the same user twice inside one second produced the **same** token and
`sessions.uq_sessions_token_hash` rejected the second sign-in. It reads as a duplicate-key error
with nothing connecting it to logging in twice. P5 worked around it; P6 hit it again modelling a
person with two browser tabs — twice is enough. The placeholder is now a fresh id per call, and
the P5 comment that described it as a live hazard was corrected.

*(Two tabs share a session in a real browser anyway, so that test uses one client for both
connections — the accurate model, reached by way of the bug.)*

### Verified already covered — no new tests needed

- **Weekly reports.** `report-stats.test.ts` is thorough where it counts: the Dhaka week
  boundary and its six-hour band on both edges, `completed_late` on the Dhaka calendar day,
  distinct-task approve/flag with the undo chain, `self_reviewed`, unassigned work in the
  synthetic `user:null` row, archived rules, and point-in-time vs window. Generation, regenerate
  (which must not re-notify) and the ack flow are covered in `report-generation` and
  `reports-actions`.
- **On-call at week boundaries**, the tz-sensitive part the plan flagged: both inclusive edges,
  a shift entirely past, one entirely future, several straddling today (most-recent `week_start`
  wins), and a deactivated engineer still resolving — all keyed to `dhakaDayOffset` rather than
  the box's day.
- **Sprints lifecycle** — 164 tests across create/list/active/get/start/close/delete and task
  add/remove.

### Closing state

- **`npm run test:all` — 37 modules · 5,739 passed · 0 failed · 130.2 min · ALL GREEN**
- Static phase 4/4; eslint 0/0 and a real type-check on both packages.
- Dev DB at baseline **47 / 6 / 9 / 27 / 15** — P6 never wrote to it.
- `client/dist` and `server/dist` untouched (§A rule 8).

*(This gate took two attempts, and the first one is **KI-36's second data point**. It came
back with `deptreview` red at 121/122 and five more modules green only on retry — while a
different project's Next dev server was running on the same machine. The re-run, alone on the
box, was ALL GREEN with `deptreview` at 122/122 and the same two modules flaking that flaked
in P4. Nothing in the tree changed between the two. That is not proof of a cause, but it is
the second time load has produced exactly this shape, and the first time the shape included a
module going fully red — so a red gate is now worth checking the machine for before it is
believed.)*

**Signed off:** ✅

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
