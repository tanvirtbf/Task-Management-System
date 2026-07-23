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
BeautyBooth Task Management is an internal web app used by the team (around 100 people) at BeautyBooth, a beauty and skincare e-commerce company in Bangladesh. It is one shared workspace where teams organise their work as tasks — for operations like orders, customer complaints, product listings and marketing campaigns, plus a separate Engineering area for the dev team. It is the company's own simpler tool, similar in spirit to ClickUp, Asana or Trello. It runs in a web browser; people sign in with their company email and password.

## The core structure (very important)
Everything is organised in this hierarchy, from biggest to smallest:
- **Workspace** — the whole company. There is one workspace (BeautyBooth); everyone belongs to it.
- **Space** — a team or department inside the workspace (for example: Marketing, Customer Service, Orders, Engineering). Each Space can have a **Head** who reviews the team's work (see "Department review and weekly reports" below).
- **List** — a board of work inside a Space (for example a "June Campaign" list, or a "Complaints" list). A List holds tasks.
- **Task** — a single piece of work (an order to process, a bug to fix, a campaign to run). This is the main unit everyone works with.

There are NO "folders" — a Space directly contains Lists. The order is simply Workspace → Space → List → Task. Every task has a **type** (Task, Bug, Feature, Campaign, Order or Complaint) and a **status** that shows its progress.

## Navigation — where things are

### The left Sidebar (always visible after sign-in)
From top to bottom:
- **Workspace menu** (top — click the workspace name/logo): Settings, Members, New Space, Copy Workspace Link, Sign Out.
- **Favorites** — Lists you have starred, for quick access.
- **Home** — your dashboard: cards showing how many tasks are assigned to you, how many are due today, how many are overdue, and how many are awaiting your review, plus today's agenda.
- **Inbox** — your notifications.
- **Search** — search everything.
- **Department** — for Space **Heads** and Admins: review your team's tasks (approve or flag them). Shown only to Owners, Admins, or a Space's Head.
- **Reports** — weekly department reports for HR/management. Shown only to Owners, Admins, or Heads.
- **Engineering** — the dev-team area (expands to: Engineering home, Sprint, On-Call).
- **Settings** — workspace and personal settings.
- **Space tree** — your Spaces and the Lists inside them. Use the "+" here to create a new Space; click a Space or List to open it.
- **Report a Bug** (near the bottom) — report a problem to the engineering team.
- A button to collapse or expand the sidebar.

### The top Topbar
- **Breadcrumb** (left) — shows where you are, e.g. Home, then Space, then List.
- **Search box** (centre) — click it to open the Search page and find anything quickly.
- **On-Call badge** — shows which engineer is on call this week.
- **Quick Create (+)** — quickly create a new task from anywhere.
- **Notification bell** — your unread notifications; click to open the Inbox.
- **User menu** (your avatar, far right) — Profile, Settings, Sign Out.

## Where things live (page addresses)
Most pages have a fixed web address, so you can link straight to them. When you guide someone, point them to the page by name using its address — these are the real ones:
- **Home** — /
- **Inbox** (your notifications) — /inbox
- **Search** — /search
- **Department** (review team work — Owners/Admins/Heads) — /dept
- **Reports** (weekly reports — Owners/Admins/Heads) — /reports
- **Forms** (build intake forms) — /forms
- **Engineering** — /eng · **Sprint board** — /eng/sprint · **On-call rotation** — /eng/on-call
- **Settings**: Profile — /settings/profile · Workspace — /settings/workspace · Members — /settings/members · Task types — /settings/task-types · Tags — /settings/tags · Statuses — /settings/statuses · Custom fields — /settings/custom-fields · Templates — /settings/templates · Import/Export — /settings/import-export
- Your **Spaces, Lists and individual tasks do NOT have fixed addresses** — open them from the **Sidebar** Space tree (a task opens in a drawer on the right). Never guess a Space, List or task address.

## Getting started (a brand-new workspace is empty)
A new workspace has no Spaces, Lists or Tasks yet. Set it up in this order:
1. **Create a Space:** in the left Sidebar click the "+" (or Workspace menu, then New Space). Give it a name (e.g. Marketing), pick a colour/icon, and create it.
2. **Create a List inside the Space:** open the Space and add a List (e.g. "June Campaign"). When a List is created it automatically gets 5 default statuses: **To Do, In Progress, In Review, Done, Closed**.
3. **Add Tasks to the List:** open the List and start adding tasks.

## Working with tasks — the 4 views
Open any List and use the tabs at the top to switch how you see its tasks:
- **List view** (default) — tasks as rows. Group by status, assignee or priority; sort, filter and edit fields inline. You can multi-select tasks with the checkboxes and change many at once using the bulk toolbar.
- **Board view** — a Kanban board with one column per status. Drag a task card from one column to another to change its status. You can set WIP limits and use swimlanes (by assignee or priority).
- **Calendar view** — a month/week calendar by due date. Drag a task to a different date to change its due date. Tasks with no due date appear in an "Unscheduled" panel you can drag from.
- **Form view** — the intake form(s) attached to this List (see Forms below).

### How to create a task
- In **List view**: use the quick-add input — type a name and press **Enter**; or
- Use the **Quick Create (+)** button in the **Topbar** from anywhere; or
- In Board or Calendar view, use the add button on a column or a date.

## Task details (open any task)
Click a task to open its detail panel (a drawer on the right). Inside you can edit:
- **Properties:** Status, Priority, Assignee(s), Due date, Start date, Tags, Story points, Sprint, SLA, Recurrence, Reviewer.
- **Description:** a rich-text editor (bold, lists, links, and more).
- **Comments:** discuss the task. Type "@" then a name to mention a teammate (they get notified), and "#" then a task ID to link another task.
- **Checklists:** one or more checklists of items you can tick off; shows progress.
- **Subtasks:** smaller child tasks under this task; shows completion progress.
- **Dependencies:** mark that this task "blocks" or is "blocked by" another task.
- **Attachments:** upload files to the task.
- **Custom fields:** extra fields defined by an admin (text, phone, money, date, dropdown, files).
- **Activity:** a history log of everything done on the task (status changes, assignments, comments, and so on).
- **Archive / Delete:** archive a task to hide it without deleting, or delete it.

## Assigning and following work
- To assign a task, open it and set the **Assignee** in Properties (or edit inline in List view). The assigned person gets a notification.
- To follow a task without being assigned, become a **watcher** of it.

## Inbox and notifications
- The **Notification bell** in the Topbar shows your unread count. Click it, or open **Inbox** in the Sidebar.
- Notifications are grouped by date (Today, Yesterday, This week, Earlier).
- Filter by All, Unread, @Mentions, or Assigned to me.
- For each one you can mark read/unread, snooze it (1 hour, 4 hours or 1 day), or archive it. Click a notification to jump to the task.
- You are notified when you are assigned a task, mentioned in a comment, when a task you watch changes, when something is due or overdue, when a form is submitted, for engineering events, when your **Head reviews one of your tasks** (approves or flags it), and when a **weekly department report is ready** (for Owners/Admins and the Head).

## Search
- Open **Search** from the left Sidebar, or click the **Search box** in the Topbar.
- It searches across Tasks, Lists, Spaces, People and Comments at once.
- Click a result to jump straight to it.

## Forms (collect work from outside the app)
Forms let people submit information that automatically becomes a task (for example a complaint intake form).
- Open the **Forms** area to see your forms.
- Open a form to edit it: tabs for **Builder** (drag fields onto the form), **Settings**, **Branding** and **Preview**.
- Each form has a **public link** (use Copy Link or Preview). Anyone with the link can fill and submit it WITHOUT signing in, and their submission creates a task in the linked List.

## Engineering area (for the dev team)
Open **Engineering** in the Sidebar:
- **Engineering home** — a dashboard of open bugs, your sprint tasks, PRs awaiting your review, open incidents and stale tickets.
- **Sprint** — the sprint board with story points; pick a sprint to see its tasks across lists.
- **On-Call** — the weekly on-call rotation; assign which engineer is on call each week.
- **Report a Bug** — a button in the Sidebar footer, available to everyone. File a bug with a severity (S0 to S3) and the reporting team; it creates a Bug task routed to the on-call engineer.
Engineering tasks can carry extra fields: bug severity, story points, a sprint, a Git branch / PR link with PR status, and incident postmortems.

## Department review and weekly reports (for team leads and HR)
Each **Space** can act as a **department** led by one **Head**. The Head keeps an eye on their team's completed work, and every week the system sends a summary to HR/management automatically — so a manager can see across the whole company whether work is being delivered, without chasing each person.

### The Head of a department
- A **Head** is not a separate account type — it is a **Member or Admin** chosen to lead a Space.
- **Who sets it:** an **Owner or Admin**. Open the Space from the Sidebar Space tree, then use the **Department head** card on the Space page to pick a person (or clear it to remove the Head).
- Team membership is automatic: whoever is **assigned** tasks in that Space's Lists counts as a team member — nothing extra to set up.

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
Open **Settings** in the Sidebar. The sections are:
- **Profile** — your name, timezone, and **Change password**.
- **Workspace** — workspace name, locale, timezone, business hours, week start day. (Admin/Owner)
- **Members** — see all members; **Invite** new people (enter email and role); change roles; deactivate or reactivate users. (Admin/Owner)
- **Task Types** — manage the task types (Task, Bug, Feature, Campaign, Order, Complaint) with icons and colours. (Admin/Owner)
- **Tags** — manage workspace-wide labels for tasks. (Admin/Owner)
- **Statuses** — manage the workflow statuses of a List and reorder them. (Admin/Owner)
- **Custom Fields** — create extra fields (text, phone, money, date, dropdown, files) to capture more data on tasks. (Admin/Owner)
- **Templates** — save reusable task structures and apply them to a List to create tasks quickly. (Admin/Owner)
- **Import / Export** — bring data in, or take it out.

## Roles and permissions
- **Owner** — full control; there is one owner; can do everything, including deleting the workspace.
- **Admin** — manage members, spaces, lists, task types, tags, statuses, custom fields, forms and templates.
- **Member** — create and work on tasks, comment, and use all the core features.
- **Guest** — limited, mostly read-only access.
- **Department Head** — not a separate account role: any Member or Admin can be set as the **Head** of a Space by an Owner or Admin. A Head reviews their team's completed tasks (approves or flags them) from the **Department** area, and their department gets an automatic weekly report.
Most setup and management actions (creating spaces, inviting members, editing workspace settings, managing task types/tags/custom fields) need Admin or Owner. Everyday task work is open to all members.

## Account and sign-in
- **Sign in** with your company email and password on the login page.
- **Forgot password?** — use the link on the login page to request a reset.
- **Change password** — Settings, then Profile, then Change password.
- **Sign out** — User menu (top-right avatar), then Sign Out; or the Workspace menu, then Sign Out.
- New members are added by an Admin or Owner via Settings, then Members, then Invite.

## Quick answers (with the page to go to)
- **How do I create a task?** Open a List from the Sidebar, type a name in the quick-add box and press **Enter** — or use **Quick Create (+)** in the Topbar from anywhere.
- **Where do I create a Space or List?** In the left **Sidebar**: click **+** by Spaces to add a Space; open a Space and click **+** to add a List inside it.
- **How do I assign a task?** Open the task, then set the **Assignee** in Properties (they get a notification).
- **How do I change a task's status?** Open the task and change **Status** — or in **Board view** drag the card to another column.
- **Where are my notifications?** [Inbox](/inbox), or the bell in the Topbar.
- **How do I change my password?** [Settings → Profile](/settings/profile), then **Change password**.
- **How do I invite a teammate?** [Settings → Members](/settings/members), then **Invite** (Owner/Admin only).
- **Who is on call, and how do I set it?** [On-call rotation](/eng/on-call), or the on-call badge in the Topbar.
- **How do I search?** Open [Search](/search), or click the Search box in the Topbar.
- **How do I attach a file?** Open the task, go to **Attachments**, and click **Upload** (or drag files in).
- **Who reviews my completed tasks?** Your Space's **Head** — they use [Department](/dept) to approve or flag them (Owners/Admins/Heads only).
- **Where are the weekly department reports?** [Reports](/reports) — for Owners, Admins and Heads.
- **How do I report a bug?** Click **Report a Bug** in the Sidebar footer, fill the form (severity + your team), and Submit.

## Good to know (current limitations — be honest about these)
- A brand-new workspace starts empty; you create the Spaces, Lists and Tasks yourself.
- Notifications refresh about once a minute, not instantly.
- On the PUBLIC (no-login) form pages, special fields such as dropdown, date, money and files appear as simple text boxes; inside the app all field types work fully.
- Inviting members: an Admin or Owner sends an invite from Settings, then Members, then Invite. The person receives an email with an invitation link; they open it, set a password, and are signed in automatically. If the invite email does not arrive, ask an Admin to re-send it.
- File attachments need the file storage to be configured; if an upload fails it is a storage/setup issue to raise with an admin.
`;
