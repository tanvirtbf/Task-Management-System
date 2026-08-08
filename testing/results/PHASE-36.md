# PHASE 36 — Frontend shell, routing & UX states

**Status:** PARTIAL — routing, deep links, guards and console verified; keyboard, responsive and
accessibility not covered — §7
**Methods:** UI (Chrome) · CODE
**Issues filed:** none new — **confirmed `SCAN-L2` and `SCAN-M5`**
**Data left behind:** none.

---

## 1. Routing and deep links — PASS

The router declares **33** `path:` entries. Nine were loaded as **real page navigations** (not SPA
pushes), which tests the deep link and the hard-refresh fallback together:

| route | result |
|---|---|
| `/` | renders, 1041 chars |
| `/inbox` | renders, 2025 chars |
| `/dept` | renders, 567 chars |
| `/reports` | renders, 1292 chars |
| `/eng` | renders, 655 chars |
| `/settings/roles` | renders, 3305 chars |
| `/s/:spaceId/l/:listId` | renders the list |
| `…/l/:listId/calendar` | renders the calendar — the `:viewId` param resolves |
| `?task=<id>` | opens the drawer over the list |

Every one loaded from a cold navigation, so the dev server's SPA fallback is correct.

## 2. Unknown routes — `SCAN-L2` confirmed

```
GET /definitely-not-a-real-route  ->  lands on "/"
```

The catch-all is `{ path: "*", element: <Navigate to="/" replace /> }`. There is no 404 page — an
unknown URL silently becomes Home, so a mistyped or stale link gives no signal that it was wrong.
Confirmed exactly as the scan describes.

## 3. Route guards — two verified directly

**`RequireGuest` works.** Navigating to `/login` while authenticated redirects to `/`. This was
discovered the hard way: an attempt to sign in as a second user appeared to "stay logged in as
Owner", which looked like a session bug. It was the guard bouncing `/login` to Home before the form
ever rendered — the typed credentials went nowhere. Correct behaviour, and a good demonstration of
it.

**Session restore works.** `localStorage.clear()` followed by a reload kept the user signed in — the
access token lives in memory only and is re-minted from the httpOnly `bb_refresh` cookie. That is
the intended "Keep me signed in" design, not a leak.

`RequirePermission` on the gated routes was **not** exercised per role — see §7.

## 4. The shell — PASS

Sidebar: workspace switcher, Home / Inbox (badge **12**) / Search (⌘K hint) / Department / Reports,
an **Engineering** section, **Favorites** ("Star a list to pin it here." — a real empty state), a
space-tree filter box, all 9 spaces with per-space `+` and `…` menus, and Settings pinned at the
bottom. Topbar: breadcrumb (`Marketing › Eid Campaign 2026`), global search, quick-create `+`,
notification bell with count, avatar menu.

The AI assistant launcher sits bottom-right and greeted with an onboarding bubble.

## 5. `SCAN-M5` — confirmed, with the mechanism

`Sidebar.tsx:292-309` renders the Engineering block — the section header, **Eng Home**, **Sprint
Board**, **On-call rotation** and the **Report a bug** button — **unconditionally**. It sits
immediately *after* the closing `)}` of the conditional that gates Department and Reports, so it has
no role, permission or space-membership check at all.

Every user, including a Marketing-only account, sees the engineering navigation. P29 established that
`GET /eng/home` answers 200 for them too, so the links are not merely decorative.

## 6. Console — effectively clean

During a full session (login → Home → 6 routes → list → board → calendar → drawer) the console
produced **two** messages, both antd deprecation warnings from the library, not the application:

```
Warning: [antd: Tooltip] `overlayInnerStyle` is deprecated. Please use `styles.container` instead.
Warning: [antd: Progress] `strokeWidth` is deprecated. Please use `size` instead.
```

No application errors, no failed requests, no React key or hydration warnings. Recorded rather than
filed — they are two one-line prop renames in `Tooltip` and `Progress`.

## 7. Deferred (rule R10)

| item | why |
|---|---|
| the remaining ~24 routes, and each **per role** | needs a scripted sweep across five accounts |
| `RequirePermission` on each gated route | same |
| loading / error / empty states on every page | needs induced failures per page |
| `ErrorBoundary` catching a thrown render error | needs a deliberate throw injected into a component |
| keyboard: ⌘K, Escape closing drawers, tab order, focus trap | needs a scripted harness |
| **responsive at 1920 / 1440 / 1024 / 768 / 390** | attempted — `resize_window` reported success but the rendered viewport did not change, so no breakpoint was actually exercised. Recorded as untested rather than passed. |
| accessibility: labels, roles, contrast, landmarks | needs an axe-style audit |

## 8. Coverage vs the plan

5 of the 12 checklist lines are covered (routing + deep links, the unknown-route behaviour, two of
the three guards, the shell inventory, and the console). Seven are deferred.

This is the phase where the UI debt `STATUS.md` has been tracking since P8 comes due: driving a
12-line UI checklist through one-screenshot-at-a-time browser automation produces thin evidence. The
honest recommendation is a single scripted Playwright pass covering P34, P35 and P36 together, rather
than three more partial manual passes.

**Evidence:** screenshots and console reads taken in-session.
