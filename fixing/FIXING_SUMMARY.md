# FIXING CAMPAIGN — FINAL SUMMARY (F1–F34, 2026-08-03 → 2026-08-08)

**The one-line verdict:** the 93 issues the testing campaign proved real — plus the five more this
campaign found in its own headlights — are all closed: **96 fixed, 1 WON'T FIX by decision, 1
duplicate**. Nothing is silently OPEN. The symmetric proof ran both directions: P42 demonstrated 15
representative issues reproducing on the broken tree; F34 replayed the same repros on the fixed
tree and **15 of 15 no longer reproduce**, with the demo-data baseline byte-identical afterwards.

This document is the go-live gate deliverable: what was fixed, what was consciously not fixed, the
decisions and who owns them, and the residual risk.

---

## 1. The ledger — every issue has a disposition

| universe | n |
|---|---|
| Issues from the testing campaign (ISS-001…088 + 089…091, SCAN-*) | 93 |
| Filed DURING fixing, rule X1 (092 F3 · 093 F3 · 094 F26 · 095 F28 · 096–098 F31) | +6 → 98¹ |
| **FIXED** (incl. ISS-005 closed as re-measured/does-not-reproduce) | **96** |
| **WON'T FIX** — ISS-018, decision D4 (login email stays admin-changeable-only) | 1 |
| **DUPLICATE** — ISS-093 = ISS-087 (byte-identical failure signature) | 1 |
| Silently open | **0** |

¹ ISS-092/093 were filed during F3, 094 during F26, 095 during F28, 096–098 during F31 — each the
fixing campaign catching a defect in its own headlights and refusing to fix it off-ledger.

Also closed along the way, from the 2026-07-29 full-system scan's unnumbered carry-ins:
SCAN-H2 (F4) · SCAN-H4 (F15) · SCAN-M1/M2 (F19) · SCAN-M4 (F28 decision) · SCAN-M5 (F26) ·
SCAN-M7 (F13).

## 2. What actually changed — the campaign in eight moves

1. **The clock became one clock (F1–F5).** Every TIMESTAMP was stored 6 h off; `DB_TIMEZONE=+00:00`
   made the driver's hardcoded assumption true, and five silent side-effects (DATE day-shifts, a
   six-day on-call week, three hand-rolled date helpers) were caught in the same phase.
   `workspaces.timezone` finally decides "today". An S0 bug is no longer born breached.
2. **RBAC became real and then became right (F7–F10, F26, F28).** All 56 catalog toggles enforce
   (route gates + service scope + live legacy-role reads); the nav and buttons gate on the same
   keys the endpoints check; and the seeded Guest fell from 19 grants to 7 — with the one write a
   guest keeps (report a bug) rebuilt on a named intake principal when the revocation exposed that
   its mechanism needed `task.create`.
3. **The spec's promises got teeth (F13–F23).** Tag-delete cascades, blocked-task completion,
   sprint overlap, archived-freeze, last-admin, headship-survives-deactivation, the counters
   rebuilt app-side (MySQL forbids the trigger shape), hard-delete takes notifications and queues
   R2 keys, pagination/cursors/422s honest, the error catalog generated from code.
4. **The UI stopped lying (F24–F27).** Invented trends and sparklines deleted; archive reversible;
   the dependency picker searches the workspace; names unique on create AND rename; every
   advertised control does what it says — a theme that ran to the very last phase (⌘K).
5. **The seven product decisions were decided AND built (F28, D12.1–7).** Business-clock SLA;
   fiscal-year removed; checklist assignee UI (date half refused, with reasons); the `/sla` queue;
   the locale control disabled honestly; sprint delete with the active guard; list move with
   visibility documented.
6. **The LOW tail was swept, not waived (F29).** Dev-field gating by type, BD phone + ISO-4217
   money validation, `pr_url` URL-checked, both checklist-bulk doors capped at 200.
7. **Headroom bought before it was needed (F30).** Four filesort-killing indexes (EXPLAIN-proven,
   latency-proven), the bundle split where splitting wins (and the antd mega-bucket rejected by
   measurement), the 16.7 s boot re-measured to 4.1 s and closed.
8. **Verification closed its own loop (F31–F34).** The never-run Playwright harness stood up; the
   deferred interaction debt (drag-and-drop, offline, revocation, breakpoints, axe) ran and its
   three findings were filed, then fixed, then proven by their own un-annotated tests; the full
   regression sweep re-ran; production parity re-checked with the runbook corrected; and P42's 15
   repros were replayed and are gone.

## 3. Decisions taken (the ones a future maintainer must know)

| decision | what it locked in |
|---|---|
| **D1** | production is not live → data disposable, tightening cheap now |
| **D4** | ISS-018 WON'T FIX — login email changes stay admin-only |
| **D3/D3.1** | all 56 permissions gated; service-shaped checks COMPOSE (`legacyAdmin && holds`) |
| **D5** | password policy applies to NEW passwords only |
| **D6–D10** | notification types 12→7 (producerless dropped); prefs really suppress; email channel removed; search stays LIKE; envelope families documented |
| **D11** | name uniqueness on create AND rename; archived rows included |
| **D12.1–7** | the F28 batch (guest 7 grants · business clock · assignee-no-date · /sla page · locale honest · sprint delete · list move; `is_private` on lists stays out BY DESIGN) |
| **F31's green-or-filed rule** | an e2e test may fail only while annotated with the ISS it documents; un-annotating is how a fix proves itself |

Design positions worth restating: session-UTC is the canonical clock (a raw SQL client MUST
`SET time_zone='+00:00'` or timestamps look 6 h off — that is the frame, not a bug); the ≤15-min
live-access-token window after deactivation is a documented auth-layer decision; SSE/live-push was
deliberately not built (propagation is refetch-on-open); `lists.is_private` is decorative by
design, with narrow `space.view` as the real mechanism.

## 4. What was consciously NOT fixed

- **ISS-018** (WON'T FIX, D4) — self-service login-email change; deliberate support-policy choice.
- **The color-contrast serious rows** ISS-098 recorded (7–22 nodes/page) — the criticals are gone;
  contrast is a themed design pass, catalogued for whoever runs it.
- **The RBAC backlog** the dynamic-RBAC plan always carried (P12–15 own-scope on remaining writes,
  P20–22 repos, P27 space-members UI, P29–30 client action-gating beyond F26's set): pre-existing
  scope, tracked in `RBAC_DYNAMIC_PLAN.md`, untouched by this campaign's charter.
- **tasks10** jest config excluded from sweeps: a concurrency-isolation twin of `tasks` (same
  testMatch, private DB) — running it doubles 25 minutes for zero coverage.

## 5. Residual risk at go-live

1. **The box-only handoff (F33 §5).** Nine checks need SSH to 209.38.65.61 or broken-on-purpose
   credentials: the §6 runbook end-to-end, prod cookie flags, the 5501 firewall question (ISS-089's
   decider), R2 unreachability, `run-job.sh` with the API down, `eng.not_configured` live, the
   Dhaka midnight boundary with a moved clock, assistant upstream failures, SPA-origin headers
   behind the real vhost. Each has its repo-side half verified; each is a first-deploy operator
   task.
2. **Migration path vs fresh path.** Fresh = `db:setup` → **42 tables / 5 views / 9 triggers** (the
   corrected canonical shape). Already-provisioned = `upgrades/001–013` in order. `db:migrate`
   remains a trap and is fenced off in the runbook.
3. **Provider secrets** rotated locally in 2026-07's hygiene pass still need their at-source
   rotations confirmed (MySQL/Mailtrap→real-SMTP/OpenAI/R2) — user-gated since KI-4.
4. **Scale posture.** Verified flat at 5,000 tasks / 47k activity rows with the filesorts gone;
   LIKE-search (~125 ms at that volume) is the first thing to watch at 10×, per D9's better-LIKE
   decision.
5. **The chain-flake caveat is operational knowledge.** On this shared box, a serial multi-module
   jest chain (or default worker parallelism) produces phantom mass-failures on a draining pool. A
   red module is not evidence until re-run solo — this held in F23, F28, and F32.

## 6. Where the proof lives

- Per-phase: `fixing/results/F01–F34.md` · one-line-per-issue: `fixing/FIX-LOG.md` · board:
  `fixing/STATUS.md` · decisions: `fixing/DECISIONS.md` · issue texts: `testing/ISSUES.md`.
- Re-runnable probes (the durable regression net beyond ~3,800 jest + 44 vitest + 81 e2e):
  clock (`F01/clock-probe.cjs`), orphans/cascades (`F16/f16-probe.cjs`, 24/24),
  day-in-the-life (`F07/f7-day-in-the-life.cjs`, 47/47), EXPLAIN/latency (`F30/*`),
  assistant eval (`server/scripts/assistant-eval.cjs --assert`, PERFECT),
  and the symmetric proof itself (`F34/reverify-probe.cjs`, 15/15).
- F32's full sweep: `fixing/evidence/F32/` (jest-sweep, vitest, orphan sweep, day-in-the-life,
  assistant eval). F34's final e2e: `fixing/evidence/F34/pw-final.txt`.
