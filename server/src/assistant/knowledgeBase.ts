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
- **Space** — a team or department inside the workspace (for example: Marketing, Customer Service, Orders, Engineering).
- **List** — a board of work inside a Space (for example a "June Campaign" list, or a "Complaints" list). A List holds tasks.
- **Task** — a single piece of work (an order to process, a bug to fix, a campaign to run). This is the main unit everyone works with.

There are NO "folders" — a Space directly contains Lists. The order is simply Workspace → Space → List → Task. Every task has a **type** (Task, Bug, Feature, Campaign, Order or Complaint) and a **status** that shows its progress.

## Navigation — where things are

### The left Sidebar (always visible after sign-in)
From top to bottom:
- **Workspace menu** (top — click the workspace name/logo): Settings, Members, New Space, Copy Workspace Link, Sign Out.
- **Favorites** — Lists you have starred, for quick access.
- **Home** — your dashboard.
- **Inbox** — your notifications.
- **Search** — search everything.
- **Engineering** — the dev-team area (expands to: Engineering home, Sprint, On-Call).
- **Settings** — workspace and personal settings.
- **Space tree** — your Spaces and the Lists inside them. Use the "+" here to create a new Space; click a Space or List to open it.
- **Report a Bug** (near the bottom) — report a problem to the engineering team.
- A button to collapse or expand the sidebar.

### The top Topbar
- **Breadcrumb** (left) — shows where you are, e.g. Home, then Space, then List.
- **Command Palette** (centre) — press **Ctrl+K** (or Cmd+K on Mac) to search and jump anywhere quickly.
- **On-Call badge** — shows which engineer is on call this week.
- **Quick Create (+)** — quickly create a new task from anywhere.
- **Notification bell** — your unread notifications; click to open the Inbox.
- **User menu** (your avatar, far right) — Profile, Settings, Sign Out.

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
- You are notified when you are assigned a task, mentioned in a comment, when a task you watch changes, when something is due or overdue, when a form is submitted, and for engineering events.

## Search
- Open **Search** in the Sidebar, or press **Ctrl+K** (Cmd+K) anywhere.
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
Most setup and management actions (creating spaces, inviting members, editing workspace settings, managing task types/tags/custom fields) need Admin or Owner. Everyday task work is open to all members.

## Account and sign-in
- **Sign in** with your company email and password on the login page.
- **Forgot password?** — use the link on the login page to request a reset.
- **Change password** — Settings, then Profile, then Change password.
- **Sign out** — User menu (top-right avatar), then Sign Out; or the Workspace menu, then Sign Out.
- New members are added by an Admin or Owner via Settings, then Members, then Invite.

## Quick answers to common questions
- How do I create a task? Open a List, then type a name in the quick-add input and press Enter — or use the Quick Create (+) button in the Topbar.
- Where do I create a Space or List? Left Sidebar: "+" to add a Space; open a Space to add a List inside it.
- How do I assign a task to someone? Open the task, then set the Assignee in Properties.
- How do I change a task's status? Open the task and change Status — or in Board view drag the card to another column.
- Where are my notifications? The bell in the Topbar, or Inbox in the Sidebar.
- How do I change my password? Settings, then Profile, then Change password.
- How do I invite a teammate? Settings, then Members, then Invite (Admin or Owner only).
- Where do I see who is on call? The on-call badge in the Topbar, or Engineering, then On-Call.
- How do I search? Press Ctrl+K (Cmd+K), or open Search in the Sidebar.
- How do I attach a file to a task? Open the task, go to Attachments, and upload.

## Good to know (current limitations — be honest about these)
- A brand-new workspace starts empty; you create the Spaces, Lists and Tasks yourself.
- Notifications refresh about once a minute, not instantly.
- On the PUBLIC (no-login) form pages, special fields such as dropdown, date, money and files appear as simple text boxes; inside the app all field types work fully.
- Inviting members: an admin can send an invite, but completing sign-up through the invite link is not finished yet. For now an admin sets people up. If someone is stuck on an invitation link, ask them to contact their workspace Admin or Owner.
- File attachments need the file storage to be configured; if an upload fails it is a storage/setup issue to raise with an admin.
`;
