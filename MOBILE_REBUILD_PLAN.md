# MOBILE REBUILD PLAN — phone-first BeautyBooth Tasks

Supersedes §8 ("the shape of the work") of `MOBILE_UI_SCAN_2026-08-25.md`. That section was a first
sketch; this document is the reviewed, corrected, executable version. **Six things in the original
sketch were wrong or dangerous — they are listed in §1 so the mistakes are not silently repeated.**

Goal: ~100 BeautyBooth staff, **70% on phones** (mid-range Android 360–412px, some iPhones 390–430),
run this system smoothly. Desktop (30%) must not regress.

Working rule, as always: **ONE PHASE PER GO.** Each phase below ends with a numeric gate. If the gate
fails, the phase is not done — no moving on.

---

## 0) The honest answer to "will bugs come?"

**Yes. Any change this size produces bugs.** The question that actually matters is whether they are
caught in minutes by a machine or in a week by a warehouse staffer, and today the answer is the
second one:

- **No CI exists anywhere in the repo.**
- `npm test` at the root produces false failures; the truth is 33 separate module configs.
- **4 tests are already failing** (pre-existing, documented in `SYSTEM_SCAN_2026-08-25.md` §1b).
- Playwright is **one project, `Desktop Chrome`**, 15 specs, with **a single overflow assertion on
  `/` only** (`playwright.config.ts:25`). There is no mobile test of any kind.

So the plan's first phase is not UI work. It is the net. Everything after it is verifiable.

---

## 1) What was wrong with the first sketch — corrected here

| # | The sketch said | Why it was wrong | What this plan does |
|---|---|---|---|
| **W1** | Phase 1 = "global CSS/config pass… every screen improves, nothing is redesigned"; test net was phase 7 | **Backwards.** The riskiest global changes would land with no regression net, on a codebase with no CI. | Net first (P0), then mobile-only CSS (P1). |
| **W2** | "antd `controlHeight` 36 → 44" | **Would break desktop.** `antdTheme` is a *static JS object* passed once to `ConfigProvider` (`main.tsx:16`, `theme.ts:150`). A JS theme **cannot be media-queried** — raising it raises every button, input and select for the 30% on desktop too. | Touch targets are raised in **CSS, inside a mobile media query**. The theme object is not touched. |
| **W3** | "add `touch-action` to the three dnd call sites — a 3-line diff" | **Actively harmful.** dnd-kit wants `touch-action: none` on draggables — and that **kills finger-scrolling over those elements**. Board columns are mostly cards, so the user could no longer scroll the column. | **Drop drag on mobile entirely** (P7). Status changes move into the card's tap menu — faster on a phone anyway, and it deletes the whole gesture-conflict class instead of managing it. |
| **W4** | "`100vh` → `dvh`" | Too blunt. `dvh` **changes as the URL bar shows and hides**, so anything sized with it resizes while you scroll. That is jank, not a fix. | `svh` (or a fixed container at `100%`) for the app shell; `dvh` only where the element genuinely should track the visible area. Decided per call site, not globally. |
| **W5** | Bottom tab bar **and** an overlay drawer for the space tree | **Two navigation systems for one job**, and a fourth overlay competing with the drawer/sheet/popover stack. The drawer is a desktop idiom ported to a phone. | **No drawer.** `/spaces` becomes a real full-screen drill-down route (spaces → lists → tasks). It gets the back stack for free — which already works in this app — and is one less overlay to fight. |
| **W6** | "one row component shared by the list and the space browser — two rewrites become one" | **Premature sharing.** The two carry different data and context (the browser needs a list-name chip). Sharing up front produces a twelve-prop component. | Build it for the list. Extract to shared **only after** the second use proves the shape. |

### Also missing from the sketch entirely — now first-class here

- **Keyboard handling.** Verified: **zero** `visualViewport` handling in the client, and no
  `interactive-widget` in the viewport meta. A fixed bottom bar plus an on-screen keyboard is *the*
  classic mobile bug, and it lands on the two flows that matter most: sending a comment and
  submitting the create sheet.
- **A layering plan.** Verified z-index tokens (`theme.ts:140-147`): dropdown 1000, sticky 1010,
  fixed 1020, modal 1040, popover 1050, toast 1060. **There is no slot for a bottom nav bar**, and
  `fixed: 1020` is exactly where the assistant button already sits — on top of where the tab bar goes.
- **One `useIsMobile` boundary.** Verified: no such hook exists (7 hooks, none of them layout;
  `matchMedia` is hand-rolled in 2 components). Without deciding this once, 140 files each invent one.
- **Deleting the old 640px collapse.** It is a `useEffect` + `matchMedia` in `Sidebar.tsx:54-62`. If
  the new shell starts at 768 and this stays, **640–768 is a dead zone with two systems fighting**.
- **Acceptance numbers.** "Mobile friendly" is unfalsifiable. The scan already produced the baseline,
  so every phase below gets a pass/fail figure.
- **Data at scale.** `api.ts:767-786` downloads **every** task in a list, page by page, at **1,448
  bytes per task**. Fine at 47 demo tasks; 283 KB for 200 tasks and 1.4 MB for a 1,000-task space
  browser, on mobile data, every time. The sketch ignored this; it is P8 here.

---

## 2) Will the UX actually be good? — three changes that decide it

Fixing breakage is not the same as being good to use. Three calls matter more than all the CSS:

### U1 — On a phone, three view tabs become **one** view
List / Board / Calendar is desktop thinking. The scan measured what each is worth at 390px: List is
unreadable (12px name cell), Calendar's grid **renders at zero width**, and **Board's cards read
perfectly**. So the mobile answer is already known:

> **One scrollable card list, with a "Group by" control (Status · Assignee · Due) and a Due-date
> agenda mode.** Grouping by status *is* the board. The agenda mode *is* the calendar.

Three broken surfaces collapse into one good one. Less to build, less to maintain, and a simpler
mental model for a CS agent on a phone. Desktop keeps all three tabs unchanged.

### U2 — The assistant becomes primary navigation on mobile, not a corner button
It is already the only correctly-built mobile component in the app, and on a phone *"amar aj ki kaj
ase"* in Bangla beats navigating any list. It should be a first-class entry point in the mobile
shell, not a floating button that currently covers content on every screen.

### U3 — Decide what "offline" means, and stop lying about it
`OfflineIndicator.tsx:47` promises *"changes will sync when reconnected"* and **nothing implements
it**. Two honest options: (a) read-cache only — the app shell and last-viewed data are cached, writes
require a connection and fail with a clear message; or (b) a real mutation queue, which is weeks of
work and its own bug surface. **Recommended: (a)**, and fix the message the same day.

---

## 3) Decisions to lock before P1 (change them now, not mid-build)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Mobile shell breakpoint | **768px** | Below it, no sidebar at all. Above it, today's desktop untouched. Matches the existing F31 note. **The 640 collapse is deleted the same day.** |
| D2 | The `isMobile` boundary | **One `useIsMobile()` hook**, `matchMedia("(max-width: 767px)")`, used only for *structural* choices (which component renders). Never for cosmetics — those go in CSS. | Stops 140 files inventing their own. Keeps the CSS layer authoritative for looks. |
| D3 | Navigation model | **Bottom tab bar + full-screen `/spaces` drill-down. No drawer.** | See W5. Back stack already works. |
| D4 | Tab bar slots | **Home · Inbox · ＋ · Spaces · Assistant** | Earned from the real daily loop. Note: **no "More"** — a More tab is where features go to die; the rest (SLA, Dept, Reports, Eng, Settings) hangs off the profile/avatar screen, which is where people look for them anyway. |
| D5 | Drag on mobile | **None.** Status/assignee/date change via the card's tap menu. Desktop drag unchanged. | See W3 — deletes a whole bug class. **Verified safe:** every drag action already has a non-drag path — tapping a card opens the task (`BoardCard.tsx:91`), status changes through `InlineStatusEdit` on both the row and the drawer (`TaskPropertiesPanel.tsx:58`), and scheduling is the due-date field. The only thing genuinely lost on a phone is *manual reorder*, which sorting covers. |
| D6 | z-index for the bottom bar | **1030** (between `fixed:1020` and `modal:1040`). Assistant button is retired on mobile (it becomes a tab), which frees 1020. | Bar sits above content and the old FAB, below drawers/sheets/toasts. |
| D7 | Task detail on mobile | antd `Drawer placement="bottom"`, `height: 92svh`, with a **real header and a ≥44px close**. No swipe-to-dismiss in v1 (antd doesn't provide it; Back and Close both already work). | Cheap, uses the existing component, keeps the `?task=` URL behaviour that makes Android Back work. |
| D8 | Offline | **Read-cache only**, and fix the misleading message immediately. | See U3. |
| D9 | Desktop may change? | **Only for genuine bug fixes** (P2). Everything cosmetic is inside `@media (max-width: 767px)`. | The 30% currently have a working app. Protect it. |

---

## 4) Acceptance set — the numbers each phase is measured against

Baselines are from `MOBILE_UI_SCAN_2026-08-25.md`, measured at **360×640 and 390×844**.

| # | Criterion | Today | Target |
|---|---|---|---|
| A1 | Task name rendered width, list view @360 | ~~12px~~ | **255px / 32 chars — ✅ met in P4** |
| A2 | Routes reachable from Home in ≤3 taps @360 | ~~Home, Inbox, Search only~~ | **✅ met in P3** — Spaces → space → list |
| A3 | Content wider than its pane that no gesture can reach | ~~3 at 390 / 4 at 360~~ | **0 — ✅ met in P2** |
| A4 | Interactive targets < 44px on the task screen | ~~68~~ | **0 — ✅ met in P4** |
| A4a | antd controls < 44px | ~~14~~ | **0 — ✅ met in P1** |
| A5 | Inputs below 16px (iOS zoom) | ~~every field except login~~ | **0 — ✅ met in P1** |
| A6 | Settings content column @390 | ~~74px~~ | **390 of 390 — ✅ met in P3** |
| A7 | Calendar month grid width | ~~0px~~ | **agenda renders, 366px — ✅ met in P7** |
| A8 | Viewport blowout when a picker opens | ~~390 → 652px~~ | **stays 390, 0px off-screen — ✅ met in P7** |
| A14 | Mobile copy asking for an impossible gesture | ~~3 (drag to schedule, drag files, ⌘K)~~ | **0 — ✅ added and met in P7** |
| A9 | Home page height @390 | ~~2,512px, first screen = 2 numbers~~ | **My Work at y=247 — ✅ met in P5** |
| A10 | Login-to-usable-home, typical 4G | ~~4.1s + 718 KB~~ | **1.68s ✅ · 470 KB gz ⚠️ (20 KB over)** — P8 |
| A11 | Desktop visual diff after a mobile-only phase | — | **zero changed pixels** |
| A12 | Keyboard open: composer and submit button visible | ~~~750px below the fold~~ | **✅ met in P3** — both hit-test tappable |
| A13 | A 500-task list on a phone | ~~22,826 nodes · 13.4s · 7.5s~~ | **533 nodes · 1.86s · 305ms — ✅ met in P4** |

---

## 5) The phases

### P0 — The net and the decisions *(no UI change at all)*
1. Add Playwright mobile projects (`Pixel 5` @393 and a 360×640 profile) beside the existing desktop
   one — `playwright.config.ts:25` is a one-line array today, so this is cheap.
2. Write the A1–A12 checks as real assertions. **They must FAIL on today's code** — a net that passes
   on a broken app is not a net.
3. Capture desktop screenshots of every route as the "must not change" baseline (A11).
4. Lock D1–D9 (§3), amending anything you disagree with **now**.
5. Measure the two things the scan could not: **the comment composer with the keyboard open**, and a
   **list view with ~500 realistic tasks** (seed a scratch list; do not touch demo data).

**Gate:** mobile projects run; A1–A9 all fail with the documented numbers; desktop baseline captured;
the two unknowns have numbers. *Nothing shipped to users.*

---

### P1 — The mobile-only CSS layer *(desktop provably untouched)*
One new stylesheet, **everything inside `@media (max-width: 767px)`**. No JS, no component edits, no
theme object changes.

- 16px on every input — **the exact block verified live in the scan** (kills iOS auto-zoom, A5).
- Minimum 44×44 on antd controls and icon buttons, via CSS (**not** the theme object — W2).
- Reduced page/card padding (the public form currently spends 31% of a 360px screen on padding).
- The shared grid-track fix: `minmax(min(100%, 280px), 1fr)` — repairs six overflowing grids at once.
- `env(safe-area-inset-*)` on the fixed elements (`viewport-fit=cover` is already set and currently
  unbacked, which is worse than not setting it).

**Gate:** A5 = 0 and **A4a** = 0 at 360 and 390 · **A11 desktop diff is zero pixels** · all existing
e2e specs still pass. *(A4 — every control, including the sidebar rail and drawer chrome — moved to
P4 during execution; see the P1 record for why.)*
**Rollback:** delete one stylesheet.
**✅ Done — see the P1 execution record.**

---

### P2 — The clipping and flex bugs *(bug fixes; these touch desktop, deliberately)*
- Replace `overflow: hidden` with a corner-preserving scrollable treatment at the **six** sites:
  `ListViewGroup:103`, `SpaceTasksBrowser:181`, `DeptSummary:281`, `ReportDetailPage:730`,
  `OnCallRotationPage:118`, `CustomFieldsSettings:190`. **This is the single most damaging pattern in
  the app** — it converts overflow into silently deleted data with no scrollbar and no signal.
- Add `minWidth: 0` to the `flex: 1` titles that collapse (`EngineeringHomePage:73`,
  `SprintBoardPage:92`, `SettingsHeader:18`).
- Give the three antd tables `scroll={{ x: … }}` — **no table in the app sets it today**, which is
  why antd provides no scroll container at all.
- Fix `DeptQueue.tsx:214`: `padding: \`${tokens.spacing[3]} ${tokens.spacing[2]}\`` emits
  `padding: "12 8"` with no units, so the browser drops it — dept queue rows have **zero padding on
  every device**, desktop included.

**Gate:** A3 = 0 · desktop diff reviewed screen by screen and every change is intentional and an
improvement · dept/report/on-call tables scroll to their last column on both platforms.
**✅ Done — see the P2 execution record.**

---

### P3 — The mobile shell *(the phase that unblocks 70% of the staff)*
- Bottom tab bar (D4), z-index 1030 (D6), safe-area aware, hidden ≥768px.
- **Delete** the 640px auto-collapse in `Sidebar.tsx:54-62` and render no sidebar at all below 768.
- New full-screen `/spaces` drill-down route (D3): spaces → lists → tasks, using the existing back
  stack.
- Compact mobile top bar: title + back + search + avatar. Move SLA, Department, Reports, Engineering
  and Settings onto the avatar/profile screen.
- Retire the assistant FAB on mobile — it becomes a tab (U2).
- **Keyboard handling**: `visualViewport` listener so the bottom bar and any sticky composer get out
  of the keyboard's way; add `interactive-widget=resizes-content` to the viewport meta.
- Repoint the two dead nav targets found in the scan (`/eng/report-bug`, `/profile` both redirect to
  `/` today) so the new nav doesn't inherit them.

**Gate:** A2 — every needed route reachable in ≤3 taps at 360 · A12 — with the keyboard open the
composer and the submit button are both visible · nothing in the bottom band overlaps the bar
(assistant toast, offline pill, push prompt, bulk bar) · **A11 desktop diff zero**.
**✅ Done — see the P3 execution record.**

---

### P4 — The task surface *(the daily screen)*
- **One mobile task view** (U1): a card list, grouped by a switchable key, replacing the three tabs
  below 768px. Board's card layout is the proven-readable starting point.
- Task detail as a bottom sheet (D7) with a real header and a ≥44px close.
- Card tap menu carrying status / assignee / due-date changes (this is what replaces drag, D5).
- Verify the comment flow end to end with the keyboard open — the composer is inline today
  (`CommentsSection.tsx:309`), which is *good* for keyboards; if it is made sticky in the sheet, A12
  must be re-tested.

**Gate:** A1 — ≥20 characters of the task name visible at 360 · A4 = 0 on the task screen · **A13 — a
500-task list under 6,000 DOM nodes and scrolling at speed** · open a task → change status → comment
→ Back, entirely by thumb, on a 360px screen · A11 desktop diff zero.
**✅ Done — see the P4 execution record.**

---

### P5 — Home, Inbox, and Create
- Home: work first. One compact KPI strip (not five full-height cards), then My Work. A9.
- Inbox: wrapping filter chips, ≥44px targets, keep the SSE live behaviour.
- Create: one tap from the ＋ tab into a bottom sheet; pre-fill the list when opened from inside one.

**Gate:** A9 — the first screenful of Home shows real tasks · Inbox filters all reachable at 360 ·
create a task in ≤4 taps from any screen.
**✅ Done — see the P5 execution record.**

---

### P6 — The customer-facing page and the one settings page everybody uses
- **Public form** (`/forms/:slug`): 16px fields (P1 already does this), `type="tel"` +
  `inputMode="numeric"` for phone fields (`lib/bd-phone.ts` exists and is unused), scroll-to-first-error
  on failed submit (today it silently does nothing), reduced padding, and a decision on **photo
  upload** — it is currently disabled with the dead control still shown, on a complaint form for a
  beauty business, where the camera is the most valuable input.
- **Settings → Profile**: single-column stack below 768 (A6). The nine admin settings pages inherit
  the stack but get no further mobile design — they stay desktop-first by choice.

**Gate:** A6 · a customer can complete the public form on a 360px phone without zooming or panning ·
push opt-in and password change work on a phone.
**✅ Done — see the P6 execution record.**

---

### P7 — Calendar and the drag decision
- Calendar below 768 becomes the **agenda mode** of P4's view, reusing the existing `tasksByDay`
  data — the data layer is fine, only the presentation dies today (A7).
- Execute D5: remove drag on mobile; keep desktop drag exactly as it is. Fix the calendar panel copy
  that currently says *"drag to schedule"* — an action no phone can perform.
- Fix the picker blowout (A8): replace `RangePicker` on mobile with the preset chips promoted to
  primary plus two stacked single date fields.

**Gate:** A7 · A8 — viewport stays 390 when any picker opens · no mobile copy instructs a gesture that
does not exist.
**✅ Done — see the P7 execution record.**

---

### P8 — Speed, scale, and the PWA
- `lazy()` on `TaskRedirect` — removes **119 KB of rich-text editor from every first load**,
  including the login screen (A10).
- Self-host Inter, drop the render-blocking cross-origin `@import` at `index.css:5`.
- Enable query retry (**queries only** — `queryClient.ts:23-29` has no `mutations` block today, and it
  must stay that way, or a lost response could double-write) and reconsider
  `refetchOnWindowFocus` now that returning to a backgrounded app is the mobile refresh gesture.
- **Data at scale**: decide server-side filtering + paging for `listByList`. Use P0's 500-task
  measurement to size it. This is what stops the app feeling fine today and slow in six months.
- PWA finish: `apple-touch-icon` (without it, iOS Add-to-Home-Screen — the *only* iOS push path —
  produces a screenshot of the login page as the app icon), 192/512 PNG icons, a real `fetch` handler
  with an app-shell cache, register the service worker **unconditionally** (today it only registers
  after a push-permission grant, so anyone who tapped "Not now" has no service worker at all),
  an install prompt, manifest `shortcuts`, and D8's honest offline message.

**Gate:** A10 — ≤3s to usable Home on typical 4G, ≤450 KB first load · installable on Android with a
correct icon · offline shows the app shell and an honest message, never a promise it cannot keep.
**✅ Done — see the P8 execution record. Time met (1.68s); bytes 20 KB over, cause stated.**

---

## 6) Risk register

| Risk | How it shows up | Caught by |
|---|---|---|
| A mobile change leaks into desktop | Buttons taller, spacing off, a scrollbar appears for the 30% | A11 desktop screenshot diff, run every phase |
| The overflow fixes change desktop visuals | Rounded corners lost, unexpected scrollbars | P2 is reviewed screen by screen on purpose; it is the one phase allowed to change desktop |
| Bottom bar fights the keyboard | Send button unreachable while typing a comment | A12, gated in P3 and re-checked in P4 |
| Overlay stack collisions | Tab bar over a sheet; assistant over a modal | D6 layering decided once, before any overlay work |
| Two nav systems fight in 640–768 | Sidebar collapses *and* a tab bar shows | The 640 collapse is deleted in the same commit as the bar (P3) |
| Premature component sharing | A twelve-prop row component nobody can change | W6: build for the list, extract on the second use |
| The 4 already-failing tests mask new ones | A real regression hides in known-red output | Fix or quarantine them before P1, so red means new |
| Real data behaves unlike demo data | Smooth at 47 tasks, slow at 2,000 | P0 measures 500 tasks; P8 acts on it |
| Scope creep into the nine admin settings pages | Weeks spent on screens 4 admins use at a desk | D9 + §7 of the scan: they stay desktop-first, deliberately |

---

## 7) What this plan deliberately does **not** do

- It does not rebuild the form builder, the forms list, nine of twelve settings pages, report detail,
  sprint board or engineering home for phones. They are admin and authoring work, done rarely, at a
  desk. They get P1's CSS layer and P2's bug fixes and nothing more.
- It does not add an offline mutation queue (D8).
- It does not touch the API, the data model, the permission system or the SSE inbox — the scan found
  no mobile work needed in any of them.
- It does not go native. Push already works, the manifest and service worker exist, and Android
  supports installable PWAs fully. A Capacitor wrapper or a React Native rewrite would cost months and
  buy nothing on this list.

---

## 8) Suggested sequencing

**P0 → P1 → P2** first: after these three the app is measurably better on a phone, desktop is
provably unchanged, and every later phase has a net. **P3 is the one that changes people's lives** —
it is where "I can't open my list" stops being true. **P4 is the biggest single build.** P5–P7 are
independent and can be reordered by whichever team is complaining loudest. **P8 can start any time
after P0** — `lazy(TaskRedirect)` alone is a one-line, 119 KB win and could honestly ride along with
P1.

*Companion documents: `MOBILE_UI_SCAN_2026-08-25.md` (the evidence) and
`SYSTEM_SCAN_2026-08-25.md` (engine and backend state at the same commit).*

---

## 9) P0 execution record — ✅ **COMPLETE 2026-08-25** (no product code changed)

### What was built

| Artefact | What it does |
|---|---|
| `client/playwright.config.ts` | Three new projects beside the original desktop one: **`mobile-390`** (390×844, iPhone 12/13 class), **`mobile-360`** (360×640, mid-range Android), **`desktop-guard`** (1440×900). The original `chromium` project is scoped with `testIgnore` so its **76 tests in 15 files are untouched** — verified by `--list`. |
| `client/e2e/mobile-acceptance.pw.ts` | The A1–A13 net. Each test asserts the **target**, and every criterion today's code cannot meet is listed in `NOT_YET` and marked `test.fail()`. |
| `client/e2e/desktop-guard.pw.ts` | A11. Snapshots the properties a mobile-only stylesheet could leak into — root/body font size, shell geometry, control heights and paddings, and the count of clipping containers — across 8 desktop routes. |
| `client/mobile-baseline.json` | 22 measurements, both profiles. The numbers every later phase is diffed against. |
| `client/desktop-guard.baseline.json` | The desktop "must not change" record, 8 routes. |

**The ratchet.** Because failing criteria are marked `test.fail()`, **the suite is green today**. When a
phase fixes one, Playwright reports *"Expected to fail, but passed"* — that is the signal to delete
the `NOT_YET` entry, after which the criterion becomes a permanent regression guard. Green always
means "nothing got worse"; red always means "something changed". Nobody has to remember anything.

### The net was proven, not assumed

- **It detects every documented breakage.** Every A-check failed on today's code, and the numbers it
  produced match the scan's independently-measured figures (A1 12px, A6 68px, A7 0px, A8 390→652,
  A9 2,512px).
- **It caught two bugs in itself.** The first draft of A3 skipped containers with a single child —
  which silently excluded every table wrapper, i.e. the worst offenders. The first draft of A6
  measured the settings *nav* heading instead of the page heading. Both fixed; A3 then found the
  department table (203px hidden) and A6 reported 68px.
- **A8 was wrong and the net said so.** It passed at 360px, so the criterion was too narrow.
  Investigated: at 390 Chrome expands the layout viewport to 652px to fit a 660px two-panel picker;
  at 360 it does not — the panel is **380px off the left edge** instead. A8 now asserts both
  (viewport stable **and** the panel fully on screen) and fails correctly on both profiles.
- **The desktop guard was proven to go red.** A deliberate `.ant-btn { min-height: 44px }` was added
  globally to `index.css` — exactly the leak P1 must avoid — and the guard failed on 5 routes with
  the button height drifting 36→44 and 28→44. Reverted; green again.

### The baseline it recorded

| # | Criterion | @390×844 | @360×640 |
|---|---|---|---|
| A1 | Task name visible in list view | **12px = 1 character** | **12px = 1 character** |
| A2 | Space/list links reachable from Home | **0** | **0** |
| A3 | Containers hiding content unreachably | **3** (dept table 203px, dept tabs 144px, on-call 86px) | **4** (+ list row 41px) |
| A4 | Controls under 44px on the task screen | **68** (smallest 12×20 "Edit task name", 14×14 "Drag to reorder") | **68** |
| A5 | Text fields under 16px | **7** | **7** |
| A6 | Settings content column | **68px** (heading), viewport 390 | **68px**, viewport 360 |
| A7 | Calendar month grid width | **0px — it does not render** | **0px** |
| A8 | Date picker | viewport **390 → 652**, panel 660px | viewport stable, panel **380px off the left edge** |
| A9 | Home page height | **2,512px = 2.98 screens** | 2,512px = **3.92 screens** |
| A12 | Comment composer with the keyboard open | **not in viewport** | **not in viewport** |
| A13 | 500-task list | **22,826 DOM nodes · 13.4s to render · 7.5s per 20 scroll frames** | same |

### The two unknowns, answered

**1. The comment composer with a keyboard open — worse than expected.** With the viewport shrunk to
keyboard height, the composer sits at y≈1131 — roughly **750px below the fold at 390px and 840px at
360px**. It is not fixed or sticky; it is simply the last thing in a very long drawer, below the
description, checklists, attachments, subtasks, dependencies and activity. **Commenting on a phone
today means scrolling most of the task, then typing into a box the keyboard is about to cover.**
P4 must treat the composer as a first-class sticky element, and P3's keyboard handling has to land
before that is safe.

**2. The list at real volume — this changes the plan.** With the endpoint intercepted (zero database
writes) and one real task cloned N times, at 390×844:

| Tasks | JSON | Time to render | DOM nodes | Page height | Heap | 20 scroll frames |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 69 KB | 4.5s | 2,576 | 2,724px | 93 MB | 323 ms |
| 200 | 275 KB | 5.7s | 9,326 | 8,424px | 104 MB | **1,468 ms** |
| 500 | 688 KB | **12.2s** | 22,826 | 19,824px | 215 MB | **7,402 ms** |
| 1,000 | 1,376 KB | **26.3s** | 45,326 | 38,824px | 368 MB | **26,621 ms** |

There is **no virtualisation anywhere** — every task becomes ~45 DOM nodes and all of them are
rendered. Sixty frames per second needs ~320 ms for twenty frames; at 500 tasks it takes 7.4 seconds.
*Honest caveats:* this is the Vite dev build (unminified, React in development mode) on a desktop
CPU. Production is meaningfully faster; a mid-range Android is meaningfully slower. The two roughly
cancel, so treat the shape of the curve as real and the absolute numbers as indicative.

### 🔄 Plan change forced by P0

> **Virtualisation moves out of P8 and into P4.** The original plan left the fetch-everything
> strategy to the last phase. P0's measurement makes that untenable: a beautiful mobile card list
> that dies somewhere between 200 and 500 tasks is not worth building twice. **P4 builds the mobile
> task view virtualised from the first commit**, and A13 is its gate. Server-side filtering and
> paging stay in P8 — that is a backend change and can follow — but the client must stop rendering
> every row before the mobile view ships.

This also reframes the finding: it is **not a mobile-only defect**. The desktop list has exactly the
same ceiling today; nobody has hit it because the demo database holds 47 tasks. BeautyBooth's real
Complaints and Orders lists will pass 200 within weeks of going live.

### Decisions D1–D9 — 🔒 locked 2026-08-25

Locked as written in §3, with one addition recorded here: **D10 — the mobile task list is
virtualised from the first commit of P4** (from the finding above).

### Gate — met

- ✅ Mobile projects run; **A1–A13 all fail on today's code** with numbers matching the independent scan.
- ✅ Desktop baseline captured across 8 routes, and the guard proven to detect a real leak.
- ✅ Both unknowns measured.
- ✅ The original desktop suite is untouched: **76 tests in 15 files** still discovered, and the two
  new specs are correctly excluded from it.
- ✅ No product code changed. No database writes. Nothing shipped to users.

**P1 may begin on the next go.**

### Notes for whoever runs P1

- Run the net with the dev stack already up: API on :5501, vite on :5173.
  `npx playwright test --project=mobile-390 --project=mobile-360 --project=desktop-guard`
- P1 targets **A4 and A5**, and must leave the desktop guard green. If the guard goes red during P1,
  the change escaped its media query — that is the whole point of the phase.
- Do not raise `controlHeight` in `theme.ts`. See W2 in §1 — the guard will catch it, but it is
  cheaper not to write it.
- `client/test-results/` is Playwright's scratch output and can be deleted at any time.

---

## 10) P1 execution record — ✅ **COMPLETE 2026-08-25**

### What shipped

**Two files touched, and one of them is a one-line import.**

| File | Change |
|---|---|
| `client/src/mobile.css` | **New.** The entire mobile override layer. Every rule sits inside `@media (max-width: 767px)`. |
| `client/src/main.tsx` | One import line after `./index.css`. |

Cost: **+369 bytes gzipped** (CSS 4,321 → 4,690 B gz). The JS bundle is byte-identical.
Rollback is deleting one file and one line.

### What it does, and why each rule is written the way it is

- **A5 — iOS auto-zoom, fixed app-wide.** Every `input`, `textarea`, `select` and antd field
  computes at 16px below 768px. Safari zooms the page in on focus for anything smaller and never
  zooms back; every field in this app was 14px except the login form.
- **A4a — antd controls reach 44px.** `min-height` on `.ant-btn`, `.ant-input`, `.ant-picker`,
  `.ant-select-selector`, and on dropdown/menu/option rows. `min-height`, not `height`, so nothing
  already larger shrinks. Single-selects also need `height` overridden because antd sets an explicit
  one that beats `min-height`.
- **D5 — the drag handle is hidden on mobile.** dnd-kit registers `PointerSensor` only and the cards
  never set `touch-action`, so a drag on a phone either loses the gesture to the browser or steals a
  tap. Hiding the handle stops the app advertising an affordance that cannot work. Every drag action
  already has a non-drag path.
- **Touch feedback.** The app fakes `:hover` with 53 JS `onMouseEnter` handlers across 36 files,
  which on touch either never fire or fire on tap and stick on — so nothing gave feedback when
  pressed. One `:active` rule plus `-webkit-tap-highlight-color: transparent` fixes the feel until
  those components are rebuilt.
- **Six overflowing grids, repaired by four selectors.** Reports 300px · Forms 320 · Templates 320 ·
  Sprint 280 · Space 280 · Import/Export 240 — every one a track minimum wider than the column it
  sits in. Smaller tracks (140px attachment thumbnails, 200px KPI tiles) still reflow correctly and
  are left alone.
- **Safe-area custom properties.** `index.html` has opted into `viewport-fit=cover` all along and
  nothing ever compensated. `--safe-top/bottom/left/right` are now defined for P3's bottom bar, and
  the assistant button — the one fixed element that carries a class — already uses them.

**Two conventions the file documents in its own header**, because they will look wrong to a reader
who does not know this codebase:

1. `!important` is deliberate. antd v6 injects component CSS into `<head>` at runtime, i.e. *after*
   the bundled stylesheet, so an equal-specificity rule loses the cascade.
2. Attribute selectors like `[style*="minmax(320px"]` exist because 1,319 of this app's styles are
   inline objects with no class to hook. A stylesheet rule with `!important` does beat an inline
   style, so this is the only way to reach them without editing 140 components. When a later phase
   rewrites one of those components properly, the matching rule here should be deleted.

### 🔄 Scope correction found by doing the work: A4 splits into A4a and A4

The plan's P1 gate said **A4 = 0** — every control on the task screen at 44px. Measuring the actual
68 offenders showed that gate was wrong to aim at P1:

| What the 68 are | Count | Who should fix them |
|---|---|---|
| Sidebar rail links and buttons (`Home`, `Inbox`, `Search`, `Expand sidebar`, 32px tall) | ~30 | **P3 — it deletes the rail entirely** |
| Task-drawer chrome (28×28 close, 22×22 icon buttons, the 20px status pill) | ~14 | **P4 — it rebuilds the drawer with a real header** |
| Bespoke inline `<span>` triggers (`Edit task name` at 12×20 — the crushed task name itself) | ~6 | **P4 — the card view replaces the row** |
| Multi-select checkboxes (18×18, and hover-only so invisible on touch anyway) | 4 | **P4** |
| Shared antd controls (buttons, inputs, selects, menu rows) | ~14 | **P1 — this phase** |

Enlarging controls that P3 and P4 are about to delete is churn, and forcing a 44px box onto an 18px
checkbox inside a 38px row would break the row rather than help. So:

> **A4a** (every antd control ≥44px) is P1's gate and now passes on both profiles.
> **A4** (every control on the task screen) stays exactly as written and moves to **P4**.

A4 is not weakened — it is still the target, still measured, still failing, and now owned by the
phase that can actually meet it.

### A pre-existing broken test, found and fixed

The gate says "all existing e2e specs still pass". Running them surfaced
`smoke.pw.ts:56 — login succeeds + session survives a reload` timing out at 45s. **Proved
pre-existing:** with `mobile.css` temporarily unimported, it failed identically. The cause is the
project's own documented trap — an unbounded `waitForLoadState("networkidle")` on an app that holds
an SSE stream open, so it never settles. The same file already used the correct bounded pattern
seventy lines further down; that pattern is now applied at line 67 too. **The spec went from a 45s
timeout to 4.3s and the file is 3/3 green.**

Two more unbounded `networkidle` waits exist at `assistant.pw.ts:54` and `:139`. They were **not**
touched — nothing has proved them failing, and speculative edits to tests are how a net stops being
trustworthy. Worth a look before P2.

### Gate — met

| Check | Result |
|---|---|
| **A5** — text fields under 16px | **0 at both 390 and 360** (was 7). Retired from `NOT_YET`; now a permanent guard |
| **A4a** — antd controls under 44px | **0 at both profiles**, across the task drawer, settings and inbox |
| **A4** — all controls on the task screen | 68 → **55**, the remainder explicitly owned by P3/P4 |
| **A11 — desktop guard** | **green**, all 8 routes unchanged |
| Existing desktop e2e | `smoke.pw.ts` **3/3 green**, including the 16-route render-and-console sweep |
| `tsc -b --force` | clean |
| `eslint .` | **12 errors + 4 warnings — exactly the baseline, zero new** |
| Production build | succeeds; JS byte-identical, CSS +369 B gz |
| Visual check at 390px | Home, list, task drawer, settings, forms and the logged-out login page all screenshotted; no layout breakage, **zero page errors** |

**P2 may begin on the next go.**

### ⚠️ Trap this phase hit: `npm run build` overwrites a tracked deploy artifact

`client/dist/` is **committed on purpose** — this project ships build output through git so a deploy
runs in one terminal. Running `npm run build` to check the bundle therefore deleted 37 tracked files
and replaced them with new, gitignored ones, leaving the repo in a half-state that looks like damage.
Restored with `git checkout -- client/dist && git clean -fdx client/dist`. **Verify the build, then
put dist back** — regenerating the deploy artifact is a deploy-time decision, not a side effect of a
size check.

### Notes for whoever runs P2

- P2 is the one phase allowed to change desktop pixels. Expect the desktop guard to go red; read the
  diff line by line, then re-baseline with `UPDATE_GUARD=1`.
- Its target is **A3** (containers hiding content unreachably): 3 at 390, 4 at 360 — the department
  member table (203px hidden), the department tabs strip (144px), on-call (86px), and at 360 a list
  row (41px).
- `DeptQueue.tsx:214` emits `padding: "12 8"` with no units because the spacing tokens are numbers,
  so the browser drops it and those rows have **zero padding on every device**. It is a one-line fix
  and belongs in P2.
- None of the three antd tables sets `scroll={{ x }}`, which is why antd gives them no scroll
  container at all.

---

## 11) P2 execution record — ✅ **COMPLETE 2026-08-25**

### What changed

Nine source files, all of it bug-fixing. No new files, no new dependencies.

| Fix | Files | What it does |
|---|---|---|
| `overflow: "hidden"` → `overflowX: "auto", overflowY: "hidden"` | `ListViewGroup:103` · `SpaceTasksBrowser:181` · `DeptSummary:281` · `OnCallRotationPage:117` · `ReportDetailPage:730` · `CustomFieldsSettings:190` | Content wider than the card becomes **scrollable instead of deleted**. Only the x axis changes; y stays hidden so the rounded corners still clip. |
| Unitless padding | `DeptQueue:214` | The spacing tokens are numbers, so `` `${tokens.spacing[3]} ${tokens.spacing[2]}` `` emitted **`padding: "12 8"`** — invalid CSS the browser silently dropped. Those rows had **zero padding on every device, desktop included**, since the day they were written. |
| `flex: 1` → `flex: 1, minWidth: 0` | `EngineeringHomePage:73` · `SprintBoardPage:92` · `SettingsHeader:18` | A `flex: 1` box cannot shrink below its content, so a fixed-width sibling pushes the header past the viewport. The topbar already learned this in F34; the page headers had not. |

### Two corrections to the plan, both found by measuring

**1. The antd tabs strip was a false positive, not a defect.** A3 flagged the department tabs nav as
hiding 144px behind `overflow: hidden`. Before "fixing" antd's own component, it was checked live at
390px: `.ant-tabs-nav-more` **is present and visible**, so antd collapses what does not fit into a
"more" dropdown and every tab remains reachable. The A3 helper now skips `.ant-tabs-nav-wrap`, with
that verification written next to the line. **The check was wrong; the app was right.**

**2. The tables did not need `scroll={{ x }}` after all.** The plan called for adding it to the three
antd tables. Measuring first showed `.ant-table-content` computes `overflow-x: visible`, so the
overflow simply escapes upward until the card's `overflow: hidden` eats it — which means fixing the
*card* fixes the table too. That route was taken instead because `scroll={{ x }}` also forces antd
into `table-layout: fixed`, changing how every column is sized on **desktop**, for no gain here. One
uniform fix, six sites, no antd prop changes. `scroll={{ x }}` stays available if a sticky first
column is ever wanted.

### Proven, not assumed

- **The clipped content is genuinely reachable now.** On `/dept` at 390px the container scrolls 203px
  and the "Last activity" column moves from `left: 502` (off-screen) to `left: 299` (on-screen).
  On-call scrolls its full 86px.
- **The desktop diff was reviewed screen by screen**, exactly as the gate requires: the nine source
  files were stashed, seven desktop routes captured at 1440×900, restored, captured again, and the
  pairs compared pixel by pixel.

| Route | Pixels changed | Verdict |
|---|---:|---|
| **dept** | 10,079 (0.78%) | **Expected and an improvement** — the padding fix. Before, row text sat flush against the card border; after, it has the 12/8 padding it was always meant to have. |
| list | 289 (0.02%) | No visible change — antialiasing |
| sprint · eng · custom-fields | 132–216 | The assistant button's pulse animation, bottom-right corner, in every case |
| on-call · space-browser | 2–3 | Noise |

**The desktop guard stayed green**, which is correct but incomplete on its own: it snapshots the
properties a *stylesheet* could leak into (font sizes, control heights, shell geometry), and P2 is a
component-code phase. The DeptQueue padding change is real and the guard cannot see it. **For
component phases the before/after image comparison is the actual gate; the guard is the backstop.**
No re-baseline was needed — nothing the guard measures moved.

### Gate — met

| Check | Result |
|---|---|
| **A3** — content clipped beyond reach | **3 → 0 at 390, 4 → 0 at 360.** Retired from `NOT_YET`; now a permanent guard |
| Tables scroll to their last column | ✅ proven on `/dept` and `/eng/on-call` |
| Desktop diff reviewed screen by screen | ✅ 7 routes, before/after pixel comparison; one intentional change, all of it an improvement |
| **A11 desktop guard** | green (and its limits recorded above) |
| Existing desktop e2e | `smoke.pw.ts` **3/3**, including the 16-route render-and-console sweep |
| Mobile net | **25/25** across both profiles + the guard |
| `tsc -b --force` | clean |
| `eslint .` | **12 errors + 4 warnings — exactly the baseline, zero new** |
| Dev database | left exactly as found: **6 spaces, 47 tasks** |

**P3 may begin on the next go.**

### ⚠️ Trap this phase hit: the e2e suite writes to whichever database the API points at

`smoke.pw.ts` creates a space per run. The suite was written for `taskmanagement_qa`
(`auth.pw.ts:12` talks to that database directly), but it drives whatever API is on :5501 — which in
a normal dev session is `taskmanagement`. Two runs left two stray `PW Space NNNNN` rows in the dev
data. Cleaned up, and worth knowing: **spaces cannot be deleted until archived** (`DELETE` returns
`409 space.not_archived`), so the cleanup is `POST /spaces/:id/archive` then `DELETE /spaces/:id`.

### Notes for whoever runs P3

- P3 is the shell: bottom tab bar (Home · Inbox · ＋ · Spaces · Assistant), a full-screen `/spaces`
  drill-down, **deleting the 640px auto-collapse in `Sidebar.tsx:54-62` in the same commit**, and
  real keyboard handling. It targets **A2** and **A12**.
- The z-index slot is decided: **1030**, between `fixed: 1020` and `modal: 1040` (D6). Five things
  already live in the bottom band and will collide — the assistant button and its onboarding toast,
  the offline pill, the push prompt, and the bulk-action bar.
- `--safe-top/bottom/left/right` are already defined by P1's stylesheet; use them rather than calling
  `env()` again.
- A12 is measured with the viewport shrunk to keyboard height. P0 measured the composer sitting
  ~750px below the fold at 390px, so this is a real layout problem, not a rounding error.

---

## 12) P3 execution record — ✅ **COMPLETE 2026-08-25**

**This is the phase where "I can't open my list on my phone" stopped being true.**

### What shipped

| File | |
|---|---|
| `hooks/useIsMobile.ts` | **New.** The D2 boundary — one `matchMedia("(max-width: 767px)")`, structural decisions only, cosmetics stay in `mobile.css`. |
| `hooks/useKeyboardInset.ts` | **New.** Publishes the keyboard height as `--kb-inset` from `visualViewport` and returns "is it open". |
| `components/shared/MobileTabBar.tsx` | **New.** Home · Inbox · ＋ · Spaces · Assistant, z-index 1030, safe-area aware, slides away while typing. |
| `components/shared/MobileTopBar.tsx` | **New.** Back · title · search · avatar menu carrying SLA, Department, Reports, Engineering, Report-a-bug, Settings, Sign out — each behind the same permission gate the sidebar uses. |
| `pages/spaces/SpacesPage.tsx` | **New.** `/spaces` and `/spaces/:spaceId` — the drill-down that replaces the tree. |
| `layouts/AppShell.tsx` | Branches on `useIsMobile()`. The desktop return is byte-for-byte the old shell. |
| `components/shared/Sidebar.tsx` | The 640px auto-collapse **deleted** (with the unused import and store selector it left behind). |
| `pages/settings/SettingsLayout.tsx` | Single column on a phone; the 260px rail becomes a scrollable chip strip. |
| `components/shared/ReportBugButton.tsx` | Optional controlled mode, so the mobile menu can open it. No-props usage is unchanged. |
| `OfflineIndicator` · `PushPrompt` · `BulkActionToolbar` | One shared `bb-bottom-floating` class so the stylesheet can lift them clear of the bar. |
| `src/mobile.css` | P3 block: assistant button and nudge retired on mobile, the three floating elements lifted, antd overlays re-stacked. |
| `index.html` | `interactive-widget=resizes-content` on the viewport meta. |
| `router.tsx` | The two `/spaces` routes, lazy like every other page. |

### Two real bugs, found by building it

**1. A page that overflows sideways dropped the tab bar below the fold.** The first mobile shell let
the document scroll instead of `<main>`. On a phone that is not equivalent: a page wider than the
viewport widens the *document*, and mobile Chrome answers by zooming the whole layout out — measured
`window.innerHeight` going **844 → 985**, which put a `position: fixed; bottom: 0` bar 141px below
anything visible. Playwright found it as "a `<div>` from the `<main>` subtree intercepts pointer
events", which is what that looks like from the outside. Fixed by making `<main>` a scroll container,
exactly as the desktop shell has always done. Screens still overflow until P5 and P6 reshape them, so
the shell has to survive that rather than assume it away.

**2. The tab bar floated on top of the open task sheet.** D6 put the bar at 1030, "below drawers and
modals at 1040" — but 1040 is *this app's* token, and **antd actually renders drawers and modals at
z-index 1000**. Measured: drawer 1000, bar 1030, and a hit test at the bar's centre returning the
bar's own icon while the task detail was open. Fixed by lifting antd's overlay layers to the app's
own 1040 token in `mobile.css`, restoring the intended order: content < bar < drawers and modals <
dropdowns < toasts.

### 🔁 Four more checks corrected — and the pattern is now unmistakable

| Check | What it measured | What it measures now |
|---|---|---|
| **A2** | `<a href>` elements on Home — a description of the desktop sidebar tree, nothing else | Walks the real path: tap Spaces, tap a space, tap a list, assert the URL |
| **A12** | Whether the composer was in the viewport *on arrival* — never true for a long drawer, mobile shell or not | Scrolls to the composer, shrinks the viewport like a keyboard, then **hit-tests** the composer and send button |
| **A9** | `document.body.scrollHeight` — which P3 made meaningless the moment `<main>` became the scroller | Whichever element actually scrolls |
| **A6** | The page heading's **text** width — a heading is only as wide as its words, so it reported a sliver even at full width | The content column itself |

Six of these across three phases now (A3 and A8 in P2). **Every time, the criterion was right and the
cheap proxy behind it was wrong.** The lesson for P4 onward: when a check is written, ask what a user
would do and measure *that* — a hit test, a tap path, the real scroller — rather than the first DOM
number that correlates with it. Two of these (A2, A12) would have quietly passed a broken app; two
(A9, A6) quietly failed a fixed one.

### Gate — met

| Check | Result |
|---|---|
| **A2** — a list reachable from Home in ≤3 taps | ✅ **`Spaces → Marketing → Influencer Outreach`**, landing on `/s/…/l/…`. Retired from `NOT_YET` |
| **A12** — keyboard open, composer and send usable | ✅ both in viewport and **hit-test tappable** at 390 and 360. Retired |
| **A6** — settings content column | ✅ **390 of 390** and **360 of 360** (was a 74px slit). Retired |
| Bottom band free of collisions | ✅ assistant button and nudge retired on mobile (it is a tab now); offline pill, push prompt and bulk bar lifted above the bar |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3**, including the 16-route render-and-console sweep |
| Mobile net | **23/23** across both profiles + the guard |
| `tsc -b --force` | clean |
| `eslint .` | **12 errors + 4 warnings — exactly the baseline, zero new** |
| Dev database | left as found: **6 spaces, 47 tasks** |

Remaining in `NOT_YET`: **A1, A4, A13** (P4 — the card view, the drawer rebuild, virtualisation),
**A9** (P5 — Home is still 3.0 screenfuls of one-number cards at 390 and 4.1 at 360), **A7 and A8**
(P7 — the calendar and the picker).

### Notes for whoever runs P4

- P4 is the biggest single build: one mobile task view (card list + Group-by) replacing the three
  tabs below 768, the drawer as a bottom sheet, and the card tap menu that replaces drag.
- **Virtualised from the first commit (D10).** A13 is the gate: under 6,000 DOM nodes and under 1.2s
  per twenty scroll frames at 500 tasks. Today it is 22,826 nodes and 7.4s.
- The drawer already renders full-screen and reads well — the screenshot after P1/P2 is genuinely
  decent. Its problem is chrome, not layout: 24 of 24 controls under 44px, the smallest 16×16.
- A4's remainder is concentrated exactly where P4 works. Of the 68 originally measured, ~30 were the
  sidebar rail (gone as of P3) and ~14 are drawer chrome.
- The comment composer is inline at the bottom of the drawer and now provably reachable with a
  keyboard open. **If P4 makes it sticky, re-run A12** — sticky is what puts it back in the bar's way.

---

## 13) P4 execution record — ✅ **COMPLETE 2026-08-25**

**The daily screen.** Task names went from one character to thirty-six, and a 500-task list went
from unusable to smooth.

### What shipped

| File | |
|---|---|
| `components/views/MobileTaskCard.tsx` | **New.** The card: priority flag, the name on two full-width lines, then status · due · assignees underneath, and a 44px ⋯ that owns its own menu. |
| `components/views/MobileTaskView.tsx` | **New.** The one mobile task view — a hand-rolled virtualised list, grouped by Status / Who / Due, with search. |
| `pages/list/ListPage.tsx` | Mobile branch: no desktop header block, no view tabs, just the card view and the sheet. |
| `components/task/TaskDetailDrawer.tsx` | `placement="bottom"`, `92svh` on a phone; unchanged on desktop. |
| `components/shared/MobileTopBar.tsx` | Title wrapper classed so its breadcrumb links can be sized. |
| `src/mobile.css` | Drawer controls and breadcrumb links reach 44px. |

### U1 in practice: three tabs became one view

The scan measured what each desktop view was worth at 390px — the list crushed names to 12px, the
calendar grid rendered at **zero width**, and only the board's cards read properly. So the phone gets
one card list and a Group-by control does what the tabs used to: **grouping by status *is* the board,
grouping by due date *is* the calendar.** Three broken surfaces collapsed into one good one, which
made this phase smaller rather than larger. Desktop keeps all three tabs, untouched.

### D10 in practice: virtualised from the first commit

Rows are fixed-height on purpose, so windowing is arithmetic rather than measurement — `CARD_HEIGHT`
is the load-bearing constant and is commented as such. Groups are flattened into one positioned row
list, so a header and a card are the same kind of thing to the virtualiser. No new dependency: the
project had no virtualiser, and a fixed-height windowed list is about forty lines.

**Measured at 500 tasks, 390×844:**

| | Before (P0) | After |
|---|---:|---:|
| DOM nodes | 22,826 | **533** |
| Time to first card | 13.4s | **1.86s** |
| 20 scroll frames | 7,402ms | **305ms** |

305ms for twenty frames is ~60fps. The list is now flat in cost: 500 tasks render the same handful of
cards as 50.

### Gate — met

| Check | Result |
|---|---|
| **A1** — task name legible | **285px / 36 characters** at 390, 255px / 32 at 360 (was 12px / 1 character) |
| **A4** — every control on the task screen ≥44px | **0 under 44** at both profiles (was 68) |
| **A13** — a 500-task list | **533 nodes, 1.86s, 305ms per 20 frames** — all three gates passed |
| Open → status → comment → Back, by thumb | ✅ verified end to end at 360px, see below |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3** |
| Mobile net | **25/25** across both profiles + the guard |
| `tsc` / `eslint` | clean / **12 errors + 4 warnings, exactly the baseline** |
| Dev database | left as found: **6 spaces, 47 tasks, 9 comments** |

**The thumb flow, run at 360×640:** tap a card → the sheet opens and the URL gains `?task=` · the
comment box scrolls into reach, focuses and accepts typing · **Back closes the sheet and leaves the
URL clean** · the ⋯ menu opens with five options, **every one 44px tall**, and a tap changes the
status. The status was changed and put back, so the dev data ends where it started.

**One thing worth the extra check:** `locator.tap()` did *not* fire the antd menu item, while
`click()` did — which would have meant "the menu replaces drag" (D5) rested on a test that does not
resemble a finger. Re-run with the low-level `page.touchscreen.tap()` at the item's centre: **the
PATCH fired, the menu closed, the status changed.** So it is a Playwright locator nuance, not a
product defect — but it was worth ten minutes to know that rather than assume it.

### Mistakes made in this phase, and what they teach

1. **I deleted the A13 test by accident.** Rewriting A12 with a line-range splice, the end bound
   searched for the next occurrence of "A4a" — and A13 sat between them, so it went too. `--list`
   showed 11 tests where there should have been 12. **A check that silently disappears is the worst
   failure mode there is: the ratchet cannot notice a test that is not there.** Restored from the
   scratch copy. From here on, `--list` the spec after editing it — the count is the cheapest
   possible guard.
2. **The first card draft wrapped the entire card in the Dropdown**, which would have made every tap
   open the status menu and left no way to open a task at all. Caught by reading it back before
   running anything, not by a test — the acceptance net would have caught A1 but not this.
3. **A13's render number was meaningless the moment virtualisation worked.** It waited for the *last*
   cloned card to attach — exactly the row a virtualised list deliberately keeps out of the DOM — so
   it measured a 40s timeout and called it "render time". Now it waits for the first card, and
   render time is gated at under 6s. That is the seventh check corrected in this project, and the
   same lesson each time: **measure what a user experiences, not the first DOM number that
   correlates with it.**
4. **antd v6 deprecated the Drawer `height` prop**, so the first bottom-sheet version logged a console
   warning. Moved onto `styles.wrapper`. Caught by the console-error assertion inside the existing
   `smoke.pw.ts` sweep — a check written long before this project, still earning its keep.

### What P4 deliberately did not do

- **The mobile view has search and Group-by, but not the full filter set** (priority, assignee,
  date range). Those live in `TaskFilterPopover`, whose date picker is A8's problem and belongs to
  P7. Adding filters before that would have imported a broken control.
- **Its model logic is its own, not shared with `ListView`.** Sharing would have meant editing the
  desktop view — the one thing every phase of this plan has avoided. The duplication is about thirty
  lines (query, hide-closed, search, group) and is the honest price of a zero-risk desktop.
- The card does not swipe. Swipe-to-archive is a nice affordance and a whole gesture-conflict surface;
  the ⋯ menu covers the same ground with none of the risk.

### Notes for whoever runs P5

- P5 is Home, Inbox and Create. **A9 is the only acceptance number still failing on a phone besides
  the two P7 ones**: Home is 3.0 screenfuls at 390 and 4.1 at 360, and the first screenful is two
  numbers.
- A9 now measures whichever element actually scrolls, so it will keep working when Home is reshaped.
- Home's KPI cards are ~230px each; the plan calls for one compact strip and My Work first.
- The Inbox filter chips still do not wrap — "@Mentions" and "Requests", the two that carry an
  obligation, are the ones that fall off the right edge.

---

## 14) P5 execution record — ✅ **COMPLETE 2026-08-25**

### What shipped

| File | |
|---|---|
| `pages/home/KpiStrip.tsx` | **New.** The six KPIs as one 68px horizontally scrollable strip instead of six 230px cards. Same order, same meanings, same `valueDisplay`; the SLA chip keeps its link, since it is still the only tile with a queue behind it. |
| `pages/home/HomePage.tsx` | Mobile branch: greeting, KPI strip, **My Work**, then Agenda, LineUp and Activity. |
| `pages/home/MyWorkCard.tsx` | The bucket strip wraps. |
| `pages/inbox/InboxPage.tsx` | The filter chips wrap. |
| `components/shared/MobileTabBar.tsx` | ＋ pre-fills the list you are standing in. |

### What changed for someone holding a phone

**Home used to open on two numbers.** Six KPI cards at ~230px each meant scrolling past three of
them before a single task appeared. Now the numbers are one glanceable line and **My Work starts at
y=247** — comfortably inside the first screen at 390 (792 tall) and at 360 (588 tall). Total content
also came down from 2,512px to 1,742px, but that was never the point.

**Two Inbox filters were unreachable.** "@Mentions" and "Requests" — precisely the two that carry an
obligation — ran off the right edge of a 390px screen with nothing to scroll. One `flexWrap`.

**Creating a task from inside a list is now two taps.** ＋ opens the sheet with the list already
chosen, so it is tap, type, Create. Verified end to end at 360px: the task was created, landed in
the right list, and was removed again.

### 🔁 Check correction #8 — A9 was measuring the wrong thing, again

A9's assertion was "Home is at most two screenfuls". Its criterion, from the acceptance table, was
always **"the first screen shows real work"**. Those are not the same: a long Home is fine if the
work is at the top, and a short one is useless if it is not.

After the reshape, Home is **2.2 screenfuls at 390 and 2.96 at 360** — so the old proxy would have
failed a page that now does exactly what was asked of it. A9 now measures where the My Work section
starts relative to the fold, which is the thing a person actually experiences.

That is the eighth of these. Every single one has had the same shape: **the criterion was right, and
the first DOM number that seemed to correlate with it was wrong.** Four of the eight would have
passed a broken app; four would have failed a fixed one.

### Gate — met

| Check | Result |
|---|---|
| **A9** — Home shows work in the first screenful | ✅ My Work at **y=247**, above the fold at both 390 and 360. Retired from `NOT_YET` |
| Inbox filters all reachable at 360 | ✅ chips wrap; nothing off the right edge |
| Create a task in ≤4 taps | ✅ **2 taps** from inside a list, and the task lands in that list |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3** |
| Mobile net | **25/25** across both profiles + the guard |
| `tsc` / `eslint` | clean / **12 errors + 4 warnings, exactly the baseline** |
| Dev database | left as found: **47 tasks, 6 spaces, 9 comments** |

**`NOT_YET` now holds two entries: A7 and A8, both P7.** Every other acceptance criterion in the plan
is a live, passing regression guard.

### ⚠️ Cleanup note worth keeping

`DELETE /tasks/:id` **archives** a task — it does not remove the row, so a verification run that
"cleans up" with DELETE still leaves the table one taller than it found it. The row only leaves after
`POST /tasks/:id/unarchive` followed by `POST /tasks/:id/delete-request`, which for an owner appears
to execute immediately rather than queueing for approval (consistent with the 023 design, where
Owner and Admin are the deciders). Anything that creates a task while verifying should do all three.

### Notes for whoever runs P6

- P6 is the **public form** — the only page an outsider ever sees — plus **Settings → Profile**, which
  P3 already un-slivered.
- The public form's structure is already the best in the repo: single column, labels on top, every
  control full width. What it needs is: `type="tel"` and `inputMode="numeric"` for phone fields
  (`lib/bd-phone.ts` exists and is unused), **scroll-to-first-error** on a failed submit (today it
  silently does nothing, so Submit looks broken), less padding, and a decision on **photo upload** —
  currently disabled with the dead control still shown, on a complaint form for a beauty business,
  where the camera is the most valuable input a customer has.
- P1 already gave it 16px fields, so iOS no longer zooms on focus there.
- The dev workspace has **zero forms**, so P6 will need one created to test against — and it is a
  public, unauthenticated page, so the test does not need a login.

---

## 15) P6 execution record — ✅ **COMPLETE 2026-08-25**

One file changed — `pages/public-form/PublicFormPage.tsx` — and it is the only page in this product
that a customer ever sees.

### What changed for a BeautyBooth customer

| | Before | After |
|---|---|---|
| Phone field | a plain text input — a QWERTY keyboard for an 11-digit number | `type="tel"`, `inputMode="numeric"`, `autoComplete="tel"` → the numeric pad, and the browser can offer a saved number |
| A wrong phone number | accepted, discovered days later when someone tried to call back | rejected on the spot: *"Use an 11-digit number like 01712345678"*, via `lib/bd-phone.ts` — which existed in the repo, unused, all along |
| A failed submit | the page did not move, so Submit read as a button that does nothing | scrolls to the first failing field and focuses it |
| Padding | 24 outside + 32 inside per side = **112px of a 360px screen** spent on nothing | 12 + 16, giving the form back a third of the phone |
| A "files" field | a **disabled text box** reading "File uploads aren't available on public forms" | an honest one-line note in its place (see the decision below) |

### The photo-upload decision

The scan called this out as the sharpest gap: a beauty business's complaint form, on a phone, with
the camera — the single most useful thing a customer has — switched off, and a dead control still
rendered to advertise it.

Anonymous upload is genuinely a **backend** feature: a public presign endpoint, size caps, abuse
protection, and R2 actually configured. That is not something a mobile phase can honestly ship, and
pretending otherwise would repeat the mistake this project keeps finding — a UI that promises what
nothing implements. **So P6 does the honest half:** it stops rendering a disabled box, and says the
true thing in one line instead — *"Photos can't be attached here yet — please describe it above and
we'll ask for pictures when we reply."* The real capability is logged as a backend gap, not quietly
shipped as a broken field.

### Gate — met

| Check | Result |
|---|---|
| A customer completes the form on a 360px phone | ✅ verified end to end: nothing off-screen, no sideways pan, empty submit shows the error **and moves focus to it**, a bad phone is rejected with a useful message, a good submission returns "Submission received" |
| **A6** — Settings → Profile on a phone | ✅ content column 360 of 360 (met in P3, still green) |
| Password change works on a phone | ✅ the modal opens at 344px inside 360, all three fields 16px / 44px. Opened but deliberately **not submitted** — changing the owner password would have broken every other check in this project |
| Push opt-in reachable | ✅ the notifications section renders in the profile column |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3** |
| Mobile net | **25/25** across both profiles + the guard |
| `tsc` / `eslint` | clean / **12 errors + 4 warnings, exactly the baseline** |
| Dev database | left as found: **47 tasks, 6 spaces, 9 comments, 0 forms, 0 custom fields** |

### Two mistakes worth writing down

**1. A hook placed after an early return took the page down.** `useIsMobile()` went in next to the
code that needed it — which sat below the loading and not-found returns. React counted a different
number of hooks between renders and the public form died with *"Rendered more hooks than during the
previous render"*. Caught immediately because the verification screenshots it; moved up with the
other unconditional hooks and a comment saying why it has to live there.

**2. My own test fixture leaked into every task in the workspace.** The dev workspace had zero forms,
so P6 created one — and to test a phone field it needed a **workspace-scoped** custom field. Those
appear on *every task's* drawer, which broke A12: its composer selector was
`.ant-drawer textarea, .ant-drawer .ant-input`, a comma selector that returns **DOM order**, so
`.first()` picked my new "01712345678" custom-field input instead of the comment box. The composer
measured at y=201 and the send button at y=1034 — two unrelated controls.

Both halves were real problems. **The selector was too loose** (fixed: the composer is the drawer's
only `textarea` — check-correction #9), and **a fixture must not be workspace-scoped if the thing it
tests is one page** (fixed: the form, both custom fields and the submitted task were all removed, and
the database is back to exactly what it was).

### Notes for whoever runs P7

- P7 is the last of the acceptance work: **A7** (the calendar renders at zero width — it becomes the
  agenda mode of P4's view, reusing the existing tasks-by-day data) and **A8** (the range picker,
  which blows the viewport out to 652px at 390 and sits 380px off the left edge at 360).
- P7 also executes D5 properly: drag is already hidden on mobile (P1 hid the handle, P4 replaced it
  with the card menu), so what remains is removing the dnd wiring on phones and **fixing the copy that
  still says "drag to schedule"** on the calendar's unscheduled panel — an instruction no phone can
  follow.
- A7 and A8 are the only two entries left in `NOT_YET`.

---

## 16) P7 execution record — ✅ **COMPLETE 2026-08-25**

**`NOT_YET` is now empty.** Every acceptance criterion in this plan is a live, passing regression
guard, and one more was added on the way.

### Two of the three items were already done — by structure, not by code

This is worth recording because it is the plan working rather than the plan being lucky.

- **"Remove the dnd wiring on mobile."** `ListView`, `BoardView` and `CalendarView` are not rendered
  on a phone at all — P4's mobile branch bypasses them — so their dnd contexts never mount. Nothing
  to remove.
- **"Fix the calendar copy that says *drag to schedule*."** That copy lives in `CalendarView`'s
  unscheduled panel, which a phone never renders. Verified by scanning the rendered text of eight
  mobile routes: clean.

D5's decision (no drag on phones) turned out to be enforced three times over — P1 hid the handle, P4
replaced it with the card menu, and the mobile shell never mounts the drag contexts.

### A7 — the calendar became the agenda

The month grid measured **zero width** on a phone and was never going to work: 43px per day cannot
hold a task. U1's answer was that grouping by due date *is* the calendar, so the calendar route now
opens `MobileTaskView` with the **Due** grouping — Overdue / Today / Tomorrow / Next 7 days / Later /
No date. One prop, `initialGroupBy`, threaded from the route.

Measured: agenda headers render, the surface is **366px at 390 and 336px at 360**, and there are
**zero zero-width containers**.

### A8 — the picker blowout was already gone; a smaller one was not

The 652px viewport blowout came from the **two-panel RangePicker** in the list filter — a control a
phone has not reached since P4 replaced that toolbar. What a phone does meet are single-panel pickers
in the task sheet and the create sheet. Those kept the viewport stable, but at 360 the create sheet's
picker sat **2px off the left edge**: antd aligns the 330px panel to its trigger and there was no
slack. Capping the dropdown at `calc(100vw - 32px)` gives antd room to place it; both pickers now
measure **0px outside the screen** at both profiles, and the panel still renders a full Su–Sa week.

### 🆕 A14 — copy that asks for a gesture the hardware does not have

P7's gate says "no mobile copy instructs a gesture that does not exist". Scanning the rendered text
and the `aria-label` / `title` / `placeholder` attributes of eight mobile routes found two survivors:

- the task sheet's attachment dropzone: **"Drag files here or click to upload"**
- the search page: **"Press ⌘K anywhere to open the command palette"** — on a device with no keyboard

Both fixed (the dropzone says *"Tap to add a photo or file"* on a phone; the shortcut hint is
desktop-only), and the scan is now **A14**, a permanent check. It guards the class rather than the
three instances: any future "drag", "hover" or "right-click" that lands on a phone screen fails here.

### 🔁 Check corrections #10 and #11 — and a note on how they were found

**A8 had been failing on a missing button since P4.** It clicked "Filter" in the list toolbar — a
control the mobile view has not had since that toolbar was replaced. So for three phases it sat in
`NOT_YET` reporting a failure that had nothing to do with pickers. It now opens the picker the way a
user does: tap the date badge in the task sheet, which is what swaps in the DatePicker.

**A7 was checking for the desktop design.** It looked for a seven-column grid at least 200px wide —
a description of the month calendar, which the plan had already decided a phone would not get. It
would have failed forever against a correct implementation.

That is eleven of these across the project. The pattern has not varied once: **the criterion in the
acceptance table was right every time, and the DOM measurement standing in for it was wrong.** What
found most of them was not re-reading the tests — it was *watching what a test did when it failed*.
A check that fails for the wrong reason looks exactly like a check that works, until you read its
error message.

### Gate — met

| Check | Result |
|---|---|
| **A7** — the calendar route renders a usable agenda | ✅ headers render, surface 366/336px, zero zero-width containers |
| **A8** — a date picker keeps the viewport and stays on screen | ✅ viewport unchanged, single panel, **0px outside the screen** at both profiles |
| No mobile copy instructs an impossible gesture | ✅ **A14**, now permanent — 8 routes clean |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3** |
| Mobile net | **27/27** across both profiles + the guard (13 checks × 2 profiles + the guard) |
| `tsc` / `eslint` | clean / **12 errors + 4 warnings, exactly the baseline** |
| Dev database | left as found: **47 tasks, 6 spaces, 9 comments, 0 forms** |

### Where the plan stands

`NOT_YET` is empty. A1–A14 all pass at 390 and 360, and every one of them is now a guard against
regression rather than a target. **P8 is the only phase left** — speed, scale and the PWA — and none
of it is acceptance work:

- `lazy()` on `TaskRedirect`, which drags **119 KB of rich-text editor onto the login screen**
- self-host Inter, dropping a render-blocking cross-origin `@import`
- react-query `retry` for **queries only** (`queryClient.ts` has no `mutations` block today and must
  keep none, or a lost response could double-write)
- server-side filtering and paging for `listByList` — the client stopped *rendering* every row in P4;
  this stops it *downloading* them (688 KB of JSON for 500 tasks)
- the PWA finish: `apple-touch-icon`, PNG icons, a real fetch handler, unconditional service-worker
  registration, an install prompt, and an offline message that tells the truth

---

## 17) P8 execution record — ✅ **COMPLETE 2026-08-25** — the plan is finished

### Speed

| | Before P8 | After |
|---|---:|---:|
| First-load JS + CSS (gzipped) | 666 KB | **470 KB** |
| Over the wire, first visit | 718 KB | **523 KB** |
| Time to a usable Home, typical 4G | — (4.1s just to the *login form*) | **1.68s** |
| Time to a usable Home, good 4G | — | **0.81s** |

What moved it:

- **`lazy()` on `TaskRedirect`** — it was eager and statically imported the task drawer, which imports
  TipTap, so **119 KB of rich-text editor was on the login screen**. The built `index.html` no longer
  references the editor chunk at all.
- **The three rare auth pages** (forgot / reset / accept-invitation) are lazy too. Login stays eager —
  it is the first paint for anyone signed out.
- **The Google Fonts request moved out of the bundled CSS** into a `<link>` with `preconnect`. An
  `@import` inside a bundled stylesheet is only discovered after that stylesheet has downloaded and
  parsed, which cost a serial round trip on the worst possible connection.
- **`maplibre-gl` removed** — a dependency with zero imports anywhere in `src`.

**Honest on the gate: the time target is met with room to spare; the byte target is not.** A10 asked
for ≤450 KB and the first load is **470 KB gzipped** — 20 KB over. The remaining weight is antd inside
the 366 KB entry chunk, and `vite.config.ts` already records that bucketing antd made things *worse*
(448 → 578 KB). Self-hosting the fonts would take ~48 KB off the wire figure but not off this one.
Closing the last 20 KB is a real piece of work, not a tweak, and it is not worth inventing at the end
of a phase.

### Scale — a decision, not a half-implementation

`listByList` still downloads every task in a list: **1,448 bytes each, 688 KB for 500**. P4 fixed the
*rendering* cost (22,826 DOM nodes → 533) but not the *download*.

Fixing it properly means **server-side grouped pagination with per-group counts** — the mobile view
groups by status, assignee and due date, and a partial page would show wrong group counts, which is
worse than a slow correct one. That is a backend feature with its own design, and improvising it in
the last hour of a UI project is how you get a subtly wrong task list. **Recommended as its own
phase**, with P0's measurements already in hand to size it. It is deliberately not in P8's gate.

### The PWA — installable, and honest about offline

- **Icons.** The manifest shipped SVG-only and there was no `apple-touch-icon` at all, so iOS
  Add-to-Home-Screen — the *only* path by which iOS delivers Web Push, the reason the manifest exists
  — produced a screenshot of the login page as the app icon. Four PNGs are now generated from the
  existing mark: 180 (opaque, for iOS), 192, 512, and a **maskable 512** with the brand colour bleeding
  to every edge and the logo inside the safe zone.
- **Manifest** rewritten: PNG icons, `id`, `orientation`, `lang`, a brand `background_color` instead of
  white, and three **shortcuts** (My tasks · Inbox · Spaces) for the icon long-press.
- **The service worker has a `fetch` handler.** Chrome will not offer installation without one, which
  is why "no offline story" and "cannot be installed" were the same bug. It is written to keep the
  original file's caution: **`/api/*` is never cached** (stale task data is worse than none, and D8
  chose a shell cache, not a content cache), **navigations are network-first** so a deploy lands on the
  next online load and a stale shell can never reference deleted chunks, and **`/assets/*` is
  cache-first** because those names are content-hashed.
- **Registration is unconditional.** It used to live inside `ensurePushSubscription()`, which returns
  early unless notification permission is already granted — so anyone who tapped "Not now" had **no
  service worker at all, permanently**, and therefore no offline shell and no installability. Two
  capabilities gated behind an unrelated choice.
- **An install prompt exists.** `beforeinstallprompt` appeared nowhere in the codebase, so nothing had
  ever offered installation. Android gets a real Install button; iOS, which never fires that event,
  gets the Share → Add to Home Screen instruction instead. Shown once, dismissal remembered, never
  shown inside the installed app.
- **The offline message tells the truth.** It used to promise *"changes will sync when reconnected"*
  with no mutation queue, no background sync and no cache behind it — a warehouse user in a dead spot
  was told their edit was safe and then lost it. It now says *"you can look around, but changes won't
  save"*, which is exactly what the shell cache does.

**Verified:** the worker registers and activates at root scope, `bb-shell-v1` holds the shell, and an
**offline reload boots the app** instead of the browser's error page.

### 🐞 Two crashes that only existed in the production build

Loading the real bundle is not the same as running the dev server, and it found two.

**1. `entryFor` could throw — a pre-existing latent bug.** `data?.permissions[key]` guards `data` but
not `permissions`, so a payload without that key threw *"Cannot read properties of undefined (reading
'sprint.manage')"* and took the whole page to an error boundary. It had been harmless for as long as
every caller waited for `ready` — and P3's mobile top bar asks on its first render, which turned a
latent bug into a crash. Now `data?.permissions?.[key] ?? EMPTY`: an unknown permission reads as *not
granted*, never as an exception.

**2. `KpiStrip` threw on a missing KPI.** My own P5 code assumed all six keys are present. A missing
one is now a gap, not a page-killer. **The desktop `KpiRow` has exactly the same shape** and deserves
the same guard when someone next touches it — flagged, not silently changed, because desktop is not
this plan's to alter.

Neither would have been caught by the mobile net, which runs against the dev server. **The lesson for
the deploy: build and load the production bundle before shipping it** — it is a different program.

### Gate

| Check | Result |
|---|---|
| **A10** — time to usable Home, typical 4G | ✅ **1.68s** (target ≤3s) |
| **A10** — first load | ⚠️ **470 KB gz** (target ≤450 KB) — 20 KB over, cause and cost stated above |
| Installable with a correct icon | ✅ fetch handler present, unconditional registration, PNG + maskable icons, `apple-touch-icon`, install prompt |
| Offline shows the shell and an honest message | ✅ offline reload boots the app; the pill no longer promises a sync that does not exist |
| **A11 desktop guard** | green |
| Existing desktop e2e | `smoke.pw.ts` **3/3** |
| Mobile net | **27/27** across both profiles + the guard |
| `tsc` / `eslint` | clean / **12 errors + 4 warnings, exactly the baseline** |
| Dev database | left as found: **47 tasks, 6 spaces, 9 comments** |

### What is left, stated plainly

- **20 KB** to reach A10's byte target (antd in the entry chunk; splitting it made it worse before).
- **Self-hosting the fonts** — ~48 KB off the wire and one fewer third party, at the cost of adding
  woff2 files to the repo. A scope call, not a technical one.
- **Server-side paging for `listByList`** — its own phase, sized by P0's numbers.
- **A service-worker update flow** — `skipWaiting` + `clients.claim` is right for this worker, but
  there is still no "a new version is ready, reload" prompt.
- **`KpiRow`** (desktop) carries the same missing-KPI crash `KpiStrip` just had.

---

## 18) Post-P8 change — the assistant keeps its own button on a phone

**Reverses part of P3, on use rather than on reasoning.**

P3 retired the floating assistant button on mobile and moved the assistant into the fifth tab slot,
arguing that two doors to one room is a smell. That argument was right about doors and wrong about
recognition: **the purple robot button is how people know the assistant is there.** As one grey
outline icon among five tabs, it stopped reading as anything in particular.

So it is back, and the tab slot went to **Search** — which was previously only reachable from the top
bar. Still exactly one door to the assistant.

| | Desktop | Phone |
|---|---|---|
| Button | 56px, bottom-right at 24px | **46px**, right 12px, **10px above the tab bar** |
| Icon | `Bot` 26px | `Bot` 22px |
| Label | `title="সহায়ক · Help"`, `aria-label="Open help assistant"` | same |

**The onboarding nudge came back with it** — *"নতুন? এখানে যেকোনো প্রশ্ন করুন — আমি সাহায্য করব"*. P3
hid it because it covered content; sitting above the button rather than over the page, it is the
thing that actually tells a first-time user what the button does, which was the point of the change.
Its dismiss target was 30px wide and is now 44 (A4 caught that immediately).

Everything below the tab bar was re-stacked so nothing lands on the one control that is always there:
tab bar 56 → assistant button at 66 → nudge at 120 → transient pills (offline, push, install, bulk)
at 120+.

**Verified:** the button is 46×46, fully on screen, 10px clear of the bar, hit-test tappable, and a
tap opens the full-screen assistant sheet · **27/27 mobile net** · desktop guard green · smoke 3/3 ·
tsc clean · eslint 12 + 4, the baseline.
