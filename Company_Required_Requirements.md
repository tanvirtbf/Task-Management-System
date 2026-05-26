# Apnar Company er jonno Required Requirements

> **Context:** Bangladesh eCommerce company (Facebook + Website + COD + Courier model). System internal use, single company, English only, sell korar jonno na. ClickUp er full feature scan theke filter kore amader actual dorkari feature gula identify kora hoyeche.

---

## ✅ MUST HAVE — V1 Launch er age dorkar (Core Features)

Eigula chara system ta useful hobe na. **First release e ei sob lagbe.**

### ১. Authentication & User Management
- Email + Password login
- Password reset (email link)
- **2FA (TOTP — Google Authenticator)** — security er jonno
- User profile (name, avatar, role, email)
- Admin can invite users, deactivate users
- Single workspace (multi-workspace lagbe na)
- ❌ No SAML/SCIM/Okta/Enterprise SSO

### ২. Hierarchy
- **Workspace** (1 ta fixed — apnar company)
- **Space** (5 fixed: Operations, Inventory, Customer Support, Product Listing, Marketing)
- **Folder** (optional grouping)
- **List** (Facebook Orders, Website Orders, Stock Master, Complaints, ityadi)
- **Task** → **Subtask** (3 levels nested enough — 7 levels lagbe na)
- ✅ Spaces public/private toggle

### ৩. Tasks — Core Properties
- Name, Description (rich text — bold, list, link, image embed)
- Assignees (multiple)
- Watchers/Followers (auto-add on @mention/assign)
- Due Date, Start Date
- Priority (5 levels: Urgent/High/Normal/Low/None — hardcoded fine)
- Status (custom per List)
- Tags
- Custom Fields (see below)
- Comments (threaded, @mentions, reactions)
- Attachments (image, PDF, doc — 50MB per file enough)
- Activity Log per task

### ৪. Subtasks & Checklists
- Subtask (full task properties, nested under parent)
- Checklist (lightweight items inside task, 1 assignee, no dates)

### ৫. Custom Statuses
- Per List custom workflow
- 4 status groups: **Not Started / Active / Done / Closed**
- **Order workflow example:** New → Confirmed → Packed → Handed to Courier → Out for Delivery → Delivered → COD Collected → Completed | Cancelled | Return | Exchange
- Status change = primary automation trigger

### ৬. Custom Fields (subset — 13 ta enough)
- Text (short + long)
- Number, **Money/Currency** (essential for order value, COD)
- Date / Date+Time
- **Dropdown** (single-select) — courier, source, COD status
- **Labels** (multi-select)
- Checkbox
- Phone (essential — customer phone)
- URL
- Files
- People (user picker)
- **Location** (Google Maps — for delivery address)
- Progress (auto from subtasks/checklist)
- Formula (basic — sum, if, date diff)
- ❌ Skip: Rating, Emoji, Rollup, Lookup, AI Fields (v1 e)

### ৭. Dependencies
- Blocking / Waiting On / Linked (3 types)
- Gantt e arrow visualization
- Warning when closing blocked task

### ৮. Recurring Tasks
- Daily / Weekly / Monthly / Custom
- For: daily order check, weekly stock audit, monthly COD reconciliation

### ৯. Task Types
- Default: Task, Milestone
- Custom types: **Order, Complaint, Product Listing, Campaign, Return** — each with unique icon/color
- Per-List default type

### ১০. Views (9 ta — full 16 lagbe na)
- **List** — default
- **Board / Kanban** — Operations team (drag-drop status change)
- **Calendar** — Marketing content schedule
- **Table** — Inventory (Excel-style)
- **Gantt** — basic campaign timeline (baselines lagbe na)
- **Workload** — team capacity dekhar jonno
- **Map** — courier zones / delivery locations (Bangladesh er jonno useful)
- **Form** — Facebook complaint intake auto-task
- **Activity** — recent changes feed
- ❌ Skip v1: Timeline, Mind Map, Embed, Whiteboard, Box, Doc-as-view

### ১১. Filters, Sorting, Grouping
- Filter: AND/OR groups, by status/assignee/priority/tags/dates/custom fields
- Sort by any column
- Group by status/assignee/priority/custom field
- **Me Mode** (each user sees only their tasks dynamically)
- Saved views per List
- Personal vs Shared views

### ১২. Forms
- Public form link (for Facebook complaint intake)
- Form fields = mapped to task custom fields
- Auto-create task on submit
- **Conditional logic** (show/hide based on previous answers — for complaint types)
- reCAPTCHA spam protection

### ১৩. Automation Engine (most important time-saver)
- **Triggers:**
  - Status change
  - Custom field change
  - Date arrived/approaching
  - Comment posted
  - Form submitted
  - Recurring schedule
  - Task created
- **Conditions:** simple AND/OR (regex/role-based lagbe na initially)
- **Actions:**
  - Change status
  - Assign user
  - Add tag / change priority
  - Post comment (with @mention)
  - Send email/notification
  - Create subtask
  - Move/copy task to another List
  - Set custom field value
  - Call webhook (for future Shopify/courier API integration)
- No automation limit (apnar company er jonno)

### ১৪. Notifications
- **3 channels:** In-app (Inbox), Email, Mobile Push (PWA fine)
- Triggers: assign, mention, comment, status change, due date approaching
- Per-user notification settings
- Mark all read, snooze
- ❌ Skip v1: Slack/Teams/Discord integration, SMS notifications

### ১৫. Comments & Mentions
- Threaded replies
- @user, @everyone in a List
- Reactions (basic emoji)
- Assigned comments (resolve workflow)
- Edit/delete (with edited marker)

### ১৬. Attachments
- Image, PDF, DOC, XLS, video upload
- 50MB per file enough (1GB overkill for v1)
- In-line preview for images + PDF
- Storage: self-hosted or S3/MinIO

### ১৭. Activity Log
- Per-task: who/what/when, before→after
- Workspace-wide Activity View (filter by date/user/type)
- ❌ No need for full compliance Audit Log

### ১৮. Permissions & Roles
- **Owner** (founder — full access)
- **Admin** (managers — workspace settings + users)
- **Member** (team — Space-scoped access)
- **Guest** (freelance designer, supplier — view-only or limited edit per item)
- Space-level access control (Operations team only sees Operations space)
- Per-List/Task share with specific users
- ❌ Skip: Custom Roles, granular per-field permissions (v1 e)

### ১৯. Dashboards & Reporting
- **Owner Dashboard:**
  - Today's orders count
  - Orders by status (pie chart)
  - COD collection (collected vs pending — money sum)
  - Daily/weekly revenue (Order Value sum)
  - Return rate
  - Low stock items count
  - Open complaints count
  - Team workload
- **Per-team dashboards:** Operations, Support, Marketing
- Widget types: Number card, Pie chart, Bar chart, Line chart, Task list embed, Calculation
- Date range filters (today/this week/this month/custom)
- ❌ Skip: Sprint widgets (Burndown/Burnup/Velocity), AI cards

### ২০. Search
- Global keyword search (tasks, comments, docs)
- Filter by location, type, owner, date
- Recent items quick access

### ২১. Templates
- **Task templates** — repeating order workflow, complaint workflow
- **List templates** — reusable lists for new campaigns
- **Checklist templates** — packing checklist, QC checklist
- Apply with date remap

### ২২. Tags
- Space-level tags (name + color)
- Filter/search by tags
- Auto-inherit across Spaces

### ২৩. Email Integration (Basic)
- **Task creation via email** — forward complaint email to special address → auto-create task
- Send email from task (for customer reply)
- Gmail OAuth + custom SMTP option

### ২৪. Calendar Sync
- **Google Calendar 2-way sync** (most team members use Gmail)
- Outlook integration optional (later)

### ২৫. Mobile Access
- **PWA (Progressive Web App)** enough — native iOS/Android app v2 e
- Mobile-responsive UI
- Push notifications via browser

### ২৬. Time Tracking (Basic)
- Per-task start/stop timer
- Manual entry
- Time estimate vs tracked
- Per-user time report
- ❌ Skip v1: Billable rates, invoicing, complex timesheets

---

## 🟡 NICE TO HAVE — V2 te add korte paren

Initial launch e na thakleo cholbe. Pore add korben demand onujayi.

- **Docs** (Notion-style SOPs) — initially Google Docs/Notion separately use korte paren
- **Whiteboard** — brainstorming er jonno
- **Goals/OKR** — quarterly target tracking
- **AI Features:**
  - Auto-summarize task
  - AI Custom Fields (sentiment on complaints)
  - Smart task suggestion
  - **OpenAI/Claude API** integrate kore custom AI assistant (cheap, pay-per-use)
- **Native Mobile App** (iOS/Android with offline mode)
- **Slack/Discord integration** (notification mirroring)
- **Webhook signing** (HMAC)
- **Import from ClickUp/Trello** (jodi data migrate koren)
- **Audit Log** (full compliance trail)
- **Custom Roles** (beyond Admin/Member/Guest)
- **Public API** (read-only for internal dashboards)
- **Workload View per-day capacity**

---

## ❌ NOT NEEDED — Apnar company er jonno skip koren

Internal-only single-company use case e ei feature gula irrelevant. **Build korar somoy ei design decisions skip korte paren** — onek dev time bachbe.

### Business Model er jonno
- ❌ **Plan/Tier system** (Free/Unlimited/Business/Enterprise) — sob feature sob user er jonno open
- ❌ **Paid vs unpaid feature gates** — limits enforce korar dorkar nai
- ❌ **Billing/Subscription system** — Stripe integration lagbe na
- ❌ **Public sign-up page** — admin manually invite korbe
- ❌ **Pricing page / marketing site** — eta product na
- ❌ **Plan limit counters** (automation count, storage cap, custom field uses, guest seats) — unlimited rakhen
- ❌ **Multi-workspace** — ek company ek workspace fixed
- ❌ **Workspace switcher**

### Enterprise / Compliance
- ❌ **SAML SSO** (Okta/Microsoft/Custom) — Google SSO max
- ❌ **SCIM auto-provisioning** — manual user mgmt enough
- ❌ **SOC 2 / ISO 27001 / HIPAA / PCI certifications** — internal use, customer data sell korchen na
- ❌ **Data residency selector** — single region hosting fine
- ❌ **Audit Log API export** — basic activity log enough
- ❌ **MSA / dedicated CSM features**
- ❌ **White-labeling / custom branding** — apnar own brand alreadyii hocche

### Internationalization
- ❌ **Multi-language UI** — English only (apnar team English bujhe)
- ❌ **Translation system / locale files**
- ❌ **AI translation** (Spanish/French/etc.)
- ❌ **AI Notetaker 100 languages**

### Agile / Sprints
- ❌ **Sprints ClickApp** — apnara dev team na, ecommerce ops
- ❌ **Sprint Points / Velocity / Burndown / Burnup / Cumulative Flow**
- ❌ **Sprint Folders auto-generation**
- ❌ **Cycle Time / Lead Time** metrics

### Advanced AI (V1 e)
- ❌ **ClickUp Brain er full clone** — overkill; needed hole OpenAI/Claude API simple integration enough
- ❌ **Super Agents (autonomous AI teammates)** — v3+ feature
- ❌ **AI Notetaker** (Zoom/Meet bot) — meeting notes manual or use existing tools
- ❌ **AI Connected Search across Google Drive/SharePoint/Slack/Dropbox**
- ❌ **MCP server for external AIs**
- ❌ **Brain MAX desktop native app**
- ❌ **Talk-to-Text dictation**
- ❌ **Image generation in Whiteboards**

### Niche Views
- ❌ **Mind Map** — niche, less used in ecommerce ops
- ❌ **Timeline** (Gantt enough)
- ❌ **Embed View** (rare use case)
- ❌ **Doc-as-View** (separate Docs section enough jodi banan)
- ❌ **Box/Team View** (Workload view enough)

### Heavy Integrations
- ❌ **1000+ integration marketplace** — apnar dorkari 5-10 ta enough (Gmail, Google Calendar, Facebook, Pathao/Steadfast API, Shopify/WooCommerce)
- ❌ **Zapier/Make app listing** — webhook out enough
- ❌ **OAuth multi-tenant app system** — apni app build korchen, OTHER companies er jonno OAuth provide korar dorkar nai

### Other
- ❌ **Desktop apps** (Windows/Mac/Linux) — web app + PWA enough
- ❌ **Offline mode** (mobile + desktop) — v3 feature
- ❌ **Whiteboards full feature** (shapes, connectors, drawing) — v2 te basic
- ❌ **SyncUps voice/video calls** — Zoom/Google Meet separately use koren
- ❌ **Chat full Slack-replacement** — basic in-task comments enough; team chat Slack/Discord e koren
- ❌ **Public sharing of tasks/docs with non-users** — internal only
- ❌ **Template marketplace / community templates** — only internal templates
- ❌ **Custom Task IDs prefix system** — simple sequential ID enough
- ❌ **WCAG 2.2 AA full compliance** — basic keyboard nav + decent contrast enough
- ❌ **AI Field types (Sentiment, Auto Summary)** — v2
- ❌ **Goals/OKR module** — Google Sheet e initially
- ❌ **Pulse "who's online"** — nice-to-have, not core

---

## 📊 Summary Count

| Category | Total in ClickUp | Required for Your Company |
|---|---|---|
| Views | 16 | **9** |
| Custom Field Types | 20+ | **13** |
| User Roles | 5+ Custom | **4** (Owner/Admin/Member/Guest) |
| Notification Channels | 6 | **3** (in-app/email/push) |
| ClickApps (toggle modules) | 30+ | **~12** core |
| Integrations | 1000+ | **5-10** (Gmail/Calendar/Courier APIs/Shopify) |
| Language Support | 6 UI + 100 AI | **1** (English) |
| Plan Tiers | 5 + AI add-ons | **0** (no tiers) |

---

## 🎯 Recommended MVP Build Order

Build korar somoy ei priority order e jaben — boro jinish ek sathe build korben na:

### Phase 1 — Foundation (4-6 weeks)
1. Authentication + User Management + 2FA
2. Hierarchy (Workspace/Space/Folder/List)
3. Tasks CRUD with core properties
4. Custom Statuses + Priorities
5. Subtasks + Checklists
6. List View + Board View
7. Basic Comments + Attachments
8. Notifications (in-app + email)

### Phase 2 — Power Features (4-6 weeks)
9. Custom Fields (13 types)
10. Tags
11. Filters / Sorting / Grouping / Me Mode
12. Calendar View + Table View
13. Forms with conditional logic
14. Dependencies
15. Recurring Tasks
16. Templates (Task/List/Checklist)

### Phase 3 — Automation & Reporting (3-4 weeks)
17. Automation Engine (triggers/conditions/actions)
18. Webhooks (in + out)
19. Dashboards + Widgets
20. Gantt View + Workload View
21. Activity Log + Activity View
22. Search

### Phase 4 — Ecommerce-Specific (2-3 weeks)
23. Map View (courier zones)
24. Email integration (intake + send)
25. Google Calendar 2-way sync
26. Time Tracking basic
27. Task Types (Order/Complaint/Product/Campaign)
28. Custom dashboards for COD/Return Rate/Inventory

### Phase 5 — Polish (2-3 weeks)
29. PWA / Mobile responsiveness
30. Push notifications
31. Permissions refinement
32. Performance optimization

**Total estimated:** 15-22 weeks (~4-5.5 months) by a small team. Solo developer hole **6-9 months** realistic.

---

## 💡 Tech Stack Suggestion (Quick)

Internal use er jonno, **simple + reliable + free/cheap to host:**

- **Frontend:** Next.js + React + TailwindCSS + shadcn/ui
- **Backend:** Node.js (Express/NestJS) or Bun (Elysia) — apnar preference
- **Database:** PostgreSQL (primary), Redis (cache + queue)
- **Real-time:** Socket.io or Pusher (for live updates, comments)
- **File Storage:** S3 / MinIO / Cloudflare R2
- **Auth:** Auth.js / Lucia / custom JWT
- **Search:** PostgreSQL full-text or Meilisearch (cheap, self-host)
- **Email:** Resend / Postmark / SES
- **Hosting:** VPS (DigitalOcean / Hetzner — $20-40/month) or Railway/Render
- **AI (later):** Anthropic Claude API / OpenAI API (pay per use)

Single VPS + Postgres + Next.js easily handle 50-100 concurrent users.

---

*Ei document onujayi build korle apnar company er jonno full ClickUp clone er complexity 60-70% komaite parben — same usefulness paben.*
