# What BeautyBooth Actually Needs

> A ground-up redesign — fresh thinking after recognising the current build
> is over-engineered for a 100-person Bangladesh ecommerce operation.
>
> This document supersedes earlier `API_DESIGN.md` and DB-design files.

---

## Part 1 — Strategic context (read this first)

### Who you are

- **BeautyBooth** — Bangladesh ecommerce (dried fish)
- **~100 employees** across Operations, Inventory, Customer Support, Product Listing, Marketing
- **Sales channels:** Facebook (primary) + own website + POS
- **Couriers:** Pathao, Steadfast, RedX, Sundarban
- **Payment:** mostly **COD**, some bKash/Nagad/website prepaid
- **Volume:** estimate 50-300 orders/day, 5-20 complaints/day, 10-30 new product listings/week

### What you already have (don't rebuild!)

| System                     | Function                                         | Owns                         |
| -------------------------- | ------------------------------------------------ | ---------------------------- |
| **Website**                | Order intake, product catalog, inventory display | Orders, products, customers  |
| **POS**                    | In-store sales                                   | Walk-in sales                |
| **Existing sales tracker** | Purchase → sell → return flow                    | Money, stock counts, returns |

### So what does a task management system actually do for you?

**It's the people-coordination layer ON TOP of those systems.**

It handles:

1. **Who does what, when** — order ke confirm korbe, ke pack korbe, ke courier dibe
2. **Cross-team handoffs** — listing team → marketing team → operations
3. **Exception workflows** — when an order goes wrong, who handles it
4. **Process pipelines** that aren't transactional data — product listing 7-step pipeline, campaign planning
5. **Recurring operational checklists** — daily order check, weekly stock audit
6. **Customer support workflow** — intake → investigate → resolve

**It does NOT need to:**

- Re-store your orders (website has them)
- Re-store your products (website has them)
- Re-store your customer database (you have it)
- Replace your POS
- Run reports your sales tracker already runs

**The killer feature is integration.** Without `website → auto-task on new order` integration, this becomes a parallel manual system. With it, this becomes the **operational nerve center**.

---

## Part 2 — Your 6 actual workflows (this drives every feature decision)

### 2.1 Order fulfillment (Operations team)

- **Trigger:** New order on website / Facebook DM converted to order
- **Stages:** New → Confirmed → Packed → Handed to Courier → Out for Delivery → Delivered → COD Collected → Completed (or Cancelled/Return/Exchange)
- **Team:** ~40 people (confirmers, packers, dispatch, accounts)
- **Volume:** 50-300/day
- **Best UI:** Kanban board with status columns. Cards show: order #, customer phone, COD amount, due date. Click → details.
- **Critical fields:** Phone, Order Value, COD Amount, Courier, Tracking #, Address

### 2.2 Customer complaint handling (CS team)

- **Trigger:** Facebook DM, phone call, FB page comment, website contact form, courier complaint
- **Stages:** New → Acknowledged → Investigating → Resolution Pending → Resolved
- **Team:** ~10 people
- **Volume:** 5-20/day
- **Best UI:** List view + public form for FB complaint intake link
- **Critical fields:** Channel (FB/Phone/Web/Email/Courier), Order ID reference, Customer phone, Resolution type (Refund/Replace/Explain), Photos
- **SLA:** 24-hour first response

### 2.3 Product listing pipeline (Listing team)

- **Trigger:** New product source/idea
- **Stages:** Idea → Research → Photoshoot → Photos In → Content Writing → Pricing Approved → Uploaded to Website → Active
- **Team:** ~5-10 people
- **Volume:** 10-30 products/week
- **Best UI:** Per-task **checklist** of 7 steps + Board view by stage
- **Critical fields:** Source supplier, Photo URLs, Pricing, Website link

### 2.4 Marketing campaigns (Marketing team)

- **Trigger:** Festival approaching, new product launch, weekly content schedule
- **Stages:** Concept → Creative brief → Design → Approval → Scheduled → Live → Measured
- **Team:** ~5 people
- **Volume:** 5-10 campaigns/month + ongoing content
- **Best UI:** **Calendar view** is the killer here — schedule posts by day
- **Critical fields:** Channel (FB/Insta/Email), Budget, Boost spend, Scheduled date

### 2.5 Inventory management (Inventory team)

- **Trigger:** Low stock alert (from your existing system), supplier follow-up, damaged item incident
- **Stages:** vary by task type
- **Team:** ~5-10 people
- **Volume:** 10-30 tasks/week
- **Best UI:** List view + recurring weekly stock audit task
- **Critical fields:** Supplier, PO number, Quantity, Expected delivery

### 2.6 Owner / manager oversight

- **Trigger:** Twice-a-day check-in
- **Need:** Single-page snapshot of operational health
- **Best UI:** **Home page** with 6 KPI cards + 3 list widgets
- **Metrics:**
  1. Orders confirmed today (count + ⏱ change from yesterday)
  2. COD collected today (₹/৳ amount + collected vs pending)
  3. Open complaints (count + breakdown by SLA bucket)
  4. Stuck orders (in "Confirmed" >2h)
  5. Low stock items
  6. Tasks assigned to me

---

## Part 3 — EXACT feature list (the keep list — 17 modules)

> Each row = a module that stays. Anything not listed below = drop.

| #   | Module                                                                                                  | Why it's essential                                                                                      | Effort      |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | **Email + password login**                                                                              | Need auth, but no 2FA, no SSO                                                                           | Done        |
| 2   | **Two roles only: Admin / Member**                                                                      | 100 ppl one company — Owner/Admin/Member/Guest is overkill. Admin = manage workspace, Member = do tasks | Simplify    |
| 3   | **5 fixed spaces** (Operations / Inventory / CS / Listing / Marketing)                                  | Matches your org structure exactly                                                                      | Done        |
| 4   | **Lists inside spaces** (~14 lists, flat — no folders)                                                  | Order list per channel, complaint list per channel, etc.                                                | Done        |
| 5   | **Per-list status workflow** with 4 groups (not_started / active / done / closed)                       | THE order workflow with COD step is the killer feature                                                  | Done        |
| 6   | **Tasks** with: name, description (plain), status, assignee (single or multi), due date, priority, tags | Core                                                                                                    | Done        |
| 7   | **Custom Task IDs** (`ORD-1042`, `CPL-15`, etc.) per list                                               | Operations team will refer to "ORD-1042" verbally                                                       | Done        |
| 8   | **Checklists** on tasks (lightweight, single assignee per item)                                         | For product listing pipeline                                                                            | Done        |
| 9   | **Comments** (flat, simple — NO threading, NO reactions, NO resolve workflow)                           | Just chronological notes                                                                                | Simplify    |
| 10  | **Attachments** (image upload, no lightbox — click to download)                                         | Damage photos, packing labels                                                                           | Simplify    |
| 11  | **Tags** (workspace-wide, simple) — not space-scoped                                                    | "urgent", "vip-customer", "festival", etc.                                                              | Simplify    |
| 12  | **6 custom field types only:** Text, Phone, Money (BDT), Date, Dropdown, Files                          | Drop the other 11 types                                                                                 | Simplify    |
| 13  | **3 views: List + Board + Calendar**                                                                    | List=default, Board=operations, Calendar=marketing                                                      | Keep these  |
| 14  | **Public form** for FB complaint intake (no conditional logic, no reCAPTCHA)                            | Shareable URL, auto-creates task                                                                        | Simplify    |
| 15  | **Notifications:** in-app bell + email only                                                             | No push, no SMS in V1                                                                                   | Simplify    |
| 16  | **Search** (global, fuzzy, by name or custom ID)                                                        | "Find ORD-1042"                                                                                         | Done        |
| 17  | **Recurring tasks** — simple Daily or Weekly toggle (no cron)                                           | Daily order check, weekly stock audit                                                                   | Simplify    |
| 18  | **Owner Home page** — 6 fixed KPI cards + 3 list widgets (NOT a dashboard builder)                      | The actual reporting                                                                                    | Build fresh |
| 19  | **Mobile-responsive web** (no PWA, no native app)                                                       | Managers check phone                                                                                    | Keep        |
| 20  | **Activity log per workspace** (light — for audit)                                                      | Who did what when                                                                                       | Simplify    |

That's **20 features** for the V1 system. Everything else is V2 or never.

---

## Part 4 — What to DELETE (cleanup list with file paths)

### 4.1 DELETE — entire views (3 views = ~2,300 lines of code)

| View                      | File                                    | Reason                                                 |
| ------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Gantt                     | `src/components/views/GanttView.tsx`    | No multi-month projects — operations is daily          |
| Timeline                  | `src/components/views/TimelineView.tsx` | Same — duplicate of Gantt                              |
| Workload                  | `src/components/views/WorkloadView.tsx` | Managers know team capacity — no tool needed           |
| Activity (workspace view) | `src/components/views/ActivityView.tsx` | Per-task activity is enough; workspace stream is noise |
| Map                       | `src/components/views/MapView.tsx`      | Courier already maps zones; defer to V2 if asked       |
| Table                     | `src/components/views/TableView.tsx`    | List view covers same need with less complexity        |

### 4.2 DELETE — task detail sub-features (~3,500 lines)

| Feature                      | Files                                                                                          | Reason                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Subtasks**                 | `SubtasksSection.tsx`                                                                          | Use checklist instead (lighter)                             |
| **Task Dependencies**        | `DependenciesSection.tsx` + `task-dependencies.ts` mocks                                       | Operations don't track blocks; checklist sequence is enough |
| **Time Tracking**            | `TimeTrackingControl.tsx` + `TimeLogsSection.tsx` + `TimeReportPage.tsx` + `time-logs.ts` mock | Operations team won't log time; not their workflow          |
| **Per-task Activity Log**    | `TaskActivitySection.tsx`                                                                      | Workspace activity is enough                                |
| **Watchers add/remove**      | TaskPropertiesPanel watchers row                                                               | Auto-add commenters + assignees                             |
| **Rich text TipTap editor**  | `TiptapEditor.tsx` + TaskDescription rich mode + `@tiptap/*` deps                              | Plain textarea enough for operational notes                 |
| **Mentions parser**          | `MentionRenderer.tsx`                                                                          | Just plain text — operations team won't @-mention           |
| **Recurrence cron UI**       | `RecurrenceConfig.tsx`                                                                         | Replace with simple Daily/Weekly select                     |
| **Attachment lightbox**      | `AttachmentLightbox.tsx`                                                                       | Download is enough                                          |
| **Comment reactions**        | CommentsSection reactions logic                                                                | Skip — just text comments                                   |
| **Comment threading**        | parentCommentId rendering                                                                      | Flat comments simpler                                       |
| **Comment resolve workflow** | CommentsSection resolve button + show-resolved toggle                                          | Edit/delete enough                                          |
| **Comment edit UI**          | CommentsSection edit mode                                                                      | Optional — could keep simple                                |

### 4.3 DELETE — entire feature areas (~6,000 lines)

| Feature                            | Files / Pages                                                                                                       | Reason                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Automation builder**             | `pages/automations/*` + `AutomationBuilderPage`, `AutomationsListPage`, `AutomationRunsPage` + mocks                | Replace with 4-5 hardcoded backend automations. Members don't need to configure |
| **Multiple Dashboards**            | `pages/dashboards/*` + DashboardViewPage, DashboardsListPage + widget types                                         | Replace with **fixed Home page** with predefined KPIs                           |
| **Widget system**                  | `components/widgets/*` (10 widget types + WidgetPicker + WidgetEditor)                                              | Same — Home page widgets are hardcoded React components                         |
| **Templates**                      | `pages/templates/*` + TemplatesListPage + TemplateApplyModal                                                        | Just hardcode the "Festival Campaign Checklist" as a one-click task creator     |
| **Saved Views per list**           | `SavedViewsBar.tsx` + saved-views.ts                                                                                | Power-user feature; defaults work                                               |
| **Filter AND/OR groups**           | ListViewToolbar match toggle                                                                                        | Simple AND filtering is fine                                                    |
| **Notepad**                        | `pages/notepad/*` + `NotepadPage`, `MarkdownRenderer`, notes mock                                                   | Google Docs covers this                                                         |
| **Reminders**                      | `pages/reminders/*` + RemindersPage                                                                                 | Use tasks with due date instead                                                 |
| **Command palette ⌘K**             | `components/search/CommandPalette.tsx`                                                                              | Power-user — most won't discover                                                |
| **Keyboard shortcuts modal (?)**   | `components/shared/ShortcutsModal.tsx`                                                                              | Power-user                                                                      |
| **g+letter navigation**            | AppShell key handlers                                                                                               | Power-user                                                                      |
| **Dark mode**                      | `ThemeToggle.tsx` + theme.ts dark palette + index.css dark vars + buildAntdTheme dark mode                          | Nice-to-have, not core                                                          |
| **PWA + Service Worker**           | `public/service-worker.js`, `public/manifest.webmanifest`, `src/lib/push.ts`, push channel in NotificationsSettings | Web app is enough                                                               |
| **2FA flow**                       | `TwoFactorChallenge.tsx`, `TwoFactorSetup.tsx`, related routes                                                      | Internal use, password enough                                                   |
| **Active sessions UI**             | sessions endpoints + SecuritySettings sessions list                                                                 | Admin doesn't manage                                                            |
| **Webhooks UI**                    | `WebhooksSettings.tsx` + webhook CRUD                                                                               | Owner connects integrations externally                                          |
| **API Keys UI**                    | API keys section in WebhooksSettings                                                                                | Same                                                                            |
| **Form Conditional Logic builder** | FormBuilderPage ConditionalLogicBuilder                                                                             | Static forms enough                                                             |
| **Custom roles UI**                | RolesSettings.tsx                                                                                                   | Just show 2 roles inline                                                        |
| **Roles & Permissions page**       | `RolesSettings.tsx`                                                                                                 | One-screen permissions table on Settings home                                   |
| **Integrations Apps cards UI**     | `IntegrationsSettings.tsx`                                                                                          | Replace with actual configured integrations                                     |

### 4.4 DELETE — custom field types (drop 11 of 17)

Keep: Text, Phone, Money, Date, Dropdown, Files
**Drop:** Long Text, Email, URL, Number (use Money or Text), Checkbox, Labels (use Tags), People (use assignees), Location, Formula, Progress, Rating

Delete files: `LongTextField.tsx`, `EmailField.tsx`, `UrlField.tsx`, `NumberField.tsx`, `CheckboxField.tsx`, `LabelsField.tsx`, `PeopleField.tsx`, `LocationField.tsx`, `FormulaField.tsx`, `ProgressField.tsx`, `RatingField.tsx`.

### 4.5 DELETE — settings sub-pages (drop 8 of 15)

Keep: Profile, Workspace, Members, Task Types, Tags, Statuses, Custom Fields, Import/Export
**Drop:** Notifications (move to Profile), Security (move to Profile — just password change), Roles (one screen on Settings home), Integrations (basic info only), Webhooks (drop entirely), Billing (drop — self-hosted info)

### 4.6 Summary — file deletion count

**Estimated deletions:** ~95 files, ~14,000 lines of code

This makes the codebase **~40% smaller**, which means:

- Faster onboarding for new devs
- Less surface area for bugs
- Cleaner mental model for the team using it
- Smaller bundle size for mobile users

---

## Part 5 — Bangladesh ecom-specific features to ADD

> These don't exist in the current build but matter a lot for BeautyBooth.

### 5.1 Customer profile by phone number (HIGH PRIORITY)

**Why:** In Bangladesh ecom, customer phone is the de facto customer ID. Same phone = same person across orders.

**Build:**

- A lightweight `customers` table: `phone` (unique), `name`, `default_address`, `vip_flag`, `total_orders`, `total_complaints`, `created_at`
- On every task, the phone custom field auto-links to a customer record
- Customer detail panel shows: previous orders, previous complaints, lifetime value
- "VIP customer" badge auto-appears for ≥5 orders or ≥10,000৳ total

### 5.2 COD tracking sub-workflow (HIGH PRIORITY)

**Why:** COD is most of your revenue. Money flow ≠ delivery flow.

**Build:**

- Separate status: "Delivered" ≠ "COD Collected" (already in your workflow ✓)
- Per-courier COD reconciliation report (daily)
- Auto-task created when courier returns money to office
- Task assigned to accounts team for verification

### 5.3 Courier integration stubs (HIGH PRIORITY)

**Why:** Your operations team currently copies tracking #s by hand. Auto-sync changes everything.

**Build (or stub for V1):**

- Pathao API → status updates pulled every 15 min
- Steadfast API → same
- Webhook receiver endpoint for each
- Status auto-syncs to task: "Out for Delivery" → "Delivered" → "COD Collected"

### 5.4 Damage incident task type

**Why:** Common in dried-fish operations (handling, weather).

**Build:**

- Task type "Damage Incident" with: damaged item photo, qty, supplier (if PO-related), refund/replacement decision

### 5.5 Festival campaign quick-templates (HIGH PRIORITY)

**Why:** Eid, Pohela Boishakh, Durga Puja, etc. — predictable + high-volume.

**Build (just hardcode, not user-configurable):**

- "Start Eid Campaign" button → creates a parent task + 12-item checklist (creative, content, schedule, boost, etc.)
- Festival calendar overlay on Calendar view (shows upcoming festivals)

### 5.6 Bangla phone number format

**Why:** Mobile pattern: 01XXXXXXXXX (11 digits)

**Build:**

- Phone custom field validates `01[3-9]\d{8}` format
- Auto-formats display as `+880 1X-XXXX-XXXX`
- "Call" button → tel:+880... link (works on mobile)

### 5.7 BDT money formatting

**Why:** Already in some places but inconsistent.

**Build:**

- Money custom field defaults to BDT
- Display as `৳1,234.50` (with proper thousands separator)
- Lakh/crore option for reports

### 5.8 Order source tracking

**Why:** Marketing wants to know: did this order come from FB, website, or POS?

**Build:**

- Dropdown custom field "Source" with options: Facebook / Website / Phone / POS / Other
- Auto-populated when website/POS sends order
- Dashboard breaks down revenue by source

### 5.9 SMS gateway integration (V2)

**Why:** Order confirmation SMS, OTP, delivery alert — standard in BD ecom

**Build (V2):**

- Stub Bulk SMS BD / SSL Wireless gateway
- Auto-send on: order confirmed, courier dispatched, COD collected
- Bangla text support

### 5.10 Festival/holiday calendar overlay

**Build:**

- Static JSON of BD national holidays + business-relevant festivals
- Highlighted on Calendar view
- Auto-blocks recurring tasks on holidays

---

## Part 6 — Critical integrations (the actual value)

Without these, this system is just manual data entry. With them, it's the operations nerve center.

| Priority | Integration                           | What it does                                                                                                                           |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 🔥 P0    | **Website → auto-task on new order**  | New website order → POST webhook → auto-create task in "Facebook Orders" or "Website Orders" list with customer phone, address, amount |
| 🔥 P0    | **POS → daily summary task**          | Each evening, POS posts a "Today's POS sales: 23 orders / 45,000৳" task to inventory team                                              |
| 🔥 P0    | **Pathao API → status sync**          | Hourly poll: update task status as parcel moves through delivery stages                                                                |
| 🔥 P0    | **Steadfast API → status sync**       | Same                                                                                                                                   |
| 🟠 P1    | **Facebook Page → comment/DM intake** | Negative comments + complaint DMs → auto-task in "Complaints" list                                                                     |
| 🟠 P1    | **bKash / Nagad API**                 | When payment received, auto-mark task "COD Collected" or "Paid"                                                                        |
| 🟠 P1    | **SMS gateway (Bulk SMS BD)**         | Send order confirmation SMS on "Confirmed" status                                                                                      |
| 🟡 P2    | **Email forwarding → task**           | Forward complaint emails to `complaints@BeautyBooth.com` → auto-task                                                                   |
| 🟡 P2    | **Google Sheets sync**                | Legacy reports — auto-export daily summary                                                                                             |

**Build P0 integrations BEFORE anything else.** Without these, team won't adopt.

---

## Part 7 — Recommended lean architecture

After cleanup, what the system looks like:

### Backend

- **~18 database tables** (down from current planned 43)
  - users, workspace (= single tenants row)
  - spaces, lists, statuses, task_types, tags
  - tasks, task_assignees, task_tags
  - comments, checklists, checklist_items, attachments
  - custom_fields, task_custom_field_values
  - notifications, activity_log
  - customers (NEW)
  - forms, form_submissions
  - sessions (refresh tokens — already exists)

- **~80 API endpoints** (down from planned 207)
  - Auth: 6 (no 2FA, no invitations table flow — admin manually creates members)
  - Users: 6 (no role management complexity)
  - Workspace: 2
  - Spaces / Lists / Statuses / Task Types / Tags: ~20
  - Tasks (incl. assignees, tags, bulk): ~12
  - Comments / Checklists / Attachments: ~12
  - Custom fields: ~6
  - Activity / Notifications: ~6
  - Forms (incl. public): 6
  - Search: 1
  - **Webhooks (incoming from website/Pathao/etc.):** ~5
  - Customer (NEW): 3
  - Home/KPIs: 1

### Frontend

- **~70 files** (down from current ~200+)
  - 3 views: List, Board, Calendar
  - Simple task drawer (no rich text, no time, no deps, no subtasks, no activity)
  - Light topbar (no command palette, no theme toggle)
  - 7 settings sub-pages (Profile, Workspace, Members, Task Types, Tags, Statuses, Custom Fields)
  - Owner Home with 6 fixed widgets
  - Inbox (notifications)
  - Search page

- **No PWA, no service worker, no offline mode**
- **No dark mode toggle** (system theme respect optional)
- **No command palette**

### Bundle size estimate

- Current: ~1.3 MB gzipped main bundle (heavy)
- After cleanup: ~600 KB gzipped (TipTap, MapLibre, drag-drop libs removed)

---

## Part 8 — Phased rollout plan

### Phase 0 — Decide (this week)

- ✋ STOP building new features
- ✅ Sign off on this document
- ✅ Decide: Option A (delete code) vs Option B (hide behind toggles)

### Phase 1 — Cleanup (1-2 weeks)

1. Delete files listed in Part 4 (~95 files, ~14k LOC)
2. Simplify retained features (no rich text, no resolve, no dependencies, etc.)
3. Drop unused custom field types
4. Compress settings to 7 sub-pages
5. Build the fixed Owner Home page (replaces Dashboards feature)

### Phase 2 — Bangladesh add-ons (2 weeks)

6. Customer profile by phone (Part 5.1)
7. Bangla phone validation + BDT formatting (Part 5.6 + 5.7)
8. Festival template button (Part 5.5)
9. Damage incident task type (Part 5.4)
10. Order source dropdown (Part 5.8)

### Phase 3 — Critical integrations (3-4 weeks) — **THIS IS THE REAL WORK**

11. Website webhook receiver → auto-task
12. Pathao API status poll
13. Steadfast API status poll
14. Facebook complaint intake (form first, OAuth later)
15. SMS gateway send on status change

### Phase 4 — Rollout (2 weeks)

16. Pilot with Operations team (40 ppl) — they're the heaviest user
17. Fix bugs from real usage
18. Onboard CS, Listing, Marketing, Inventory teams
19. Train owner/managers on Home page

### Phase 5 — V2 candidates (later, if asked)

- Map view (delivery zones)
- bKash/Nagad payment integration
- Mobile push notifications
- Dark mode
- Saved views
- Time tracking (if owner asks)
- Advanced reporting

**Total V1 timeline: 8-10 weeks** with a solo dev. Compare to current build's ~6 months of feature accumulation.

---

## Part 9 — Decision summary

### What's perfect for BeautyBooth (KEEP)

- **5 spaces** matching your team structure ✓
- **Per-list status workflows** with COD-Collected stage ✓
- **Tasks with assignees, due dates, priority, tags, comments, attachments, checklists** ✓
- **Public form intake** for Facebook complaints ✓
- **List + Board + Calendar views** ✓
- **6 custom field types** (Text, Phone, Money, Date, Dropdown, Files) ✓
- **In-app + email notifications** ✓
- **Owner Home page with 6 fixed KPIs** ✓
- **Recurring tasks** (Daily/Weekly only) ✓
- **Custom Task IDs** (ORD-1042) ✓
- **Search** ✓
- **Mobile-responsive web** ✓

### What's over-engineered for you (DROP)

- 3 views: Gantt, Timeline, Workload (irrelevant for ops)
- 2 views: Map, Table (V2 candidates)
- 11 custom field types (formula/progress/rating/etc.)
- Automation builder (replace with 4-5 hardcoded flows)
- Multiple dashboards (Home page enough)
- Templates feature (one Festival button enough)
- Subtasks (use checklist instead)
- Dependencies, Time tracking, Rich text, Mentions, Reactions, Threading
- Command palette, Keyboard shortcuts, Dark mode
- PWA, Service worker, Push notifications
- 2FA, Sessions UI, API keys, Webhooks UI
- Custom roles (just Admin + Member)
- Saved views, Filter AND/OR, Form conditional logic

### What's missing that you actually need (ADD)

- 🔥 **Customer profile by phone** (the killer feature for BD ecom)
- 🔥 **Website → auto-task webhook**
- 🔥 **Pathao + Steadfast status sync**
- 🟠 **Festival quick-template**
- 🟠 **Order Source dropdown** (FB/Website/POS)
- 🟠 **Bangla phone validation + ৳ formatting**
- 🟠 **SMS gateway** (V2)
- 🟡 **bKash/Nagad** (V2)

---

## Part 10 — The ONE-PAGE answer

**BeautyBooth needs a 60-file, 80-endpoint coordination layer that:**

1. Manages 6 specific workflows (order, complaint, listing, campaign, inventory, oversight)
2. Integrates with website + Pathao/Steadfast (the actual value)
3. Has 3 views (List, Board, Calendar), 6 custom field types, simple comments
4. Owner sees daily KPIs on one Home page
5. No 2FA, no PWA, no dark mode, no dashboards-builder, no command palette
6. Bangla phone validation, BDT formatting, customer-by-phone, festival template

**Total: ~40% leaner than what's currently built. Build time: 8-10 weeks for V1.**

---

_Use this document as the single source of truth for next steps. If a feature isn't listed in Part 3 or Part 5, it's out of scope._
