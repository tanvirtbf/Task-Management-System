# Phase Board — Testing

> ✅ **ALL 42 PHASES RUN.** Final deliverable: **`testing/TESTING_SUMMARY.md`**.
> 91 issues · 1 CRITICAL · 10 HIGH · 47 MEDIUM · 32 LOW · 1 GAP.
> Demo database ends at its exact baseline; ISS-025 drift and SCAN-H4 triggers deliberately preserved.

Plan: `TESTING_MASTER_PLAN.md`.  Statuses: PENDING · IN PROGRESS · DONE · PARTIAL · BLOCKED

**Running total:** 91 issues — 1 CRITICAL · 10 HIGH · 47 MEDIUM · 32 LOW · 1 GAP

> 🔴 **UI DEBT IS NOW DUE (P34/P35/P36 ran PARTIAL because of it).** Those three phases verified what a
> single browser can show — rendering, routing, guards, console — and deferred every interaction test
> (drag-and-drop, two-client sync, offline, keyboard, responsive, a11y). They need ONE scripted
> Playwright pass, run together, not three more manual passes. Original note below.

> 📌 **UI debt is accumulating.** Every phase so far has deferred its browser-side checks to P36,
> which is already XL. Before P26 or P35, consider standing up the Playwright harness once and
> testing each feature's UI in its own phase instead.

> ✅ **P26 BLOCKER HANDLED (and restored):** the two missing columns were added for the phase to run
> at prod parity, then DROPPED again so ISS-025 stays reproducible. Original note kept below.

> ⚠️ **BLOCKER FOR P26:** the dev DB is missing `form_submissions.encrypted_at` / `expires_at`
> (ISS-025). Forms are untestable locally until that is applied. Fixing is a FIXING-phase action —
> but P26 cannot produce valid results before it happens.

**Deferred out of a phase (must be picked up later):**
- ~~**P4** ← stale role claim (P3)~~ — **answered in P4 → ISS-021**
- **P26** ← form-503 with no `ENCRYPTION_KEY` (P1) · `publicFormLimiter` 30/min (P2) ·
  `form.view_submissions` enforcement (P5)
- ~~**P27** ← `template.apply` enforcement (P5)~~ — **answered in P27 → NOT ENFORCED, folded into ISS-024**
- ~~**P29** ← `postmortem.manage` enforcement (P5)~~ — **answered in P29 → NOT ENFORCED, folded into ISS-024**
- ~~**P30** ← SLA end-to-end confirmation of ISS-001 (P1)~~ — **answered in P30 → ISS-081, measured to the minute**
- ~~**P31** ← `review.perform` enforcement (P5) · `space.has_reports` delete guard (P8)~~ — **both answered in P31**
  (`review.perform` = inert toggle but the action IS protected by a head/admin check; `space.has_reports` guard fires)
- **P34** ← UI session behaviour: reload, second tab, single-refresh de-dupe (P3)
- **P35** ← does a deactivated assignee render distinctly on a task card? (P7)
- **P36** ← UI logout clears store + query cache (P3) · `/settings/roles` grid (P5) ·
  `/settings/workspace` (P6) · `/settings/members` + `/settings/profile` (P7)
- ~~**P38** ← stored `<script>` in a space description — does it render? (P8)~~ — **answered in P38 §3: stored verbatim server-side; every render path is React-escaped, no `dangerouslySetInnerHTML` outside SearchPage (P25 §6)**
- **P40** ← is over-max `limit` clamped? dataset too small to tell (P2)
- **P41** ← graceful shutdown, untestable on Windows (P1)

**Cross-phase pattern — SETTLED in P11.** Six named resources: **statuses, task types and tags
enforce** name uniqueness (case-insensitively); **roles (ISS-027), spaces (ISS-033) and lists
(ISS-035) do not**. The three that enforce are the catalog resources; the three that do not are the
navigation resources, where a duplicate name hurts most. Working implementations exist to copy.
**P12 update:** custom fields also allow duplicates — the tally is now **3 enforce / 4 do not**.
**P22 update:** checklists on one task also allow duplicate names -> **3 enforce / 5 do not**.

> 🧹 **Second teardown rule, P21:** `notifications.entity_id` is polymorphic with **no FK** — hard-deleting a
> fixture task strands its notification rows forever. Delete notifications by `entity_id` too.
> (13 such orphans from P17/P21 were cleaned up; notifications baseline is now **65**.)

> 🧹 **Fixture teardown rule learned in P10:** remove test fixtures **through the API**, not with raw
> SQL. `statuses.scope_id` is polymorphic with no FK, so a raw `DELETE FROM lists` orphans its
> statuses silently (85 such rows were left by P5/P8/P9 and cleaned up in P10).

| # | Phase | Status | Issues found | Result file |
|---|---|---|---|---|
| P1 | Environment, build & health | **PARTIAL** | 6 — ISS-001…006 (1 CRITICAL, 1 HIGH, 1 MED, 3 LOW) | `testing/results/PHASE-01.md` |
| P2 | API conventions & error catalog | **DONE** | 8 — ISS-007…014 (5 MED, 3 LOW) | `testing/results/PHASE-02.md` |
| P3 | Authentication | **PARTIAL** | 4 — ISS-015…018 (2 MED, 2 LOW) | `testing/results/PHASE-03.md` |
| P4 | Legacy role authorization | **DONE** | 5 — ISS-019…023 (4 MED, 1 LOW) | `testing/results/PHASE-04.md` |
| P5 | Dynamic RBAC (56 permissions) | **PARTIAL** | 4 — ISS-024…027 (2 HIGH, 1 MED, 1 LOW) | `testing/results/PHASE-05.md` |
| P6 | Workspace | **PARTIAL** | 2 — ISS-028…029 (2 MED) | `testing/results/PHASE-06.md` |
| P7 | Users & members | **PARTIAL** | 2 — ISS-030…031 (1 MED, 1 LOW) | `testing/results/PHASE-07.md` |
| P8 | Spaces | **PARTIAL** | 3 — ISS-032…034 (1 MED, 2 LOW) | `testing/results/PHASE-08.md` |
| P9 | Lists | **PARTIAL** | 2 — ISS-035…036 (2 LOW) | `testing/results/PHASE-09.md` |
| P10 | Statuses | **PARTIAL** | 2 — ISS-037…038 (2 LOW) | `testing/results/PHASE-10.md` |
| P11 | Task types & tags | **PARTIAL** | 2 — ISS-039…040 (1 MED, 1 LOW) | `testing/results/PHASE-11.md` |
| P12 | Custom fields | **PARTIAL** | 3 — ISS-041…043 (2 MED, 1 LOW) | `testing/results/PHASE-12.md` |
| P13 | Task creation | **PARTIAL** | 2 — ISS-044…045 (1 MED, 1 LOW) | `testing/results/PHASE-13.md` |
| P14 | Task reading | **PARTIAL** | 1 — ISS-046 (1 MED) | `testing/results/PHASE-14.md` |
| P15 | Task update | **PARTIAL** | 3 — ISS-047…049 (1 HIGH, 2 LOW) | `testing/results/PHASE-15.md` |
| P16 | Task lifecycle & deletion | **PARTIAL** | 2 — ISS-050…051 (1 MED, 1 LOW) | `testing/results/PHASE-16.md` |
| P17 | Task membership | **DONE** | 1 — ISS-052 (1 MED) | `testing/results/PHASE-17.md` |
| P18 | Subtasks & dependencies | **DONE** | 3 — ISS-053…055 (1 HIGH, 1 MED, 1 LOW) | `testing/results/PHASE-18.md` |
| P19 | My Work, Home KPIs & Agenda | **DONE** | 4 — ISS-056…059 (4 MED) | `testing/results/PHASE-19.md` |
| P20 | Task activity | **DONE** | 3 — ISS-060…062 (1 HIGH, 2 MED) | `testing/results/PHASE-20.md` |
| P21 | Comments | **PARTIAL** | 4 — ISS-063…066 (1 HIGH, 3 MED) | `testing/results/PHASE-21.md` |
| P22 | Checklists | **PARTIAL** | 4 — ISS-067…070 (2 MED, 1 LOW, 1 GAP) | `testing/results/PHASE-22.md` |
| P23 | Attachments | **PARTIAL** | 1 — ISS-071 (1 MED) | `testing/results/PHASE-23.md` |
| P24 | Notifications | **PARTIAL** | 2 — ISS-072…073 (2 MED) | `testing/results/PHASE-24.md` |
| P25 | Search | **PARTIAL** | 3 — ISS-074…076 (2 MED, 1 LOW) | `testing/results/PHASE-25.md` |
| P26 | Forms | **PARTIAL** | 4 — ISS-077…080 (3 MED, 1 LOW) | `testing/results/PHASE-26.md` |
| P27 | Templates | **PARTIAL** | 0 — clean; resolved a P5 deferral into ISS-024 | `testing/results/PHASE-27.md` |
| P28 | Sprints | **PARTIAL** | 0 — clean; confirmed a `sprint.assign_tasks` gap into ISS-024 | `testing/results/PHASE-28.md` |
| P29 | On-call & Engineering | **PARTIAL** | 0 — clean; resolved a P5 deferral into ISS-024 | `testing/results/PHASE-29.md` |
| P30 | SLA | **DONE** | 2 — ISS-081…082 (1 HIGH, 1 LOW) | `testing/results/PHASE-30.md` |
| P31 | Dept review & HR reports | **PARTIAL** | 0 — clean; resolved two P5/P8 deferrals | `testing/results/PHASE-31.md` |
| P32 | Background jobs | **DONE** | 0 — clean | `testing/results/PHASE-32.md` |
| P33 | AI assistant | **PARTIAL** | 0 — clean; eval gate PERFECT, 127 jest green | `testing/results/PHASE-33.md` |
| P34 | Real-time, offline & session | **PARTIAL** | 0 — confirmed SCAN-M4; 5 of 8 lines deferred | `testing/results/PHASE-34.md` |
| P35 | Frontend views | **PARTIAL** | 0 — 4 views render; drag/virtualisation deferred | `testing/results/PHASE-35.md` |
| P36 | Frontend shell, routing & UX | **PARTIAL** | 0 — confirmed SCAN-L2 + SCAN-M5; 7 of 12 deferred | `testing/results/PHASE-36.md` |
| P37 | Data integrity & concurrency | **DONE** | 0 — clean; reproduced ISS-073 | `testing/results/PHASE-37.md` |
| P38 | Security & abuse | **PARTIAL** | 4 — ISS-083…086 (1 HIGH, 2 MED, 1 LOW) | `testing/results/PHASE-38.md` |
| P39 | Realistic multi-user scenarios | **DONE** | 0 — 22/22 assertions passed | `testing/results/PHASE-39.md` |
| P40 | Performance & scale | **PARTIAL** | 2 — ISS-087…088 (1 HIGH, 1 LOW) | `testing/results/PHASE-40.md` |
| P41 | Production parity | **PARTIAL** | 3 — ISS-089…091 (1 MED, 2 LOW) | `testing/results/PHASE-41.md` |
| P42 | Regression sweep & consolidation | **PARTIAL** | 0 — 15/15 issues re-verified; TESTING_SUMMARY.md delivered | `testing/results/PHASE-42.md` |
