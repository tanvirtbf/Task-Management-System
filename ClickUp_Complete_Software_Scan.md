# ClickUp Complete Software Scan — Full Feature Reference (May 2026)

> **Purpose:** Comprehensive feature documentation of ClickUp software, compiled for the purpose of building a ClickUp-like task management system for a Bangladesh eCommerce company.
> **Date compiled:** May 2026
> **Sources:** Official ClickUp documentation (clickup.com, help.clickup.com, developer.clickup.com), changelogs, third-party reviews 2025–2026.
> **Plan tiers used throughout:** Free Forever | Unlimited (~$7/user/mo) | Business (~$12/user/mo) | Business Plus (~$19/user/mo) | Enterprise (custom).

---

## Table of Contents

1. [Hierarchy & Architecture](#1-hierarchy--architecture)
2. [Tasks — Full Property Model](#2-tasks--full-property-model)
3. [Subtasks](#3-subtasks)
4. [Checklists](#4-checklists)
5. [Statuses](#5-statuses)
6. [Priorities](#6-priorities)
7. [Dependencies](#7-dependencies)
8. [Recurring Tasks](#8-recurring-tasks)
9. [Task Types & Milestones](#9-task-types--milestones)
10. [Multiple Assignees & Watchers](#10-multiple-assignees--watchers)
11. [Tags](#11-tags)
12. [Sprints](#12-sprints)
13. [Templates](#13-templates)
14. [Comments & Mentions](#14-comments--mentions)
15. [Activity Log & Audit Trail](#15-activity-log--audit-trail)
16. [Attachments & Storage](#16-attachments--storage)
17. [Notifications](#17-notifications)
18. [Views — All 16+ Types](#18-views--all-16-types)
19. [Filters, Sorting, View Permissions, Me Mode](#19-filters-sorting-view-permissions-me-mode)
20. [Custom Fields — All 20+ Types](#20-custom-fields--all-20-types)
21. [Forms](#21-forms)
22. [Automation Engine](#22-automation-engine)
23. [AI Automation & Brain Integration](#23-ai-automation--brain-integration)
24. [Docs](#24-docs)
25. [Whiteboards](#25-whiteboards)
26. [Chat & SyncUps](#26-chat--syncups)
27. [Goals & Targets](#27-goals--targets)
28. [Time Tracking](#28-time-tracking)
29. [Dashboards & Reporting (60+ Widgets)](#29-dashboards--reporting-60-widgets)
30. [Inbox, Notepad, Reminders, Pulse](#30-inbox-notepad-reminders-pulse)
31. [Search](#31-search)
32. [Permissions & Roles](#32-permissions--roles)
33. [2FA, SSO, SCIM](#33-2fa-sso-scim)
34. [Security & Compliance](#34-security--compliance)
35. [ClickUp Brain AI](#35-clickup-brain-ai)
36. [Super Agents (Autonomous AI)](#36-super-agents-autonomous-ai)
37. [AI Notetaker](#37-ai-notetaker)
38. [ClickApps (Modular Features)](#38-clickapps-modular-features)
39. [Integrations (1000+)](#39-integrations-1000)
40. [Public API & Webhooks](#40-public-api--webhooks)
41. [Import / Export](#41-import--export)
42. [Mobile & Desktop Apps](#42-mobile--desktop-apps)
43. [Multi-language & Accessibility](#43-multi-language--accessibility)
44. [Full Pricing & Plan Limits Matrix](#44-full-pricing--plan-limits-matrix)
45. [Build Implications for a Clone](#45-build-implications-for-a-clone)

---

## 1. Hierarchy & Architecture

ClickUp uses a strict 7-level nested hierarchy. Every artifact lives somewhere in this tree.

```
Workspace (entire organization, 1 per company)
  └─ Space (department / team / brand)
      └─ Folder (optional grouping)
          └─ List (actual container of tasks)
              └─ Task (the actionable work unit)
                  └─ Subtask (up to 7 levels deep)
                      └─ Nested Subtask
                          └─ ...
```

### Level Definitions

| Level | Contains | Notes |
|---|---|---|
| **Workspace** | Spaces, members, billing, ClickApps, integrations | Top-level; one per company recommended for cross-team reporting |
| **Space** | Folders, Lists, statuses, custom fields, tags, members | Department/team scope; independent settings, statuses, ClickApps |
| **Folder** (optional) | Lists, sub-Folders, settings | Optional middle layer; creating a Folder auto-creates one List inside |
| **List** | Tasks, views, settings | Direct or nested under Folder; main task container |
| **Task** | Subtasks, checklists, comments, attachments, custom fields | The work unit |
| **Subtask** | Nested subtasks, all task properties | Up to 7 levels with ClickApp; default 3 |
| **Nested Subtask** | More subtasks | Same property model as task |

### Hard Limits

- **Spaces per Workspace:** Free = 5 max; Paid = unlimited
- **Folders + Lists per Space:** ~100 total (archived don't count)
- **Tasks per List:** 50,000 (incl. archived + subtasks)
- **Tasks per view (render):** 5,000 max in one view at one time
- **Custom Task ID prefix scope:** per Space, alphanumeric + underscore, unique across Spaces, auto-uppercased
- **Sub-Folders:** Supported in ClickUp 3.0+

### Moving Items

- **Tasks between Lists:** ellipsis → Move; bulk via toolbar; "Move and keep in current List" copies
- **Tasks in Multiple Lists ClickApp:** task lives in N Lists; one **primary** (home) + others **secondary**; statuses always come from primary
- **Subtasks in Multiple Lists:** same model; in secondary Lists they appear as top-level parent tasks
- **Folders:** can be moved between Spaces

### Privacy & Sharing Defaults

- Spaces / Folders / Lists / tasks / Goals = **public by default**
- Dashboards = **private by default**
- 4 permission levels per item: View-only, Comment, Edit, Full Edit
- Permission hierarchy: Task > List > Folder > Space (most specific + highest wins)

---

## 2. Tasks — Full Property Model

A task in ClickUp is a heavily customizable object. Properties:

### Core Properties

| Property | Type / Behavior |
|---|---|
| **Name** | Required, single-line. Effectively unlimited length (Custom Task Type names capped at 16 chars) |
| **Description** | Full rich-text editor (Markdown, slash commands, headings, banners success/danger/info/warning, buttons, tables, embeds — YouTube, Loom, Figma, code blocks, inline checklists via `/check`) — behaves like a mini-Doc |
| **Status** | Custom per List/Folder/Space (see §5) |
| **Priority** | One of Urgent/High/Normal/Low/None (hardcoded — see §6) |
| **Assignees** | One or many (Multiple Assignees ClickApp; §10) |
| **Watchers / Followers** | Users notified of changes; auto-added on assign, comment, mention, react |
| **Due Date** | Date + optional time. Natural language input ("Friday at 3pm"). No time = defaults to 4am local |
| **Start Date** | Date + optional time. Used by Gantt/Timeline |
| **Duration / Time Estimate** | Auto-calculable: given any 2 of (start, due, duration), third is computed. "Skip non-working days" supported |
| **Time Tracked** | Native timer + manual entries (§28) |
| **Tags** | Multiple per task; Space-level (§11) |
| **Custom Fields** | ~20 native types (§20) |
| **Attachments** | Up to 1,000 per task; 1 GB max per file (§16) |
| **Checklists** | Multiple per task; 5 levels nested (§4) |
| **Comments** | Threaded, reactions, mentions, assigned comments (§14) |
| **Activity Log** | Auto-tracked (§15) |
| **Task ID** | Auto-generated, or Custom Task IDs (prefix + sequence) |
| **Dependencies** | Blocking, Waiting On, Linked (§7) |
| **Linked Tasks** | Informational link, no scheduling rules |
| **Related Tasks** | Via Relationship custom field, typed links |
| **Task Type** | Default or custom types (§9) |
| **Sprint Points** | Effort estimate, optional rollup from subtasks (§12) |
| **Milestone Flag** | Set via Task Type = Milestone (§9) |

---

## 3. Subtasks

### Nesting

- **Default depth:** 3 levels (Task → Subtask → Nested Subtask)
- **Max with ClickApp:** 7 levels (Hierarchical/Nested Subtasks ClickApp must be enabled by owner/admin)

### Inheritance Rules

- Subtasks are **independent objects** — do NOT auto-inherit parent assignees, dates, status, priority, custom field values
- Subtasks **share parent's List statuses** (cannot have a different status workflow)
- Subtask completion does NOT auto-complete parent (and vice versa)
- Subtasks in Multiple Lists ClickApp: subtask can appear in additional Lists, primary List's statuses always apply

### Properties on Subtasks

Subtasks have nearly identical property model to parent tasks: own assignees, dates, time tracking, dependencies, custom fields, comments, attachments, sub-subtasks, checklists, etc.

### Display Modes

- Collapse all under parent
- Expand all under parent
- Flatten as separate rows (allows filters to find them)
- Closed subtasks hidden by default in some views

### Limitation

Automations **cannot distinguish subtasks from tasks** (known limitation, frequent feature request).

---

## 4. Checklists

Lightweight to-do lists embedded inside tasks. Intentionally simpler than subtasks.

### Behavior

- A task can have **multiple named checklists**
- Each item: single line of text + checkbox
- **One assignee max per item** (vs. multiple on tasks)
- **5 levels of nested sub-items** (indentation)
- Drag-and-drop reorder
- Items contribute to Progress Auto custom field calculation

### What Checklist Items DO NOT Have

- Due dates (long-standing feature request)
- Reminders
- Priorities
- Custom fields
- Comments
- Status (only checked/unchecked)

### Checklist vs Subtask Comparison

| Feature | Checklist Item | Subtask |
|---|---|---|
| Assignees | 1 max | Multiple |
| Due Date | No | Yes |
| Start Date | No | Yes |
| Status | None | Full custom workflow |
| Custom Fields | No | Yes |
| Comments | No | Yes (threaded) |
| Dependencies | No | Yes |
| Time Tracking | No | Yes |
| Priority | No | Yes |
| Nesting depth | 5 levels | 7 levels |
| Appears in views (List/Board/Calendar) | No | Yes |
| Visibility in Inbox/Home | Limited | Full |

### Templates

- Save any checklist as a **Checklist Template** (ellipsis menu)
- Reuse across any task in workspace
- Sharing: Only me / Select people / All members / Admins only / Everyone (incl. guests)

---

## 5. Statuses

### Status Groups (4 system groups)

1. **Not Started** (optional) — enabled via "Not Started Status Group" ClickApp
2. **Active** — work in progress (e.g., "In Progress", "In Review")
3. **Done** — complete but kept open/editable; counts as done in reporting
4. **Closed** — terminal state; only 1 Closed status (rename-only, no custom creation)

### Customization

- Defined per **Space**, **Folder**, or **List**
- Inheritance: Folder inherits from Space; List inherits from Folder or Space; each level can override
- Each status: **name** + **color** (full hex picker)
- Defaults: "To do" and "Complete" only
- **Status Templates** save status sets for reuse — available on all plans

### Transitions & Automation

- No enforced transition rules — any status to any other by default
- Status changes are a primary **automation trigger** (assign, move, notify, post comment, send webhook)
- Status changes logged in Activity Log with before/after values
- "Status Progress" feature shows percentage completion via status weighting

### Personal Lists

Users can have custom statuses on their **Personal List**.

---

## 6. Priorities

ClickUp ships with **exactly 5 priority levels — NOT customizable**:

| Priority | Color | Meaning |
|---|---|---|
| Urgent | Red | Immediate |
| High | Orange/Yellow | Important + time-sensitive |
| Normal | Blue | Default |
| Low | Gray | Non-critical |
| None | No flag | Unset |

- **Cannot customize labels or colors** — frequent unfulfilled feature request
- Filter/sort/group by priority in any view
- Available on all plans
- Visual: colored flag icon

---

## 7. Dependencies

### 3 Relationship Types

1. **Waiting On** — Task A waits on Task B to complete
2. **Blocking** — Reciprocal of Waiting On (A is blocking B)
3. **Linked** — Informational only, no scheduling/completion rules

A → B "Waiting On" automatically creates B → A "Blocking" (reciprocal pair).

### Multiple Dependencies

A task can have many "Waiting On" + many "Blocking" relationships simultaneously.

### Effects on Scheduling

- **Dependency Warning ClickApp:** warns (not blocks) when closing a task that's still waiting on something
- **Reschedule Dependencies ClickApp:** when blocking task's dates change, dependents shift to maintain gap. List view shifts later only; Gantt supports bidirectional

### Visualization

- **Gantt:** Dependency arrows between bars; drag-and-drop creates new dependencies
- **List view:** Add "Dependencies" column
- **Task detail sidebar:** Lists all dependencies + relationships
- **Icon badges** on task rows

### Availability

All plans (Free included). Guests with edit rights can create/edit dependencies.

---

## 8. Recurring Tasks

### Frequency Options

- Daily (every N days)
- Weekdays only
- Weekly (interval N + selected days, e.g., every 2 weeks Mon/Wed/Fri)
- Monthly (specific date, "first Monday", or last day)
- Yearly (interval N)
- Custom (e.g., every 21 days, every 3 months)
- Days After Status Change (recur N days after status changes)

### Recurrence Triggers

- **On Schedule** — next instance created on scheduled date regardless of current status
- **When Complete** — next instance created when current marked complete

### What Regenerates (2 modes)

1. **Create New Task** — generates new task per recurrence; original kept as history (enables Calendar history of closed instances)
2. **Use Same Task with New Due Date & Reset Status** — same task object reused; dates roll forward; status resets

### End Conditions

- No end date (infinite)
- End after X occurrences
- End by specific date

### Other Behaviors

- Start date recurs same N days before due as original
- Task Type does NOT carry over (open request)
- All plans

---

## 9. Task Types & Milestones

### Default Task Types

- **Task** (default)
- **Milestone** (diamond icon in Gantt/Timeline)
- Newer rollouts include: Feature, Defect, Customer

### Custom Task Types

- Workspace owner/admin defines at workspace level
- Properties:
  - Name (max **16 chars**)
  - Description (max **100 chars**)
  - Icon (replaces status circle visually)
  - Color
- **Hard cap: 100 task types per Workspace**
- Per-List default type setting available
- Each type can have unique custom fields + statuses
- Usable as trigger / condition / action in Automations

### Milestone (Special Task Type)

- Mark via right-click → Task Type → Milestone, or task detail icon → Milestone, or bulk via toolbar
- **Gantt:** yellow diamond on end (due) date; if no end, at start date
- **Calendar/Timeline/Board/List:** distinct icon
- Color: yellow until Done/Closed (default scheme)
- Convert back: ellipsis → Task Type → Task
- Available on all plans

### Plan Tier

- Restricted on Free
- Broader on Unlimited/Business
- Full control on Business Plus / Enterprise

---

## 10. Multiple Assignees & Watchers

### Multiple Assignees

- Enabled via **Multiple Assignees ClickApp** (admin must activate)
- Available on **all plans**
- No documented hard cap; practical limit = workspace member count
- **Completion semantics:** one assignee closing = task closed for all
- All assignees auto-added as followers
- All assignees get notifications (per personal settings)

### Watchers / Followers

Auto-follow triggers (each toggleable per-user):
- Created the task
- Assigned to task
- Edited description or name
- Commented
- Reacted to a comment
- @mentioned
- Added explicitly
- Comment assigned to them

---

## 11. Tags

- **Scope:** Space-level (no workspace-level tag manager)
- Same-name tags in different Spaces treated as same tag in cross-Space search ("Everything" view)
- Moving a tagged task to a Space without the tag → destination auto-inherits the tag
- Properties: name + color (hex picker)
- Multiple tags per task
- Tags filterable/searchable in every view
- Combine with AND/OR filters
- All plans

---

## 12. Sprints

### Enablement

- **Sprints ClickApp** enabled at workspace level by owner/admin
- Then enabled per Space

### Sprint Folders & Sprint Lists

- **Sprint Folder** auto-generates **Sprint Lists** (one per iteration)
- Sprint List = one iteration with configurable duration (e.g., 2 weeks), naming pattern
- New Sprint Lists inherit cadence automatically

### Sprint Automations

- **Mark Sprint as Done** — auto-fires at sprint end date; ALWAYS enabled on all plans; does NOT count against monthly automation quota
- **Auto status flip to "In Progress"** when sprint starts
- **Spillover** — unfinished tasks at sprint end auto-move to next sprint
- Broader sprint automations require **Business plan and above**

### Sprint Points

- Per-task numeric effort estimate (planning poker style)
- Optional: Rollup from subtasks, Points per Assignee (different values per assignee on same task)
- **Free + Unlimited:** 100 uses of Sprint Points
- **Business+:** unlimited

### Velocity, Burndown, Burnup

- **Sprint Velocity cards** — 3–10 sprints commit vs completed; by Points or Time Estimates
- **Sprint Burndown** — work remaining over time within one sprint vs target
- **Sprint Burnup** — work completed cumulatively vs total scope
- All available as **Sprint Dashboard Cards**, requires **Business plan and above**
- **Lock Sprint Forecast** feature locks scope/estimates at sprint start
- Reports update at 4:00 AM workspace timezone

### Git Integration

Native GitHub/GitLab/Bitbucket connectors enable PR/commit links in sprint tasks.

---

## 13. Templates

### Template Types (all saveable & shareable)

- **Space templates** — full Space structure: Folders, Lists, statuses, ClickApps
- **Folder templates** — Folder + Lists + tasks + automations
- **List templates** — Lists + Views + custom fields + statuses + **Automations** + **Docs** + **Forms** + **Whiteboards**
- **Task templates** — task + subtasks + checklists + descriptions + assignees + dependencies + custom fields + due dates (remap-aware)
- **Doc templates** — Doc + pages
- **View templates** — saved view config (filters, sort, group)
- **Checklist templates** — reusable checklists
- **Whiteboard templates** — 13+ use-case categories (Roadmap, Visualization, Project Update, Org chart, Flowchart, Mind map)
- **Form templates** — form + fields

### Template Center

- Library combining: ClickUp official templates + Community templates + your workspace's saved templates
- Filterable by department, creator, tags
- Featured Community Templates curated
- Public links allow cross-workspace import

### Apply-Time Selection

- Choose which settings to apply (e.g., include statuses but skip tasks)
- Due dates remap relative to apply date
- Sharing levels: Only me / Select people / Admins only / Members and admins / Everyone (incl. guests) / Public link (cross-workspace import)

### Plan

Available all plans; richer cross-workspace community features on paid plans.

---

## 14. Comments & Mentions

### Comment Structure

- Live on tasks, Docs, image annotations, Whiteboards
- **Threaded replies** — click "Reply" for sub-thread
- Auto-add as follower when @mentioned or assigned in thread

### Mentions

- `@user`, `@team-name`, or special aliases: `@everyone`, `@all`, `@chat`, `@watchers`, `@followers`
- Mentioned user: notified + added as follower
- Aliases only work in Channel context (not thread replies)

### Reactions

- Thumbs-up shortcut button + full emoji picker
- **Shift-click** for multiple reactions at once
- Comment Reactions ClickApp **cannot be disabled** while Chat ClickApp enabled

### Assigned Comments

- Hover comment → click assign icon → pick one person
- Appears in "Assigned Comments" inbox (Assigned to me / Delegated by me tabs)
- **Resolve** checkbox; resolver's name shown; issuer notified
- Works on parent comments AND threaded replies

### Edit History

- Comments editable; "edited" marker displayed
- Edit history in activity log but no full revision viewer in UI

### Formatting

- Markdown supported
- Slash commands, banners, embeds (similar but reduced vs description)

---

## 15. Activity Log & Audit Trail

### Per-Task Activity Log

Auto-tracked events:
- Task created/deleted/restored/moved
- Name, description, priority changes
- Status changes (before/after)
- Assignee/watcher add/remove
- Due/start date changes
- Custom field edits (before/after)
- Comment creation/edit/resolution
- Subtask/checklist updates
- Attachment uploads/deletions
- Time tracking entries

Each entry: **Who · What · When · Where · Before → After**

### Activity View (location-level)

- View type showing all activity across Space/Folder/List/Workspace
- Filter by date range + activity type
- Full unlimited Activity View on **Business plan and above**

### Workspace Audit Logs (true audit trail)

**Enterprise plan only.** 4 log categories:

1. **User logs** — logins, logouts, role changes, invites, accept/decline, token use
2. **Task logs** — task activity (filterable by user + activity type)
3. **Fields logs** — Custom Fields created/edited/removed
4. **Hierarchy logs** — Space/Folder/List created/edited/deleted

- **Retention:** 30 days visible in audit log UI
- **Export:** ClickUp API (paginated query) + limited CSV from UI
- Workspace **Owners** access by default; can delegate
- Pattern: Schedule API pulls into SIEM or BigQuery for long-term retention

---

## 16. Attachments & Storage

### Per-Task Limits

- **Max file size per attachment:** 1 GB
- **Max attachments per task:** 1,000

### Workspace Storage

| Plan | Storage |
|---|---|
| Free | 100 MB total (workspace-wide) |
| Unlimited / Business / Business Plus / Enterprise | Unlimited |

Storage shared by all members (not per-user). Counts task attachments, Doc images/files, Chat uploads, Notepad attachments, cover images.

### Where Stored

- ClickUp-managed cloud (AWS-backed) by default
- **External storage integrations:** Google Drive, OneDrive, Dropbox, Box — file is **linked, not uploaded** to ClickUp storage; doesn't count toward workspace storage

### Supported Types

- Images: JPG, PNG, GIF, SVG, WebP, HEIC
- Docs: PDF, DOC, XLS, PPT, CSV, TXT, MD
- Video: MP4, MOV, WebM
- Audio
- Archives: ZIP, RAR
- Code files
- **In-line preview** for images, video, PDFs, audio, common Office formats

---

## 17. Notifications

### Channels (each independently configurable)

- In-app (Inbox)
- Email
- Mobile push (iOS/Android)
- Desktop push
- Browser push
- Slack (via integration)

### Granular Triggers

- New comment / reply on watched task
- @mention
- Assigned to task
- Assigned comment
- Status change
- Due / start date change / approaching
- Priority change
- Subtask added
- Attachment added
- Task created in followed Space/List
- Reaction to your comment
- Integration events (GitHub PR, Slack message, etc.)

### Smart Features

- **Smart Notifications** — delays mobile push when active on web/desktop (configurable 3–6 hr; recommended 3 hr)
- **Inbox snooze** — hover or press Z; presets (1h, tomorrow, next week), natural language date, calendar
- **Mark all read** + Clear at Inbox level
- **Digest email** — daily summary of due tasks + key activity
- **Auto-follow** — opt to auto-add as follower for tasks you interact with
- **Do Not Disturb** schedule per user
- Notifications **per-user, per-Workspace** (different workspaces, different settings)

### Presets

- **Default** — assignments, mentions, comments on followed items
- **Focused** — mobile only on @mentions
- **Mentions Only** — all channels only on @mentions
- **Custom** — per-trigger toggles

### Slack Sync

Per-channel mapping for ClickUp activity → Slack message; preview unfurling; create tasks from Slack back into ClickUp.

---

## 18. Views — All 16+ Types

### 18.1 List View

- Default for every Space/Folder/List
- Horizontal rows in collapsible groups; columns expose fields
- **Group by:** Status (default), Assignee, Priority, Tags, Due Date, Task Type, any Custom Field
- **Sort:** click headers asc/desc; multi-column sort
- **Filter:** AND/OR groups; supports EQ/NOT for all fields; GT/GTE/LT/LTE for numbers; dynamic dates (today, yesterday, overdue, thisweek); empty/not-empty
- **Bulk actions:** multi-select then status, assignees, tags, priority, dates, move/copy, archive/delete, add to sprint, merge, bulk custom fields
- **Inline editing:** edit fields without opening task
- **Column calculations** (footer):
  - Sum / Avg / Min / Max / Median / Range
  - Count / Count Unique / Count Empty
  - Percent Empty / Percent Not Empty
  - Earliest / Latest (for dates)
- Formula-field column calcs available on paid plans
- **Subtask display modes:** Collapse all / Expand all / As separate tasks
- **Row density:** Compact / Comfortable / Expanded
- **Time Estimate Rollup** on parent (sum of own + all subtasks) — all plans
- All plans; advanced filter operators + protected/private views on Business+

### 18.2 Board View (Kanban)

- Cards in vertical columns
- **Group by:** Status, Assignee, Priority, Tags, Due Date, Task Type, any Custom Field
- **Subgroups (swimlanes):** second axis for horizontal swimlane rows (e.g., status × priority matrix)
- **WIP Limits** — cap tasks per column with visual flag when exceeded; combine with automation alerts
- **Drag-drop** single + multi-card (select then drag); mobile drag-drop supported
- **Card customization** — choose which fields appear on card face
- All plans

### 18.3 Calendar View

- Modes: Day, 4-Day, Week, Month
- **Drag-to-reschedule:** drag task to change date; drag edge to extend duration
- **Quick-create:** click slot to create task on that day
- **All filters apply** (assignee, status, priority, tags, custom fields, Me Mode)
- **External calendar sync:**
  - Google Calendar — native 2-way sync from a specific Space/Folder/List
  - Outlook Calendar — 2-way sync as of June 2025 (was 1-way before)
  - iCal feed — 1-way export to any iCal-compatible app
- All plans

### 18.4 Gantt View

- Horizontal time bars per task across timeline with dependency arrows
- **4 dependency types:** Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish
- **Critical Path** — highlights chain controlling project end date (Free plan included)
- **Slack Time** — toggle to show tasks with buffer
- **Baselines** (released early 2026):
  - Time-locked snapshots of task start/end dates
  - Overlay live vs baseline; drift right = slip, drift left = ahead
  - Multiple baselines per Gantt view, each with own color
  - Tasks need both start + due dates
  - **Paid plans only** (Free doesn't see Baseline button)
- **Progress %** on bars; calculated as completed / total
- **Milestones** — diamond markers
- **Resource workload overlay**
- **AI** — Brain / Super Agents flag delays before cascade
- Limitation vs Timeline: Gantt only sorts, can't group by arbitrary fields
- All plans; advanced features (baselines) on paid

### 18.5 Timeline View

- Linear horizontal date layout; rows = swimlanes, tasks = bars within
- Optimized for high-level chronological planning (vs dependency-heavy Gantt)
- **Group by:** Status, Assignee, Priority, Tags, List, Folder, Custom Fields (Gantt can't group)
- **Swimlanes by assignee** — drag tasks between lanes to reassign
- **Zoom:** Days / Weeks / Months
- Click+drag empty area to create task spanning date range
- Drag bar edges to change duration; drag between rows to reassign
- Works at List/Folder/Space/Workspace level
- Per-view limits: tasks rendered per view, subtask depth, dependency arrows; overflow tasks silently excluded from that view (not deleted)
- All plans; free has view caps

### 18.6 Table View

- Spreadsheet-style grid; rows = tasks, columns = fields
- **Inline editing** every cell
- **Bulk edit** via Bulk Action Toolbar
- **Column calculations** identical to List (Sum/Avg/Min/Max/Median/Range/Count/etc.)
- **Formula columns** via Formula Custom Field (math, dates, logic, references to other fields)
- **Grouping** — Status, Assignee, Priority, custom fields
- **Sorting/filtering** identical to List
- **Subtasks** — expand and edit inline
- **Export:** CSV or Excel
  - Options: Visible Columns Only / Task Names Only / All Columns
  - **Free + Unlimited:** capped at 5 List/Table/Form view exports
  - **Business+:** uncapped
  - Export links expire after 1 hour
- Best view for treating ClickUp as a structured database (CRM, inventory, budgets)
- All plans; advanced exports + protected views Business+

### 18.7 Workload View

- Team capacity grid — assignees on rows, time buckets on columns
- **Effort units:** Number of tasks / Time Estimate / Sprint Points
- **Time periods:** Days / Weeks / Months / 7 days / 14 days
- **Display modes:**
  - Daily Scheduled (effort committed each day)
  - Weekly/Monthly Capacity (total committed)
  - Daily/Weekly/Monthly Availability (free vs spent)
- 8h task spanning Mon–Tue → 4h each weekday; only weekdays in range counted
- **Capacity limits** — natural language ("1h", "1d", "1w")
- **Per-day capacity** (e.g., Mon 8h, Wed 4h) — **Business Plus + Enterprise**
- **Color coding:** Green = under, Yellow = nearing, Red = over
- **Actions:** drag tasks between rows to reassign, drag bar for date, regroup capacity inline
- Available all plans; per-day capacity + Workload Report card Business+

### 18.8 Box View (Team View)

- One box per assignee + one "unassigned" box
- Each box shows tasks grouped by Not Done vs Done with totals
- **Workload units:** Number of tasks / Time Estimate / Sprint Points
- **Drag tasks between boxes** to reassign
- Fastest at-a-glance workload distribution snapshot
- Renamed from Box View → Team View
- All plans; Workload Report card Business+

### 18.9 Activity View

- Reverse-chronological feed of every change
- **Tracked events:** task lifecycle, name/desc/priority changes, status changes, assignees/watchers, dates, comments, attachments, custom field changes, time tracking, automations
- **Per entry:** who (avatar + name), what (item + name), when (timestamp), before → after
- **Filter:** date range (Today, Yesterday, This Week, Last 30 Days, custom), location, user(s), activity type
- **Plan:** unlimited Activity View on **Business plan and above**

### 18.10 Mind Map View

- Tree-structured node graph radiating from root
- **2 modes:**
  1. **Tasks mode** — auto-renders existing hierarchy; drag branches to restructure actual hierarchy
  2. **Blank mode** — free-form ideation; multi-select nodes + "create task" to convert to real tasks
- **Layout controls:** Re-layout button, node colors (often mapped to Lists/statuses)
- **Sharing:** public link
- **Free / Unlimited:** **100 cumulative Mind Map uses workspace-wide** (lifetime cap)
- **Business+:** unlimited

### 18.11 Map View

- Geographic map with pins per task with Location Custom Field
- Pin customization: color by status, priority, or any dropdown custom field
- Multiple Location fields supported — switch which drives the map
- Map controls: satellite/streets toggle, pan/zoom
- Filter by assignee, region, status, custom fields
- Sharing: private/public links
- **Limitation:** two tasks at identical address → only one pin
- All plans incl. Free
- Use cases: field service, deliveries, real estate, event venues, multi-site

### 18.12 Whiteboard

- Infinite collaborative canvas
- See §25

### 18.13 Doc View

- Rich-text collaborative document as a view
- See §24

### 18.14 Form View

- Submittable form, auto-creates a task per submission
- See §21

### 18.15 Chat View

- Real-time chat panel scoped to location
- See §26

### 18.16 Embed View

- Embed external URL via iframe
- "+ View → Embed → paste URL or embed code"
- Supports: YouTube, Google Maps, Google Docs/Sheets, Salesforce dashboards, Figma, Miro, web reports
- Limitation: sites with `X-Frame-Options: deny` or strict CSP cannot be embedded
- All plans incl. Free; guests can embed

---

## 19. Filters, Sorting, View Permissions, Me Mode

### Filter System

- Applied to any task-displaying view
- **Logical operators:**
  - Within group: AND or OR
  - Between groups: AND or OR (`filter_group_ops` array via API)
  - Nested groups for compound boolean
- **Field type → operators:**
  - All types: EQ, NOT
  - Number/Currency/Rating/Formula numeric: GT, GTE, LT, LTE
  - Date: dynamic values (today, yesterday, overdue, thisweek), comparison (before/after/between)
  - Text: contains, starts-with, ends-with, empty, not-empty
- **Standard dimensions:** Assignee, Watchers, Status, Priority, Tags, Due Date, Start Date, Created Date, Last Updated, Task ID, Task Type, Time Estimate, Time Tracked, Lists, Sprint, Custom Fields, Relationship, Formula
- **Personal filters** — applied only for current user

### View Saving

- **Shared (default)** — appears in Views Bar for everyone with location access
- **Private view** — visible only to creator + explicitly granted users
  - 2 share-permission levels: Full Edit (save/protect/share/delete) or Limited (see/duplicate/favorite)
  - Shareable via public link or with specific users
  - **Business plan and above**
- **Protected (locked) view** — locks settings (filters, group/sort, subtasks toggle, column visibility, closed-task display)
  - Anyone with Full Edit can unprotect by default; creator can restrict via "Manage permissions"
  - 2 permission tiers: Full Edit or Limited
  - Personal display preferences (e.g., column reorder for that user) still adjustable
  - **Business plan and above**

### View Permissions

- **Workspace Owner / Admin:** full control
- **Members with Full Edit at location:** can create/save/share/protect/unprotect/delete
- **Members with Limited / Read-only:** see + duplicate + favorite shared views, create own private, can't save changes to shared/protected
- **Guests:** see only shared content; per-view inviting available via private-view sharing
- **View-only users** — per-permission controls for specific views (Enterprise typically)

### Everything View / Home View

- **All Tasks** (formerly "Everything"): workspace-wide aggregation
- **All Spaces**: similar concept at Spaces level
- **Home / My Tasks page** — personal landing:
  - **LineUp** — curated priority queue (you or manager sets)
  - **Agenda card** — today's scheduled tasks, reminders, external calendar events
  - **My Work card** — tabs Today / Overdue / Next / Unscheduled / Done
  - **Comments & Mentions** consolidator
  - **Reminders** — with attachments, dates, recurring; managers can delegate
  - **Customizable canvas** — drag/rearrange cards
  - Calendar integration into Agenda (Google + Outlook 2-way as of 2025); one-click Zoom/Meet join

### Cross-Workspace Aggregation — NOT supported

ClickUp aggregates only within a single Workspace. Top community feature request, no shipped feature. Workaround: single Workspace + Spaces for segmentation.

### Me Mode

- Dynamic per viewer (not static "assignee = X") — shared Me Mode view shows each viewer's own work
- Click avatar in upper right of any view
- **Sub-options:**
  - Show tasks where comments assigned to me
  - Show tasks where subtasks assigned to me
  - Show tasks where checklist items assigned to me
- **Everyone Mode** — companion mode; click another member's avatar to simulate viewing their tasks
- All plans
- Known limitation: guests can still disable Me Mode in Protected views

---

## 20. Custom Fields — All 20+ Types

Each field has `id`, `type`, `type_config`, and a `value`.

### Text & Identifier

| Field | API type | Format | Plan |
|---|---|---|---|
| Text (short) | `short_text` | String | All |
| Long Text | `text` | String multi-line, rich text + AI Fields | All |
| Email | `email` | RFC-5322 validated | All |
| Phone | `phone` | E.164-style with country + area code | All |
| URL / Website | `url` | Auto-prefixes `https://`, URL format check | All |
| Task ID (Custom) | n/a (workspace setting) | Prefix + sequential (e.g., `DEV-123`) | **Business+** |

### Numeric & Currency

| Field | API type | Format | type_config | Plan |
|---|---|---|---|---|
| Number | `number` | int or float | None | All |
| Money/Currency | `currency` | Number | `currency_type` (USD/EUR/etc.), `precision` | All |
| Rating | `emoji` | Integer 0..count | `code_point`, `count` (1–5 scale) | All |
| Progress – Manual | `manual_progress` | `{current: number}` | `method: manual`, `start`, `end` | All |
| Progress – Automatic | `automatic_progress` | Read-only computed | `method: automatic`, `tracking` (which subtask/checklist statuses count) | All |

### Selection

| Field | API type | Format | type_config | Plan |
|---|---|---|---|---|
| Dropdown (single) | `drop_down` | Option ID (UUID) | `options[]` `{id, name, color, orderindex}`, `sorting`, `default` | All |
| Labels (multi-select) | `labels` | Array of label IDs | `options[]` `{id, label, color hex, orderindex}` (up to 500 options) | All |
| Checkbox | `checkbox` | Boolean | None | All |

Each dropdown/label option carries hex `color` — ClickUp's de-facto color picker (no standalone color field type).

### Date & Time

| Field | API type | Format | type_config | Plan |
|---|---|---|---|---|
| Date / Date+Time | `date` | Unix milliseconds (number) | `time` (boolean — include time) | All |

### Relational

| Field | API type | Format | Plan |
|---|---|---|---|
| People (user picker) | `users` | `{add: [user_id], rem: [user_id]}`, `multiple`, `include_groups` | All |
| Relationships (link to task) | `tasks` | `{add: [task_id], rem: [task_id]}`, scopable to a List | All (limited on Free) |
| Rollup | UI feature on relationships | Aggregated read-only from chosen field of related tasks | Paid |
| Lookup | UI feature | Read-only display of a field from linked task | Paid |

### Files & Location

| Field | Format | type_config | Plan |
|---|---|---|---|
| Files / Attachment | First-class attachments; some attachment field contexts | Cloud-storage integrations allowed | All (storage capped on Free: 100MB) |
| Location | `{lat, lng, formatted_address, place_id}` (Google Maps) | None | All |

### Computed

| Field | API type | Behavior |
|---|---|---|
| Formula | `formula` | Expression evaluated server-side over other custom fields. 70+ functions: arithmetic `+ - * /`, date/time (`TODAY()`, `DAYS()`), string, logical `IF()`, `AND()`. Cannot reference text-typed Custom Fields in some math contexts. |
| Voting | (read-only via API) | Up/down votes by users |

### AI Fields (Brain integration)

AI Fields live inside Long Text or Dropdown custom fields. Auto-populated by Brain on a trigger.

- **Summary** — summarizes task description/comments
- **Progress Updates** — generates status updates
- **Sentiment** — classifies positive/neutral/negative
- **Custom Text** — arbitrary prompt → text
- **Custom Dropdown** — prompt → select an option

Requires Brain AI or Everything AI add-on.

### Field Limits per Plan

- **Free:** 60 *uses* total across Workspace (1 use = one value set on one task)
- **Paid (Unlimited+):** Unlimited uses

### Field Permissions (5 levels)

1. Everyone can view & edit (default)
2. Everyone can view; only admins can edit
3. Only specific roles/people can view & edit (exceptions)
4. Hidden from Guests & Limited Members
5. Required — task can't be created/closed without value

- **Required Custom Fields:** Business+ only
- **Granular role-based permissions:** Business Plus + Enterprise only (via Custom Roles)
- Guests/Limited Members can always be hidden from any field (all plans)

### Updating via API

Custom Fields NOT updated via the regular Update Task endpoint — use Set Custom Field Value endpoint.

---

## 21. Forms

ClickUp Forms are a view type on a List — every submission creates a task in that List.

### Supported Field Types

Text, Long Text, Email, Phone, Number, Currency, Date/Date+Time, Dropdown, Labels, Checkbox, Rating, File Upload, Task Fields (Assignee, Priority, Status, Due Date, Tags), any Custom Field on destination List

### Features

- **Conditional Logic** — show/hide based on prior answers; up to **25 rules per field**
  - Trigger fields: Assignee, Checkbox, Dropdown, Label, People, Priority, Status
  - **Business Plus + Enterprise only**
- **Custom Branding** — colors, 1-or-2-column layout, theme (light/dark), button color, background image (Business+)
- **Hide ClickUp branding + Redirect URL** after submit — **Business Plus+ only** (redirect doesn't work when embedded; only on hosted URL)
- **reCAPTCHA** spam protection
- **Hidden / pre-populated fields** — Email, Text, URL, Dropdown, Priority, Number can be hidden + populated via URL query params (UTM-style)
- **Sharing:** public link, embed iframe, password protection, allow logged-in users only
- **Auto-task creation** — each submission = new task with mapped fields
- **Responses tab** — dedicated submission browser
- **AI Insights** — Brain summarizes/analyses submissions
- **Submission limit:** 500/hour per IP

### Limits per Plan

| Plan | Forms | Conditional Logic | Branding | Hide Branding | Redirect URL |
|---|---|---|---|---|---|
| Free | 1 total | No | No | No | No |
| Unlimited | Unlimited | No | Limited | No | No |
| Business | Unlimited | No | Yes | No | Limited |
| Business Plus | Unlimited | Yes | Yes | Yes | Yes |
| Enterprise | Unlimited | Yes | Yes | Yes | Yes |

---

## 22. Automation Engine

Scopable to Space, Folder, or List; applies to tasks, subtasks, or both.

### 22.1 Triggers

**Task-Lifecycle:**
- Task created
- Task status changes (to/from any specific status)
- Task moved (different List)
- Task copied
- Task archived
- Task deleted
- Task name updated

**Assignment & People:**
- Assignee added / removed
- Watcher added / removed

**Field & Property Changes:**
- Custom Field changes (any field, including AI Fields — AI Field values can themselves be triggers)
- Priority changes
- Due date changes / arrived / approaching
- Start date changes / arrived
- Tag added / removed

**Content & Collaboration:**
- Comment posted
- Comment assigned / resolved
- Checklist resolved
- Subtask resolved
- Task linked / unlinked
- Time tracked (entry added)

**Time-Based:**
- Recurring (every X minutes/hours/days/weeks/months)
- At a specific time (combined with date conditions)
- Date arrived (due/start)

**External & Integration:**
- Form submitted (task created via form)
- Webhook received (incoming HTTP webhook to ClickUp-generated URL — Task webhooks + Chat webhooks)
- Email submission via email-to-task addresses
- App-specific: GitHub PR opened, HubSpot deal stage, Slack message, Twilio SMS, etc.

May 2026 release notes (v3.63) added new triggers + actions + **regex conditions**.

### 22.2 Conditions

Available on **Business plan and above** (Free + Unlimited get triggers + actions only).

- Status equals / not equals / changes to / from
- Assignee is / contains / is empty
- Custom Field value matches / contains / greater/less than / is empty
- Priority is (Urgent, High, Normal, Low, None)
- Tag is / contains
- Date is before/after/on/within X days
- Time tracked greater/less than
- Created by / Watched by
- List / Folder / Space scope
- Role-based (user is in role X — Business Plus+ via custom roles)
- Regex match (added v3.63, May 2026)

**Logical operators:**
- AND — all conditions true (default; multiple conditions combine with AND)
- OR — between condition groups (partially supported, being expanded)
- Conditions ordered top-to-bottom, applied as filters before actions fire

### 22.3 Actions

Actions execute when trigger + conditions met. Run sequentially in listed order (drag-to-reorder).

**Task Actions:**
- Change status
- Assign / unassign user(s)
- Add / remove watchers
- Change priority
- Set / change due date / start date
- Add / remove tag
- Move task to List
- Copy task to List
- Create a subtask
- Create a new task (from template)
- Apply a template
- Archive / unarchive
- Delete task

**Content & Collaboration:**
- Post comment (with @mention support — creator, watcher, triggering user, or specific user)
- Add checklist / item
- Add/edit description
- Set custom field value
- Generate AI Field value (AI Action — Brain summarizes, analyses, sentiment, etc.)

**Notifications:**
- Send email (to specific user/creator/assignee; with merge tags)
- Send Chat message (ClickUp Chat)
- Send Slack message (channel/user)
- Send Microsoft Teams message
- Send Discord message

**Integrations:**
- GitHub — open PR/issue, comment
- HubSpot — create/update contact, deal
- Twilio — send SMS
- Zoom — schedule meeting
- Google Calendar — create event

**External:**
- Call webhook — outbound HTTP POST with JSON payload (Zapier, Make, custom backend)

### 22.4 Automation Limits per Plan

| Plan | Automations/month | Conditions | Audit Log | AI Actions |
|---|---|---|---|---|
| Free | 100 actions | No | No | No |
| Unlimited | 1,000 | No | No | No |
| Business | ~5,000–10,000 (docs inconsistent) | Yes | Limited | Add-on |
| Business Plus | 25,000 | Yes + custom roles | Yes | Add-on |
| Enterprise | 250,000 (or contractually unlimited) | Yes | Yes (full) | Add-on |

Audit Logs (full automation activity tracking) — Enterprise tier.

---

## 23. AI Automation & Brain Integration

### Brain in Automations

- **Natural Language Automation Builder** — plain English ("When a task moves to QA, assign Sarah and notify #qa in Slack"), Brain generates the automation including triggers, conditions, actions
- **100+ prebuilt automation templates**
- **AI Actions** — automation step that calls Brain to write task summary, progress update, sentiment label, or fill any custom field via prompt
- **AI Fields as Triggers/Conditions** — when AI-generated value changes, automations can react

### Super Agents in Automations

- AI "coworkers" as real Workspace users — @mentionable, assignable, schedulable
- 500+ fine-tuned skills (writing, research, data analysis, project mgmt)
- 3 creation paths: Natural Language Builder, Prebuilt Catalog (Standup Coordinator, Bug Triage Agent, Status Reporter), Manual Configuration
- Capabilities: read/write tasks, edit Docs, send Chat, @mention users, run Automations, query workspace data, call integrations

### MCP Server

ClickUp ships an MCP server (`developer.clickup.com/llms.txt`) so external AIs (Claude, ChatGPT) can connect into the workspace.

---

## 24. Docs

Notion-style editor.

### Block Types (via "/" slash menu)

- Headings (H1/H2/H3 — collapsible; collapsing hides until next heading of equal/larger size)
- Paragraphs (single + multi-line)
- Bullet lists, Numbered lists, Toggle lists (and Toggle headings)
- Code blocks (syntax highlighting), Inline code
- Quotes / Block quotes
- Banners (colored alerts)
- Callouts
- Dividers
- Columns (multi-column layouts)
- Tables
- Embeds (YouTube, Google Docs/Sheets, Loom, Figma, List views, Whiteboards, Dashboards — any iframe-able URL)
- Images, Videos, Files
- Bookmarks / Web links (rich preview)
- Tasks (embedded as live rows or cards)
- Mentions: @people, @tasks, @docs, @AI (Brain)
- Math / equations (LaTeX)
- Buttons
- AI block (Brain prompts inline)

### Pages & Hierarchy

- Docs contain pages + unlimited nested subpages
- Left page tree with drag-and-drop reorder/nesting
- No folder structure — organize via page tree + tags
- Each Doc: icon (emoji/avatar) + cover image (gradients, stock, upload)

### Sharing & Permissions

- Per-Doc: Private / Workspace / Shared with specific users or Teams / Public link
- Per-link levels: View only, Comment, Edit (Edit requires login on most plans)
- Cascading parent → subpages (subpages inherit; can be overridden)
- Domain restriction, expiration depending on plan
- Password protection — requested but NOT standard in 2026

### Real-Time Collaboration

- Live cursors, presence indicators, simultaneous editing
- Requires **Collaborative Editing ClickApp** (on by default)

### Comments

- Inline comments anchored to text selections
- Reply threads + Resolve
- Assigned Comments + convert to tasks
- @mentions trigger notifications

### Linking to Tasks

- Type `@` + task name → live status pill
- Linked tasks appear in task's "Relationships → Linked Docs"

### Version History

- Doc page history via page ellipsis → "Show page history"
- Per change: user, date/time, hover-to-restore reverts page

### Doc Hub

Workspace-wide Docs sidebar with sections: All Docs, Created by me, Shared with me, Private, **Meeting Notes** (auto-created by AI Notetaker), Trash. Search/sort/filter by owner, date, location.

### Plan

Docs on all plans. Private Docs + detailed permissions improve on Unlimited+. Doc templates + full library on Unlimited+.

---

## 25. Whiteboards

Infinite collaborative canvas.

### Object Types

- Shapes (rectangle, ellipse, triangle, diamond, parallelogram, etc.) with color/border/fill
- Sticky notes (many colors; rich text)
- Text boxes (rich text — bold, italic, lists, alignment)
- Connectors / arrows: line, elbow, curved; configurable color/size; arrowheads on either end
- Freehand pen / draw (variable widths/colors, highlighter)
- Images (drag-drop), embeds, links
- Frames / sections
- Live ClickUp objects: Tasks (embedded cards), Docs, Lists, Views

### Multi-user

- Real-time multi-cursor presence
- Live editing
- Viewer/editor avatars at top
- In-Whiteboard chat or embed Whiteboard inside Chat channel

### Convert to Task

Click Shape, Sticky Note, or Text box → floating toolbar → "Task" → choose List → element becomes live linked task card on canvas.

### Linking

Items can link to existing tasks, Docs, or other Whiteboards. Whiteboards embeddable in Docs or pinned to Spaces.

### Templates

Template Center has 13+ use-case categories (Roadmap, Visualization, Project Update, Org chart, Flowchart, Mind map). Custom Whiteboard templates saveable and shareable.

### AI

- Brain text-to-image generation
- Convert sketched brainstorm into tasks/projects with one click

### Export & Share

- PDF export
- Public link share
- Embed in Docs

### Plan

- **Free:** capped at ~60 Whiteboards (ClickApp uses)
- **Unlimited / Business / Enterprise:** unlimited
- **Private Whiteboards:** Business plan and above

---

## 26. Chat & SyncUps

### Core Chat

- Channels (by Spaces / Hub) and Direct Messages
- Threaded replies, message reactions (emoji), edit/delete, drafts, message search
- File sharing (with previews), GIPHY, voice clips with transcription
- "Posts" — long-form async announcement messages (separate from chat stream)
- Slack import (channels, history, members, emojis)
- Mobile app with offline mode and "Instant Load Framework"

### Task Integration

- One-click "Create Task from Message" (manual List choice, or AI Automatic to pick the right List)
- **FollowUps** — turn comments/messages into tracked action items
- Tasks/Docs mentioned in chat auto-linked back to asset
- Above messages: related-tasks count + click to see/add/remove

### SyncUps (Voice/Video)

- All plans
- Up to 200 participants; 24 simultaneous speakers
- One-click calls from any Channel/DM
- **Recording:**
  - ≤1 hour calls: full video recording (Beta)
  - \>1 hour: full audio recording
- **Transcription** — Brain transcribes; access via Clips Hub → Transcript panel
- AI Summary button → meeting summary
- Public shareable links for recordings

### Chat AI

- AI CatchUp (catch up on what you missed)
- AI agents in Chat with customizable prompts, suggested answers, auto-task creation
- Summarized threads on demand

### Plan

- Chat — Unlimited+ (introduced in ClickUp 3.0)
- SyncUps — all plans (subject to AI Notetaker limits for transcription on Brain/Everything AI tiers)

---

## 27. Goals & Targets

### Goal Types (Targets within a Goal)

- **Number** — numeric target (e.g., 5 posts/week)
- **Currency** — monetary target with currency selector
- **True/False** — Done/Not Done checkbox
- **Task** — tracks completion of one task, subtask, or entire List of tasks

A Goal can have one or many Targets; Goal progress = weighted aggregate, auto-updates as linked tasks/values change.

### Properties

Title, description, **owner(s) (multiple supported)**, due date, visibility (specific users/Teams), color, Folder.

### Folders for Goals

Group related Goals (sprint cycles, OKRs, weekly scorecards, quarterly initiatives). Folder shows aggregate progress across child Goals.

### Plan

- **Unlimited and above** — full Goals
- **Free** — limited (capped at 100 uses lifetime)
- Goal Folders prominent on Business+
- Multiple owners + granular permissions on paid plans

---

## 28. Time Tracking

### Global Timer

Start/stop from any device (web, desktop app, mobile, Chrome extension). Timer follows you across tasks.

### Manual Entry

Add time retroactively with start/end times or total duration. Works on tasks or via "Add time entries by date range."

### Billable

Per-entry billable/non-billable toggle. "Default new time entries to billable" option. Tags on time entries.

### Hourly Rates / Invoicing

- Billable marking + reports supported
- **No native invoicing or per-user rate billing** — manage via integration (Harvest, Toggl, QuickBooks, ADP)

### Time Estimates vs Tracked

- Time Estimates ClickApp — estimated time per task
- Granular Time Estimates — per assignee on the same task
- Time Estimates Rollup — aggregate from subtasks
- Time Tracked Rollup — aggregate tracked time from subtasks
- Dashboard cards: Time Estimated vs Time Tracked

### Timesheet View

View time by day/week/month/custom range. Group by user, task, project. Reminders for submission.

### ClickApps

- **Time Tracking** — enable at workspace level (per-Space toggle on Business+)
- **Time in Status** — tracks duration in each status

### Reports

Dashboard Time Tracking cards: Time Tracked, Billable vs Non-Billable, Time Estimated vs Tracked, by user/task/list.

### Integrations

Native: Toggl, Harvest, Everhour, Timely, Time Doctor, Clockify. Harvest bidirectional sync. QuickBooks/ADP via Zapier.

### Plan

- Native time tracking on Free (with lifetime cap on tracked time; Time Tracking ClickApp ~60 uses)
- Advanced timesheet + full reporting Business+

---

## 29. Dashboards & Reporting (60+ Widgets)

ClickUp markets "60+ cards" organized as Featured / AI Cards / Overview + standard categories.

### Card Categories

**Task cards:**
- Task List card (live List view embedded with inline filtering/editing)
- Status counts / Pie chart of statuses
- Priority breakdown
- Assignee workload pie
- Tasks by Tag
- Total tasks (number card)
- Overdue/Completed counts

**Time tracking cards:**
- Time Tracked (by user/task/day)
- Billable vs Non-Billable
- Time Estimated vs Tracked
- Time per task

**Sprint cards** (Business+; Sprints ClickApp required):
- Sprint Burndown (current + Legacy)
- Sprint Burnup (current + Legacy)
- Sprint Velocity (3–10 sprints commit vs completed)
- Cumulative Flow (status over time)
- Lead Time
- Cycle Time
- Reports update at 4:00 AM workspace timezone

**Portfolio cards:**
- Portfolio overview (multiple Lists/projects rollup with progress + dates)
- Workload card (capacity over time)

**Custom field cards:**
- Custom Field bar/pie/line charts
- Calculation against any custom field (sum/avg/min/max/count)

**Calculation cards:**
- Calculations across fields (P&L, cost of labor, estimated vs actual)
- Battery / progress visualizations

**Embed cards:**
- Embed any URL (Google Sheets, YouTube, dashboards)

**Text & Rich text cards:**
- Rich text block (formatted notes, headings, embeds)

**Chat cards:**
- Chat Channel embedded in dashboard for live conversation

**Doc cards:**
- Embed live Doc content

**AI Cards** (Brain required):
- AI StandUp Card (personal summary)
- AI Team StandUp Card
- AI Executive Summary Card
- AI Project Update Card
- AI Brain Card (custom prompts with mentions of tasks/docs/files)

### Filtering

Per-card + dashboard-wide filters by owner, status, date, custom field, tag, list/folder/space.

### Date Ranges

Most cards support relative ranges (today, this week, last 30 days, custom).

### Sharing

Share via public link or with specific users without exposing workspace; granular per-dashboard permissions.

### Templates

Pre-built dashboard templates (sprint tracking, client reporting, team workload, marketing performance).

### Plan

- Free: capped (~100 uses)
- Unlimited: Dashboards but advanced cards (sprints, portfolios, calculations) Business+
- Business+: unlimited dashboards + advanced cards
- Private dashboard views Business+

---

## 30. Inbox, Notepad, Reminders, Pulse

### 30.1 Inbox

- Unified notifications surface combining task comments, mentions, assignments, status changes, Chat mentions, Doc comments, list updates
- Side-by-side view: notification list left, underlying item opens right (no leaving Inbox)
- **Snooze** (hover or Z key): presets (1h, tomorrow, next week, custom) or "until updated"
- **Auto-follow** setting auto-adds you as follower
- Mark all read, archive, cleared/snoozed tabs
- Customizable settings: per-source mute, per-keyboard-shortcut config
- **Mobile Inbox:** swipe-left to snooze, swipe-right to clear, tap to open
- All plans

### 30.2 Notepad

- Personal quick-note tool — distinct from Docs
- Web, Desktop, iOS, Android, Chrome Extension
- Free on all plans (incl. Free)
- Rich text: headings, bold/italic/strikethrough, colors, highlights, code blocks, slash commands
- Checklists with drag-drop reorder + nested items
- Notes sync across devices; offline support
- **Convert to Task:** hover → "+" or ellipsis → Convert → pick List; title becomes task title, content becomes description. Mobile: long-press → Convert
- Promote to full Doc
- Brain integration: summarize, generate outline, organize scattered notes

### 30.3 Reminders

- Lightweight personal action items, **separate from tasks**
- Properties: title, description, due date/time, recurrence, attachment, custom notification timing
- **Can be delegated** to another user
- Can be recurring
- Created from anywhere — sidebar, comments (independent of source task), mobile, Chrome extension
- Available to **everyone, including guests**, on all plans
- Surfaced in Inbox Primary tab when due + Reminders card in My Tasks

### 30.4 Pulse (now "Analytics" in Teams Hub)

- Real-time view of who is online (green dot), what each user is currently working on, recent activity
- Toggleable Online/Offline filters; hourly activity by user
- Renamed Pulse → Analytics inside Teams Hub (2026 update)
- Enabled via Pulse ClickApp (workspace/admin controlled)
- **Plan:** Business and above

---

## 31. Search

### Global Search (AI Command Bar)

- Workspace-wide keyword + filter search across tasks, Docs, lists, comments, Chat, attachments
- Filter by owner, date, location, type

### Recent Items

Quick-access list in command bar.

### Saved Searches / Filters

List views support saved filters (e.g., "My Overdue Tasks," "This Week's Priorities," "Blocked Items").

### AI Deep Search (Brain)

Multi-pass semantic search across entire workspace including buried/historical content, with cited results.

### Connected Search (Everything AI)

Extends search to Google Drive, GitHub, Figma, SharePoint, Slack, Dropbox; results inline.

### Web Search

Brain can pull from the web.

### Filtered List View Querying

Brain can answer questions about a currently filtered List view (2026 update).

---

## 32. Permissions & Roles

### Standard Roles

- **Owner** — single user; full access; only role that can transfer ownership and delete workspace
- **Admin** — manages users, billing, ClickApps, integrations, workspace settings
- **Member** — standard paid seat with access to assigned Spaces
- **Limited Member** — paid seat with restricted access (replaced "Internal Guest"; anyone using company email domain / corporate SSO is treated here; bills at full member rate)
- **Guest** — external seat (cannot use the org's email domain)

### Guest Sub-Types

- **View-only guest** — free, unlimited, view-only
- **Permission-controlled guest** — Full edit / Edit / Comment / View only per item; counts against guest seat allocation

### Guest Seat Allocations

| Plan | Allocation |
|---|---|
| Free | 5 free permission-controlled guests |
| Unlimited | 5 guests + 2 per paid member |
| Business | 10 guests + 5 per paid member |
| Business Plus | 15 guests + 10 per paid member |
| Enterprise | Custom |

### Custom Roles

- **Business Plus:** 1 custom role
- **Enterprise:** unlimited custom roles
- Owners (and delegated admins) can compose any combo of role-level permissions

### Permission Granularity

- Per Folder, List, Task, Dashboard, Doc, Goal, Goal Folder, selected views on paid plans
- Per-Space granularity requires Enterprise
- Public sharing toggleable per item

### Public Sharing Controls

- View vs Comment vs Edit
- Domain restriction + expiration depending on plan

### Sharing Rules

- Public Spaces inherit to Folders/Lists/Tasks/Goals
- Private items shareable with specific users/Teams

---

## 33. 2FA, SSO, SCIM

### Two-Factor Authentication

- **TOTP** (Google Authenticator, Authy, Duo) — all plans (Free included)
- **SMS 2FA** — Business plan and above
- **Backup codes** provided at setup
- **Enforcement:** Owners/admins can require 2FA workspace-wide
  - Mode 1: 3 logins grace period, then SMS-2FA required
  - Mode 2: immediate SMS-2FA required
- When required, users cannot deactivate on their own

### SSO Providers

- **Google SSO** — Business plan and above
- **Microsoft / Microsoft Entra ID** — Enterprise
- **Okta** — Enterprise
- **Custom SAML 2.0** (OneLogin, JumpCloud, etc.) — Enterprise

### SCIM Provisioning

- **Okta SCIM** — full provisioning (user create/update/remove, role assignment incl. custom roles)
- **Microsoft Entra ID SCIM** — limited (user create + remove; no roles, custom roles, team assignments)
- **Google Workspace** — JIT (just-in-time), not full SCIM
- **Custom SAML** — SCIM base URL + API token exposed after SAML setup

### JIT Provisioning

Users with company email domain auto-converted to Limited Members at full member billing.

### Per-User SSO Bypass

Possible for break-glass admins.

### Custom Domain SAML

Supported.

---

## 34. Security & Compliance

### Certifications

- SOC 1 Type 2, SOC 2 Type 2, SOC 3 (annually audited)
- ISO 27001:2022, ISO 27017:2015, ISO 27018:2019, ISO 27701:2019
- **ISO 42001 (AI Management Systems)** — early certification
- GDPR compliant
- HIPAA — BAA available on **Enterprise plan only**
- PCI DSS compliant

### Encryption

- In transit: TLS 1.2 (HTTPS for all web app comms)
- At rest: AES-256

### Hosting

100% AWS, multi-AZ redundancy.

### Data Residency (Enterprise only, no extra charge)

- United States
- Europe — Ireland (AWS eu-west-1)
- Asia Pacific — Australia
- Asia Pacific — Singapore

### Monitoring

24/7/365 monitoring; automated security testing; third-party penetration testing.

### AI Data Privacy

Third-party AI providers (OpenAI, Anthropic, Google) prohibited from training on or retaining ClickUp user data; in-context learning only.

---

## 35. ClickUp Brain AI

ClickUp's AI layer; paid add-on on top of any base plan.

### Core Capability Buckets

**AI Writer / writing tools** — generate, summarize, translate, simplify, explain, improve text. Works in any text field (tasks, Docs, comments, chat, whiteboards, Notepad).

**AI for tasks:**
- Task auto-summary (current status, key decisions, action items + owners, blockers, scope changes)
- Auto-extract action items into properly assigned tasks
- AI-generated status updates / standup
- Task description draft from a prompt
- Subtask summary (rolls up nested subtasks)

**AI Knowledge Manager / Connected Search / Deep Search** — searches across tasks, Docs, Chat, comments, connected apps (Google Drive, GitHub, Figma, SharePoint, Slack, Dropbox); cited answers. Deep Search digs into historical/buried content. Web search included.

**AI Notetaker** — see §37.

**AI Custom Fields** — fields whose value is computed by an AI prompt over the task's data (parse text, calculate, categorize, cross-reference).

**AI Agents (Super Agents)** — see §36.

**Ambient Intelligence** — surfaces relevant context, related tasks, smart suggestions proactively.

**Brain MAX** — separate native desktop app (macOS 13+ / Windows 10+) bundling AI chat, multi-model selection (ChatGPT, Gemini, Claude), enterprise search, Talk-to-Text dictation. Native app, not Electron.

### Pricing (May 2026)

| Tier | Price | Includes |
|---|---|---|
| Free AI | $0 | Trial-level access |
| Brain AI | **$9/user/month annual** ($18 monthly) | Brain MAX, AI assistant, web search, multi-model chat, AI writing, project summaries, standard Talk-to-Text. **1,500 AI Super Credits/user/month** |
| Everything AI | **$28/user/month annual** ($68 monthly) | Premium AI models, unlimited Super Agents, unlimited AI Fields/Cards/assignment automation, AI Prioritize + time-blocking, image generation, unlimited Talk-to-Text, unlimited Enterprise Search, unlimited AI Notetaker. **5,000 AI Super Credits/user/month** |

**Add-on credits:** $10 per 10,000 Super Credits ($0.001/credit overage).
**Talk-to-Text standalone:** $9/user/month.
**Notetaker standalone:** from $12/month for 60 hours.

---

## 36. Super Agents (Autonomous AI)

### Autopilot Agents vs Super Agents

- **Autopilot Agents** — automation-like, run on triggers, perform fixed sequences with AI judgment in steps
- **Super Agents** — autonomous, goal-directed teammates that reason multi-step, choose tools, follow conditional branches, retain memory across sessions, exist as named workspace members, act on triggers independently of user being online

### Pre-built Super Agent Personas

Strategist, Developer, Visual Designer, Standup Coordinator, Bug Triage Agent, Status Reporter, and others.

### Super Agent Builder

No-code, 3-step process:
1. Alignment
2. Configuration
3. Deployment

Configure tools and data sources from across the workspace + connected external apps.

### Typical Autonomous Tasks

Bug triage, standup compilation, client status reporting, onboarding tracking, ticket routing, content drafting, research, code review summaries, sprint planning.

### Capabilities

- Write and run code against workspace data
- Calculate metrics (e.g., sprint velocity)
- Cross-reference task lists
- Draft and send messages
- Create/update tasks and Docs
- Schedule meetings

### Plan

- Standard Super Agents on Brain AI ($9 add-on)
- Unlimited Super Agents on Everything AI ($28)

---

## 37. AI Notetaker

- Joins Zoom, Google Meet, and Microsoft Teams as a bot
- Auto-transcribes in real time
- Generates structured **Meeting Notes Doc**:
  - Meeting name + date
  - Attendees
  - Overview summary
  - Key takeaways (bullets)
  - Next steps checklist
- **Action items become real ClickUp tasks** (auto-assigned)
- Auto-detects ~100 languages (Spanish, French, German, Italian, Portuguese, Dutch, Hindi, Japanese, Chinese, Finnish, Korean, Polish, Russian, Turkish, Ukrainian, Vietnamese, etc.)
- Recordings: video ≤1 hour; audio-only longer; via Clips Hub
- Notes auto-saved to Meeting Notes section of Doc Hub

### Plan

- Limited usage on Brain AI
- **Unlimited** on Everything AI ($28)
- Standalone Notetaker from $12/month for 60 hrs

---

## 38. ClickApps (Modular Features)

ClickApps are togglable per Workspace (many also per Space). Owners/admins only. Comprehensive list:

### Task Management & Organization

- Custom Fields
- Custom Task IDs
- Tags
- Priorities
- Milestones
- Tasks in Multiple Lists ("Multi-task")
- Relationships
- Not Started Status Group
- Nested Subtasks (up to 7 levels)
- Subtask State
- Multi-task Toolbar
- Custom Item Types
- Default Personal Views
- Docs Home
- Email (send/receive within ClickUp)
- LineUp

### Agile / Sprints

- Sprints
- Sprint Points
- Automated Sprints / Sprint Automations

### Dependencies & Workflow

- Dependencies / Dependency Warning
- Reschedule Dependencies
- Remap Subtask Due Dates
- Incomplete Warning
- Work In Progress Limits
- Create-Quick Statuses

### Time

- Time Tracking
- Time Tracking Rollup
- Time Estimates
- Time Estimates Rollup
- Granular Time Estimates
- Time in Status

### Collaboration

- Multiple Assignees
- Collaborative Editing
- Threaded Comments
- Comment Reactions (auto-enabled with Chat; can't be disabled)
- Clip (screen recording)
- GIPHY
- Zoom
- Who's Online?

### Automation & Reporting

- Automation
- Dashboards
- Pulse

---

## 39. Integrations (1000+)

### Communication & Chat

Slack, Microsoft Teams, Discord, Google Chat (Hangouts Chat), Intercom, Front

### Development & Version Control

GitHub, GitLab, Bitbucket, Sentry, PagerDuty

### Design & Whiteboarding

Figma, Miro, InVision, Adobe Creative Cloud

### Time Tracking

Toggl, Harvest, Everhour, Clockify, TimeCamp, Time Doctor

### Cloud Storage / Files

Google Drive, OneDrive, Dropbox, Box, SharePoint

### CRM / Sales / Marketing

HubSpot, Salesforce, Pipedrive, Mailchimp, ActiveCampaign

### Support / Help Desk

Zendesk, Intercom, Front, Help Scout, Freshdesk

### Analytics / BI

Tableau, Power BI, Looker (via Zapier/Make), Google Sheets

### Video / Meetings

Zoom, Loom, Microsoft Teams meetings, Google Meet, Vimeo

### iPaaS / No-Code Automation

Zapier, Make (Integromat), Workato, Pipedream, n8n, Tray.io

### Productivity / Office

Google Workspace (Drive, Calendar, Gmail, Sheets, Docs), Microsoft 365 (Outlook, Teams, OneDrive, Calendar)

### AI / ML

ClickUp Brain (built-in), MCP for external Claude/ChatGPT, OpenAI (via Zapier)

### Telephony / Notifications

Twilio (SMS via automation), Discord

### Calendar Sync

- **Google Calendar** — 2-way sync; filter by status, due-date range, location
- **Outlook Calendar** — 2-way sync (June 2025+); requires Microsoft 365 or Outlook.com; Microsoft admin must approve permission scopes
- **iCal feed** — 1-way `.ics` URL; Apple Calendar, Outlook, Fantastical
- All plans

### Email Integration

- **Send Email From Task** — opens Email tab in comment composer; pick account, To/CC/BCC, subject, body, attachments
- **Email To Task** — every task has unique inbound email address (ellipsis → "Attach emails to this task"); forwarding creates comment/attaches email
- **Create tasks via email** — Spaces/Lists have inbound addresses; sender → new task (subject = name, body = description)
- **Email Automation Action** — send template emails on triggers
- **IMAP / SMTP** custom mail server (host, port, SSL, credentials)
- **Native:** Gmail (OAuth) and Outlook (Microsoft OAuth)

**Plan limits:**
- Free: 1 email account, 100 uses lifetime
- Unlimited: 1 email account, unlimited uses
- Business+: 2 email accounts
- Enterprise: Multiple + audit-log coverage

---

## 40. Public API & Webhooks

### Type

**REST**, JSON over HTTPS. Base URL: `https://api.clickup.com/api/v2/`. Newer endpoints under `/v3/` — gradual rollout.

**No GraphQL.** OpenAPI spec downloadable from developer.clickup.com.

### Authentication

**Personal API Token:**
- Format: `pk_<token>`
- Header: `Authorization: {personal_token}` (no "Bearer" prefix)
- Never expires unless regenerated
- Generated in Settings → Apps

**OAuth 2.0** (for multi-user apps):
- Authorization Code grant
- Authorize URL: `https://app.clickup.com/api?client_id={client_id}&redirect_uri={redirect_uri}`
- Token URL: `https://api.clickup.com/api/v2/oauth/token`
- Header: `Authorization: Bearer {access_token}`
- Access token currently does not expire (subject to change)
- Only Workspace owners/admins can create OAuth apps

### Rate Limits (per token)

| Plan | Limit |
|---|---|
| Free / Unlimited / Business | 100 req/min |
| Business Plus | 1,000 req/min |
| Enterprise | 10,000 req/min |

429 responses include:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (Unix timestamp)

### Endpoint Categories

Teams (Workspaces), Spaces, Folders, Lists, Tasks (CRUD, filtering, custom fields), Comments, Checklists, Time tracking, Goals, Members, Webhooks, Views, Templates, Tags, Custom Fields, Attachments, Docs.

### MCP Server

`https://developer.clickup.com/llms.txt` — AI-friendly index of every API/help page in Markdown.

### Webhooks

**Two flavors:**
- Developer API webhooks (per-team, via API) — for integrations
- Automation webhooks (per-List/Folder/Space, in-app) — outbound HTTP POST as automation action

**Event Types (Developer API):**

Task events (13): `taskCreated`, `taskUpdated`, `taskDeleted`, `taskPriorityUpdated`, `taskStatusUpdated`, `taskAssigneeUpdated`, `taskDueDateUpdated`, `taskTagUpdated`, `taskMoved`, `taskCommentPosted`, `taskCommentUpdated`, `taskTimeEstimateUpdated`, `taskTimeTrackedUpdated`

List events (3): `listCreated`, `listUpdated`, `listDeleted`
Folder events (3): `folderCreated`, `folderUpdated`, `folderDeleted`
Space events (3): `spaceCreated`, `spaceUpdated`, `spaceDeleted`
Goal/Target events (6): `goalCreated`, `goalUpdated`, `goalDeleted`, `keyResultCreated`, `keyResultUpdated`, `keyResultDeleted`

**Payload Format:**

HTTP POST, `Content-Type: application/json`. Standard envelope:
```json
{
  "webhook_id": "...",
  "event": "taskUpdated",
  "task_id": "...",
  "history_items": [
    {
      "field": "status",
      "before": "Open",
      "after": "In Progress",
      "user": { "id": ..., "username": ... },
      "date": 1716678000000
    }
  ]
}
```

**Signing:** Each webhook has shared secret; ClickUp signs every payload — verify with HMAC.

**Retry Policy:**
- Developer webhooks: up to 5 retries; after 5 failures, `fail_count` increments; marked failing
- Marked failing if endpoint returns non-2xx OR takes >7 seconds
- Automation webhooks: retries for 1 hr 15 min; displays as "pending" in Activity tab

**Health endpoint:** `developer.clickup.com/docs/webhookhealth` returns `status` ("active"/"failing") and `fail_count`.

---

## 41. Import / Export

### Native Imports (direct)

Asana, Basecamp, Confluence, Jira, Monday.com, Notion, Todoist, Teamwork, Trello, Slack, Wrike.

Plus:
- **CSV / Excel Spreadsheet Importer** — generic with field mapping
- **Manage imports** dashboard tracks status

**Per-tool mapping:**
- Trello — Boards → Spaces (one Space per board) or merged
- Asana — Projects → Folders/Lists
- Jira — Projects → Spaces, issue types → separate Lists, attachments included
- Monday — Boards → Folders/Lists

### Exports

- **List / Table view** → CSV or Excel
- **Workspace-wide export** → CSV (selected Spaces/Folders/Lists); includes fields, attachment URLs, time-tracked, comments
- **Subtasks:** "As separate tasks" or nested
- **Docs** → PDF, HTML, Markdown
- **Dashboards** (Business+) → CSV or PDF per widget

### Not Supported

- Native task export to PDF (long-standing request)
- Bulk dashboard export

---

## 42. Mobile & Desktop Apps

### Mobile App

**Platforms:** iOS (iPhone + iPad), Android. Free with any plan.

**Features:**
- Create/edit tasks, comments, attachments
- Notifications (push, lock-screen, banner)
- All views: List, Board, Calendar, Gantt (reduced), Box, Mind Map, Whiteboards (read)
- Docs viewing + light editing
- Chat
- Time tracking (start/stop timer)
- Voice notes
- Camera attachment uploads
- Home-screen widgets (iOS 14+/Android) — task count, recent activity
- Biometric unlock
- ClickUp Brain (mobile AI)

**Push Notifications:**
- Per-event toggles (assigned, mentioned, status change, comment)
- Digest mode — batches into periodic summary
- DND windows
- Per-Space filtering

**Offline Mode (Mobile) — Limited:**
- Tasks/notes already opened can be **viewed** offline
- Most actions require connection
- **Creating tasks/reminders offline is NOT supported on mobile** (desktop only)
- Changes during intermittent connectivity sync on reconnect

### Desktop App

**Platforms:** Windows, macOS, Linux. Free; same login as web.

**Advantages over Web:**
- Native OS notifications
- Faster launch, lower memory
- Persistent login
- Keyboard shortcuts (incl. global shortcut to capture task)
- Multi-window support
- Universal search / quick-create overlay
- System-tray icon

**Offline Mode (Desktop) — Better than Mobile:**
- View recently opened tasks + notes offline
- **Create new tasks + reminders offline; sync on reconnect**
- Cannot **edit** existing tasks/notes offline
- Cannot create **subtasks** offline (workaround: create task, convert later)

**Features Available:**
All core surface — Tasks, Docs, Chat, AI, Notifications, Whiteboards, Mind Maps, Dashboards, Time tracking.

---

## 43. Multi-language & Accessibility

### UI Localization (Full)

English, French, Spanish, Portuguese (Brazil), German, Italian.

### Mobile App Localization

Italian, French, German, Portuguese, Spanish (regional variants).

### AI Translation (Broader)

English, French, Spanish, Portuguese, German, Italian, Swedish, Dutch, Korean, Japanese, Chinese, Arabic.

### AI Notetaker Transcription

~100 languages auto-detected (Spanish, French, German, Italian, Portuguese, Dutch, Hindi, Japanese, Chinese, Finnish, Korean, Polish, Russian, Turkish, Ukrainian, Vietnamese, etc.).

### Accessibility

- ClickUp working toward WCAG 2.0 compliance
- Multi-year plan to reach **WCAG 2.2 Level AA** + ADA
- Tested with NVDA (Windows) + VoiceOver (macOS / iOS)
- Engaged external accessibility experts
- Active accessibility feedback community
- Extensive keyboard shortcuts (configurable in My Settings) covering navigation, task actions, view switching, Inbox actions, Chat, command bar

(Note: Not at full WCAG conformance in 2026 — partial support, ongoing work.)

---

## 44. Full Pricing & Plan Limits Matrix

### Free Forever — $0

- Unlimited users + unlimited tasks
- **100 MB storage total**
- **5 Spaces max**
- 100 automation runs/month
- 60–100 lifetime "uses" on advanced features (custom fields, Gantt, Dashboards, Whiteboards, Mind Maps, Goals)
- **1 Form**
- Unlimited Custom Views (shared by default)
- Limited guest permissions (~5 permission-controlled guests)
- TOTP 2FA
- 24/7 support
- 1-day activity view
- API rate limit: 100 requests/minute/token
- **No SSO, no SAML, no audit log**
- AI: trial only

### Unlimited — $7/user/month annual ($10 monthly)

Everything in Free, plus:
- Unlimited storage
- Unlimited Spaces, Folders, Lists, Custom Fields, Custom Views, Forms, Dashboards (basic cards), Whiteboards, Gantt, Mind Maps, Goals, Integrations
- 1,000 automation runs/month
- 7-day activity view
- Native Time Tracking; resource management
- Guest permissions (~5 + 2 per paid member)
- ClickUp Chat
- Email integration
- API rate limit: 100 req/min/token
- Goals & Portfolio management (basic)

### Business — $12/user/month annual ($19 monthly) — Popular

Everything in Unlimited, plus:
- Unlimited dashboards with **advanced cards** (sprints, portfolios, calculations)
- Unlimited timeline & activity views
- 5,000–10,000 automation runs/month
- Sprint Points & Sprint reporting
- Workload management (portfolio)
- Webhooks
- Custom exporting
- Mind Mapping (unlimited)
- Private Whiteboards
- **Google SSO**
- SMS 2FA
- Unlimited proofing
- ~10 guests + 5 per member
- API rate limit: 100 req/min/token

### Business Plus — $19/user/month annual

Everything in Business, plus:
- Team sharing
- **1 Custom Role**
- Custom Permissions
- Custom capacity in Workload
- Increased automation & API: ~25,000–50,000/month
- Subtasks in multiple Lists
- Conditional Logic in Forms
- Advanced public-link settings (hide ClickUp branding, redirect URL)
- Priority support
- API rate limit: 1,000 req/min/token
- ~15 guests + 10 per member

### Enterprise — Custom Pricing

Everything in Business Plus, plus:
- **Unlimited Custom Roles**
- **SAML SSO** (Okta / Microsoft / custom)
- **SCIM** auto-provisioning
- Workspace-level permissions (private Spaces by default)
- **Audit Log** (30-day retention; API export)
- Session management
- Enterprise API
- 250,000 automations/month
- Custom branding / white-labeling
- Default personal views enforcement
- MSA available; **HIPAA BAA available**
- **Data residency** (US / Ireland / Australia / Singapore) at no extra cost
- Live onboarding training; dedicated Customer Success Manager
- API rate limit: 10,000 req/min/token

### AI Add-ons (stack on any base plan)

| Add-on | Price | Includes |
|---|---|---|
| Brain AI | $9/user/month annual ($18 monthly) | 1,500 Super Credits/user/month |
| Everything AI | $28/user/month annual ($68 monthly) | 5,000 Super Credits/user/month; unlimited Super Agents/Notetaker/Talk-to-Text/Enterprise Search/AI Fields/Cards |
| Overage credits | $10/10,000 (~$0.001/credit) | — |
| Talk-to-Text standalone | $9/user/month | — |
| AI Notetaker standalone | from $12/month | 60 hrs |

### Hard Hierarchy Limits (Unlimited+)

- 400 Lists per Folder
- 400 Folders per Space

### Form Limits (all plans)

- 500 form submissions/hour per IP
- Conditional logic Business Plus / Enterprise; up to 25 rules per field

---

## 45. Build Implications for a Clone

Key architectural takeaways for designing schema, services, and authorization:

### 1. Hierarchy

Workspace → Space → (Folder?) → List → Task → Subtasks (up to 7 levels). Goals + Docs live alongside (workspace-scoped with location pointers). Multi-table schema where each level has own ID + parent FK.

### 2. Permissions

Multi-level (Workspace / Space / Folder / List / Task / item) with role inheritance + per-item overrides. Distinct seat tiers (Member / Limited Member / Guest / View-only Guest) + pluggable custom roles.

### 3. Content Blocks

Build ONE shared block engine (Docs + tasks + Whiteboards + Chat + Notepad + dashboard text cards). Notion-like.

### 4. ClickApps

Architect features as togglable modules per Workspace + per Space — not hard-coded.

### 5. Real-time

CRDT-style collab for Docs / Whiteboards + presence system for cursors and "who's online."

### 6. AI Layer

Treat AI as separate billable add-on (credits-based) sitting on top of base tiers. Expose AI as: inline writer, summarizer, custom field type, search, agent runtime.

### 7. Audit & Compliance

30-day audit log surface + API export; SCIM endpoint; SAML SSO (Enterprise gate); separate data-residency regions.

### 8. Limits Enforcement

Track per-plan counters for: automation runs/month, ClickApp uses (lifetime on Free), storage, guests, API rate (per-token), form submissions/hour/IP.

### 9. Tasks in Multiple Lists

Many-to-many join table with `is_primary` flag — status/custom fields always read from primary List's schema.

### 10. Statuses

Per-List (inheriting from Folder/Space) ordered set, each belonging to one of 4 status groups. Build `status_group` enum: NotStarted / Active / Done / Closed.

### 11. Custom Fields

Per-Workspace (definable globally) and attached per-List/Space. Field value uses counted on Free plan = `(rows in field_value table)` NOT just `(non-null cells)`. Multi-value fields (Labels) count per value.

### 12. Priorities

Hardcoded (1=Urgent, 2=High, 3=Normal, 4=Low, 0=None) — do NOT design for runtime priority customization unless intentionally differentiating from ClickUp.

### 13. Dependencies

Directed graph with edge types: `BLOCKS`, `BLOCKED_BY`, `LINKED`. `BLOCKS` and `BLOCKED_BY` are inverse pairs. Reschedule logic = topo-sort with date-shift forward propagation.

### 14. Recurring Tasks

Best modeled as `recurrence_rule` table on tasks. RFC 5545 / RRULE compatible covers all ClickUp options.

### 15. Subtasks

Recursive (`parent_task_id`); enforce max depth in app logic, not DB.

### 16. Checklists

Separate entities under task; max 5 levels nested; single assignee per item.

### 17. Watchers / Followers

Many-to-many user↔task table; auto-add on events listed in §10.

### 18. Activity Log

Append-only event table: `who`, `what_type`, `entity_type`, `entity_id`, `before_json`, `after_json`, `when`.

### 19. Custom Task IDs

Per-Space sequence + prefix; collisions impossible because prefixes unique per Space.

### 20. Time Tracking

Separate `time_entries` table; aggregate via SUM for "time tracked" on task; "time estimate" is a single nullable column on task.

### 21. Comments

Self-referential threading via `parent_comment_id`; reactions join table; mentions join table; `assigned_to_user_id` nullable.

### 22. Sprints

Special List type with `start_date` + `end_date`; Sprint Folder = special Folder generating Sprint Lists from recurring template; sprint points = numeric column on tasks.

### 23. Milestones

NOT a separate object type — they're a `task_type_id` value with a flag.

---

## What's NOT in ClickUp (worth noting for clone scope decisions)

- **Cross-Workspace aggregation** — not supported (top community request, no shipped feature)
- **Native task export to PDF** — long-standing request
- **Bulk dashboard export**
- **Customizable priority labels/colors** — hardcoded
- **GraphQL API** — REST only
- **Password-protected Doc public links** — requested, not standard
- **Native invoicing / per-user rate billing** — must integrate (Harvest, etc.)
- **Hourly rate fields per user** — managed externally
- **Subtask differentiation in automations** — automations cannot distinguish subtasks from tasks
- **Checklist items with due dates / reminders / status / custom fields / comments / priority** — intentionally not supported
- **Subtasks with different status sets from parent** — subtasks share the List's status workflow
- **OR logic between automation condition groups** — partially supported, being expanded

---

## Reference Sources (Master List)

**Official ClickUp:**
- clickup.com/features (overview)
- clickup.com/features/views, /docs, /whiteboards, /chat, /goals, /project-time-tracking, /sprints, /custom-fields, /automations, /milestones, /map-view, /mind-maps, /home, /notepad, /reminders, /kanban-board, /gantt-chart-view, /recurring-tasks, /custom-task-types, /task-tags
- clickup.com/pricing
- clickup.com/security
- clickup.com/accessibility
- clickup.com/contact/dataresidency
- clickup.com/clickapps
- clickup.com/integrations
- clickup.com/ai, /brain/max, /brain/pricing, /brain/enterprise-search, /brain/ai-notetaker, /brain/agents, /brain/talk-to-text

**ClickUp Help Center (help.clickup.com):**
- Hierarchy: Intro to the Hierarchy, Hierarchy best practices, Intro to Spaces
- Tasks: Intro to tasks, Tasks feature availability and limits, Task fields, Custom Task IDs
- Subtasks: Intro to subtasks, Create nested subtasks, Subtasks in Multiple Lists FAQ
- Checklists: Use task checklists, Create checklist templates
- Statuses: Manage task statuses, Statuses FAQ, Not Started Statuses, Use Done statuses, Status templates
- Priorities: Set task Priorities
- Dependencies: Intro to Dependency Relationships, Create Dependency Relationships, Rescheduling dependencies, Link tasks
- Recurring: Use recurring tasks
- Task Types: Custom task types, Set default custom task types, Custom task types feature availability and limits
- Sprints: Intro to Sprints, Activate the Sprints ClickApp, Use Sprint Points, Sprint Velocity/Burndown/Burnup cards, Sprints feature availability
- Templates: Use task templates, Use List templates, Share a template, Intro to templates, Create and use Whiteboard templates
- Comments: Intro to comments, Reply to task comments, Reactions to comments, Use @mentions, Assign comments
- Activity Log: Intro to Activity view, Search and filter task activity, Workspace audit logs, Audit Logs feature availability
- Attachments: Add attachments to tasks, Manage your Workspace storage, Workspace storage limits
- Notifications: Notification settings, Smart notifications, Mobile notifications, Snooze Inbox notifications
- Views: Intro to List/Board/Calendar/Gantt/Timeline/Table/Workload/Team/Activity/Mind Map/Map/Form/Doc/Chat/Embed view, Customize Board view, Use subgroups, Use baselines on Gantt, Workload feature availability, Use Workload view, Set capacity limits, Intro to Me Mode, Create and share a private view, Protect a view, Permissions in detail, Views feature availability, Add a view to All Tasks
- Custom Fields: Custom Field types, Intro to Custom Fields, Custom Field permissions, Make Custom Fields required, Set default values, Hide Custom Fields from guests, Intro to Formula Fields, AI Fields, Custom Fields uses
- Forms: Intro to Forms and Form view, Use conditional logic in Forms, Form settings, Form view feature availability and limits
- Automation: Use Automation Triggers, Use Automation Actions, Use Automation Conditions, Intro to Automations, Automations feature availability, Create a task webhook Automation, Integrate ClickUp using Automation webhooks
- Email: Use Email in ClickUp, Create tasks via email, Connect IMAP
- Calendar: Google Calendar integration, Outlook Calendar integration, Sync Calendar views with external calendar
- SSO: SSO Overview, Custom SAML SSO, Okta SCIM, Microsoft Entra ID SCIM, Microsoft SSO, Bypass SSO for users
- Import/Export: Import overview, Import from Trello, Export List and Table views, Export Workspace data
- Mobile/Desktop: ClickUp Mobile App, Mobile notifications, Offline Mode, Use the ClickUp desktop app, Apps across devices
- Docs: Intro to Docs, Docs Hub, Content Blocks, Use columns
- Whiteboards: Intro to Whiteboards, Add items to a Whiteboard, Whiteboards feature availability
- Chat/SyncUps: SyncUps feature availability, Use voice and video in SyncUps, Add a Chat view, Create or connect tasks from Chat messages, Chat data retention
- Notetaker: Use AI Notetaker, Supported languages for AI Notetaker
- Goals: Create a Goal, Organize your Hierarchy for goals and OKRs
- Time Tracking: Intro to time tracking, Time tracking integrations, Time Tracking feature availability
- Dashboards: Intro to cards, Task List cards, AI Cards, Custom cards, Embed cards, Time Tracking cards, Use time-based Dashboard cards, Dashboards feature availability, Intro to Sprint Dashboard cards
- Inbox: Intro to Inbox (3.0), Snooze Inbox notifications
- Notepad: Use Notepad, Convert notes to tasks
- Reminders: Intro to reminders
- Pulse: Intro to Pulse
- Permissions: Intro to user roles, Manage Custom Role permissions, Guest-type user roles, Permissions in detail, Public sharing, Share Spaces/Folders/Lists/tasks
- 2FA: Activate and manage two-factor authentication
- Audit: Workspace audit logs, Audit Logs feature availability
- Data: Data hosting / Data residency, Compliance and GDPR
- AI: ClickUp AI models / privacy / security FAQ, ClickUp AI feature availability, What is ClickUp Brain, Write with Brain AI, Summarize task and location activity, Brain AI and Connected Search, Deep Search, What are Super Agents, Create and configure Autopilot Agents, Translate and localize
- ClickApps: Intro to ClickApps, Customizable ClickUp features
- Tags: Intro to tags, Manage task tags, Edit tags
- Milestones: Milestones
- Slack: Slack Automations, Intro to the integration with Slack, Sync ClickUp activity with Slack channels
- Pricing: Pricing per user role and plan
- Spaces: Intro to Spaces, Create and edit Spaces
- Tasks in Multiple Lists: Tasks in Multiple Lists
- Followers: Add and remove task followers
- Text formatting: Intro to text formatting

**ClickUp Developer Portal (developer.clickup.com):**
- Authentication, Rate Limits, Webhooks, Webhook task/list payloads, Custom Fields, Filter Views, Create Workspace-level audit logs

**ClickUp Blog:**
- The ultimate guide to ClickUp terms & features
- Audit log security & compliance
- Super Agents
- Singapore data centre announcement
- Localised data hosting in Europe
- Form view conditional logic
- Form view guide
- Gantt vs Timeline
- Gantt Chart Milestones 2026
- Kanban Board WIP Limits

**Third-Party Reviews & Guides (2026):**
- UpSys Consulting — ClickUp Pricing 2026, ClickUp API Guide, ClickUp Hierarchy
- SmartProcessFlow — ClickUp Pricing 2026, ClickUp Free Plan
- Cloudwards — ClickUp Pricing 2026, Automations Guide
- SaaSCRMReview — ClickUp Pricing 2026
- GetAIPerks — ClickUp Pricing & AI add-on
- Quackback — ClickUp Pricing 2026 per-user costs
- ZenPilot — ClickUp 2026 Roadmap, Hierarchy for Agencies, Everything about Views
- WorkManagementHub — ClickUp Super Agents 2026, Gantt Baselines Guide
- SiliconANGLE — ClickUp Brain agentic capabilities
- ToolStack — Mobile App Review, SSO/SAML Review
- Releasebot — May 2026 Release Notes
- ProcessDriven — ClickApps explained, Subtasks vs Checklists vs Descriptions, How to use Docs, How to use Dependencies, Views Explained
- Consultevo — Task Dependencies Guide, Followers, Manage Statuses, Priority, Activity View, Recurring Tasks, ClickApps setup, Timeline view limits, Table view guide
- BeProductive — Unlocking ClickUp Custom Fields
- Taylor Monroe — ClickUp Dashboards breakdown
- MyRemoteVA — Free Forever Plan
- DaSilva Life — Understanding ClickUp Hierarchy
- SmashingApps — ClickUp Free Plan 2026
- Stitchflow — ClickUp SCIM Provisioning
- Paubox — Is ClickUp HIPAA Compliant
- Get-Alfred — $9 AI add-on analysis

---

*This document is a complete feature reference of ClickUp software as of May 2026, compiled for the purpose of designing a ClickUp-like task management system. It captures behavior, plan tiers, and limits across every feature surface — task management, views, automation, collaboration, AI, security, and pricing — and concludes with explicit build implications for cloning.*
