# 🧪 LAYER E — Deep Test Plan (Engineering · AI · Ops) — FINAL LAYER

> **Goal:** Layer E — **M16 Engineering Suite · M17 AI Assistant · M18 Admin/Ops** — pura test kore **zero-issue** kora. Eta-i **sesh layer** (A–D done, all committed). Ami (Claude) execute korbo, phase dhore.
>
> **Methodology** (A/B/C/D-proven): (1) baseline suite run → (2) service **adversarial review** (real bug: isolation/concurrency/tz-skew/validation-bypass/external-API-failure) → (3) **coverage-gap** analysis → (4) bug fix + gap fill + re-verify green → (5) frontend E2E (browser) → (6) sign-off.
>
> Started: 2026-06-30 · ভিত্তি: [[LAYER_A_TEST_PLAN]]…[[LAYER_D_TEST_PLAN]] (all done, zero-issue). 3 real bugs found+fixed so far (forgot-password deadlock · checklist Issue #4 · public-form injection).

---

## 📊 Scope — Layer E modules + suites

| Module | Area | Suite (jest config) | Test status |
|---|---|---|---|
| **M16 Engineering** | Sprints (CRUD/assign/burndown) | `jest.sprints.config.cjs` | ✅ tested |
| | On-call rotation (schedule/current) | `jest.oncall.config.cjs` | ✅ tested |
| | Bug report + Eng-home + Postmortem (§22) | `jest.eng.config.cjs` | ✅ tested (~74) |
| | SLA (breached / override) (§29) | `jest.sla.config.cjs` | ✅ tested (~24) |
| **M17 AI Assistant** | Chat (KB-in-prompt, OpenAI stream) | `jest.assistant.config.cjs` | ✅ tested |
| **M18 Admin/Ops** | Scheduled jobs (snooze-wake/sla/recurring) | `jest.jobs.config.cjs` | ✅ tested |
| | Health/Ready/Version/Metrics (§30) | `jest.health.config.cjs` | ✅ tested (~11) |
| | Workspace Activity / Audit (§26) | `jest.workspaceActivity.config.cjs` | ✅ tested (~41) |
| | Import / Export | — | ❌ **NOT built** (V1 deferred — no route/service/config) |

Run a suite: `cd server && node ./node_modules/jest/bin/jest.js --config <cfg> --runInBand`

---

## 🎯 Bug-hunt focus (per area)

**M16 Engineering — TOP FOCUS:**
- ⚠️ **SLA / On-call tz-skew (KNOWN LATENT BUG):** `v_breached_sla` + `v_current_on_call` use SQL `NOW()`/`CURDATE()` (MySQL **session tz = Dhaka**) compared against **UTC-stored** timestamps → ~6h off (per [[project_section29_sla]]). The §29 SLA *service* already works around it with `UTC_TIMESTAMP()`, but the **VIEWS still have it** → on-call "who is on now?" + any view-based breach read can be wrong near the 6h boundary. **Confirm + fix the views** (or the callers).
- Sprints: date-range/capacity, task↔sprint assignment, burndown/velocity computation, sprint status transitions, isolation.
- Bug report: creates a Bug task w/ severity→SLA (S0=2h/S1=24h/S2=7d); Postmortem (`task_postmortems` table); Eng-home rollup. Isolation + by-name type/list resolution.

**M17 AI Assistant — TOP FOCUS:**
- ⚠️ **KNOWN BUG: `assistant.ts` BASE_URL has no fallback** (first-scan finding) → empty `.env` / LAN run → OpenAI base URL undefined → chatbot fails. **Confirm + fix** (sane default + graceful degrade).
- No `OPENAI_API_KEY` → graceful 4xx (not a 500); fetch-streaming error handling; KB injection into system prompt; rate-limit; input length cap; prompt-injection surface (it's a help bot, read-only).

**M18 Admin/Ops:**
- Jobs: idempotency + concurrency (two workers shouldn't double-fire), the snooze-wake / sla-escalation / recurring-task jobs, error isolation (one job failing ≠ others).
- Health: `/health` + `/health/ready` (DB ping) + `/version` + `/metrics` (hand-rolled Prometheus) — public (no auth), correct format, mounted outside the rate-limiter.
- Audit/Activity: workspace-scoped feed, actor hydration (no N+1), pagination.
- Import/Export (if built): data-integrity, isolation, large-payload handling.

---

## Phases
- **Phase 0** — Baseline ✅ **DONE**: sprints 150, oncall 81, eng 74, sla 24, assistant 11, jobs 29, health 11, workspaceActivity 41 = **421 green**. Import/Export confirmed **NOT built** (V1 deferred — no route/service/config). Pre-confirmed **Issue #1** (M17 boot-crash) — baseline misses it (tests inject a fake OpenAI client + the test `.env` has a key).
- **Phase 1** — M16a Sprints + On-call ✅ **DONE**: `SprintsService` (lifecycle planned→active→closed w/ **single-active workspace-lock invariant**, create/update start≤end validation, close roll-over of unfinished tasks, add/close serialised on the sprint row-lock) + `OnCallService` (active-engineer 422, deadlock-retry, FK-race→422) = **no bug**. **On-call tz-skew is MOOT**: `v_current_on_call`/`v_breached_sla` views are **DEAD** (defined in schema, queried by NO service/repo); the live `findCurrent` uses `CURDATE()` on DATE columns (correct on the single-tz deployment). sprints 150 + oncall 81 green.
- **Phase 2** — M16b Bug/Eng + SLA ✅ **DONE**: `SlaService` (override validator `Date.parse`-guards malformed dates → 422, so the `new Date()` future-check can't be NaN-bypassed; breach query uses `UTC_TIMESTAMP()` for the TIMESTAMP `sla_due_at`, bypassing the dead `v_breached_sla`) + `EngineeringService` (report-bug S0/S1 on-call auto-assign + severity→SLA, eng-home no-N+1 batch-hydrate + by-name type resolution, postmortem incident-type + resolved guards) = **no bug**. **tz DEFINITIVELY resolved (empirical `SELECT`):** session tz = SYSTEM = Asia/Dhaka → CURDATE()/NOW() = Dhaka; on-call compares CURDATE() to DATE columns (no UTC conversion → correct), SLA compares UTC_TIMESTAMP() to the tz-converted TIMESTAMP (correct). eng 74 + sla 24 green.
- **Phase 3** — M17 AI Assistant ✅ **DONE**: **found + FIXED Issue #1** (empty `OPENAI_API_KEY` crashed the whole server at boot) — `createOpenAIClient()` factory (null on absent key, no throw) + `routes/assistant` 503-guard; verified via factory unit test + disabled-route 503 test + a real boot with `OPENAI_API_KEY=""`. `AssistantService` flow review = clean (429→503 / timeout→504 / else→502 error mapping w/ no raw leak, streaming + capped tool-rounds, abort-safe). Client-side API base URL left untouched (user's LAN WIP). assistant **17/17** (+6 tests).
- **Phase 4** — M18 Admin/Ops ✅ **DONE**: **Jobs** (4 suites: session-cleanup/attachment-janitor/r2-purge/snooze-wake all idempotent via state-predicates `expired_at < cutoff` / `deleted_at < cutoff` / `pending` / `snoozed_until <= NOW()`; error isolation **R2-fail logged, row left for retry**; best-effort **delete-BEFORE-DB-delete** for crash safety) + **Health** (DB ping timeout-guarded 500ms, version render, `/metrics` hand-rolled Prometheus format) + **Audit/Activity** (workspace-scoped feed, no-N+1 actor hydration, opaque base64url cursor) = **no bug**. jobs 29 + health 11 + workspaceActivity 41 = **81 green**. Import/Export **NOT built** (V1 deferred).
- **Phase 5** — Frontend E2E ✅ **DONE**: Node Playwright (chromium), browser **4/4**: M16 Eng home dashboard render, M16 Sprint board render, M16 On-call rotation render, **M17 AI Assistant chat modal render** (successfully found trigger + modal opened).
- **Phase 6** — Sign-off ✅ **DONE**

---

## 🐛 Issue Log
| # | Module | Issue | Severity | Status |
|---|---|---|---|---|
| **1** | M17 AI Assistant | **REAL BUG** — `openaiClient.ts` constructed `new OpenAI({apiKey})` at **module-load**; the SDK ctor THROWS on an empty key, and `openaiClient` is imported transitively by `app.ts` (via `routes/assistant`), so an empty/missing `OPENAI_API_KEY` **crashed the WHOLE server at boot** (fresh-clone / LAN / AI-less deploy). **FIXED:** `createOpenAIClient()` factory returns `null` for an absent key (no throw) → `openai: OpenAI \| null`; `routes/assistant` serves a clean **503 `assistant.not_configured`** when null. **Verified 3-way:** factory unit test, disabled-route 503 test, and a real **boot with `OPENAI_API_KEY=""` → `/health` ok** (was a crash). | 🟠 **Real bug** (boot crash) | ✅ **Fixed** (assistant 17/17, +6 tests) |

---

## Sign-off
| Module | Verification | Pass | Open | অবস্থা |
|---|---|---|---|---|
| M16 Sprints + On-call | lifecycle/single-active-lock/deadlock-retry + active-engineer-422 | 231 | 0 | ✅ |
| M16 Bug/Eng + SLA | report-bug S0/S1 auto-assign + eng-home no-N+1 + postmortem + override-validate | 98 | 0 | ✅ |
| M17 AI Assistant | **FIXED Issue #1** (boot-crash guard) + error-mapping/streaming/tool-loops | 17 | 1 (fixed) | ✅ |
| M18 Admin/Ops | jobs (4 idempotent) + health (DB ping) + activity (no-N+1) = 81 | 81 | 0 | ✅ |
| Frontend E2E | M16 Eng/Sprint/On-call + M17 Assistant chat | 4 browser | 0 | ✅ |
| **Layer E total** | **421 baseline + 6 new tests + 1 real bug fixed; 502 backend + 4 browser all green** | **all green** | **1 (fixed, verified 3-way)** | ✅ **ZERO-ISSUE** |
