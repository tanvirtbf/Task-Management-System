# MOBILE UI SCAN — 2026-08-25 @ `b090667`

**Question asked:** the app will be used by ~100 BeautyBooth staff, **70% of them from phones**, and it
should feel like an app. Scan the whole UI so nothing is missed.

**Method:** four parallel deep passes (core task views · app shell + navigation + PWA · every other
page · a live phone-viewport sweep) plus direct measurement. **107 screenshots** captured at
**390×844** (iPhone 12/13 class) and **360×640** (mid-range Android) against a booted dev stack,
with real DOM measurement of overflow, tap-target size and font size on each screen; production
load times measured over throttled mobile networks against the real site.

---

## 0) Headline

**The app is not "a bit cramped" on a phone. Most of it is unusable, and one part is unreachable.**

Three findings decide everything else:

1. **On a phone there is no way to open a list.** Below 640px the sidebar force-collapses to a 56px
   rail that contains only Home, Inbox and Search. The entire space → list tree, Favorites, SLA,
   Department, Reports, all Engineering pages and Report-a-bug live only in the expanded sidebar and
   simply do not render. Expanding it leaves **128px** of content. So for 70% of the staff, the core
   browse workflow — open my department's list, look at the tasks — does not exist.
2. **The default task screen shows no task names.** In List view at 390px, every column except the
   name is `flexShrink: 0`, so the name is crushed to a single character. The screenshots show tasks
   rendering as **"S", "A", "B"**.
3. **This cannot be fixed by "adding responsive CSS".** The client is styled with **1,319 inline
   `style={{}}` objects across 140 of 151 components**, and an inline style cannot contain a media
   query. That is why the entire app has only **5 width media queries** — it is a structural ceiling,
   not neglect.

The good news is real too: **the data layer, the API shape, the routing and the deep-link/back-button
behaviour are all already mobile-correct**, one component (the assistant) is already built properly
for phones and is the template to copy, and roughly half the app's screens are admin work that can
honestly stay desktop-first. The rebuild is a **shell + six screens** job, not a rewrite of 151 files.

**Scope note:** this was never out of scope. `FINAL_REQUIREMENTS.md:172` lists item #20 —
*"Mobile-responsive web | No PWA, no native app"*. Mobile-responsive was agreed from the start and
never built. (The "no PWA" half is already obsolete: web push forced a manifest and a service worker
into the app months ago.)

---

## 1) What a phone user actually sees

Measured live at 390×844. At 360px every number is ~30px worse.

| Screen | Verdict | What actually happens |
|---|---|---|
| **List view** (the default) | 🔴 **UNUSABLE** | Task names crush to one letter. Status, due date, assignees and the ⋯ menu are clipped away by an `overflow:hidden` container with **no scrollbar** — not squeezed, *gone*. The toolbar wraps to 4 rows and eats 140px of height before a single task. |
| **Board view** | 🟠 **BREAKS on touch, best on layout** | Visually the **best screen in the app** — cards are full width, names read completely, one column fits the phone. But dragging is broken: cards register drag on the whole card at 4px of movement with no `touch-action`, so a scroll gesture and a card drag fight each other, and a tap is a coin flip. |
| **Calendar view** | 🔴 **UNUSABLE — the grid does not render** | Measured `gridWidth: 0`. The 280px "unscheduled" panel is open by default and takes what's left, so you get a cut-off toolbar, the panel, and **a large empty white box where the month should be**. Scrolling the pane fully right lands on a **completely blank white page**. The panel's own copy says *"1 task without dates · drag to schedule"* — an action no phone can perform (see B5). |
| **Task detail drawer** | 🟠 **DEGRADES** | antd clamps it to `100vw` so it fits, but the only way out is a **28×28 ✕** in the corner (the header is disabled and no mask strip is exposed). The property grid is a hard `120px 1fr`, so labels eat 40% of the screen. Android Back does close it — that works by accident and is the saving grace. |
| **Home** | 🟠 **BREAKS** | The page is **2,512px tall — three full screens — and the first screenful is two numbers.** Each KPI sits in a ~230px desktop card, stacked one per screen; to see "Overdue: 2" you scroll past two other cards. The My Work bucket strip does not wrap: **"Unscheduled" and "Done" are off-screen and untappable**. |
| **Inbox** | 🟠 **BREAKS** | Filter chips (~432px, no wrap) push the page 124px wide. **"@Mentions" and "Requests" — the two tabs that carry an obligation — are the ones that fall off.** Rows themselves reflow fine. |
| **Search** | 🟢 **WORKS** | Zero overflow. The only genuinely narrow-safe screen behind login. Long task names truncate to ~20 chars; autofocus pops the keyboard on entry. |
| **Settings (all 12 pages)** | 🔴 **UNUSABLE — worst in the app** | `gridTemplateColumns: "260px 1fr"` with no media query. Measured: the nav rail takes 260px and **the content column gets 74px**. On `/settings/roles` the page heading renders **one character per line, vertically** — `R / o / l / e / s`. Scrolling the slit fully right shows only the far edge of the members table: a column of green "ctive" pills and "…" menus. Member names, emails and roles are never visible **at any scroll position**. Includes **Profile**, where all ~100 staff enable push and change their password. |
| **Department** | 🔴 **UNUSABLE** | 7-column table inside `overflow:hidden`: "Needs review", "Flagged" and "Last activity" are **invisible with no scrollbar**, and "Overdue" is half-cut. A department head opens this page for exactly those numbers. |
| **Reports / SLA** | 🔴 **UNUSABLE when populated** | Same clipping mechanism. Neither table sets `scroll={{x}}` — in fact **no table in the app does**, so antd provides no scroll container at all. |
| **Engineering (Eng home, Sprint, On-call)** | 🟠 **BREAKS** | On-call is the worst: the week-range column resolves to **23.6px** — "Aug 8 — Aug 14" renders one character per line — and the engineer picker is clipped mid-control. |
| **Form builder** | 🔴 **UNUSABLE** | Three fixed panes (260 + canvas + 280). Drag-to-add-field **cannot work on touch at all**, and the reorder grip is decorative — it isn't wired to anything on any device. |
| **Public form** (customers!) | 🟢 **WORKS**, with real gaps | Best-built page in the repo: single column, labels on top, everything `width:100%`. But **31% of a 360px screen is padding**, every field is 14px so **iOS zooms on focus**, phone fields get a QWERTY keyboard (no `type="tel"`), **photo upload is explicitly disabled** — on a beauty/skincare complaint form, from a phone — and a failed submit scrolls nowhere, so it looks like the button does nothing. |
| **Login / forgot / reset / accept-invite** | 🟢 **WORKS** | `size="large"` gives 44px controls and 16px text — no iOS zoom. These pages already do it right. Accepting an invite is a new hire's first act and it works on a phone. |

---

## 2) The blockers, ranked

### 🔴 B1 — Navigation does not exist on a phone
`Sidebar.tsx:54-62` collapses one-way at ≤640px; the rail (`:506-567`) holds Home, Inbox, Search,
Settings. Everything else is in the expanded branch only. There is **no drawer, no hamburger, no
bottom bar** anywhere in the codebase (`<Drawer` appears once — it's the task detail). The sidebar is
`position: sticky` and in-flow, not an overlay, so **expanding it to reach anything leaves 142px of
content** (measured) — and the choice persists in localStorage, so it survives a reload in the wrong
state. The 56px rail is also mounted on *every* screen, meaning usable width is **286px of 390, and
256px of 360**. **Nothing else on this list matters until the shell is replaced.**

### 🔴 B2 — Settings is a 71px sliver
`SettingsLayout.tsx:129`, hard `260px 1fr`, no media query. Twelve routes destroyed, including
Profile — push opt-in, password, timezone — which is the one settings page all ~100 staff need.

### 🔴 B3 — `overflow:hidden` turns overflow into missing data
The same idiom repeats at `DeptSummary.tsx:281`, `ReportDetailPage.tsx:730`,
`OnCallRotationPage.tsx:118`, `ListViewGroup.tsx:103`, `SpaceTasksBrowser.tsx:181`,
`CustomFieldsSettings.tsx:190`. It exists for rounded corners. Its effect on a phone is that content
is **silently deleted rather than scrolled to** — the user has no way to know anything is missing.
This single pattern is the most damaging thing found in the scan, and swapping it for
`overflow-x:auto` is a mechanical fix.

### 🔴 B4 — List rows can't show a task name, and three controls are invisible
`ListViewRow.tsx` gives every slot `flexShrink:0` except the name. Measured: the title cell renders
**12px wide where it needs 190px** — and it is 12px at 360px, still 12px at 390px, 28px at 412px and
**46px even on the largest iPhone (430px)**. No phone on the market shows a readable task name.
Separately, the drag handle, multi-select checkbox and ⋯ menu are `opacity:0` revealed by `:hover`
(`:343-349`) — **touch has no hover**, so select, archive, duplicate, copy-link and delete are
unreachable. They remain clickable, so a blind tap can still fire Delete.

### 🟠 B5 — Drag-and-drop is dead on touch — proven, not inferred
All four dnd-kit contexts (board, list, calendar, form builder) register **only `PointerSensor`**
with a 4px activation distance; cards compute `touch-action: manipulation`, while dnd-kit requires
`none`. A real touch-drag gesture on a board card was recorded:

```
pointerdown → touchstart → pointermove → pointermove → touchmove → pointercancel → touchmove …
```

The browser claimed the pan after ~16px and fired `pointercancel`; dnd-kit's own live region
announced **"Dragging was cancelled."** The card never moved. **Board column moves, list reordering
and calendar drag-to-schedule are all non-functional on a phone today** — and the calendar's
unscheduled panel instructs the user to do exactly that. The form builder's reorder grip isn't wired
to anything on any device.

### 🟠 B6 — Every text field zooms the page on iPhone
antd's global `fontSize: 14` (`theme.ts:182`) applies to every Input, Select, TextArea and DatePicker.
iOS Safari zooms on focus below 16px and does not zoom back. Of ~416 font-size declarations in the
app, **~381 are under 14px and only 13 are ≥16px**; the app's modal size is **11px**.

### 🟠 B7 — Nothing meets a touch-target minimum
`controlHeight: 36` / `controlHeightSM: 28` (`theme.ts:187-188`); topbar buttons 32×32; the avatar —
the only door to sign-out and profile — is **28×28**. The status pill (the single most-used control in
the product) computes to **~17px tall**; the due-date clear ✕ is **11×11** and sits 4px from the
control that opens the picker, so accidental date wipes are a matter of time. The minimum is 44×44.

### 🟠 B8 — Opening the date filter blows the viewport out to 652px
antd's `RangePicker` renders a **660px two-panel calendar**. On a 390px phone Chrome expands the
layout viewport to **652 CSS px and zooms the whole app out to ~60%** to fit it; the grid paints
eight day-columns because the second panel bleeds in, and the filter popover behind it is clipped on
both edges. Filtering by due date is the most-used filter in the product. (The filter popover itself
is also positioned at `left: -20`, so "DUE DATE" reads "UE DATE" and the "Today" chip is half-cut.)

### 🟠 B9 — The public form fails the one customer-facing job
iOS zoom on every field, no `tel`/numeric keyboard for phone fields (`lib/bd-phone.ts` exists and is
unused), **photo upload disabled with the dead control still shown**, and a validation failure that
scrolls nowhere so Submit appears inert.

### 🟡 Also real
- **Fixed-width grids** overflow their container on six pages: `minmax(300–320px, 1fr)` tracks in a
  273px box (Reports, Forms, Templates, Sprint, Import/Export). One shared token fixes all:
  `minmax(min(100%, 280px), 1fr)`.
- **`100vh` used 13 times, `dvh` zero times** — on mobile browsers the page bottom sits under the URL
  bar (the sidebar's Settings link, the settings pane).
- **`viewport-fit=cover` is set with zero `env(safe-area-inset-*)` anywhere** — in iOS standalone,
  the topbar renders under the status bar and four fixed elements sit on the home indicator.
- **The bottom band is already crowded**: the assistant FAB, the assistant onboarding toast, the
  offline pill, the push prompt and the bulk-action bar all live at `bottom: 16–24px`. The toast
  covers real content on **every** screenshot taken. Whatever bottom navigation gets built collides
  with all five.
- **A real CSS bug**: `DeptQueue.tsx:214` writes `padding: \`${tokens.spacing[3]} ${tokens.spacing[2]}\``
  — the tokens are numbers, so it emits `padding: "12 8"` with no units and the browser drops it.
  Dept queue rows have zero padding on every device. (Only instance of the pattern in the repo.)
- **No dark mode at all** — one light palette, zero `prefers-color-scheme`. A full-white screen at
  night reads as "not a real app" and costs battery on OLED.
- **`retry: false` + `refetchOnWindowFocus: false`** (`queryClient.ts:25-26`) are sane desktop
  defaults and wrong for phones: one dropped request becomes a permanent error, and returning to a
  backgrounded app — the mobile refresh gesture — shows stale data.
- **Playwright has zero mobile coverage**: one project, `Desktop Chrome`; 15 specs; a single
  overflow assertion on `/` only. Whatever gets rebuilt has no regression net.
- **Page-level overflow measurement is misleading here.** `document.documentElement.scrollWidth ===
  clientWidth` on *every* page, because `<main>` carries `overflow-x:auto` — the overflow is hidden
  inside nested inner scrollers instead. Board has **three overlapping horizontal scrollers** (84px,
  24px and the 1,174px board track), so a sideways swipe does different things depending on where the
  finger lands. Any future mobile test must measure content-over-pane, not page scrollWidth.
- **Two routes in the sidebar don't exist as pages**: `/eng/report-bug` and `/profile` both redirect
  to `/` (report-a-bug is a modal; profile lives at `/settings/profile`). Harmless on desktop where
  the real triggers are visible — but they are exactly the kind of dead end a mobile nav rebuild
  would inherit.
- **Small things that read as sloppiness on a phone**: the login page renders
  "PasswordForgot password?" with no gap; Search advertises *"Press ⌘K anywhere"* to a device with no
  keyboard; the assistant's footer hint says *"Shift+Enter — নতুন লাইন"*; and the assistant's purple
  header overlaps and clips the first line of its own body text.

---

## 3) Why it can't be retrofitted — and what the cheap global wins actually are

| Metric | Count |
|---|---|
| Inline `style={{...}}` objects | **1,319** across **140 of 151** `.tsx` files |
| `className=` usages | 57 — and 34 of those are the assistant widget |
| `.css` files in the client | **2** (`index.css` 283 lines, `AssistantWidget.css` 620) |
| Width media queries in the entire app | **5** (1024 ×3, 520, 480) + 3 `matchMedia` sites |
| antd responsive Grid (`Col xs/md`) | **2 usages**, both in one file |
| Simulated `:hover` via JS handlers | **53** across 36 files |

An inline style cannot hold a media query, a `:hover` or a `:focus-visible`. That is the whole
explanation for both the missing breakpoints and the 53 JS hover handlers (which on touch either
never fire or **stick on** after a tap, so nothing shows what is selected).

**A claimed silver bullet, tested and disproved.** Two passes flagged that antd v6 runs in `cssVar`
mode (`theme.ts:151`), so one media query overriding `--ant-font-size` / `--ant-control-height` should
retune every control app-wide. Tested live:

- the variables are **not on `:root`** — they are scoped to a generated `.css-var-_r_0_` class, so a
  `:root` override does nothing;
- targeting that class **does** lift `.ant-btn` from 36px → 44px ✅ …
- …but `.ant-input` **stays 36px** ❌ and computed `font-size` **stays 14px** ❌ — so it does **not**
  solve the iOS-zoom problem, which was the main prize.

**What does work, verified:** a plain element-level block. This took every field on the settings page
from 14px to 16px and kills iOS auto-zoom app-wide:

```css
@media (max-width: 767px) {
  input, textarea, select, .ant-input, .ant-input-affix-wrapper input,
  .ant-select-selection-search-input, .ant-select-selection-item,
  .ant-picker-input > input { font-size: 16px !important; }
}
```

So the honest picture: **a handful of global CSS/config edits buy a lot** (16px inputs, taller antd
controls, `overflow-x:auto` instead of `hidden`, the grid-track token, `dvh`, safe-area padding,
`touch-action` on three dnd call sites) — but the shell and the six daily screens still need to be
built, not tuned.

---

## 4) Performance on a Bangladeshi phone

Measured against the **real production site** at 390px with the cache cold:

| Network | Time until the login form is visible |
|---|---|
| Fast 3G / weak 4G (1.6 Mbps, 562 ms RTT) | **6.7 s** |
| Typical 4G (4 Mbps, 100 ms RTT) | **4.1 s** |
| Good 4G (10 Mbps, 40 ms RTT) | **3.2 s** |

**718 KB over 14 requests just to show a login box:**

| | |
|---|---|
| `index-*.js` (app) | 425 KB |
| **`editor-*.js` (TipTap rich-text)** | **119 KB — on the login screen** |
| `react-*.js` | 90 KB |
| Inter font from `fonts.gstatic.com` | 48 KB |
| Cloudflare beacon | 11 KB |
| icons + CSS | 15 KB |

The editor is there because `router.tsx:17` imports `TaskRedirect` eagerly, which statically imports
`TaskDetailDrawer` → `TaskDescription` → TipTap. **One `lazy()` removes 119 KB from every first
load.** The Google Fonts `@import` at `index.css:5` is also render-blocking and cross-origin with no
`preconnect` — self-hosting Inter would remove a full round trip on a high-latency connection.

**The API side is fine, and worth saying out loud:** Home needs 12 calls in one parallel wave, a list
view 19 calls in two — latency cost is ~1–2 s even at 562 ms RTT, and every JSON payload is under
5 KB. (A duplicate `/auth/me` and a doubled SSE connection appear in dev; that is React StrictMode's
double-effect, not a production defect — checked.)

**But the fetch strategy is desktop-shaped and will hurt at scale.** `api.ts:767-786` (`listByList`)
loops page-by-page until the whole list is downloaded, because filtering is client-side. At the
measured **1,448 bytes per task**, a 200-task list is **283 KB of JSON** and a 1,000-task space
browser is **1.4 MB** — every time, on mobile data. With 47 demo tasks this is invisible; with a year
of BeautyBooth's real data it is the thing people will complain about. Mobile needs server-side
filtering plus paging or infinite scroll.

---

## 5) "App er moto" — PWA readiness

More is already in place than expected, and the gaps are small and specific.

**Already correct:** `index.html` has the right viewport meta with `viewport-fit=cover`, a theme
colour, the manifest link and the iOS `apple-mobile-web-app-*` tags. The manifest has `name`,
`short_name`, `description`, `start_url`, `scope`, `display: standalone`, `theme_color`. nginx serves
it all properly (`/assets` immutable, `index.html` and `sw.js` no-store, correct manifest MIME, SPA
fallback). Web push works and is wired to the inbox.

**What blocks it from feeling like an app:**

| # | Gap | Consequence |
|---|---|---|
| 1 | `sw.js` has **no `fetch` handler** (deliberate — it's push-only) **and is only registered after the user grants push permission** | No offline shell at all — a dead spot shows the browser's dinosaur. And Chrome won't fire `beforeinstallprompt` without a fetch handler, so **Android can't do a real install**. A user who tapped "Not now" on the push prompt has no service worker at all, permanently. |
| 2 | **No `apple-touch-icon`** | iOS ignores manifest icons for Add-to-Home-Screen. Since A2HS is the *only* way iOS delivers web push — the reason the manifest exists — an iPhone user who follows that flow gets **a screenshot of the login page as their app icon**. |
| 3 | Manifest icons are **SVG-only**, no 192/512 PNG, and the same full-bleed SVG is declared `purpose:"maskable"` | Android WebAPK icon and splash generation are unreliable; the maskable declaration is wrong (content isn't in the safe zone), so Android double-rounds it. |
| 4 | **No install prompt UI** — `beforeinstallprompt` appears nowhere in the codebase | Nobody will ever install it, because nothing ever offers. |
| 5 | No `env(safe-area-inset-*)` despite `viewport-fit=cover` | Content under the notch and home indicator in standalone — worse than not opting in. |
| 6 | No `orientation`, `shortcuts`, `screenshots`, `id` in the manifest | Long-press shortcuts ("New task", "Inbox") and a rich install sheet are cheap, high-value "feels like an app" wins. |
| 7 | No update-available flow | A long-lived standalone session can request a chunk a deploy has deleted → error boundary. |
| 8 | `OfflineIndicator.tsx:47` says *"changes will sync when reconnected"* | **The UI lies** — there is no cache, no queue, no background sync. A warehouse user in a dead spot loses the edit and was told otherwise. |

**Recommendation: stay a PWA — don't go native.** Push already works, the manifest and SW exist, the
app is React on the web, and Android (the overwhelming majority here) supports installable PWAs fully.
A Capacitor wrapper or a React Native rewrite would cost months and buy nothing this list doesn't.

---

## 6) What is already right (do not rebuild these)

- **Deep links and the back stack.** Opening a task pushes history; closing replaces it. **Android
  Back closes the drawer correctly** — the single most important mobile behaviour, already working.
- **The assistant widget is a correct mobile component**: full-screen sheet under 520px, true
  focus-trapping modal on mobile vs non-modal popover on desktop, closes itself after an in-app
  navigation. Built with plain CSS + `matchMedia`, no new library. **This is the pattern to copy.**
  On a phone it is also arguably the *best* interface this product has — asking *"amar aj ki kaj
  ase"* beats navigating a squeezed table, so the assistant should be promoted to primary navigation
  on mobile, not left as a corner FAB.
- **Board cards** already read perfectly at phone width — full task names, wrapped titles, readable
  meta. The mobile task view should be **card-shaped like the Board, not row-shaped like the List**.
- **The auth pages** (login, forgot, reset, accept-invite) are already mobile-correct.
- **The public form's structure** — single column, labels on top, 100% controls, block submit.
- **`CreateTaskModal`**, **attachments** (`auto-fill minmax(140px)` + real click-to-upload fallback),
  **comments**, the **@mention picker** (tracks field width at any viewport), and every atom —
  `AssigneeStack`, `Avatar`, `PriorityFlag`, `DueDateBadge`, `StatusPill`, `TagChip` — are all fluid
  and size-parameterised. They need bigger defaults, not new code.
- **Statuses settings** reorders with arrow buttons rather than drag — touch-friendly by accident,
  and the pattern the other reorder UIs should copy.
- **The API, the data shapes, the permission model and the SSE inbox** need no mobile work at all.

---

## 7) What can honestly stay desktop-first

Scoping this down is the difference between a two-month project and a two-week one. These are
configuration and authoring screens used by 2–4 admins, rarely, usually at a desk. They still need
B2/B3 fixed so they are not slivers with hidden data — but they do **not** need per-row mobile
redesigns:

Form builder · Forms list · Settings → Members, Teams, Roles, Task types, Tags, Statuses, Custom
fields, Templates, Import/Export · Report detail (it is print-designed) · Sprint Board and Eng Home
(seven engineers who work on laptops).

**Must be excellent on a phone:** Home · Inbox · **the list/task view** · task detail · create-task ·
Search · **Settings → Profile** · the **public form** · all four auth pages · plus the new shell.
One more: *seeing who is on call* must work on a phone even though *setting* the rotation doesn't —
and the topbar chip that shows it is currently hidden below 480px.

**Usable, not beautiful:** `/dept`, `/reports`, `/sla` — heads do check these from phones, but
reading beats editing. Card-per-member with tap-through is enough.

---

## 8) The shape of the rebuild

Not a plan to execute yet — the shape, so it can be costed and phased one step at a time.

**The shell** (this is the unblocker, and it is ~6 files):
- Kill the 56px rail below 768px. Replace with a **bottom tab bar** — Home · Inbox · **＋** ·
  Spaces · More — plus an **overlay drawer** for the space→list tree (the tree is hierarchical and
  cannot live in a tab bar; today it simply vanishes).
- `/spaces` needs to become a real full-screen route. Today the tree exists only inside the sidebar,
  which is why B1 happens.
- Budget for the collision: the assistant FAB, its onboarding toast, the offline pill, the push
  prompt and the bulk bar all currently sit in the bottom band.
- Add an in-app back affordance (iOS has no hardware back, and the breadcrumb renders on only two
  route families).

**The cheap global pass** (mostly config, app-wide effect): 16px inputs via the verified CSS block ·
antd `controlHeight` 36→44 · `overflow:hidden` → `overflow-x:auto` at the six sites · the shared grid
track token · `100vh` → `dvh` · `env(safe-area-inset-*)` · `touch-action` on the dnd call sites ·
`lazy()` on `TaskRedirect` (−119 KB) · `retry`/`refetchOnWindowFocus` tuned for mobile.

**The six screens that need real mobile components:** the task list (card-shaped, sharing one row
component with the space browser — that turns two rewrites into one) · the calendar (an **agenda
list**, not a 7×6 grid; the data layer already produces `tasksByDay`) · the task drawer (reflow to a
bottom sheet — best ROI, it's already a vertical stack) · Home (tasks first, KPIs compressed to one
strip) · Inbox (wrapping chips, bigger targets) · Settings shell (stack, not `260px 1fr`).

**The PWA finish:** `apple-touch-icon` + PNG icons, a real fetch handler with an app-shell cache,
register the SW unconditionally, an install prompt, manifest `shortcuts`, and either make
`OfflineIndicator` tell the truth or make the offline promise real.

**Suggested order** (each is independently shippable, matching one-phase-per-go):
1. The global CSS/config pass — every screen improves, nothing is redesigned.
2. The mobile shell (bottom bar + drawer + `/spaces`) — this is what unblocks 70% of the staff.
3. The task list card component (shared with the space browser) + the task drawer reflow.
4. Home + Inbox.
5. The public form and Settings → Profile.
6. Calendar agenda view; Board touch-DnD (or drop drag on mobile and move status into the card menu).
7. The PWA finish + a Playwright mobile project so none of it regresses.

---

## 9) Gaps in this scan — stated honestly

- **No real device.** Everything was measured in headless Chromium with touch emulation at phone
  viewports. Not verified on hardware: actual iOS Safari zoom-on-focus, the `100vh` URL-bar
  overshoot, momentum scrolling, and safe-area collision on notched iPhones (the assistant button
  sits at y 769–827 of 844, so it will meet the home indicator). The touch-drag failure **was**
  reproduced with a real CDP touch gesture, so that one is proven, not inferred.
- **The comment composer and activity feed** at the bottom of the task drawer were never measured —
  the drawer's inner scroller resisted programmatic scrolling and scrolling by touch risked stray
  taps on Delete controls. Commenting is a top-3 mobile flow and is still unknown.
- **Everything was measured as Owner.** Space-scoped members see fewer sidebar entries, which may
  change (probably improve) the collapsed-rail reachability picture.
- **Empty data on three pages.** `/sla`, `/reports` and the public form have no rows in the dev
  database, so their tables and grids never rendered. Their verdicts come from column definitions
  and grid tracks — the identical `/dept` table *was* measured populated and confirms the mechanism.
- **47 tasks / 12 users is a small dataset.** No list virtualization exists anywhere; whether long
  lists stutter on a mid-range Android is untested, and the JSON-scale projection in §4 is
  arithmetic, not a load test.
- **Install behaviour unverified** — whether Chrome/Android actually refuses `beforeinstallprompt`
  here, and what iOS A2HS really produces, needs a physical phone on the production host.
- **No Core Web Vitals** — transfer sizes and time-to-visible were measured; LCP/INP/CLS were not.

---

*Companion to `SYSTEM_SCAN_2026-08-25.md` (engine/backend/database scan of the same commit).*
