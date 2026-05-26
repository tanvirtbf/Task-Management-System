# ClickUp Software er Main Requirements — Short List (Bangla)

> Amader ClickUp-like task management system banate ja ja core requirements lagbe — concise list.

## ১. Hierarchy & Structure
- Workspace → Space → Folder → List → Task → Subtask (up to 7 levels nested)
- Tasks in Multiple Lists (ek task ekadik list e thakte parbe)

## ২. Task Management
- Task properties: name, description, assignee, due/start date, priority, status, tags, watchers
- Subtasks (full task er moto property, independent)
- Checklists (light to-do, 5 levels nested, 1 assignee per item)
- Custom Statuses (per Space/Folder/List — Not Started/Active/Done/Closed groups)
- Priorities: Urgent / High / Normal / Low / None (5 ta hardcoded)
- Dependencies: Blocking / Waiting On / Linked
- Recurring tasks (daily/weekly/monthly/yearly/custom + status-based)
- Task Types & Milestones (custom types, milestone = diamond marker)
- Multiple Assignees, Tags (Space-level)
- Comments (threaded, @mentions, reactions, assigned comments, resolve)
- Attachments (1GB per file, 1000 per task)
- Activity Log per task (who/what/when, before→after)

## ৩. Views (Multiple Display Modes)
- List, Board (Kanban + WIP limits), Calendar (Google/Outlook 2-way sync)
- Gantt (dependencies + baselines), Timeline, Table (Excel-style)
- Workload (capacity), Box/Team (assignee distribution), Activity (feed)
- Mind Map, Map (location pin), Whiteboard, Doc, Form, Chat, Embed

## ৪. Custom Fields (20+ types)
- Text, Long Text, Number, Currency, Date, Email, Phone, URL
- Dropdown, Labels (multi-select), Checkbox, Rating, Progress
- Files, Location, People, Relationships, Rollup, Lookup
- Formula (70+ functions), AI Fields (Summary/Sentiment/Custom)

## ৫. Forms
- Public/private forms, auto-create task on submit
- Conditional Logic (up to 25 rules per field)
- Custom branding, reCAPTCHA, hidden/pre-populated fields

## ৬. Automation Engine
- Triggers: status change, date arrived, field change, comment, form submit, webhook, schedule
- Conditions: AND/OR groups, regex, role-based
- Actions: assign, notify, move/copy, comment, email, Slack, webhook, AI generate

## ৭. Collaboration
- Docs (Notion-style blocks, real-time edit, version history, Doc Hub)
- Whiteboards (shapes, sticky, connectors, convert to task)
- Chat + SyncUps (channels, DM, threads, voice/video, transcription)
- Goals & Targets (Number/Currency/True-False/Task — auto-progress)
- Time Tracking (timer, manual, billable, estimates, timesheet)

## ৮. Dashboards & Reporting
- 60+ widgets: Task / Time / Sprint / Portfolio / Custom Field / AI cards
- Sprint Burndown / Burnup / Velocity (Cumulative Flow, Lead/Cycle Time)
- Filters, date ranges, sharing via public link

## ৯. Notifications & Inbox
- 6 channels: in-app, email, mobile push, desktop, browser, Slack
- Smart notifications, snooze, digest, DND
- Unified Inbox, Notepad (personal notes), Reminders (delegate-able), Pulse (online status)

## ১০. Permissions & Security
- Roles: Owner / Admin / Member / Limited Member / Guest (view-only + permission-controlled)
- Custom Roles, per-item granularity
- 2FA (TOTP, SMS), SSO (Google, Microsoft, Okta, SAML), SCIM auto-provisioning
- Audit Log (30-day retention), SOC 2 / ISO 27001 / GDPR / HIPAA / PCI compliant

## ১১. AI Features (Brain)
- AI Writer (generate/summarize/translate), AI Task Summary, Action Item extraction
- AI Knowledge Manager / Deep Search / Connected Search
- AI Notetaker (Zoom/Meet/Teams, ~100 languages, auto-tasks)
- AI Custom Fields, Super Agents (autonomous AI teammates)

## ১২. Integrations & API
- 1000+ integrations (Slack, Teams, GitHub, Figma, Zoom, HubSpot, etc.)
- Email integration (Gmail/Outlook OAuth + IMAP), Calendar 2-way sync
- Public REST API + Webhooks (28 event types, HMAC signing)
- Import (Trello/Asana/Jira/Monday/CSV), Export (CSV/Excel/PDF)

## ১৩. Platform Support
- Web app, Desktop (Windows/macOS/Linux — offline mode), Mobile (iOS/Android)
- Multi-language UI (English, French, Spanish, Portuguese, German, Italian)
- Keyboard shortcuts, accessibility (WCAG 2.2 AA target)

## ১৪. Templates & Modularity
- Space/Folder/List/Task/Doc/View/Checklist/Whiteboard/Form templates
- Template Center (official + community + custom)
- ClickApps — 30+ togglable features per Workspace/Space

## ১৫. Plan / Tier Logic
- Free / Unlimited / Business / Business Plus / Enterprise
- Limit enforcement: automation runs/month, storage, guests, custom field uses, API rate
