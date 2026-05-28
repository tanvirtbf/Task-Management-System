# What the BeautyBooth Dev Team Actually Needs

> Companion document to `WHAT_BeautyBooth_ACTUALLY_NEEDS.md` (the operational
> spec for the 5 non-tech spaces). This document scopes a 6th space —
> **Engineering** — and lists the additional features that have to come
> back for software engineers to actually use the system.
>
> **Author's note:** I previously recommended dev team use Linear / GitHub
> Issues separately (Path B). User chose to extend this system (Path A).
> This document executes Path A honestly — both the cost and the design.

---

## Part 0 — One-paragraph honest framing (read before approving)

Software engineering work has a **fundamentally different shape** from
order-pack-deliver work. Cleanup we did for the 5 operational teams
(remove subtasks, remove dependencies, remove rich text, remove mentions,
remove activity log, remove time tracking) was *correct for them* and
*wrong for dev*. To bring dev in, we have to **selectively un-do** some of
that cleanup — but only inside the Engineering space, gated by task type.
Done well, the operational teams never see the dev complexity; the dev
team gets what they need. Done badly, we recreate ClickUp.

The line we will hold: **dev features show only when `taskTypeId` is a dev
type** (Bug, Feature, Tech Debt, Incident, Release). Operational tasks
keep their simplified UI.

---

## Part 1 — Strategic context

### Assumed dev-team size
- **5-15 engineers** (BeautyBooth ~100-employee company → 5-15% engineering ratio is normal for a tech-enabled ecom)
- Roles in real life: Engineering Lead (1), Senior Devs (2-3), Mid/Junior Devs (3-6), QA (1-2), DevOps part-time (1)

### What the dev team actually works on at BeautyBooth
1. **Website** — bug fixes, new features (loyalty, cart, checkout), performance, SEO
2. **POS & Sales tracker** — internal tool maintenance
3. **Backend / API** — order processing, inventory sync
4. **Courier integration** — Pathao / Steadfast / RedX / Sundarban APIs
5. **Payment gateway** — SSLCommerz, later bKash / Nagad
6. **This task system** — itself!
7. **Production incidents** — site down, checkout broken, etc.
8. **Cross-team bug triage** — Operations / CS / Marketing report bugs upstream

### What this means for the system
- Operational teams **report bugs** into Engineering (cross-team handoff)
- Engineering **breaks features into stories** (subtasks)
- Engineering **plans in sprints** (not date-based like marketing)
- Engineering **needs code context** in tasks (Git branch, PR URL, stack trace)
- Engineering **mentions teammates** in code review discussion

---

## Part 2 — Dev team's 8 actual workflows

### 2.1 Bug triage (incoming from any team)
- **Trigger:** Operations / CS / Marketing notices something broken on website or internal tool
- **Stages:** Reported → Triaged → Confirmed → In Dev → In Review → Ready to Deploy → Deployed → Verified → Closed (or Won't Fix / Duplicate)
- **Critical fields:** Severity (S0-S3), Reproducibility, Environment, Browser/OS, Steps to reproduce, Stack trace, Reporter
- **SLA:** S0 = 2 hours, S1 = 24h, S2 = 1 week, S3 = backlog
- **UI:** Triage board (Kanban) — Engineering Lead grooms it morning + afternoon

### 2.2 Feature development (planned work)
- **Trigger:** Product/Owner request, festival prep, customer feedback aggregated
- **Stages:** Backlog → Spec'd → Ready → In Progress → In Review → Ready to Deploy → Deployed → Done
- **Critical fields:** Story points (1/2/3/5/8/13), Acceptance criteria checklist, Mockup/design link, Stakeholder team
- **UI:** Sprint board (Kanban) + Epic group view

### 2.3 Tech debt / refactor
- **Trigger:** Senior dev identifies pain point during regular work
- **Stages:** Identified → Justified → Approved → In Progress → Done
- **Critical fields:** Impact (slows team / risks bug / blocks feature), Estimated effort, Risk if not fixed
- **UI:** Same as feature board, separate task type for filtering

### 2.4 Production incident
- **Trigger:** Site down, payment failing, courier sync broken, customer reports
- **Stages:** Detected → Investigating → Mitigating → Resolved → Post-mortem
- **Critical fields:** Affected service, User impact, Timeline of actions, Root cause, Action items
- **Special:** Auto-assigns to on-call engineer, paged immediately
- **UI:** Incident-dedicated board with severity color coding

### 2.5 Code review
- **Trigger:** Engineer opens PR on GitHub
- **Stages:** Awaiting review → Changes requested → Approved → Merged
- **Critical fields:** Reviewer (separate from assignee), PR URL, CI status, Approval status
- **UI:** "My PRs awaiting review" filter on dev home page

### 2.6 Release management
- **Trigger:** Bi-weekly (or as needed) deployment cycle
- **Stages:** Planned → In QA → Approved → Deploying → Deployed → Verified → Rolled-back (only if issue)
- **Critical fields:** Version tag (v2.4.1), Linked tasks (changelog), Deploy date, Rollback notes
- **UI:** Release task type with linked-tasks list

### 2.7 Sprint planning
- **Trigger:** End of every 2 weeks
- **Action:** Lead + team pick tasks from backlog, set sprint dates, commit
- **Critical fields:** Sprint name (Sprint 23), Start/end dates, Sprint goal, Committed story points
- **UI:** Dedicated sprint planning view — drag tasks from backlog into sprint

### 2.8 On-call rotation
- **Trigger:** Weekly rotation among senior devs
- **Action:** On-call engineer auto-assigned all incoming P0/P1 incidents
- **UI:** "Who's on-call this week" badge + auto-assignment rule

---

## Part 3 — EXACT feature list for V1 dev support

> Each row = ONE addition. Effort = solo dev days. Total **~25 features**,
> ~30-40 dev-days of work after the V1 operational system ships.

### 3.1 Task types (5 new) — Effort: 1 day

| ID | Name | Icon | Used for |
|---|---|---|---|
| `tt-bug` | Bug | Bug | Bug reports incl. cross-team |
| `tt-feature` | Feature | Sparkles | Story / user-facing feature |
| `tt-tech-debt` | Tech Debt | Wrench | Refactor / cleanup |
| `tt-incident` | Incident | AlertOctagon | Production fire |
| `tt-release` | Release | Package | Deployment / version tag |

(Epic = optional V2 — keep simple)

### 3.2 Engineering space + lists (4 lists) — Effort: 0.5 day

- **Space:** Engineering (icon: Code, color: indigo)
- **Lists:**
  1. **Bug Triage** — incoming bugs from all teams
  2. **Sprint Board** — current sprint work
  3. **Backlog** — accepted but not yet scheduled
  4. **Incidents** — production incidents (own SLA)

### 3.3 Per-list status workflows — Effort: 0.5 day

**Bug Triage:** Reported → Triaged → Confirmed → In Dev → In Review → Ready to Deploy → Deployed → Verified → Closed → Won't Fix → Duplicate

**Sprint Board:** Backlog → Ready → In Progress → In Review → Ready to Deploy → Deployed → Done

**Incidents:** Detected → Investigating → Mitigating → Resolved → Post-mortem

### 3.4 Bug-specific custom fields — Effort: 1 day

| Field | Type | Required | Notes |
|---|---|---|---|
| Severity | Dropdown (S0/S1/S2/S3) | Yes | Color-coded |
| Reproducibility | Dropdown (Always/Sometimes/Once/Cannot) | Yes | |
| Environment | Dropdown (Production/Staging/Local) | Yes | |
| Browser/OS | Text | No | e.g. "Chrome 120 / Windows" |
| Steps to reproduce | Rich text | Yes | Markdown + code blocks |
| Expected behavior | Rich text | No | |
| Actual behavior | Rich text | No | |
| Stack trace | Code block | No | Pasted error log |
| Customer impact | Text | No | "1 user" / "all users" / "~10%" |
| Reporter team | Dropdown (Ops/CS/Marketing/Listing/Internal) | No | Auto-set on cross-team intake |

### 3.5 Feature-specific custom fields — Effort: 0.5 day

| Field | Type | Required | Notes |
|---|---|---|---|
| Story points | Dropdown (1/2/3/5/8/13/?) | No | Fibonacci |
| Acceptance criteria | Checklist | Yes | Given/When/Then |
| Stakeholder team | Dropdown | No | Who requested |
| Design / mockup URL | Text | No | Figma link |

### 3.6 Real Subtasks — Effort: 3 days

**Restore the deleted `SubtasksSection.tsx`** with these constraints:
- Subtasks are real Task records with their own status / assignee / due date
- Parent shows aggregated progress: `4/7 subtasks done (57%)`
- Two levels max — no nesting beyond that (avoids confusion)
- Display in a dedicated section in the task drawer
- Bulk-create from textarea ("one subtask per line")

**Restrict to dev task types only:** `taskTypeId in (Bug, Feature, Tech Debt, Incident, Release)`. Operational task drawer never shows the section.

### 3.7 Task Dependencies — Effort: 3 days

**Restore the deleted `DependenciesSection.tsx`** with these constraints:
- Two relations only: `blocks` and `blocked-by`
- (Drop `relates-to`, `duplicate-of` — too rarely used)
- Visual indicator on task card if blocked
- Can't close a task that has open blockers (warning, not hard block)
- Dependency graph view: not in V1 — just inline list of related tasks
- **Restrict to dev task types only** — same gating as subtasks

### 3.8 Rich text editor (TipTap) — Effort: 4 days

**Restore `TiptapEditor.tsx`** with these constraints:
- Markdown shortcuts only (no toolbar bloat — let devs type ` ``` ` for code block)
- Code blocks with syntax highlighting (use `lowlight` for language detection — JS, TS, Python, Bash, JSON, SQL)
- Inline code with backticks
- Headings (H2, H3 only)
- Bold / italic
- Bullet / numbered lists
- Links (paste URL = auto-link)
- **No tables, no embeds, no images** in V1 (keep bundle slim)
- **Restrict to dev task types** for description; comments stay plain everywhere

**Bundle impact:** ~150 KB gzip increase. Acceptable.

### 3.9 @Mentions — Effort: 2 days

**Restore `MentionRenderer.tsx`** with these constraints:
- `@username` in description and comments — autocompletes user list
- `#task-id` cross-task references (e.g. `#BUG-1042`)
- Mention triggers notification to mentioned user
- **Available in dev task types only** for descriptions; available everywhere in comments (other teams already need to ping each other)

### 3.10 Threaded comments — Effort: 2 days

- One level of threading only: top-level comment → reply
- No deep nesting
- "Resolve thread" button (collapses thread, shows "Resolved" badge)
- Show only unresolved threads by default, toggle to show all
- **Available everywhere** — not dev-only (CS team also benefits)

### 3.11 Activity log per task — Effort: 2 days

**Restore `TaskActivitySection.tsx`** with these constraints:
- Show: status changes, assignee changes, comment additions, branch links, PR events
- Chronological feed at bottom of task drawer
- Per-task only — no workspace-wide activity stream (keep that out)
- **Available everywhere** — not dev-only

### 3.12 Sprint / Iteration system — Effort: 4 days

- New concept: `Sprint` (id, name, startDate, endDate, goal, status)
- Status: Planned / Active / Closed
- Tasks have optional `sprintId` field
- Sprint board view: filters current sprint, Kanban columns by status
- Sprint planning view: drag tasks from "Backlog" list to "current Sprint"
- Burndown chart: V2 — show committed story points vs done over time
- Past sprint archive: see what shipped per sprint

### 3.13 Git integration (lightweight) — Effort: 3 days

- New custom fields per dev task: `branchName` (text), `prUrl` (text)
- Auto-suggest branch name from task: `BUG-1042-cart-fix` from task name + ID
- Paste GitHub/GitLab PR URL → extract status badge (open/merged/closed) via fetch on save
- "Copy branch name" button → shell-ready: `git checkout -b BUG-1042-cart-fix`
- **No webhook in V1** — just URL paste. PR state polled on view, not real-time.

### 3.14 Cross-team bug intake — Effort: 2 days

- "Report a bug" button visible in operational team sidebars
- Opens a guided form (uses Public Form infrastructure already in place):
  - What did you do? (steps)
  - What happened?
  - What did you expect?
  - Screenshot upload
  - URL where it happened
- On submit → creates task in Bug Triage list with status "Reported"
- Notifies on-call engineer

### 3.15 Reviewer field — Effort: 1 day

- New task field: `reviewerId` (single user, optional)
- Distinct from `assignees[]`
- Shown in board column "In Review"
- "Awaiting your review" smart filter on home page

### 3.16 Dev-specific home page tabs — Effort: 1 day

Engineering Lead opens Home → sees dev-specific cards in addition to global KPIs:
- "My open bugs (assigned)"
- "PRs awaiting my review"
- "Tasks in my sprint"
- "Stale tickets" (no activity in 14 days)

### 3.17 Story-points field on board cards — Effort: 0.5 day

- Tiny badge in top-right of board cards showing `5pt`, `8pt`, etc.
- Sprint capacity bar at top of Sprint Board: `45/60 pts committed`

### 3.18 Bug severity color rail — Effort: 0.5 day

- Left edge stripe on board cards colored by severity (S0 red, S1 orange, S2 yellow, S3 grey)
- Quick visual triage

### 3.19 On-call rotation — Effort: 1.5 days

- New settings page: "On-call rotation"
- Drag-drop weekly rotation calendar
- Auto-assign new Incidents + S0/S1 Bugs to current on-call
- "On-call this week" badge in topbar

### 3.20 Recurring maintenance tasks — Effort: built-in already

- Re-use existing recurrence (Daily/Weekly toggle)
- Pre-seed: "Weekly backup verify", "Monthly cert renewal check"

### 3.21 Filters specific to dev — Effort: 1 day

Add saved-view chips to Engineering space:
- All Bugs (open)
- All Bugs (S0/S1 only)
- My sprint
- Awaiting review
- Stale (>14 days no activity)
- Just landed (merged this week)
- Backlog grooming candidates

### 3.22 Linkable task references in commit messages — Effort: 0 (convention only)

- Document: "Use `BUG-1042` in commit message → search will find it"
- Already works via the existing global search

### 3.23 Engineering-only roles — Effort: 0.5 day

Add 3 internal sub-roles **inside Engineering space only** (workspace-wide role stays Admin/Member):
- `eng-lead` — can close sprints, manage on-call
- `eng-dev` — default; can create/edit tasks
- `eng-qa` — can verify deployed tasks, set "Verified" status

These are space-scoped permissions, not new workspace roles.

### 3.24 Deploy / Rollback marker — Effort: 1 day

- "Deployed" status auto-stamps `deployedAt` timestamp
- "Rolled back" reason field if status moves backwards from Deployed → In Dev
- Helps post-mortem reconstruction

### 3.25 Postmortem template — Effort: 0.5 day

- New Incident → checklist auto-populated:
  - [ ] Timeline reconstructed
  - [ ] Root cause identified
  - [ ] Impact quantified (users / revenue / time)
  - [ ] Customer comms sent
  - [ ] Action items created (linked tasks)
  - [ ] Lessons documented

---

## Part 4 — Effort summary

| Category | Days |
|---|---|
| Task types / spaces / lists / statuses | 2.5 |
| Custom fields (bug + feature) | 1.5 |
| Restore subtasks + dependencies + rich text + mentions + activity | 13 |
| Threaded comments | 2 |
| Sprint system | 4 |
| Git integration | 3 |
| Cross-team bug intake | 2 |
| Reviewer + dev home cards + filters + UX polish | 4 |
| On-call + roles + postmortem + deploy marker | 3.5 |
| **Total** | **~35 dev-days (~7 weeks solo)** |

This is **on top of** the 8-10 week V1 operational system + integrations.

**Realistic total to ship V1 operational + V1 engineering: 15-17 weeks** for one solo developer.

If you have 2 developers in parallel: **9-11 weeks.**

---

## Part 5 — What to deliberately NOT build (keep simple)

| Skipped feature | Why |
|---|---|
| Epics (multi-quarter roadmap) | 5-15 dev team doesn't need quarter planning UI. A label + saved view is enough. |
| Burndown chart | Vanity metric for small teams. Velocity-tracking via past sprint counts is enough. |
| Capacity planning (PTO calendar, individual capacity) | Overkill. Lead manually balances. |
| Custom workflow builder | Use the 3 hardcoded workflows. Don't let users invent new statuses. |
| Multiple sprint boards per team | One Engineering sprint board is enough. Sub-teams use filters. |
| Story estimation poker | Use Slack / Discord during planning meeting. |
| Inline code review (PR file annotations) | GitHub does this — don't reinvent. |
| Sentry / DataDog auto-bug-creation | V2 — webhook only, no in-app config. |
| CI build status integration | V2 — paste link, don't poll. |
| Resource / utilization reports | Too HR-ish. Avoid. |
| Time tracking | V3 — only if leadership specifically asks for billing-style hours. |
| Roadmap timeline / Gantt | V2 if asked. Most small teams never use it. |

---

## Part 6 — Files to add / modify

### New files (~20 files)

```
client/src/
├── pages/
│   ├── engineering/
│   │   ├── EngineeringHome.tsx          # Lead dashboard
│   │   ├── SprintPlanningPage.tsx       # Drag tasks into sprint
│   │   ├── OnCallRotationPage.tsx       # Settings sub-page
│   │   └── ReportBugButton.tsx          # Cross-team intake trigger
│   └── settings/
│       └── EngineeringSettings.tsx      # Sprint length, on-call config
├── components/
│   ├── task/
│   │   ├── SubtasksSection.tsx          # RESTORED from cleanup
│   │   ├── DependenciesSection.tsx      # RESTORED
│   │   ├── TaskActivitySection.tsx      # RESTORED
│   │   ├── MentionRenderer.tsx          # RESTORED
│   │   ├── GitIntegrationPanel.tsx      # NEW — branch + PR
│   │   ├── BugSeverityRail.tsx          # NEW — color stripe
│   │   ├── StoryPointBadge.tsx          # NEW — sprint estimate
│   │   ├── ReviewerEdit.tsx             # NEW — single-select reviewer
│   │   └── PostmortemChecklist.tsx      # NEW — incident wrap-up
│   ├── editor/
│   │   └── TiptapEditor.tsx             # RESTORED
│   ├── sprint/
│   │   ├── SprintBoard.tsx              # NEW — Kanban + capacity bar
│   │   ├── SprintPlanningBoard.tsx      # NEW — drag from backlog
│   │   └── SprintHeader.tsx             # NEW — sprint name, dates, goal
│   └── shared/
│       └── OnCallBadge.tsx              # NEW — topbar indicator
├── mocks/
│   ├── sprints.ts                       # NEW — sprint data
│   ├── on-call.ts                       # NEW — rotation schedule
│   └── eng-tasks.ts                     # NEW — seed bugs + features
├── types/
│   ├── sprint.ts                        # NEW — Sprint, SprintTask
│   └── on-call.ts                       # NEW — Rotation type
└── lib/
    └── git-url-parser.ts                # NEW — extract repo/PR from URL
```

### Modified files (~12 files)

- `mocks/spaces.ts` — add Engineering space
- `mocks/lists.ts` — add 4 dev lists
- `mocks/statuses.ts` — add 3 new dev workflows
- `mocks/task-types.ts` — add 5 dev task types
- `mocks/custom-fields.ts` — add bug + feature fields
- `types/index.ts` — add Sprint, BugSeverity, ReviewerId, etc.
- `components/task/TaskDetailDrawer.tsx` — gate sections by task type
- `components/task/TaskPropertiesPanel.tsx` — add reviewer / story points rows
- `components/task/CommentsSection.tsx` — add threading
- `pages/home/HomePage.tsx` — add dev-specific cards when user is in eng
- `router.tsx` — add /eng routes
- `lib/mock-api.ts` — add sprint, on-call, git endpoints

---

## Part 7 — Phased rollout

### Phase A — Foundation (week 1-2)
- Engineering space + 4 lists + 5 task types + 3 workflows
- Bug + feature custom fields
- Cross-team "Report a bug" button (uses existing public form infra)
- **Outcome:** other teams can submit bugs; engineering can triage manually

### Phase B — Restore deleted features (week 3-5)
- Bring back subtasks + dependencies + rich text + mentions + activity log
- Threaded comments
- **Outcome:** dev tasks have the depth engineers need

### Phase C — Sprint + Git (week 6-7)
- Sprint system
- Git URL fields + branch name suggester
- Sprint planning page
- Sprint board with capacity
- **Outcome:** engineering plans + ships in cycles

### Phase D — Polish + on-call (week 7)
- On-call rotation
- Postmortem checklist
- Reviewer field
- Dev home page cards
- Deploy / rollback markers
- **Outcome:** team can actually adopt

### Phase E — Pilot (week 8)
- Engineering team uses it for 2 sprints
- Collect feedback
- Fix bugs
- Decide on V2 candidates

---

## Part 8 — Integration with operational system

The Engineering space lives **alongside** the 5 operational spaces. Cross-team flow:

```
Customer reports broken cart
  ↓
CS team gets complaint task in Customer Support space
  ↓
CS rep clicks "Report a bug" → fills form
  ↓
Bug task auto-created in Engineering → Bug Triage list
  ↓
Engineering Lead triages → assigns to dev → on-call if S0
  ↓
Dev creates branch (BUG-1234-cart-fix) → opens PR
  ↓
Pastes PR URL on task → reviewer assigned
  ↓
Merged → status "Ready to Deploy"
  ↓
Deployed → status "Deployed" → QA verifies
  ↓
Status "Verified" → auto-notification to original CS reporter
  ↓
CS rep closes their complaint with "Fixed in deploy v2.4.1"
```

This is **the killer cross-team flow**. Without it, dev team and ops team
talk in Slack and nothing is tracked.

---

## Part 9 — Honest trade-offs

### Things this will get right
- Engineers get the depth they need (subtasks, deps, rich text, mentions)
- Operations team UI stays simple (gating by task type works)
- One source of truth for bug → fix → deploy → verify
- Cross-team handoff is structured

### Things this will get wrong (acceptable)
- Slightly larger bundle (TipTap, mentions, activity = +200KB gzip)
- Two mental models in one app (ops-style and dev-style) — onboarding takes ~30 min explanation
- No real GitHub webhook in V1 — PR status is on-demand fetch
- No deep reporting (velocity is just "count of stories last sprint")

### Things this CANNOT compete with
- **Linear** — faster, prettier, native to engineers. We won't match it.
- **GitHub Projects** — free, Git-native, zero setup.
- **Jira** — enterprise-grade, lots of integrations.

We are choosing "one tool for the company" over "best-of-breed per team."
Trade-off is conscious.

---

## Part 10 — Final recommendation

**Build this if:**
- You want ONE unified system for all 100 employees
- Engineering Lead is OK using a non-Linear/non-Jira tool
- You're willing to invest 7 extra weeks
- You expect long-term ownership (5+ years)

**Don't build this if:**
- Engineering already loves Linear / GitHub Projects — they'll resent the switch
- You need to ship V1 fast (under 12 weeks total)
- Your dev team would rather use Slack + GitHub Issues + spreadsheet (small teams often do)
- Engineering team < 5 people (overhead not worth it — they can stay in GitHub Issues)

If you're unsure, **ship V1 operational system first, run it for 1 month, then decide.** By then the dev team will have opinions, and you'll know whether the unified-tool dream is worth 7 weeks.

---

*This document is the source of truth for dev-team features. If a feature isn't in Part 3, it's out of scope. If a feature is in Part 5 ("don't build"), do not propose it. Add to Part 11 if scope changes.*

## Part 11 — Change log (track scope changes here)

| Date | Change | Reason |
|---|---|---|
| 2026-05-27 | Initial draft | User chose Path A (extend system) over Path B (separate dev tool) |
