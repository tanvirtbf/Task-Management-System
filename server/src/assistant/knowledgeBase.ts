/**
 * KNOWLEDGE BASE for the in-app AI Help Assistant (see AI_ASSISTANT_PLAN.md).
 *
 * This is the assistant's entire factual knowledge of the system — it is injected
 * into the system prompt on every request (see `buildMessages.ts`). The bot must
 * answer ONLY from this content, so keep it accurate.
 *
 * Stored as a TypeScript string (not a .md file) on purpose: `tsc` does not copy
 * .md files into `dist/`, so a runtime `readFileSync` would crash in production.
 * As a string it is bundled and works in dev AND prod. The content is plain
 * markdown — edit it here whenever a feature changes (that is how you "retrain"
 * the bot). Do NOT use backtick or dollar-brace sequences inside the content.
 */
export const KNOWLEDGE_BASE = `
# BeautyBooth Task Management — System Guide

## About this system
BeautyBooth Task Management is the internal web app used by the ~100 staff at BeautyBooth, a beauty and skincare e-commerce company in Bangladesh — one shared workspace where every team runs its work as tasks (orders, complaints, product listings, marketing campaigns, plus a separate Engineering area). It is the company's own simpler alternative to ClickUp or Asana. People sign in with their company email on the [login page](/login) and land on [Home](/).

## The core structure (very important)
Everything is organised in this hierarchy, from biggest to smallest:
- **Workspace** — the whole company. There is one workspace (BeautyBooth); everyone belongs to it. (Its name, timezone and business hours are edited in [Settings → Workspace](/settings/workspace).)
- **Space** — a team or department inside the workspace (for example: Marketing, Customer Service, Orders, Engineering). Each Space can have a **Head** who reviews the team's work (see "Department review and weekly reports" below).
- **List** — a board of work inside a Space (for example a "June Campaign" list, or a "Complaints" list). A List holds tasks.
- **Task** — a single piece of work (an order to process, a bug to fix, a campaign to run). This is the main unit everyone works with.

There are NO "folders" — a Space directly contains Lists. The order is simply Workspace → Space → List → Task. Every task has a **type** (Task, Bug, Feature, Campaign, Order, Complaint or Incident) and a **status** that shows its progress.

## Navigation — where things are

### The left Sidebar (always visible after sign-in)
Top to bottom: the **Workspace menu** (click the workspace name — Settings, Members, New Space, Copy Workspace Link, Sign Out) · **Favorites** (Lists you starred) · then the pages listed under "Where things live" below — [**Home**](/), [**Inbox**](/inbox), [**Search**](/search), [**Department**](/dept), [**Reports**](/reports), [**SLA breaches**](/sla), [**Engineering**](/eng) (expands to [Sprint](/eng/sprint) and [On-Call](/eng/on-call)) and [**Settings**](/settings) · the **Space tree** (your Spaces and their Lists — the "+" here creates a Space; click a Space or List to open it) · **Report a Bug** near the bottom · and a button to collapse the sidebar.
**Department** and **Reports** appear only for Owners, Admins and a Space's Head. [SLA breaches](/sla) is open to everyone.

### The top Topbar
- **Breadcrumb** (left) — shows where you are, e.g. Home, then Space, then List.
- **Search box** (centre) — click it to open the Search page and find anything quickly.
- **On-Call badge** — shows which engineer is on call this week.
- **Quick Create (+)** — quickly create a new task from anywhere.
- **Notification bell** — your unread notifications; click to open the Inbox.
- **User menu** (your avatar, far right) — Profile, Settings, Sign Out.

## Where things live (page addresses)
Most pages have a fixed web address, so you can link straight to them. When you guide someone, point them to the page by name using its address — these are the real ones:
- [Home](/) — the dashboard you land on after signing in: how many tasks are assigned to you, how many are due today, overdue, and awaiting your review, plus today's agenda
- [Inbox](/inbox) — your notifications
- [Search](/search) — search everything
- [Department](/dept) — review team work (Owners/Admins/Heads)
- [Reports](/reports) — weekly reports (Owners/Admins/Heads)
- [Forms](/forms) — build intake forms
- [SLA breaches](/sla) — what is past its SLA deadline right now
- [Engineering](/eng) · [Sprint board](/eng/sprint) · [On-call rotation](/eng/on-call)
- [Settings](/settings) — and inside it: [Profile](/settings/profile) · [Workspace](/settings/workspace) · [Members](/settings/members) · [Teams](/settings/teams) · [Roles & permissions](/settings/roles) · [Task types](/settings/task-types) · [Tags](/settings/tags) · [Statuses](/settings/statuses) · [Custom fields](/settings/custom-fields) · [Templates](/settings/templates) · [Import / Export](/settings/import-export)
- Spaces, Lists and tasks DO each have their own address, but it contains an internal id that you cannot know — so **never write a link to a Space, List or task**. Tell the person to open it from the **Sidebar** Space tree instead (a task opens in a drawer on the right).

## Getting started
Everyone lands on [Home](/) after signing in; it shows what is assigned to them. Setting up new structure (Owner/Admin): Sidebar **+** (or Workspace menu → New Space) creates a **Space**; open the Space and **+** adds a **List**, which automatically gets the 5 default statuses **To Do, In Progress, In Review, Done, Closed**; then add tasks to the List.

## Working with tasks — the 4 views
Open a List from the **Sidebar** Space tree (Lists have no fixed address, so there is no link to give — open it from the Sidebar), then use the tabs at the top of the page to switch how you see its tasks:
- **List view** (default) — tasks as rows. Group by status, assignee or priority; sort, filter and edit fields inline. You can multi-select tasks with the checkboxes and change many at once using the bulk toolbar.
- **Board view** — a Kanban board with one column per status. Drag a task card from one column to another to change its status. You can set WIP limits and use swimlanes (by assignee or priority).
- **Calendar view** — a month/week calendar by due date. Drag a task to a different date to change its due date. Tasks with no due date appear in an "Unscheduled" panel you can drag from.
- **Form view** — the intake form(s) attached to this List (see Forms below).

### How to create a task
The fastest way from anywhere in the app is the **Quick Create (+)** button in the **Topbar** — it is on every page, including [Home](/), so you never have to navigate first.
- **Quick Create (+)** in the **Topbar** — works from any page; pick the List, type the name, create.
- Or open the List from the **Sidebar** and use the quick-add input in **List view**: type a name and press **Enter**.
- Or, in Board or Calendar view, use the add button on a column or a date.

## Task details (open any task)
To open a task: find it in a List (from the **Sidebar**), on [Home](/) under your own work, or through [Search](/search) — then click it. Its detail panel opens as a drawer on the right. Inside you can edit:
- **Properties:** Status, Priority, Assignee(s), Due date, Start date, Tags, Story points, Sprint, SLA, Reviewer. (A **Recurrence** setting is also shown, but see "Good to know" below — it is saved and does not yet create the next task by itself.)
- **Description:** a rich-text editor (bold, lists, links, and more).
- **Comments:** discuss the task. Type "@" then a name to mention a teammate (they get notified), and "#" then a task ID to link another task.
- **Checklists:** one or more checklists of items you tick off. Click a checklist's **name**, or an item's **text**, to rename it; the trash icon on an item deletes it. The section header shows done/total with a percentage, and the same progress appears on the task's row or card in List and Board view.
- **Subtasks:** smaller child tasks under this task; shows completion progress.
- **Dependencies:** mark that this task "blocks" or is "blocked by" another task.
- **Attachments:** open the task (from its List in the **Sidebar**, [Home](/), or [Search](/search)), scroll to **Attachments** and click **Upload**, or drag files onto it.
- **Custom fields:** extra fields defined by an admin (text, phone, money, date, dropdown, files).
- **Activity:** a history log of everything done on the task (status changes, assignments, comments, and so on).
- **Archive / Delete:** archive a task to hide it without deleting, or delete it.

## Assigning and following work
- To assign a task, open it (from a List in the **Sidebar**, from [Home](/), or via [Search](/search)) and set the **Assignee** in Properties — or edit it inline in List view. The assigned person gets a notification in their [Inbox](/inbox).
- To follow a task without being assigned, become a **watcher** of it.
- To see everything assigned to YOU, go to [Home](/) — the cards and today's agenda are all yours.

## Inbox and notifications
- The **Notification bell** in the Topbar shows your unread count. Click it, or open [**Inbox**](/inbox) in the Sidebar.
- Notifications are grouped by date (Today, Yesterday, This week, Earlier).
- Filter by All, Unread, @Mentions, or Assigned to me.
- For each one you can mark read/unread, snooze it (1 hour, 4 hours or 1 day), or archive it. Click a notification to jump to the task.
- You are notified when you are assigned a task, mentioned in a comment, when a task you watch changes, when something is due or overdue, when a form is submitted, for engineering events, when your **Head reviews one of your tasks** (approves or flags it), and when a **weekly department report is ready** (for Owners/Admins and the Head).
- Notifications reach you in three ways at once: the **Inbox** (updates live, no refresh needed), **email**, and **desktop or phone notifications**.
- **Email** is automatic — no setting to turn on. You get one when someone assigns you a task, and one when a task assigned to you passes its due date.
- **Desktop / phone notifications** need your permission once per device. The app asks the first time you sign in on that device; choose **Enable** and allow it in the browser. After that you are alerted even when the app tab is closed.
- If you missed that question or said "Not now", turn it on any time from [**Settings → Profile**](/settings/profile), under **Notifications**. If you had earlier chosen **Block** in the browser, you must allow it again in the browser's own site settings for this site, then reload the page.
- On an **iPhone or iPad**, first open the site in Safari, tap **Share**, then **Add to Home Screen**, and open the app from that icon — Apple only delivers notifications to a site added this way.

## Search
- Open [**Search**](/search) from the left Sidebar, or click the **Search box** in the Topbar.
- It searches across Tasks, Lists, Spaces, People and Comments at once.
- Click a result to jump straight to it.

## Forms (collect work from outside the app)
Forms let people submit information that automatically becomes a task (for example a complaint intake form).
- Open [**Forms**](/forms) to see your forms.
- Open a form to edit it: tabs for **Builder** (drag fields onto the form), **Settings**, **Branding** and **Preview**.
- Each form has a **public link** (use Copy Link or Preview). Anyone with the link can fill and submit it WITHOUT signing in, and their submission creates a task in the linked List.

## Engineering area (for the dev team)
Open [**Engineering**](/eng) in the Sidebar:
- [**Engineering home**](/eng) — a dashboard of open bugs, your sprint tasks, PRs awaiting your review, open incidents and stale tickets.
- [**Sprint**](/eng/sprint) — the sprint board with story points; pick a sprint to see its tasks across lists.
- [**On-Call**](/eng/on-call) — the weekly on-call rotation; assign which engineer is on call each week.
- **Report a Bug** — a button in the Sidebar footer, available to everyone. File a bug with a severity (S0 to S3) and the reporting team; it creates a Bug task routed to the on-call engineer.
Engineering tasks can carry extra fields: bug severity, story points, a sprint, a Git branch / PR link with PR status, and incident postmortems.

## Team access, edit rights and cross-team approval
The team-access update (August 2026) makes a TEAM-SCOPED workspace possible, but whether yours runs that way is a **setting an Admin turns on** — never assert which mode someone is in. Two reaches in [Roles & permissions](/settings/roles) decide it: **See spaces** ("Everywhere" = everyone sees every team's work; **"Their spaces"** = you see only the teams you are on) and **Edit tasks** ("Everywhere" = anyone may edit anything; **"Own items"** = only what you created or were assigned).
**How to tell:** look at the Sidebar Space tree — other departments' Spaces listed means it is still open; only your own means team-scoped. **Owners and Admins see everything either way.** The rules below describe the team-scoped mode; in the open mode they simply do not bite yet, so say that plainly instead of telling someone they cannot do something they can.

### Who sees what (team-scoped mode)
- A **Member or Guest sees only their own team's** Spaces, Lists and tasks. Other teams' work is invisible to them (not even shown as existing). **Owners and Admins still see everything.**
- If you see nothing at all, you are probably not on any team yet — ask an Admin to add you on the [Teams](/settings/teams) page.
- An Admin can grant **one team sight of another** ("Marketing can also see Social Media") from the [Teams](/settings/teams) page. That is view-only — no edit or assign rights come with it.
- If you are assigned a task that belongs to ANOTHER team, you can open that one task from anywhere (Inbox, My Work, Search, a link) — but you still cannot browse that team's lists.

### Who can edit a task (when Edit tasks is set to "Own items")
Only these people can change a task (its fields, checklists, attachments, custom fields, dependencies, tags, or archive/delete it):
1. its **assignees**, 2. its **creator**, 3. the **Head of the team that owns it**, 4. an Owner/Admin.
Everyone else on the team can still READ it and COMMENT on it — the task drawer shows a "View only" notice for them. Every change is recorded in the task's **Activity** section (who, when, old value, new value), visible to anyone who can open the task.

### Assigning someone from another team (approval)
- Assigning a person who is NOT a member of the task's team does not assign them immediately — it creates an **assignment request** they must approve first. Assigning inside your own team is instant, as always. (This only bites in the team-scoped mode: while everyone can still see everything, every assignment stays instant.)
- The request can be **Accepted** or **Declined** by: the person themselves, THEIR team's Head, or an Admin — never by the person who asked.
- The receiver can also raise a **query** instead (for example "I need 2 more days" with a proposed date). The requester answers from the task's **Assignment approval** panel and can move the real due date in the same step; the receiver then accepts or declines.
- Where to act: the **[Inbox](/inbox) "Requests" tab** (your own requests, plus your team's if you are a Head) or the task drawer's **Assignment approval** panel. You also get an email and a push notification at each step.
- A request nobody answers **expires after 7 days** and the requester is told. Until you accept, the task itself stays closed to you — decide from the request card, which shows the task's name, team, list and due date.
- Bulk assigning across teams works the same way: the toolbar reports "N updated — M assignments waiting for approval".

## Department review and weekly reports (for team leads and HR)
Each **Space** can act as a **department** led by one **Head**. The Head keeps an eye on their team's completed work, and every week the system sends a summary to HR/management automatically — so a manager can see across the whole company whether work is being delivered, without chasing each person.

### The Head of a department
- A **Head** is not a separate account type — it is a **Member or Admin** chosen to lead a Space.
- **Who sets it:** an **Owner or Admin**. Open the Space from the Sidebar Space tree, then use the **Department head** card on the Space page to pick a person (or clear it to remove the Head).
- Team membership is managed on the [Teams](/settings/teams) page: an Admin (or the team's own Head) adds and removes people there, and each person has one **home team**. Membership is what decides WHAT YOU SEE (next section) — being assigned a single task does not make you a team member.

### Reviewing the team's work — the Department page ([Department](/dept))
Owners, Admins and a Space's Head can open **[Department](/dept)** from the Sidebar to review work. (Members and Guests do not see this page.)
- Pick a department at the top if you lead or oversee more than one.
- The queue has tabs: **Needs review** (completed tasks waiting for a verdict), **Flagged**, **Overdue** and **Due today**.
- For each completed task you can **Approve** it, or **Flag** it with a short note (up to 500 characters) saying what needs another pass. The assignee is notified either way.
- You can also review from inside a task: open the task, scroll to the **Department review** section, and use **Approve** or **Flag** there. Those buttons appear only once the task is in a **Done** or **Closed** status.

### Weekly reports for HR — the Reports page ([Reports](/reports))
- Every **Monday** the system automatically creates a **weekly report** for each department covering the previous week — no one has to run it.
- **Who sees them:** Owners, Admins (HR/management) and the department's Head, on the **[Reports](/reports)** page, grouped by week. (Members and Guests do not see this page.)
- Click a report to open its detail. It shows a **per-member breakdown** (completed, completed-late, overdue, approved, flagged), **totals with the change versus last week**, the **flagged tasks with their notes**, and the **Head's note**.
- **Actions on a report:**
  - **Mark seen** — Owners/Admins acknowledge they have read it; the first person to mark it seen is recorded, so HR knows who handled it.
  - **Regenerate** — an Admin or the current Head refreshes the numbers with the latest data; the Head's note and the Seen status are kept, and nobody is notified again.
  - **Head's note** — only that report's Head can add or edit a note (extra context for HR).
- A Head or Admin can also **generate a report for a past week on demand**, instead of waiting for Monday.

### Notifications from this feature
- When your Head **reviews one of your tasks** (approves or flags it) you get a notification — if it was flagged, the note is included so you know what to fix.
- When a **weekly report is ready**, the Owners/Admins and the Head get a notification that links straight to the report.

## Settings and administration
Open [**Settings**](/settings) in the Sidebar. You only see the sections you have permission for, so your list
may be shorter than this one:
- [**Profile**](/settings/profile) — your name, timezone, and **Change password**. (everyone)
- [**Workspace**](/settings/workspace) — workspace name, locale, timezone, business hours, week start day.
- [**Members**](/settings/members) — see all members; **Invite** new people (enter email, role and team); change roles; deactivate or reactivate users. **Deactivate** is the normal way to remove someone: it takes their access away and keeps all their work and history. **Delete permanently** (the row menu, Owners/Admins only) exists for an account added BY MISTAKE — it works only while that person has created nothing at all; if they already have tasks, comments or files the app refuses, lists what they own, and offers Deactivate instead. Deleting cannot be undone. The workspace owner, and your own account, can never be deleted.
- [**Teams**](/settings/teams) — which team each person belongs to, and who leads (heads) each team. Admins add/remove people on any team and set each person's home team; a team's **head** can manage their own team's roster here too. Inviting someone always asks which team they join. ⚠️ For a person who is ALREADY in the workspace, team membership is changed ONLY here — the Members page has no team control, and no per-row "Edit" screen. Never send someone to Members to change a team.
- [**Roles & permissions**](/settings/roles) — create roles and choose exactly what each one may do, then give them to people.
- [**Task Types**](/settings/task-types) — manage the task types (Task, Bug, Feature, Campaign, Order, Complaint, Incident) with icons and colours.
- [**Tags**](/settings/tags) — manage workspace-wide labels for tasks.
- [**Statuses**](/settings/statuses) — see each List's workflow statuses and **reorder** them by dragging. Creating, renaming or deleting a status is NOT available on this page yet — every List keeps the 5 defaults it was created with.
- [**Custom Fields**](/settings/custom-fields) — create extra fields (text, phone, money, date, dropdown, files) to capture more data on tasks.
- [**Templates**](/settings/templates) — create and edit reusable task templates (with pre-built checklists). ⚠️ Be honest about the gap: the page's own text mentions an **"Apply template"** button on campaign lists, but that button is **not in the app yet** — templates can be written and kept, not yet applied to a List from the UI.
- [**Import / Export**](/settings/import-export) — **not working yet.** The page shows importers (ClickUp, Asana, Trello, Jira) and export options, but every importer answers "coming soon" and the export buttons do not actually produce a file. Never tell someone to move real data with it; if they need a copy of the data, they should ask an admin.

## Roles and permissions
- **Owner** — the account that always holds every permission and can never be locked out. There is one Owner. (There is no way to delete the workspace from inside the app.)
- **Admin** — runs the workspace: members, spaces, lists, statuses, task types, tags, custom fields, forms, templates and roles.
- **Member** — the everyday teammate: creates and works on tasks, comments, checklists, attachments.
- **Guest** — an outside collaborator, and by default READ-ONLY on the work itself. A Guest can view Spaces, tasks, members and activity, write **comments**, use this assistant, and report a bug. A Guest CANNOT create, edit, assign, archive or delete tasks, cannot manage checklists or dependencies, cannot upload files, and cannot read form submissions (those hold customers' contact details). An admin can widen this in [Roles & permissions](/settings/roles).
- **Department Head** — not a separate account role: any Member or Admin can be set as the **Head** of a Space by an Owner or Admin. A Head reviews their team's completed tasks (approves or flags them) from the [**Department**](/dept) area, and their department gets an automatic weekly report.
What each role may do is **configurable** — an admin edits it, and can also create new roles. Setup and management actions (creating spaces, inviting members, editing workspace settings, managing task types/tags/custom fields) are limited to whoever has been given those permissions, which by default means Owners and Admins. Everyday task work is open to everyone.

### Editing what a role can do — [Roles & permissions](/settings/roles)
This page is where an admin decides what each role may do. It needs the "Create and edit roles" permission, so normally only an Owner or Admin can open it.
1. The left panel lists every role with how many people hold it.
2. Click a role to see its **permission grid** on the right — every ability in the system, grouped (Workspace, Members, Spaces, Lists & statuses, Tasks, Task content, Catalog & settings, Forms, Engineering, Department review & reports, Insights, Roles & permissions).
3. Tick a box to grant an ability, untick to remove it. Risky ones (deleting things, changing roles, deactivating people) are shown in **red**.
4. Press **Save changes**. The change takes effect on that person's very next click — nobody has to sign out and back in.
- **New role** (top right) creates your own role, for example "Marketing Manager" or "Intern". It starts with nothing ticked, so you choose exactly what it may do. Your own roles can be deleted; the four built-in ones cannot.
- The **Owner** role is shown but cannot be edited — that is deliberate, so nobody can accidentally lock the workspace out of its own settings.

### How far a permission reaches — the scope
This is the important idea. Next to a ticked ability, if it can be limited, you pick **how far it reaches**:
- **Everywhere** — anywhere in the workspace.
- **Their spaces** — only inside the Spaces that person belongs to. (Belonging to a Space means holding a role inside that Space.)
- **Own items** — only tasks they created or that are assigned to them.
So "Edit tasks — Own items" means that person can edit their own tasks but not a colleague's. And **See spaces — Their spaces** is the master switch: set that and a person stops seeing departments they are not part of — Lists, tasks, search results and dashboard counts all follow it.

### "I want someone to see only their own department"
This is the most common request, and it takes TWO steps — one per person, one per role:
1. **Put the person on the right team.** [Teams](/settings/teams) → open the team → **Add member** → **pick the person from the dropdown** (it lists people already in the workspace; you do not type an email here — someone brand new is added with Members → **Invite**, which asks for their team). Being on a team IS what "their spaces" means, and each person also has one **home team**. An Admin, or that team's own Head, can do this. (This step alone is per-person and safe.)
2. **Make the reach team-scoped.** [Roles & permissions](/settings/roles) → click the role they hold (usually **Member**) → set **See spaces** to **Their spaces** → **Save changes**. It takes effect on their very next click; Lists, tasks, search results and dashboard counts all follow.
3. ⚠️ **Always warn them about step 2:** it applies to **everyone holding that role**, not to one person. If 22 people are Members, all 22 become team-scoped at once.
- Want ONE person to have abilities nobody else on their role has? Create a role for them in [Roles & permissions](/settings/roles) — but be honest that there is **no screen yet for giving a custom role to a person**: the Members page only offers **Admin**, **Member** or **Guest**. Tell them to ask the workspace Owner/Admin, who can arrange it another way.

### "You don't have permission" — what it means
If a page says access is not available, or an action is refused, it is not a bug: that ability has not been given to your role. The message names what was needed. Ask your workspace Owner or Admin to grant it in [Roles & permissions](/settings/roles).

## Account and sign-in
- **Sign in** with your company email and password on the [login page](/login).
- **Forgot password?** — open [Forgot password](/forgot-password), enter your email, and a reset link is emailed to you.
- **Change password** — [Settings → Profile](/settings/profile), then **Change password**.
- **Sign out** — User menu (top-right avatar), then Sign Out; or the Workspace menu, then Sign Out.
- New members are added by an Admin or Owner via [Settings → Members](/settings/members), then **Invite**.

## Quick answers (with the page to go to)
- **How do I create a task?** Open a List from the Sidebar, type a name in the quick-add box and press **Enter** — or use **Quick Create (+)** in the Topbar, which works from any page including [Home](/), so always give them that link to start from. (You can also just ask me here: name the task and the List, and I will create it.)
- **Where do I create a Space or List?** In the left **Sidebar**: click **+** by Spaces to add a Space; open a Space and click **+** to add a List inside it.
- **How do I assign a task?** Open the task — from its List in the Sidebar, from [Home](/), or via [Search](/search) — then set the **Assignee** in Properties (they get a notification). Always give them [Home](/) or [Search](/search) as the place to start, since a task has no address of its own.
- **How do I change a task's status?** Open the task and change **Status** — or in **Board view** drag the card to another column.
- **Where are my notifications?** [Inbox](/inbox), or the bell in the Topbar.
- **How do I change my password?** [Settings → Profile](/settings/profile), then **Change password**.
- **How do I invite a teammate?** [Settings → Members](/settings/members), then **Invite** (Owner/Admin only).
- **How do I remove someone who left the company?** [Settings → Members](/settings/members) → the row menu → **Deactivate**. Their access stops immediately and everything they did stays intact. (Permanent deletion is only for accounts added by mistake — see below.)
- **I added someone by mistake — can I delete them completely?** Yes, if they have not created anything yet: [Settings → Members](/settings/members) → the row menu → **Delete permanently**, then type their email to confirm (Owner/Admin only, cannot be undone). If they have already made tasks, comments or uploads, the app will refuse and show what they own — use **Deactivate** for those people.
- **How do I create a new role?** [Roles & permissions](/settings/roles) → **New role** → give it a name → tick the abilities it should have (and pick how far each reaches) → **Save changes**.
- **How do I stop someone seeing other departments?** Since the team-access update this is the DEFAULT: Members and Guests already see only the team(s) they belong to on [Teams](/settings/teams). To widen it, add them to more teams or grant their team sight of another team; the underlying role switch lives in [Roles & permissions](/settings/roles) (**See spaces → Their spaces**).
- **Why does it say I don't have permission?** That ability is not in your role. Ask an Owner or Admin to add it in [Roles & permissions](/settings/roles).
- **Who is on call, and how do I set it?** [On-call rotation](/eng/on-call), or the on-call badge in the Topbar.
- **How do I search?** Open [Search](/search), or click the Search box in the Topbar.
- **Can the assistant create a task for me?** Yes — just ask it in the chat, naming the task and the LIST it belongs in (for example: "Eid Campaign 2026 list-e 'banner reviewer khoja' name ekta task banao, due kal"). The task is created as YOU, with your normal permissions — assigning someone from another team still goes through their approval. The assistant can only CREATE tasks; editing, completing or deleting still happens in the app.
- **How do I add someone to a team, or give one person access to a department (for example "only Marketing")?** Answer it as numbered steps:
  1. Open [Teams](/settings/teams) and find the team.
  2. Click **Add member** and pick the person from the dropdown. (Someone brand new to the company is added with Members → **Invite**, which asks for their team.)
  3. Only if they should ALSO stop seeing other teams: in [Roles & permissions](/settings/roles) set their role's **See spaces** to **Their spaces** — warn them this affects everyone holding that role.
  Never send them to [Members](/settings/members) for team membership; that page has no team control.
- **Where do I see everything assigned to me?** [Home](/) — the cards count your open, due-today, overdue and awaiting-review tasks, and today's agenda lists them. You can also just ask me here and I will read your live numbers.
- **What is past its deadline right now?** [SLA breaches](/sla) — bugs and complaints past their SLA, newest first. Anyone can open it.
- **Which team am I on, and who is my Head?** [Teams](/settings/teams) shows every team, its members and its head.
- **Can I add or rename a status?** Not yet — [Statuses](/settings/statuses) lets you SEE and drag-reorder a List's statuses, nothing else. Every List keeps the 5 it was created with.
- **Can I import from ClickUp, or export everything?** Not yet — [Import / Export](/settings/import-export) is still a placeholder; the importers say "coming soon" and the export buttons produce no file. Ask an admin if you need a copy of the data.
- **What can a Guest do?** View, comment, use this assistant and report a bug — that is all. Guests cannot create or edit tasks, upload files, or read form submissions.
- **How do I attach a file?** Open the task, go to **Attachments**, and click **Upload** (or drag files in).
- **Who reviews my completed tasks?** Your Space's **Head** — they use [Department](/dept) to approve or flag them (Owners/Admins/Heads only).
- **Where are the weekly department reports?** [Reports](/reports) — for Owners, Admins and Heads.
- **How do I report a bug?** Click **Report a Bug** in the Sidebar footer, fill the form (severity + your team), and Submit.
- **Why can't I see another team's Space or tasks?** Since the team-access update, Members see only their OWN team's work. Ask an Admin to add you to that team on [Teams](/settings/teams), or to grant your team sight of it.
- **Why can't I edit this task ("View only")?** Only its assignees, its creator, that team's Head, or an Admin may edit. Anyone else can read and comment only.
- **I assigned someone but they were not added — why?** They are from ANOTHER team, so an **assignment request** was created instead. Track it in the task's Assignment approval panel or your [Inbox](/inbox) Requests tab; they (or their Head) must accept first.
- **Where do I approve an assignment request?** [Inbox](/inbox) → the **Requests** tab → Accept, Decline, or Query on the card. Heads see their whole team's requests there too.
- **The request says I need more time — what now?** If YOU raised the request, open the task's **Assignment approval** panel and use **Answer** — you can reply and move the due date in one step; the other side then accepts.

## Good to know (current limitations — be honest about these)
- A brand-new workspace starts empty; you create the Spaces, Lists and Tasks yourself.
- **Recurrence is not automatic yet.** You can set a recurrence on a task and it is saved, but the system does not create the next occurrence for you — make the next task yourself for now. Say this plainly if someone asks; do not promise repeating tasks.
- On the PUBLIC (no-login) form pages, special fields such as dropdown, date, money and files appear as simple text boxes; inside the app all field types work fully.
- Inviting members: an Admin or Owner sends an invite from Settings, then Members, then Invite. The person receives an email with an invitation link; they open it, set a password, and are signed in automatically. The email comes from the person who invited them (the subject reads like "X added you to BeautyBooth Tasks"), so tell them to search the sender's name — and to check **Promotions** and **Spam** before asking for a re-send.
- File attachments need the file storage to be configured; if an upload fails it is a storage/setup issue to raise with an admin.
`;
