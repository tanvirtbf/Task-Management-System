# Frontend UI Implementation Plan — Phase-Wise

> **Goal:** Build the entire UI of the task management system with **dummy data only** (no API), so the team can visually confirm the design and flow before any backend work starts.
>
> **Mode:** Mock-first. All data comes from `src/mocks/*.ts`. TanStack Query is configured with mock fetchers that resolve to in-memory data. Mutations update local Zustand stores so the UI feels alive.
>
> **Style direction:** Professional, dense, data-rich. Inspired by Linear / Height / ClickUp 3.0 but with our own visual identity. **Not** a generic Ant Design look — heavy theme customization.
>
> **Stack reminder:** React 19 + Vite + TypeScript + Ant Design 6 + TanStack Query 5 + Zustand 5 + React Router 7 + dnd-kit + Tiptap + Recharts + FullCalendar + MapLibre.

---

## Table of Contents

0. [Design System & Conventions (cross-phase)](#0-design-system--conventions-cross-phase)
1. [Phase 1 — Foundation, Theme, Mock Layer, Auth Pages](#phase-1--foundation-theme-mock-layer-auth-pages)
2. [Phase 2 — App Shell, Sidebar, Workspace Home](#phase-2--app-shell-sidebar-workspace-home)
3. [Phase 3 — List View + Task Detail Modal](#phase-3--list-view--task-detail-modal)
4. [Phase 4 — Board View (Kanban)](#phase-4--board-view-kanban)
5. [Phase 5 — Calendar, Gantt, Timeline Views](#phase-5--calendar-gantt-timeline-views)
6. [Phase 6 — Table, Workload, Activity, Map Views](#phase-6--table-workload-activity-map-views)
7. [Phase 7 — Custom Fields, Forms (Builder + Public)](#phase-7--custom-fields-forms-builder--public)
8. [Phase 8 — Automation Builder, Templates](#phase-8--automation-builder-templates)
9. [Phase 9 — Dashboards](#phase-9--dashboards)
10. [Phase 10 — Settings Pages](#phase-10--settings-pages)
11. [Phase 11 — Inbox, Notepad, Reminders, Search, Command Palette](#phase-11--inbox-notepad-reminders-search-command-palette)
12. [Phase 12 — Polish, Empty States, Loading, Dark Mode, PWA, Animations](#phase-12--polish-empty-states-loading-dark-mode-pwa-animations)

---

## 0. Design System & Conventions (cross-phase)

These choices apply to **every phase**. Phase 1 establishes them as code.

### 0.1 Visual Identity (what makes it unique, not generic Antd)

| Element | Decision |
|---|---|
| **Primary color** | Indigo `#4F46E5` (not Antd default blue) — modern, distinct from ClickUp pink and Trello blue |
| **Accent color** | Emerald `#10B981` for success / done states |
| **Warning** | Amber `#F59E0B` |
| **Danger** | Rose `#E11D48` |
| **Background (light)** | Off-white `#FAFAFB` (sidebar `#F4F4F6`) — softer than pure white |
| **Background (dark)** | Slate `#0F172A` (sidebar `#1E293B`) — proper dark, not gray |
| **Border** | `#E5E7EB` light / `#1F2937` dark — single hairline weight |
| **Border radius** | `6px` for inputs/buttons, `8px` for cards, `10px` for modals — distinctly subtle |
| **Shadows** | Two layers only: `0 1px 2px rgba(0,0,0,0.04)` and `0 4px 12px rgba(0,0,0,0.08)`. No heavy drop shadows |
| **Font (UI)** | **Inter** loaded from Google Fonts (weights 400, 500, 600, 700) |
| **Font (numbers)** | **JetBrains Mono** for IDs, amounts, codes — gives data-rich pages a "terminal-like" precision |
| **Font sizes** | 12 (caption), 13 (body small), 14 (body), 16 (lead), 18 (h4), 22 (h3), 28 (h2), 36 (h1) |
| **Spacing scale** | 4-px grid: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64` |
| **Density** | Compact by default — rows 36px tall, padding 8/12. Power-user feel |
| **Icon library** | **Lucide React** as primary (outline, consistent stroke). Antd icons only when shadcn/lucide lacks a specific match |
| **Empty state illustrations** | Custom SVG, minimal line-art (we'll commission a small set in Phase 12) |
| **Animations** | 150ms ease-in-out for hover/focus, 200ms for modal/sheet enter, 100ms for inline edits. No bouncy springs |
| **Cursor** | `cursor: grab` for draggables, `pointer` everywhere clickable |
| **Status indicators** | Always a colored 8px dot + name + optional pill background — never icon alone |

### 0.2 Antd Theme Override (placed in `main.tsx`)

```typescript
const themeConfig = {
  token: {
    colorPrimary: '#4F46E5',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#E11D48',
    colorLink: '#4F46E5',
    colorBgLayout: '#FAFAFB',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    boxShadowSecondary: '0 4px 12px rgba(0,0,0,0.08)',
  },
  components: {
    Menu: {
      itemHeight: 32,
      itemBorderRadius: 6,
      itemMarginInline: 6,
    },
    Layout: {
      siderBg: '#F4F4F6',
      headerBg: '#FFFFFF',
      headerHeight: 48,
    },
    Table: {
      cellPaddingBlock: 8,
      cellPaddingInline: 12,
      headerBg: '#FAFAFB',
    },
    Card: {
      paddingLG: 20,
    },
    Button: {
      fontWeight: 500,
    },
  },
};
```

### 0.3 Mock Data Architecture

```
src/
├── mocks/
│   ├── index.ts                 — re-export all
│   ├── workspace.ts             — single workspace
│   ├── users.ts                 — ~12 dummy team members with avatars
│   ├── spaces.ts                — 5 spaces (Ops, Inventory, Support, Listing, Marketing)
│   ├── lists.ts                 — ~15 lists across spaces
│   ├── statuses.ts              — status sets per list
│   ├── task-types.ts            — 7 task types
│   ├── tags.ts                  — ~20 tags
│   ├── tasks.ts                 — 200+ realistic ecom tasks (orders, complaints, products)
│   ├── custom-fields.ts         — fields per list
│   ├── custom-field-values.ts   — values per task
│   ├── comments.ts              — comments per task
│   ├── attachments.ts           — fake file metadata
│   ├── activity.ts              — activity log entries
│   ├── notifications.ts         — 20+ notifications
│   ├── reminders.ts             — personal reminders
│   ├── notes.ts                 — notepad notes
│   ├── automations.ts           — 5 seeded automations
│   ├── forms.ts                 — 3 forms (Facebook Complaint, Product Request, etc.)
│   ├── webhooks.ts              — 2 webhooks
│   ├── templates.ts             — 10 templates
│   ├── dashboards.ts            — 4 dashboards with widget configs
│   └── time-entries.ts          — time tracking entries
├── lib/
│   ├── mock-api.ts              — exports object with all CRUD-shaped functions
│   ├── delay.ts                 — random 100-400ms delay to feel realistic
│   └── fake-id.ts               — uuid generator
```

Every mock function:
- Returns a Promise with a 100–400ms randomized delay
- Logs to console with `[mock] GET /tasks/:id` for visibility during dev
- Optionally injects a 5% error rate (toggle via env flag) so we can test error states

Example mock-api shape:
```typescript
export const mockApi = {
  tasks: {
    list: (params) => delay().then(() => filterTasks(params)),
    get: (id) => delay().then(() => tasks.find(t => t.id === id)),
    create: (data) => delay().then(() => insertTask(data)),
    update: (id, patch) => delay().then(() => updateTask(id, patch)),
    delete: (id) => delay().then(() => removeTask(id)),
  },
  // ...
};
```

### 0.4 Folder Structure (target after all phases)

```
client/src/
├── main.tsx
├── router.tsx
├── App.tsx
├── index.css
├── theme.ts                          — design tokens
├── mocks/                            — see above
├── lib/
│   ├── mock-api.ts
│   ├── delay.ts
│   ├── fake-id.ts
│   ├── date-utils.ts
│   ├── filter-engine.ts              — client-side filter eval
│   ├── permissions.ts
│   └── format.ts                     — money, dates, etc.
├── stores/                           — Zustand stores
│   ├── auth.ts
│   ├── ui.ts                         — sidebar collapsed, modal open, etc.
│   ├── tasks-cache.ts                — local mutations layer
│   └── notifications.ts
├── hooks/
│   ├── useTasks.ts
│   ├── useTask.ts
│   ├── useView.ts
│   ├── useMockData.ts
│   ├── usePermission.ts
│   ├── useKeyboardShortcuts.ts
│   ├── useDebounce.ts
│   └── useMediaQuery.ts
├── http/                             — kept for future; not used in mock phase
├── components/
│   ├── ui/                           — primitives (Button, Pill, etc.)
│   ├── task/                         — TaskCard, TaskRow, TaskDetail, etc.
│   ├── views/                        — ListView, BoardView, CalendarView, etc.
│   ├── editor/                       — Tiptap wrappers
│   ├── filter/                       — FilterBuilder, ConditionRow
│   ├── automation/                   — Builder steps
│   ├── form-builder/
│   ├── dashboard/                    — Widget renderer + each widget type
│   ├── icons/                        — Lucide re-exports + custom
│   └── shared/                       — EmptyState, LoadingState, ErrorBoundary
├── layouts/
│   ├── AppShell.tsx                  — sidebar + topbar + outlet
│   ├── AuthLayout.tsx                — centered card layout
│   ├── PublicFormLayout.tsx          — standalone for public forms
│   └── SettingsLayout.tsx            — settings sub-page nav
├── pages/
│   ├── auth/                         — login, accept-invitation, 2fa-setup, etc.
│   ├── home/                         — workspace home / my tasks
│   ├── space/                        — space overview
│   ├── list/                         — list view with view tabs
│   ├── task/                         — task detail standalone page
│   ├── dashboards/
│   ├── automations/
│   ├── forms/                        — form list + builder
│   ├── public-form/                  — /forms/:slug
│   ├── inbox/
│   ├── notepad/
│   ├── reminders/
│   ├── search/
│   └── settings/                     — 12 sub-pages
└── types/                            — shared TS types mirroring backend
```

### 0.5 Cross-Phase Acceptance Rules

For **every** phase to be considered "done":
- [ ] Zero TypeScript errors (`npm run build` passes)
- [ ] Zero ESLint warnings (`npm run lint` passes)
- [ ] All clickable elements have keyboard focus styles
- [ ] All text has min contrast ratio 4.5:1
- [ ] Mobile responsive (≥ 768px tablet first; mobile in Phase 12)
- [ ] All dummy data passes through Zod schemas (so swapping to real API later is one-line change)
- [ ] No real `fetch` / `axios` calls (everything via `mockApi`)
- [ ] All long lists use TanStack Virtual when items > 50
- [ ] Empty states are designed (no blank pages)
- [ ] Loading states are designed (no flicker, use skeletons)

---

# Phase 1 — Foundation, Theme, Mock Layer, Auth Pages

**Goal:** Lock the visual identity, set up the mock-data layer, build all auth-facing pages. End of phase: demoable login flow that takes you to a placeholder Home page.

### Scope

#### Routes
- `/login` — Login page
- `/login/2fa` — 2FA challenge (after login submit)
- `/invitation/:token` — Accept invitation page
- `/forgot-password` — Request reset
- `/reset-password/:token` — Set new password
- `/2fa-setup` — Authenticated 2FA setup (linked from settings later)
- `/` — Placeholder home (just renders "Welcome" — actual content in Phase 2)

#### Files to create / modify

```
src/theme.ts                                          (NEW — exports themeConfig)
src/index.css                                         (UPDATE — Inter + JetBrains Mono import, reset)
src/main.tsx                                          (UPDATE — apply theme)
src/router.tsx                                        (UPDATE — add auth routes)
src/mocks/users.ts                                    (NEW — 12 dummy users)
src/mocks/workspace.ts                                (NEW)
src/mocks/index.ts                                    (NEW)
src/lib/delay.ts                                      (NEW)
src/lib/fake-id.ts                                    (NEW)
src/lib/mock-api.ts                                   (NEW — initial: auth + workspace)
src/stores/auth.ts                                    (UPDATE — add 2fa flow state)
src/layouts/AuthLayout.tsx                            (NEW)
src/pages/auth/Login.tsx                              (UPDATE)
src/pages/auth/TwoFactorChallenge.tsx                 (NEW)
src/pages/auth/AcceptInvitation.tsx                   (NEW)
src/pages/auth/ForgotPassword.tsx                     (NEW)
src/pages/auth/ResetPassword.tsx                      (NEW)
src/pages/auth/TwoFactorSetup.tsx                     (NEW)
src/components/ui/Logo.tsx                            (NEW — proper wordmark + symbol)
src/components/ui/PasswordStrengthMeter.tsx           (NEW)
src/components/ui/FormCard.tsx                        (NEW — reusable centered card)
```

#### Components Built (UI primitives)
- `<Logo>` — wordmark "TaskHub" + 32x32 symbol (geometric mark — to be designed)
- `<FormCard>` — centered 400px-wide card with logo on top
- `<PasswordStrengthMeter>` — 5-bar indicator + label
- `<AuthLayout>` — full-screen split: left = brand panel with hero gradient + tagline + product screenshot teaser, right = form. On mobile, just the form full-width.

#### Mock auth flow
- Email + password: any email + any password ≥ 8 chars accepts. Hard-coded test users:
  - `owner@company.local` / anything → role `owner`
  - `admin@company.local` / anything → role `admin`
  - `member@company.local` / anything → role `member`
- 2FA: any 6-digit code accepts.
- After successful "login", `useAuthStore.setUser(...)` and navigate `/`.

#### Visual Direction
- Login page: split-screen.
- Left panel (50% width on desktop, hidden on mobile):
  - Gradient background `linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)`
  - Wordmark top-left
  - Center: tagline "Operations, in one place." + small product screenshot mockup
  - Bottom: "© 2026 [Company Name]"
- Right panel: white background, form vertically centered
- Form has Email, Password, "Remember me" checkbox, Login button, "Forgot password?" link
- After login click, button shows spinner inline; on success, soft fade to home

### Dummy data shape

```typescript
// src/mocks/users.ts
export const users: User[] = [
  { id: 1, firstName: "Tanvir", lastName: "Rahman", email: "owner@company.local", role: "owner", avatarUrl: null, status: "active" },
  { id: 2, firstName: "Saif", lastName: "Ali", email: "admin@company.local", role: "admin", ... },
  // 10 more across teams
];
```

### Acceptance Criteria

- [ ] Visit `/login` shows the split-screen with our brand colors
- [ ] Login with any of 3 test emails redirects to `/` (placeholder)
- [ ] Login with bad email format shows inline error
- [ ] Click "Forgot password?" → forgot password page → submitting any email shows "If account exists, email sent" success state
- [ ] Click invitation link `/invitation/test-token` shows accept page with email pre-filled
- [ ] All pages adapt to mobile (≥ 360px width)
- [ ] Refresh after login preserves auth state (Zustand persist middleware)
- [ ] Logout (will be in topbar in Phase 2) clears state

---

# Phase 2 — App Shell, Sidebar, Workspace Home

**Goal:** Build the persistent app chrome — sidebar, topbar, command palette trigger — and the workspace home page with KPI cards and "My Work" widget.

### Scope

#### Routes
- `/` — Home / My Tasks page (replaces placeholder)
- Layout: `AppShell` wraps all authenticated routes from here forward

#### Files to create

```
src/layouts/AppShell.tsx
src/components/shared/Sidebar.tsx
src/components/shared/SidebarSpaceTree.tsx
src/components/shared/Topbar.tsx
src/components/shared/UserMenu.tsx
src/components/shared/NotificationBell.tsx        (just the icon + badge; opens in Phase 11)
src/components/shared/QuickCreateButton.tsx       (FAB + dropdown)
src/components/shared/CommandPaletteTrigger.tsx   (just the search-look button; opens Phase 11)
src/components/ui/StatusPill.tsx
src/components/ui/PriorityFlag.tsx
src/components/ui/AssigneeStack.tsx               (max-3 stacked avatars + N count)
src/components/ui/TagChip.tsx
src/components/ui/DueDateBadge.tsx                (auto color: green if future, amber if today, red if overdue)
src/components/ui/EmptyState.tsx
src/pages/home/HomePage.tsx
src/pages/home/MyWorkCard.tsx
src/pages/home/AgendaCard.tsx
src/pages/home/LineupCard.tsx
src/pages/home/RemindersDueCard.tsx
src/pages/home/RecentActivityCard.tsx
src/mocks/spaces.ts
src/mocks/lists.ts
src/mocks/folders.ts
src/mocks/statuses.ts
src/mocks/task-types.ts
src/mocks/tags.ts
src/mocks/tasks.ts                                 (200+ realistic tasks)
```

#### Sidebar (left, 248px wide, collapsible to 56px)

**Sections (top to bottom):**

1. Workspace switcher (just the workspace name + chevron, dropdown will be added in V2 multi-workspace)
2. **Quick links** (icons + label):
   - 🏠 Home (`/`)
   - 📥 Inbox (`/inbox`) — with unread badge
   - 🔍 Search (`/search`) — keyboard shortcut hint `⌘K`
   - 📊 Dashboards (`/dashboards`)
3. **Favorites** (collapsible section): list of pinned items
4. **Spaces** (tree):
   - Each space: icon + name + chevron (expand/collapse)
   - Expanded space shows Folders (chevron) and Lists (no chevron)
   - Each List has tiny icons indicating views available
   - Hover: shows "+ Add list" inline + ellipsis menu
5. Bottom pinned section:
   - 📝 Notepad
   - ⏰ Reminders
   - ⚙️ Settings

Drag-to-reorder lists/folders within a space (dnd-kit).

#### Topbar (48px tall)

- Left: breadcrumb based on current route (e.g., `Operations / Facebook Orders / List`)
- Center: Command palette button (Antd `Input` look, says "Search or jump to..." with ⌘K hint)
- Right (in order):
  - Quick-create button (`+` with dropdown: New Task, New List, New Doc — V2)
  - Notification bell (badge with unread count)
  - User menu (avatar — click opens dropdown: Profile, 2FA setup, Theme toggle, Logout)

#### Home Page (`/`)

3-column grid on desktop, single column on mobile:

**Top hero row (full width):**
- Greeting: "Good afternoon, [first name]"
- Day & date
- 4 KPI cards in a row: Today's Orders, COD Collected (today), Open Complaints, Low Stock Items
  - Each card: large number (JetBrains Mono), label, sparkline showing last 7 days, color-coded trend

**Middle row:**
- Left (66%): My Work card (tabs: Today / Overdue / Next / Unscheduled / Done)
  - Each tab shows compact task list (TaskRow primitive)
- Right (33%): Agenda card (today's tasks chronologically + calendar events for today)

**Bottom row:**
- 3 columns:
  - LineUp (drag-to-prioritize queue)
  - Reminders Due Today
  - Recent Activity (last 10 entries across workspace)

### Dummy data targets

- **Spaces:** 5 (Operations, Inventory, Customer Support, Product Listing, Marketing) with icons + colors
- **Lists:** 15+ — e.g., Operations: Facebook Orders, Website Orders, Returns. Inventory: Stock Master, Purchase Orders. Support: Complaints, Queries. Listing: New Product Pipeline. Marketing: Content Calendar.
- **Tasks:** 200+ across all lists — orders with realistic Bangla customer names, Bangladesh addresses, BDT amounts, courier names (Pathao, Steadfast, RedX, Sundarban)
- **Statuses:** per-list workflows (e.g., Facebook Orders: New → Confirmed → Packed → Handed to Courier → Out for Delivery → Delivered → COD Collected → Completed)

### Acceptance Criteria

- [ ] Sidebar persistent across all authenticated routes
- [ ] Click any list in sidebar navigates to placeholder list page (Phase 3 implements)
- [ ] Sidebar collapses to 56px-wide icon rail; icons remain clickable
- [ ] Topbar shows correct breadcrumb based on URL
- [ ] User menu dropdown: clicking Logout returns to `/login`
- [ ] Home page KPI cards animate count-up on first render (0 → final number over 600ms)
- [ ] Sparklines render with real proportions to mock data
- [ ] All tabs in My Work show different filtered task subsets
- [ ] Empty states: each card has a designed "nothing here" state (test by filtering down dummy data)
- [ ] Notification bell shows badge `3` (hard-coded for now)

---

# Phase 3 — List View + Task Detail Modal

**Goal:** The single most important page — the List view of a List, with full task display, inline edit, multi-select bulk actions, and the Task Detail modal that opens on click. This is the workhorse — get it right, everything else builds on these primitives.

### Scope

#### Routes
- `/s/:spaceId/l/:listId` — List page (defaults to List view)
- `/s/:spaceId/l/:listId/:viewId` — Specific saved view
- `/t/:taskKey` — Task detail standalone page (also opens as modal overlay if navigated from a list)

#### Files to create

```
src/layouts/ListLayout.tsx                         — list header + view tabs + outlet
src/pages/list/ListPage.tsx                        — fetches list + views, renders selected view
src/components/views/ListView.tsx                  — the workhorse
src/components/views/ListViewToolbar.tsx           — group/filter/sort/Me Mode controls
src/components/views/ListViewGroup.tsx             — collapsible group of tasks
src/components/views/ListViewRow.tsx               — single task row
src/components/views/ListViewColumnHeader.tsx
src/components/views/ListViewCalculations.tsx      — footer calculations
src/components/task/TaskRow.tsx                    — compact row primitive
src/components/task/TaskDetailModal.tsx            — modal/page hybrid
src/components/task/TaskDetailHeader.tsx
src/components/task/TaskDescriptionEditor.tsx     — Tiptap wrapper
src/components/task/TaskFieldsPanel.tsx           — custom fields grid in detail
src/components/task/TaskRelationships.tsx
src/components/task/TaskActivityLog.tsx
src/components/task/InlineStatusEdit.tsx
src/components/task/InlinePriorityEdit.tsx
src/components/task/InlineAssigneeEdit.tsx
src/components/task/InlineDateEdit.tsx
src/components/task/InlineTagEdit.tsx
src/components/task/QuickCreateTaskInput.tsx       — bottom of each group "+ Add task"
src/components/task/BulkActionToolbar.tsx          — appears on multi-select
src/components/shared/Multiselect.tsx              — shift-click selection helper
src/hooks/useTasks.ts                              — TanStack Query wrapper for mock API
src/hooks/useTask.ts
src/hooks/useTaskMutations.ts
src/mocks/comments.ts
src/mocks/activity.ts
```

#### List View Detailed UX

**Top of list page (above the view tabs):**
- List name (24px font, inline editable on click)
- Subtitle: list description (smaller, gray)
- Right side: member avatars (AssigneeStack) + "+ Invite" + "•••" menu

**View tabs (just below):**
- Pill-style tabs: `List` `Board` `Calendar` `Gantt` `Table` `Workload` `Map` `Activity` `Form`
- Active tab has filled background with primary color
- `+ Add View` at the end

**Toolbar (above the list rows):**
- Left side:
  - Group by `▼` button (shows current group; click opens dropdown to change)
  - Filter `▼` button (with badge showing active filter count)
  - Sort `▼` button
  - Closed tasks toggle
  - Subtasks display mode toggle
- Right side:
  - Me Mode toggle
  - Personal column visibility settings
  - Search (input)
  - View settings ellipsis menu

**List rows:**
- Grouped by status (default). Each group has a header bar with:
  - Group icon + name + count badge
  - Collapsible chevron
  - "+ Add task in `Confirmed`" inline input button
- Row layout (36px tall):
  - Drag handle (appears on hover)
  - Checkbox (multi-select)
  - Status pill (inline edit dropdown)
  - Task name (inline editable on click)
  - Priority flag
  - Assignee stack
  - Due date badge
  - Custom field cells (each its own column based on view config)
  - Activity indicators on right (comments count, attachments count) — small icons with numbers
  - Row hover shows ellipsis menu on far right

**Column calculations footer:**
- Each numeric/money column shows aggregation:
  - Hover the column footer → shows menu: Sum / Avg / Min / Max / etc.
  - Selected calculation persists on view

**Bulk Action Toolbar:**
- Floats at bottom of screen when 1+ tasks selected
- Shows "[N] selected" + actions: Set Status / Assign / Set Priority / Set Date / Add Tag / Move / Copy / Archive / Delete
- Slide-up animation on appear

#### Task Detail Modal/Page

Hybrid pattern: opens as side-sheet drawer (right 720px wide) when navigated from a list; opens as full page if direct URL.

**Layout (drawer):**
- Drawer header: task type icon + task ID (`ORD-1042`) + "•••" menu + close X
- Body scrollable, 3 sections vertically:

  1. **Top section**
     - Task name (large, inline editable)
     - Status pill + Priority + Task Type
     - Properties grid (2 cols on tight, 3 cols on wide):
       - Assignees (avatar stack + inline picker on click)
       - Watchers (count, click to expand)
       - Due Date / Start Date (inline date pickers)
       - Time Estimate
       - Tags (chips + add)
       - Custom fields (rendered per type)

  2. **Description** (Tiptap editor with slash command menu)

  3. **Subtasks** (collapsible: shows progress `2/5 done`)
     - List of subtasks (each is a mini TaskRow)
     - "+ Add subtask" inline input

  4. **Checklists** (one per checklist)
     - Title (editable)
     - Items with checkbox + text + assignee (small)
     - "+ Add item" inline

  5. **Attachments**
     - Grid of thumbnails for images
     - Files list with icon + filename + size
     - Drag-drop zone

  6. **Comments** (sticky-bottom composer always visible)
     - Threaded comments with reactions
     - Mentions render as chips
     - Composer with Tiptap mini-editor

- Drawer footer (sticky): "Created by X · 2 days ago · ID ORD-1042"

#### Inline Editing UX (critical for feeling fast)

- Click any cell → instant edit mode
- Press Enter or click outside → save (optimistic)
- Escape → cancel
- Tab → move to next cell in row
- Status/priority/assignee/tag/date all use Antd Select/Popover, but **borderless** until clicked

### Dummy data targets

- Each task has: full property set + 0-5 subtasks + 0-3 comments + 0-2 attachments
- Activity log: ~10 entries per task showing realistic history
- Custom fields populated per list (e.g., Facebook Orders tasks have Customer Name, Phone, Address, Order Value, COD Amount, Courier)

### Acceptance Criteria

- [ ] Click any list in sidebar → loads in List view with all 50+ tasks of that list, grouped by status
- [ ] Click task row → drawer slides in from right with full detail
- [ ] Edit name inline → save on blur, persists in mock store
- [ ] Change status via dropdown → row moves to new group with smooth transition
- [ ] Multi-select 3 tasks (Shift+click range, Cmd+click discrete) → toolbar appears
- [ ] Bulk-set priority → all selected rows update
- [ ] Add subtask via inline input → appears in subtask list
- [ ] Post a comment → appears in thread with current user avatar
- [ ] React to a comment → reaction count increments
- [ ] Drag drop reorder within a group (dnd-kit) → position updates
- [ ] Drag across groups → status changes accordingly
- [ ] Group/Filter/Sort dropdowns work and persist per browser session

---

# Phase 4 — Board View (Kanban)

**Goal:** Beautiful, dense Kanban board with WIP limits and multi-task drag.

### Scope

#### Files to create

```
src/components/views/BoardView.tsx
src/components/views/BoardColumn.tsx
src/components/views/BoardCard.tsx
src/components/views/BoardSwimlane.tsx              — for subgroups
src/components/views/BoardWipLimitBadge.tsx
src/components/views/BoardColumnHeader.tsx
src/components/views/BoardAddColumnButton.tsx
```

#### Board View UX

- Columns horizontally scrolling; minimum column width 280px
- Each column header:
  - Status color dot + name + count badge + WIP limit display (e.g., `3 / 5`)
  - Right: collapse chevron + ellipsis menu
  - WIP limit visualization: count turns red when over
- Card layout:
  - Compact (default) OR Comfortable (toggle in view settings)
  - Shows: priority flag + task name (1-2 lines) + bottom row with assignee avatars + due date + comment/attach counts
  - Custom fields configurable to show on card (via view settings)
- Drag-drop:
  - Single card: drag within or across columns
  - Multi-select cards (click first then shift-click): drag together
  - Column-level: drag column headers to reorder columns (corresponds to status reorder)
- Subgroups (swimlanes):
  - When enabled, columns become a 2D grid: status × subgroup field
- Add task inline in any column (bottom "+ Add task")

### Acceptance Criteria

- [ ] Board view selectable via view tab
- [ ] All tasks of list appear in correct columns
- [ ] Drag card across columns → status changes
- [ ] WIP limit indicator turns red when count exceeds limit
- [ ] Subgroups toggle creates swimlane grid
- [ ] Multi-card drag works
- [ ] Card customization (which fields show) persists per view

---

# Phase 5 — Calendar, Gantt, Timeline Views

**Goal:** Three time-based views, each polished.

### Scope

#### Files

```
src/components/views/CalendarView.tsx              — wraps FullCalendar
src/components/views/CalendarEventCard.tsx
src/components/views/CalendarUnscheduledPanel.tsx
src/components/views/GanttView.tsx                 — frappe-gantt or custom
src/components/views/GanttToolbar.tsx              — zoom + view options
src/components/views/TimelineView.tsx              — custom horizontal swimlanes
src/components/views/TimelineSwimlane.tsx
src/components/views/TimelineBar.tsx
src/lib/gantt-data-adapter.ts
```

#### Calendar View

- Month / Week / 4-Day / Day modes (toggle in toolbar)
- Tasks rendered as colored event bars (color = status color)
- Drag event to new day → due date updates
- Resize event horizontally → duration updates (changes start_date)
- Click empty cell → quick-create task with that due date
- Unscheduled panel (right sidebar, toggleable):
  - Shows tasks without dates
  - Drag onto calendar to schedule
- Mini month picker in toolbar for navigation
- Today button + previous/next arrows

#### Gantt View

- Horizontal timeline with tasks as bars
- Bar color: status; opacity reduced if archived
- Dependencies rendered as arrows
- Hover dependency arrow shows the relationship type
- Drag bar to shift dates; drag edge to resize
- Click + drag from bar edge to another bar → create "waiting on" relationship
- Milestones: diamond at due_date
- Critical path: highlight in red (toggle in toolbar)
- Show progress bar inside each task bar (% complete from subtasks)
- Zoom levels: Day / Week / Month
- Left panel: task list (collapsible)

#### Timeline View

- Similar to Gantt but with grouping/swimlanes
- No dependency arrows
- Drag tasks between swimlanes to reassign

### Acceptance Criteria

- [ ] Calendar drag-to-reschedule updates mock data
- [ ] Unscheduled panel drag-to-schedule works
- [ ] Gantt dependency arrows render correctly
- [ ] Drag bar in Gantt updates dates
- [ ] Critical path toggle highlights chain
- [ ] Timeline swimlanes by assignee shows everyone's load
- [ ] All three views maintain filter state shared with List view

---

# Phase 6 — Table, Workload, Activity, Map Views

**Goal:** The remaining 4 views, completing the 9-view set.

### Scope

#### Files

```
src/components/views/TableView.tsx                 — TanStack Table
src/components/views/TableViewCell.tsx
src/components/views/TableViewExportButton.tsx
src/components/views/WorkloadView.tsx
src/components/views/WorkloadCell.tsx
src/components/views/WorkloadCapacityRow.tsx
src/components/views/ActivityView.tsx
src/components/views/ActivityRow.tsx
src/components/views/MapView.tsx                   — MapLibre wrapper
src/components/views/MapPin.tsx
src/components/views/MapPinPopup.tsx
```

#### Table View
- Spreadsheet-like grid using TanStack Table
- Resizable columns (drag column edges)
- Frozen first column (task name)
- Click cell → instant edit mode
- Copy-paste cell values (Ctrl+C / Ctrl+V)
- Keyboard nav: arrow keys, Enter to confirm, Tab to next
- Export to CSV / Excel (Excel via xlsx library)
- Calculation footer (sum/avg/etc.)

#### Workload View
- Rows: assignees
- Columns: days/weeks (toggle period)
- Each cell shows: task count OR time estimate sum
- Color: green (<80% capacity), amber (80-100%), red (>100%)
- Click cell → list of tasks for that user on that day
- Drag tasks between rows → reassign
- Capacity adjustable per user

#### Activity View
- Reverse-chronological list
- Filters: date range, user, action type
- Each entry: avatar + "did X" + when (relative time) + before→after diff
- Click entry → opens related task in drawer

#### Map View
- MapLibre GL JS with OpenFreeMap tiles (free, no API key)
- Centered on Dhaka by default
- Pins for tasks with location custom field
- Pin color: by status (configurable)
- Cluster pins when zoomed out
- Click pin → popup with task summary + "Open" button
- Sidebar list of tasks visible on current viewport

### Acceptance Criteria

- [ ] Table view edits propagate to other views (shared cache)
- [ ] Workload colors match capacity logic
- [ ] Activity feed loads 50 entries with infinite scroll for more
- [ ] Map renders all tasks with valid locations as clustered pins

---

# Phase 7 — Custom Fields, Forms (Builder + Public)

**Goal:** All 13 custom field types render correctly + form builder + public form page.

### Scope

#### Files

```
src/components/custom-field/CustomFieldRenderer.tsx
src/components/custom-field/fields/TextField.tsx
src/components/custom-field/fields/LongTextField.tsx
src/components/custom-field/fields/NumberField.tsx
src/components/custom-field/fields/MoneyField.tsx
src/components/custom-field/fields/DateField.tsx
src/components/custom-field/fields/DropdownField.tsx
src/components/custom-field/fields/LabelsField.tsx
src/components/custom-field/fields/CheckboxField.tsx
src/components/custom-field/fields/PhoneField.tsx
src/components/custom-field/fields/UrlField.tsx
src/components/custom-field/fields/FilesField.tsx
src/components/custom-field/fields/PeopleField.tsx
src/components/custom-field/fields/LocationField.tsx
src/components/custom-field/fields/FormulaField.tsx     (read-only)
src/components/custom-field/fields/ProgressField.tsx
src/components/custom-field/fields/RatingField.tsx
src/components/custom-field/fields/EmailField.tsx
src/components/custom-field/CustomFieldManager.tsx      — admin UI to add/edit fields
src/components/form-builder/FormBuilder.tsx
src/components/form-builder/FormFieldPalette.tsx
src/components/form-builder/FormCanvas.tsx
src/components/form-builder/FormFieldProperties.tsx
src/components/form-builder/FormConditionalLogicBuilder.tsx
src/components/form-builder/FormBrandingPanel.tsx
src/components/form-builder/FormSettingsPanel.tsx
src/pages/forms/FormsListPage.tsx
src/pages/forms/FormBuilderPage.tsx
src/pages/forms/FormSubmissionsPage.tsx
src/pages/public-form/PublicFormPage.tsx
src/layouts/PublicFormLayout.tsx                       — no sidebar, standalone
src/mocks/forms.ts
src/mocks/form-submissions.ts
```

#### Each field type — visual treatment
- **Text:** plain input
- **Long Text:** auto-expanding textarea
- **Number:** input with optional unit suffix
- **Money:** input with currency symbol prefix (৳ for BDT), proper formatting
- **Date:** Antd DatePicker with optional time
- **Dropdown:** color-coded select with circular color indicator
- **Labels:** multi-select chips with color
- **Checkbox:** simple toggle
- **Phone:** input with country flag dropdown + format on blur
- **URL:** input with little link icon, auto-prepend `https://`
- **Files:** drag-drop + grid of attached files
- **People:** searchable user picker, multi-mode if config allows
- **Location:** input with autocomplete + small inline map preview
- **Formula:** read-only display with calculator icon
- **Progress:** circular or bar progress + edit modal for manual
- **Rating:** star/heart/thumbs icons (configurable)
- **Email:** input + validate + clickable in display

#### Custom Field Manager
- Settings page subpage `/settings/custom-fields`
- Grouped by scope (workspace / space / list)
- Each field: name, type, required, position
- Drag to reorder
- Edit triggers a modal with type-specific config

#### Form Builder
- 3-pane layout:
  - Left: palette (field types + existing custom fields)
  - Center: form canvas (drag-drop fields, click to select)
  - Right: properties panel (label, required, conditional logic)
- Top tabs: Builder / Conditional Logic / Settings / Branding / Preview
- Preview tab renders form as user would see it
- Settings: redirect URL, reCAPTCHA toggle, login required toggle
- Branding: primary color picker, logo upload, layout (1 or 2 col)
- Conditional logic builder: visual if-then rules

#### Public Form Page
- Standalone (`/forms/:slug`) — no sidebar
- Branded per form settings (custom color, optional logo, background)
- Rendered fields per form order
- Submit button
- Success state: configurable message OR redirect

### Acceptance Criteria

- [ ] All 17 field types (13 + extras: rating, email, formula, progress) render in task detail
- [ ] Custom Field Manager allows creating + editing + deleting fields
- [ ] Form builder drag-drop works
- [ ] Conditional logic preview correctly hides/shows fields
- [ ] Public form `/forms/facebook-complaint-intake` shows beautiful standalone form
- [ ] Submitting public form creates mock task + redirects to thank-you

---

# Phase 8 — Automation Builder, Templates

**Goal:** Visual automation builder with trigger/conditions/actions + template library page.

### Scope

#### Files

```
src/pages/automations/AutomationsListPage.tsx
src/pages/automations/AutomationBuilderPage.tsx
src/pages/automations/AutomationRunsPage.tsx                — execution history
src/components/automation/TriggerCard.tsx
src/components/automation/TriggerTypeSelector.tsx
src/components/automation/ConditionsBuilder.tsx
src/components/automation/ConditionRow.tsx
src/components/automation/ActionsBuilder.tsx
src/components/automation/ActionRow.tsx
src/components/automation/ActionTypeSelector.tsx
src/components/automation/AutomationPreview.tsx              — natural-language preview
src/components/automation/TemplateVariablePicker.tsx         — for {{task.name}} etc.
src/pages/templates/TemplatesListPage.tsx
src/pages/templates/TemplateDetailPage.tsx
src/mocks/automations.ts
src/mocks/automation-runs.ts
src/mocks/templates.ts
```

#### Automation Builder UX
- 3-step vertical wizard (always visible, not separate screens):
  1. **Trigger** card
     - Select trigger type (dropdown grouped: Task Lifecycle, Field Changes, Time-based, External)
     - Configure trigger parameters
  2. **Conditions** card (optional, collapsible)
     - "+ Add condition" → adds a ConditionRow (field / operator / value)
     - AND/OR toggle between conditions
  3. **Actions** card
     - Sequential list of actions
     - Drag to reorder
     - "+ Add action" → dropdown picker
- Sticky bottom: natural-language preview
  - Example: "When a task's **status changes to Confirmed**, if **priority is Urgent**, then **assign to @Packing Team** and **send notification to @Ali**."
  - Save button + test button

#### Template Variables
- Whenever a text field accepts templates: small `{ }` button opens a picker
- Picker shows: task.name, task.id, task.status, task.due_date, task.assignees, custom fields, trigger.actor, now
- Click variable → inserts `{{path}}` syntax

#### Templates Page
- Grid of template cards by type (Task / List / Folder / Space / Doc / Checklist / Form)
- Each card: thumbnail/preview + name + description + creator + share dropdown
- "Create Template" button → captures from existing entity
- Click card → opens "Apply Template" modal

### Acceptance Criteria

- [ ] Create automation with trigger + 2 conditions + 3 actions saves to mock store
- [ ] Natural-language preview generates correctly
- [ ] Template variables picker works
- [ ] Test mode runs automation against fake event → shows simulated actions log
- [ ] Templates list shows 10+ seeded templates

---

# Phase 9 — Dashboards

**Goal:** Dashboard pages with all widget types + drag-resize widget editor.

### Scope

#### Files

```
src/pages/dashboards/DashboardsListPage.tsx
src/pages/dashboards/DashboardPage.tsx
src/pages/dashboards/DashboardEditMode.tsx
src/components/dashboard/DashboardGrid.tsx               — react-grid-layout
src/components/dashboard/WidgetRenderer.tsx
src/components/dashboard/widgets/NumberWidget.tsx
src/components/dashboard/widgets/PieWidget.tsx
src/components/dashboard/widgets/BarWidget.tsx
src/components/dashboard/widgets/LineWidget.tsx
src/components/dashboard/widgets/AreaWidget.tsx
src/components/dashboard/widgets/TableWidget.tsx
src/components/dashboard/widgets/TaskListWidget.tsx
src/components/dashboard/widgets/CalculationWidget.tsx
src/components/dashboard/widgets/EmbedWidget.tsx
src/components/dashboard/widgets/TextWidget.tsx
src/components/dashboard/AddWidgetModal.tsx
src/components/dashboard/WidgetConfigPanel.tsx
src/components/dashboard/DateRangePicker.tsx
src/mocks/dashboards.ts
```

#### Dashboard Page UX
- Top: dashboard name + description + share button + date range picker + edit mode toggle
- Grid of widgets (12-column responsive grid using `react-grid-layout`)
- Edit mode: widgets get drag handles + resize handles + delete X
- Add widget: floating "+ Widget" → modal with widget type cards (icon + name + description)
- Widget config: side drawer with type-specific options

#### Seed dashboards (4)
1. **Owner Dashboard** (full workspace)
   - Today's Orders (number)
   - Orders by Status (pie)
   - COD Collected (number)
   - Revenue last 14 days (line)
   - Return Rate (number)
   - Low Stock Items (number)
   - Open Complaints (number)
   - Team Workload (bar)
2. **Operations Dashboard**
3. **Support Dashboard**
4. **Marketing Dashboard**

#### Visual treatment
- Each widget: subtle border, no heavy shadow
- Numbers in JetBrains Mono for precision feel
- Color usage purposeful: green for positive trends, red for negative, primary for neutral
- Pie/bar use a limited palette: indigo, emerald, amber, sky, violet, rose

### Acceptance Criteria

- [ ] All 4 seed dashboards render with realistic numbers
- [ ] Each widget type renders correctly with mock data
- [ ] Edit mode allows drag/resize/delete
- [ ] Date range filter updates all widgets simultaneously
- [ ] Add widget flow creates new widget on grid

---

# Phase 10 — Settings Pages

**Goal:** All 12+ settings sub-pages.

### Scope

#### Files

```
src/layouts/SettingsLayout.tsx                       — left nav + right content
src/pages/settings/ProfileSettings.tsx
src/pages/settings/PasswordSettings.tsx
src/pages/settings/TwoFactorSettings.tsx
src/pages/settings/NotificationsSettings.tsx
src/pages/settings/AppearanceSettings.tsx            — theme toggle, density, language
src/pages/settings/IntegrationsSettings.tsx          — Gmail, Google Calendar connect cards
src/pages/settings/UsersSettings.tsx                 — admin: list + invite + edit role
src/pages/settings/InviteUserModal.tsx
src/pages/settings/WorkspaceSettings.tsx
src/pages/settings/SpacesSettings.tsx                — manage spaces
src/pages/settings/StatusesSettings.tsx              — manage statuses per space
src/pages/settings/TaskTypesSettings.tsx
src/pages/settings/TagsSettings.tsx
src/pages/settings/CustomFieldsSettings.tsx          — workspace-level
src/pages/settings/ClickAppsSettings.tsx             — toggle modular features
src/pages/settings/WebhooksSettings.tsx
src/pages/settings/TemplatesSettings.tsx
src/pages/settings/BillingSettings.tsx               — V2 placeholder ("not applicable — internal use")
```

#### Settings Layout
- Left rail (220px): grouped nav
  - **Account:** Profile, Password, 2FA, Notifications, Appearance, Integrations
  - **Workspace:** General, Members, Spaces, Statuses, Task Types, Tags, Custom Fields, ClickApps, Webhooks, Templates
- Right pane: form-based content per page
- Each page: clear section headings, "Save" button at bottom of changed sections

#### Specific page UX highlights

**Profile:** avatar upload + name/timezone/locale + delete account button (with confirmation)

**2FA Settings:** if disabled: shows QR code + manual key + 6-digit input to enable. If enabled: shows backup codes button + disable button (password reverify)

**Notifications:** matrix table (event type rows × channel columns) of checkboxes + DND time picker

**Users (admin):** Antd Table of users with avatar, name, email, role, last active, status (active/deactivated) + invite button + per-row actions

**ClickApps:** card grid of all ClickApps with on/off toggles + each has "Configure" if applicable

**Statuses:** color-coded reorderable list per scope with "+ Add status" + delete (with reassign modal)

### Acceptance Criteria

- [ ] All 17 settings sub-pages exist and route correctly
- [ ] Each page has at least mockup-level fidelity
- [ ] Mutations (e.g., change name) update mock store and persist across navigation
- [ ] Invite user modal creates pending invitation entry
- [ ] Admin-only pages hidden from Member role

---

# Phase 11 — Inbox, Notepad, Reminders, Search, Command Palette

**Goal:** Personal productivity surfaces.

### Scope

#### Files

```
src/pages/inbox/InboxPage.tsx
src/pages/inbox/InboxList.tsx
src/pages/inbox/InboxItemRow.tsx
src/pages/inbox/InboxDetailPanel.tsx
src/pages/notepad/NotepadPage.tsx
src/pages/notepad/NoteEditor.tsx
src/pages/reminders/RemindersPage.tsx
src/pages/reminders/CreateReminderModal.tsx
src/pages/search/SearchPage.tsx
src/components/shared/CommandPalette.tsx                 — Cmd-K modal
src/components/shared/CommandPaletteItem.tsx
src/hooks/useGlobalKeyboardShortcuts.ts
src/mocks/notifications.ts
src/mocks/notes.ts
src/mocks/reminders.ts
```

#### Inbox UX
- Split view (60/40):
  - Left: notification list grouped by date (Today / Yesterday / This Week / Earlier)
  - Right: opened item preview (task or comment context)
- Tabs at top: Unread (default) / Snoozed / Cleared
- Each row: actor avatar + summary line + time + snooze/archive icons (visible on hover)
- Keyboard nav: J/K (up/down), E (archive), Z (snooze), X (mark read)
- Mobile: list-only with swipe gestures

#### Notepad
- Single-column layout
- Left: list of notes (recent first) + "+ New note" button
- Right: Tiptap editor for selected note
- Auto-save on type (debounced 1s)
- "Convert to task" button → modal to pick list

#### Reminders
- Two sections: Due Today, Upcoming, Completed (collapsible)
- Each reminder: title + due time + actions
- "+ New reminder" button → modal with title / due date+time / notes / recurrence / delegate-to
- Mark complete with checkbox

#### Search Page
- Full-screen layout
- Search input at top (focuses on `/` shortcut)
- Filter chips: Type (Task / Comment / Note / Doc) / Space / Date Range / Owner
- Results grouped by type
- Empty state: "Try searching for an order ID, customer name, product, or campaign"

#### Command Palette (Cmd+K)
- Modal centered, 600px wide, 50% screen height max
- Search input + grouped results:
  - Quick actions (Create Task, Create List, Switch Space, etc.)
  - Recent items
  - Tasks matching query
  - People matching query
- Keyboard nav: up/down arrows, Enter to select
- Footer with hint: ↑↓ to navigate, ↵ to select, esc to close

### Acceptance Criteria

- [ ] Inbox shows 20+ mock notifications grouped correctly
- [ ] Snoozing a notification removes from Unread, appears in Snoozed
- [ ] Notepad CRUD works with autosave
- [ ] Reminders create + complete + delegate flow works
- [ ] Search finds tasks/comments/notes matching query
- [ ] Cmd+K opens command palette from anywhere
- [ ] Command palette can navigate to any list/task

---

# Phase 12 — Polish, Empty States, Loading, Dark Mode, PWA, Animations

**Goal:** Take everything from "functional" to "delightful." Production-ready.

### Scope

#### Polish checklist

**Loading states:**
- Skeleton screens for every page (mimics final layout)
- Inline spinners only for buttons during submit
- No spinner spam — use skeletons for >300ms loads, instant for <300ms

**Empty states:**
- Every empty surface has a designed empty state:
  - Custom SVG illustration (commission 10-15 minimal line-art pieces)
  - Title + description + clear CTA
- Examples:
  - Empty list: "No tasks yet" + "Create your first task" CTA
  - Empty search: "Nothing found for `<query>`" + suggestions
  - Empty inbox: "All caught up!" + relax illustration

**Dark mode:**
- Theme toggle in user menu
- Stored in localStorage + Zustand
- All antd tokens have dark variants in `theme.ts`
- Custom components tested in dark

**Animations:**
- Page transitions: 100ms fade between routes
- Modal/sheet enter: 200ms slide
- Toasts: bottom-right slide-in
- Toggle/checkbox: subtle 80ms scale
- Tab change: underline glide 150ms

**PWA:**
- `manifest.webmanifest` with icons (192, 512)
- Service worker via `vite-plugin-pwa` — static asset cache
- Install prompt button when installable
- Offline indicator banner if `navigator.onLine === false`

**Accessibility:**
- Verify all focus rings
- Verify color contrast (use Lighthouse)
- Keyboard nav through every page
- Screen reader labels on icon-only buttons
- `aria-live` regions for toasts

**Mobile-specific:**
- Bottom nav bar on mobile (Home / Inbox / Search / Profile)
- Sidebar becomes drawer on mobile (hamburger)
- Touch targets ≥ 44px
- Long-press for context menu instead of right-click

**Toast notifications:**
- `<Toaster>` component using sonner library or antd notification
- Used for: task created, automation ran, errors, network status changes

**Error boundaries:**
- Root-level ErrorBoundary that catches React errors → friendly screen
- Per-page ErrorBoundary for granular recovery

**404 page:**
- Friendly 404 with illustration + back button

**Demo mode banner:**
- Top banner: "Demo mode — using mock data. No backend connected." with X to dismiss

#### Files

```
src/components/shared/Skeleton.tsx                 — variants per content type
src/components/shared/Toaster.tsx
src/components/shared/ErrorBoundary.tsx
src/components/shared/OfflineIndicator.tsx
src/components/shared/MobileBottomNav.tsx
src/components/shared/DemoModeBanner.tsx
src/pages/NotFoundPage.tsx
src/illustrations/                                  — SVG empty state illustrations
src/lib/theme-switcher.ts
src/hooks/useTheme.ts
src/main.tsx                                        — wrap in ErrorBoundary, register SW
public/manifest.webmanifest
public/icons/icon-192.png
public/icons/icon-512.png
public/icons/apple-touch-icon.png
```

### Acceptance Criteria

- [ ] Lighthouse: Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 90, PWA ≥ 90
- [ ] Every page has skeleton during load
- [ ] Every empty state has a designed illustration
- [ ] Dark mode works on all pages with no contrast issues
- [ ] Mobile: bottom nav + drawer sidebar + responsive layouts
- [ ] PWA installable on Chrome desktop + Safari iOS
- [ ] Offline indicator shows when offline
- [ ] Toasts appear for all success/error events
- [ ] 404 page renders for unknown routes
- [ ] No console errors or warnings

---

## Workflow — How to use this plan

When ready to start each phase, say to Claude:

> "Implement Phase 1 from FRONTEND_UI_PLAN.md"

Claude will then:
1. Create/modify the files listed in that phase
2. Generate the mock data shape if not already present
3. Implement the routes + components
4. Verify acceptance criteria one by one
5. Show a summary of what was built and how to test it

**Important:** Phases are sequential. Don't skip — each builds on the previous (especially Phase 1 design system + Phase 2 layout + Phase 3 task primitives).

After each phase, **review visually** at `npm run dev`:
- Click through every new page
- Test every new interaction
- Check mobile view
- Note any visual or UX changes you want before moving to the next phase

## Phase Estimates (rough)

| Phase | Estimate |
|---|---|
| 1 — Foundation, Theme, Auth | 2-3 days |
| 2 — App Shell, Sidebar, Home | 3-4 days |
| 3 — List View + Task Detail | 5-7 days (the big one) |
| 4 — Board View | 2-3 days |
| 5 — Calendar/Gantt/Timeline | 4-5 days |
| 6 — Table/Workload/Activity/Map | 4-5 days |
| 7 — Custom Fields + Forms | 5-6 days |
| 8 — Automation + Templates | 4-5 days |
| 9 — Dashboards | 3-4 days |
| 10 — Settings | 3-4 days |
| 11 — Inbox/Notepad/Reminders/Search | 3-4 days |
| 12 — Polish | 4-5 days |
| **Total** | **~42-55 days** (8-11 weeks solo, 4-6 weeks with a designer in parallel) |

## After Phase 12 — Backend Integration

When the UI is approved end-to-end:
1. Swap `mockApi` for real `api` (axios instance already exists in `src/http/client.ts`)
2. TanStack Query keys and shapes already match real API by design
3. Add real auth (replace mock auth check with cookie-based)
4. Add WebSocket subscription per SRS §22
5. All UI components remain unchanged

This separation is the key value of the mock-first approach — the frontend is "done" before any API is built, and the design is locked.

---

*Generated 2026-05-26. Update this file when scope changes per phase.*
