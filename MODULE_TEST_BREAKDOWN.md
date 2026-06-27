# 🧪 Module-Wise Test Breakdown — Task Management System (BeautyBooth)

> **উদ্দেশ্য:** পুরো সিস্টেমকে স্বাধীনভাবে-টেস্টযোগ্য কয়েকটা module-এ ভাগ করা, যাতে আপনি একটা একটা module ধরে **deeply** test করতে পারেন। প্রতিটা module নিজে নিজে একটা coherent feature — তাই একটা ধরলে সেটার backend + frontend + DB একসাথে শেষ করতে পারবেন।
>
> Generated: 2026-06-27 · ভিত্তি: full 6-agent codebase scan · Backend ~155 endpoints / 35 tables · Frontend React 19।

---

## 📖 কীভাবে ব্যবহার করবেন

1. **নিচের "Module Map" থেকে একটা module বেছে নিন** (উপর থেকে নিচে — foundation আগে টেস্ট করলে পরের module-গুলো সহজ হয়)।
2. সেই module-এর section-এ যান → **Key flows** (happy path) আগে চালান → তারপর **Edge cases** (negative test) → শেষে **Permissions** চেক করুন।
3. **⚠️ Known issues** আগে পড়ে নিন — কিছু জিনিস ইচ্ছাকৃতভাবে অসম্পূর্ণ বা পরিচিত bug, যাতে আপনি সেগুলোকে "নতুন bug" ভেবে সময় নষ্ট না করেন।
4. প্রতিটা item-এ ✅ checklist আছে — টেস্ট করে টিক দিন।
5. কোনো bug পেলে নিচের **Bug Report Template** ব্যবহার করে নোট করুন।

### টেস্ট এনভায়রনমেন্ট সেটআপ
- **Run guide:** `LOCAL_RUN_GUIDE.md` (server + client কীভাবে চালু করবেন)
- **Login:** `owner@company.local` / `Owner@12345` (Owner role)
- দুই/তিন role-এর জন্য আলাদা account লাগবে (Owner / Admin / Member / Guest) — Members module থেকে invite/create করে নিন। **Permission testing-এর জন্য এটা জরুরি।**
- Backend dev: `cd server && npm run dev` · Frontend dev: `cd client && npm run dev`
- ⚠️ Dev backend-এ কোড change করলে `tsx watch` লাগে (nodemon `.ts` ignore করে → stale code)।
- Browser dev-tools **Network** + **Console** ট্যাব খোলা রাখুন — প্রতিটা action-এ request/response আর error দেখুন।

### Legend (চিহ্ন)
| চিহ্ন | মানে |
|---|---|
| 🔐 | যেকোনো logged-in member করতে পারে |
| 👑 | Admin **বা** Owner |
| 🛡️ | শুধু Owner |
| 🔓 | Public (login ছাড়াই) |
| ✅ auto-tested | backend-এ automated test আছে |
| ❌ no auto-test | backend test নেই — **manual টেস্টে বেশি মনোযোগ দিন** |
| 🟡 partial/stub | feature পুরো নয় (ইচ্ছাকৃত) |

---

## 🗺️ Module Map (এবং টেস্ট করার সাজেস্টেড অর্ডার)

| # | Module | পরীক্ষার আগে যা থাকা দরকার | Auto-test |
|---|---|---|---|
| **Layer A — Foundation** | | | |
| M1 | Authentication & Account Security | — | ✅ |
| M2 | Members, Roles & Invitations | M1 | ✅ (invite-accept 🟡) |
| M3 | Workspace & Settings | M1 | ✅ |
| **Layer B — Structure & Catalog** | | | |
| M4 | Spaces & Lists (Hierarchy + Sidebar) | M1, M2 | ✅ |
| M5 | Statuses, Task Types & Tags (Catalog) | M4 | ✅ |
| M6 | Custom Fields | M4, M5 | ✅ |
| **Layer C — Tasks (core)** | | | |
| M7 | Tasks — Core CRUD & Lifecycle | M4, M5 | ✅ |
| M8 | Task Views — List / Board / Calendar | M7 | (FE only) |
| M9 | Task Relations — Subtasks, Dependencies, Membership | M7 | ✅ |
| M10 | Task Collaboration — Comments, Checklists, Attachments, Activity | M7 | ⚠️ Comments/Checklists ❌ |
| **Layer D — Productivity & Intake** | | | |
| M11 | Forms — Builder & Public Intake | M5, M6 | ✅ |
| M12 | Notifications, Inbox & Real-time (SSE) | M7, M9 | ✅ |
| M13 | Search | M4, M7 | ✅ |
| M14 | Home Dashboard | M7 | ✅ |
| M15 | Templates | M5, M7 | ✅ |
| **Layer E — Engineering · AI · Ops** | | | |
| M16 | Engineering Suite (Sprints · On-Call · Bug/Incident · SLA) | M7 | ✅ |
| M17 | AI Help Assistant | M1 | ⚠️ 🔴 known bug |
| M18 | Admin & Ops (Jobs · Health · Metrics · Audit · Import/Export) | M1 | ✅ (Import/Export 🟡) |

> **সাজেশন:** M1 → M2 → M3 → M4 → M5 → M6 → M7 ক্রমে আগান (এগুলো ভিত্তি)। এরপর M8–M18 যেকোনো অর্ডারে।

---

# Layer A — Foundation

## M1. Authentication & Account Security 🔐
**এক কথায়:** Login, logout, token refresh, password reset, password change — পুরো auth lifecycle।

**Backend (8 ep) · `routes/auth.ts` · ✅ auto-tested:**
- `POST /auth/login` 🔓 (rate-limit 5/min/IP)
- `POST /auth/forgot-password` 🔓 (সবসময় 202, email enumeration আটকায়)
- `POST /auth/reset-password` 🔓
- `POST /auth/refresh` 🔓 (`bb_refresh` cookie দিয়ে নতুন access token)
- `POST /auth/logout` 🔐 · `POST /auth/logout-all` 🔐
- `GET /auth/me` 🔐
- `POST /auth/change-password` 🔐

**Frontend:** `pages/auth/Login`, `ForgotPassword`, `ResetPassword` · `stores/auth.ts` · `http/client.ts` (401→refresh interceptor) · `Root.tsx` bootstrap।
**DB:** `users`, `sessions` (sha256 token jar), `password_reset_tokens`।

**🎯 Key flows:**
1. ভুল password → error; সঠিক password → dashboard-এ ঢোকে, refresh করলেও logged-in থাকে।
2. "Forgot password" → email আসে (Mailtrap-এ চেক) → reset link → নতুন password → নতুন password দিয়ে login।
3. Access token expire হলে (১৫ মিনিট) পরের API call-এ auto-refresh হয় (Network tab-এ `/auth/refresh` দেখা যাবে, user টের পায় না)।
4. `change-password` → পুরোনো password ভুল দিলে fail; সঠিক দিলে success।
5. `logout` → session শেষ; `logout-all` → সব device-এ logout।

**🧪 Edge cases:**
- একই IP থেকে দ্রুত ৬ বার ভুল login → 429 (rate-limit)।
- Reset token একবার ব্যবহারের পর আবার ব্যবহার → fail (single-use)।
- Reset token পুরোনো/expired (>30 min) → fail।
- Logout-এর পর পুরোনো access token দিয়ে call → 401।
- `/auth/me` token ছাড়া → 401।

**✅ Checklist:**
- [ ] Valid/invalid login · [ ] Auto-refresh কাজ করে · [ ] Forgot→reset পুরো flow · [ ] Change-password · [ ] Logout / logout-all · [ ] Rate-limit (429) · [ ] Reset token single-use

---

## M2. Members, Roles & Invitations 👑
**এক কথায়:** Team member দেখা, invite করা, role বদলানো, deactivate/reactivate, admin-reset password।

**Backend (8 ep) · `routes/users.ts` · ✅ auto-tested:**
- `GET /users` 🔐 · `GET /users/:id` 🔐
- `POST /users/invite` 👑
- `PATCH /users/:id` 🔐 (self **বা** 👑 — অন্যেরটা শুধু admin/owner)
- `PATCH /users/:id/role` 👑
- `POST /users/:id/deactivate` 👑 · `POST /users/:id/reactivate` 👑
- `POST /users/:id/reset-password` 👑 (202)

**Frontend:** `pages/settings/MembersSettings` · `ProfileSettings` (নিজের profile) · `pages/auth/AcceptInvitation` 🟡।
**DB:** `users`, `invitations`, `password_reset_tokens`, `workspace_activity`।

**🎯 Key flows:**
1. Owner হিসেবে member list দেখুন → একজনকে invite করুন → invitation email আসে।
2. একজন member-কে Admin বানান → সেই account দিয়ে login করে দেখুন নতুন permission পেল কিনা।
3. একজনকে deactivate করুন → সেই account দিয়ে login fail করবে → reactivate → আবার কাজ করে।
4. Member হিসেবে নিজের profile edit করুন (name/timezone/avatar)।

**🧪 Edge cases / permission tests:**
- **Member** হিসেবে অন্যের role বদলানোর চেষ্টা → 403।
- Owner-এর role বদলানোর চেষ্টা → block।
- নিজের role নিজে বদলানো / নিজেকে deactivate → block।
- Member অন্যের profile edit করতে চায় → 403; নিজেরটা পারে।
- একই email-এ আবার invite।

**⚠️ Known issues:**
- 🟡 **Invite-accept flow অসম্পূর্ণ** — Admin invite পাঠাতে পারে, কিন্তু invitee-র signup complete করার page (`AcceptInvitation`) একটা **stub** ("coming soon")। তাই নতুন user আসলে join করতে পারবে না — এটা পরিচিত gap, bug নয়।

**✅ Checklist:**
- [ ] Member list/detail · [ ] Invite + email · [ ] Role change (+ effect) · [ ] Deactivate/reactivate · [ ] Self vs other profile edit (permission) · [ ] Admin reset-password · [ ] 🟡 invite-accept stub নিশ্চিত করুন

---

## M3. Workspace & Settings 👑
**এক কথায়:** Workspace-এর নাম/logo আর global settings (timezone, locale, week-start, working days, business hours, fiscal year)।

**Backend (2 ep) · `routes/workspace.ts` · ✅ auto-tested:**
- `GET /workspace` 🔐
- `PATCH /workspace` 👑

**Frontend:** `pages/settings/WorkspaceSettings` · settings `useWorkspace()` hook-এ পুরো app জুড়ে ব্যবহৃত।
**DB:** `workspaces`।

**🎯 Key flows:**
1. Workspace নাম বদলান → topbar/sidebar-এ update হয়।
2. `weekStartsOn` বদলান (Bangladesh = Saturday) → **Calendar view-এর week-grid** সেই অনুযায়ী সাজে কিনা দেখুন।
3. Business hours / timezone বদলান।

**🧪 Edge cases:**
- Member হিসেবে settings save → 403।
- Wire-এ flat → nested `settings` object mapping (Network tab-এ দেখুন)।

**✅ Checklist:**
- [ ] Workspace edit (👑) · [ ] Member-blocked (403) · [ ] week-start → Calendar-এ effect · [ ] Settings persist (refresh-এর পরও থাকে)

---

# Layer B — Structure & Catalog

## M4. Spaces & Lists (Hierarchy + Sidebar) 👑/🛡️
**এক কথায়:** Space ও List তৈরি/edit/archive/delete এবং বাঁদিকের sidebar tree।

**Backend · ✅ auto-tested:**
- **Spaces (7 ep) `routes/spaces.ts`:** `GET /spaces` 🔐 · `GET /spaces/:id` 🔐 · `POST /spaces` 👑 · `PATCH /spaces/:id` 👑 · `POST /spaces/:id/archive`·`/unarchive` 👑 · `DELETE /spaces/:id` 🛡️ (archived + খালি হতে হবে)
- **Lists (9 ep) `routes/lists.ts`:** `GET /spaces/:spaceId/lists` · `GET /lists` · `POST /lists` 👑 (৫টা default status auto-seed) · `GET /lists/:id` · `PATCH /lists/:id` 👑 · archive/unarchive 👑 · `DELETE /lists/:id` 🛡️ · `GET /lists/:listId/tasks`

**Frontend:** `pages/space/SpacePage` · `pages/list/ListPage` · `shared/Sidebar`, `SidebarSpaceTree`, `SidebarFavorites` · `CreateSpaceModal`, `CreateListModal` · `stores/ui.ts` (expand/collapse/favorite)।
**DB:** `spaces`, `lists` (folders DB-তে নেই — flat)।

**🎯 Key flows:**
1. নতুন Space বানান (নাম/icon/color) → sidebar-এ আসে → ভেতরে List বানান → List-এ গেলে ৫টা default status আছে।
2. Space/List archive করুন → list থেকে হারায়; unarchive → ফিরে আসে।
3. Sidebar-এ space expand/collapse, favorite (star) করুন → refresh-এর পরও persist করে।
4. Space archive করলে তার ভেতরের list-গুলোও cascade-archive হয়।

**🧪 Edge cases:**
- নন-খালি বা নন-archived Space **delete** → 409 (block)।
- Member হিসেবে create/edit → 403।
- Admin (owner নয়) delete করতে চায় → 403 (delete শুধু 🛡️ owner)।
- Archived list-এ task add করার চেষ্টা।

**✅ Checklist:**
- [ ] Space CRUD + archive/unarchive · [ ] List CRUD + default-status seed · [ ] Delete preconditions (409) · [ ] Owner-only delete (🛡️) · [ ] Sidebar tree expand/favorite persist · [ ] Cascade archive

---

## M5. Statuses, Task Types & Tags (Catalog) 👑
**এক কথায়:** Workflow-এর building block — status column, task type (Task/Bug/Feature ইত্যাদি), আর tag।

**Backend · ✅ auto-tested:**
- **Statuses (5 ep) `routes/statuses.ts`:** list-by-list · `POST` create (duplicate→409) · `PATCH /lists/:listId/statuses/reorder` · `PATCH /statuses/:id` · `DELETE` (in-use বা last-in-group হলে 409)
- **Task Types (4 ep) `routes/taskTypes.ts`:** list · create · update · delete (system type protected, in-use→409)
- **Tags (4 ep) `routes/tags.ts`:** list · create · update · delete (cascade)

**Frontend:** `pages/settings/StatusesSettings`, `TaskTypesSettings`, `TagsSettings`।
**DB:** `statuses`, `task_types`, `tags`, `task_tags`।

**🎯 Key flows:**
1. একটা list-এ নতুন status যোগ করুন → drag করে reorder করুন → Board view-তে column order বদলায়।
2. Task type-এ `isDevType` flag (Bug/Feature) — এই type-এর task-এ engineering field (story points/git) দেখা যায় কিনা (M16-এ link)।
3. Tag বানান/edit/delete → task-এ লাগানো tag delete করলে task থেকে খুলে যায় (cascade)।

**🧪 Edge cases:**
- একই নামে status/tag → 409 duplicate।
- যে status-এ task আছে সেটা delete → 409 `status.in_use`।
- group-এর শেষ status delete → 422 `status.last_in_group`।
- System task type delete/edit → block।

**✅ Checklist:**
- [ ] Status CRUD + reorder · [ ] Status in-use/last-in-group guard · [ ] Task type CRUD + system protection · [ ] Tag CRUD + cascade · [ ] Duplicate (409) · [ ] Member-blocked

---

## M6. Custom Fields 👑/🔐
**এক কথায়:** Workspace/space/list scope-এ custom field define করা (৬ type) আর task-এ value বসানো।

**Backend (7 ep) · `routes/customFields.ts` · ✅ auto-tested:**
- `GET /custom-fields` 🔐 · `GET /lists/:listId/custom-fields` 🔐
- `POST /custom-fields` 👑 · `PATCH /custom-fields/:id` 👑 (type+scope immutable) · `DELETE` 👑
- `PUT /tasks/:id/custom-fields/:fieldId` 🔐 (value set) · `DELETE` 🔐 (clear)

**Frontend:** `pages/settings/CustomFieldsSettings` · `components/custom-field/CustomFieldRenderer`, `CustomFieldsList` · `fields/` (TextFields, NumericFields=money, SelectionFields=dropdown, DateField, FilesField) · phone field = BD validation।
**DB:** `custom_fields`, `custom_field_options`, `task_custom_field_values`।

**🎯 Key flows:**
1. ৬ type-ই বানান: **text, phone, money(৳), date, dropdown, files** → task detail-এ render হয়।
2. একটা task-এ প্রতিটা field-এ value দিন → refresh-এর পরও থাকে।
3. **Phone field:** valid BD number (`01[3-9]xxxxxxxx`) accept, invalid → error।
4. **Money field:** ৳ symbol, taka↔paisa (১০০:১) conversion।
5. **Dropdown:** color-dot সহ option।

**🧪 Edge cases:**
- Field type/scope edit করতে চাওয়া → block (immutable)।
- Field delete → সব task-এর সেই value cascade-মুছে যায়।
- Invalid value envelope (যেমন dropdown-এ অস্তিত্বহীন option_id)।
- `hiddenFromGuests` field — guest role-এ দেখা যায় না।

**⚠️ Note:** শুধু ৬ type support করে। (পুরোনো mock-এ আরও type ছিল — সেগুলো dead code, ignore করুন।)

**✅ Checklist:**
- [ ] ৬ type-ই create + render · [ ] Value set/clear/persist · [ ] BD phone validation · [ ] Money paisa conversion · [ ] Type/scope immutable · [ ] Delete cascade · [ ] Guest redaction

---

# Layer C — Tasks (core)

## M7. Tasks — Core CRUD & Lifecycle 🔐
**এক কথায়:** Task-এর জন্ম থেকে মৃত্যু — create, edit, bulk, archive/unarchive, delete, "my work"।

**Backend (tasks.ts থেকে core অংশ) · ✅ auto-tested:**
- `POST /tasks` 🔐 (full hydrated Task + ETag) · `POST /tasks/bulk` 🔐 (≤200)
- `GET /tasks/:id` 🔐 (id বা custom_id দিয়ে) · `PATCH /tasks/:id` 🔐 (If-Match ETag optional)
- `POST /tasks/:id/archive`·`/unarchive` 🔐 (subtask সহ cascade)
- `DELETE /tasks/:id` 🔐 (soft; `?hard=true` → 👑 permanent)
- `GET /tasks/my-work` 🔐 (today/overdue/next/unscheduled/done bucket)

**Frontend:** `TaskDetailDrawer` (৭২০px drawer, ১৩+ section) · `TaskPropertiesPanel` · inline edits (`InlineNameEdit`, `InlineDateEdit`, status/priority/assignee) · `CreateTaskModal` · `QuickCreateTaskInput` · `pages/task/TaskRedirect` (`/t/:taskKey`)।
**DB:** `tasks` (denormalized counters trigger-maintained), `task_activity`।

**🎯 Key flows:**
1. নতুন task — নাম, status, priority, assignee, due date, description দিন → save।
2. Inline edit — drawer-এ প্রতিটা field সরাসরি edit।
3. Priority **0–4** (None/Urgent/High/Normal/Low) ঠিকভাবে দেখায়।
4. Archive → list থেকে হারায় (default filter); unarchive → ফেরে; soft-delete vs `?hard=true`।
5. "My Work" — আপনার assign-করা task ঠিক bucket-এ (overdue/today/next ৭দিন/unscheduled/done)।
6. **ETag concurrency:** দুই tab-এ একই task খুলে একটাতে edit করুন → অন্যটাতে edit করলে 409 conflict।

**🧪 Edge cases:**
- nesting depth > 2 → block।
- Bulk create-এ একটা fail করলে পুরোটা rollback (atomic)।
- Invalid status/type/assignee/tag → 422।
- Counter (subtasks/comments/attachments count) — subtask/comment যোগ করলে ঠিকভাবে বাড়ে/কমে কিনা।

**✅ Checklist:**
- [ ] Create (full + quick) · [ ] Inline edit সব field · [ ] Priority 0–4 · [ ] Archive/unarchive cascade · [ ] Soft vs hard delete (permission) · [ ] My-work bucket · [ ] ETag 409 conflict · [ ] Bulk atomic

---

## M8. Task Views — List / Board / Calendar (Frontend-heavy)
**এক কথায়:** একই task-গুলো ৩ ভাবে দেখা — তালিকা, kanban board, ক্যালেন্ডার — drag-drop সহ।

**Backend:** মূলত `GET /lists/:listId/tasks` (filter/sort/cursor) — M7-এর সাথে shared।
**Frontend:** `components/views/ListView`, `BoardView`, `CalendarView` (+ ListViewGroup, BoardColumn/Header/Toolbar/Swimlane, CalendarToolbar/EventCard/UnscheduledPanel) · `stores/board.ts` (WIP limit, density, swimlane, collapsed columns) · `hooks/useMultiSelect`।

**🎯 Key flows (প্রতিটা view-এ আলাদা করে):**
1. **List view:** status-এ group; filter (search, "me", show/hide closed, priority, assignee); sort (name/priority/due/created/updated, asc/desc); **drag** task → অন্য status group-এ ফেললে status বদলায়; **bulk select** (checkbox) → toolbar archive/delete।
2. **Board view:** status column; **swimlane** none/assignee/priority; card density compact/comfortable; column collapse; drag card → column বদলালে status update।
3. **Calendar view:** month grid; task-কে date cell-এ **drag** → due date বদলায়; date click → quick-create; unscheduled panel toggle।

**🧪 Edge cases:**
- ফাঁকা list / filter-এ কিছু না মিললে empty state।
- Drag করে আবার পুরোনো জায়গায় ফেললে (no-op)।
- board store settings refresh-এর পরও persist করে (localStorage `th-board`)।

**⚠️ Known issues (🟡 ইচ্ছাকৃত, bug নয়):**
- Calendar-এর **week/day view** নেই — "Phase 12 polish" placeholder দেখায়।
- **Gantt view** নেই।
- Lineup card-এর drag-to-reorder, inline list-rename — UI আছে, wiring deferred।

**✅ Checklist:**
- [ ] List: group/filter/sort/drag/bulk · [ ] Board: column/swimlane/density/collapse/drag · [ ] Calendar: month grid/drag-reschedule/quick-create/unscheduled · [ ] Settings persist · [ ] Empty states · [ ] 🟡 week/day placeholder নিশ্চিত

---

## M9. Task Relations — Subtasks, Dependencies, Membership 🔐
**এক কথায়:** Task-এর সাথে অন্য task ও মানুষের সম্পর্ক — subtask, blocks/blocked-by, assignee/watcher/tag।

**Backend · ✅ auto-tested:**
- **Membership (tasks.ts):** `POST/DELETE /tasks/:id/assignees[/:userId]` · `POST/DELETE /tasks/:id/watchers/self` · `POST/DELETE /tasks/:id/tags[/:tagId]` (সব idempotent)
- **Subtasks:** `GET /tasks/:id/subtasks`
- **Dependencies (3 ep) `routes/taskDependencies.ts`:** `GET /tasks/:id/dependencies` (দুই দিক) · `POST /task-dependencies` (self-loop/cycle/duplicate guard) · `DELETE /task-dependencies/:id`

**Frontend:** `SubtasksSection`, `DependenciesSection`, inline assignee/tag/watcher edit (TaskPropertiesPanel)।
**DB:** `task_assignees`, `task_watchers`, `task_tags`, `task_dependencies`।

**🎯 Key flows:**
1. Subtask যোগ করুন (multiline quick-add) → progress bar (done/total) বাড়ে।
2. Assignee যোগ/বাদ → assignee auto-watcher হয়।
3. Dependency: task A কে task B "blocks" করান → দুই task-এই reverse দিক দেখা যায়।
4. Watch/unwatch নিজেকে।

**🧪 Edge cases:**
- Dependency-তে **self-loop** (নিজেকে block) → 422।
- **Cycle** (A→B→A) → 422 `dep.cycle`।
- Duplicate dependency → 409।
- একই assignee আবার যোগ → idempotent (error নয়)।

**⚠️ Known issue:** 🟡 Subtask/dependency picker **same-list-only** — cross-list linking deferred (P6)।

**✅ Checklist:**
- [ ] Subtask add + progress · [ ] Assignee/watcher/tag add-remove (idempotent) · [ ] Auto-watch on assign · [ ] Dependency both directions · [ ] Self-loop/cycle/duplicate guards · [ ] 🟡 same-list-only নিশ্চিত

---

## M10. Task Collaboration — Comments, Checklists, Attachments, Activity 🔐
**এক কথায়:** Task-এর ভেতরের সহযোগিতা — মন্তব্য, checklist, file, activity log।

**Backend:**
- **Comments (4 ep) `routes/comments.ts` · ❌ NO auto-test:** `GET /tasks/:id/comments` · `POST` (mention `@handle` + `#TASK-ID` ref parse) · `PATCH /comments/:id` (author, 15-min window) · `DELETE` (author বা 👑)
- **Checklists (9 ep) `routes/checklists.ts` · ❌ NO auto-test:** checklist create/update/delete · item add/bulk-add/update/toggle/remove
- **Attachments (6 ep) `routes/attachments.ts` · ✅ auto-tested:** `POST /uploads/sign` · `finalize` · `download` (302) · `DELETE` · `GET /tasks/:id/attachments` · `POST /tasks/:id/attachments` (proxied)
- **Activity:** `GET /tasks/:id/activity` ✅

**Frontend:** `CommentsSection`, `ChecklistsSection`, `AttachmentsSection`, `TaskActivitySection` · `TiptapEditor` (rich text)।
**DB:** `comments`, `checklists`, `checklist_items`, `attachments`, `task_activity`।

**🎯 Key flows:**
1. **Comment:** লিখুন → `@mention` করুন (notification যায় কিনা — M12) → reply (threaded) → edit (15 min-এর মধ্যে) → delete।
2. **Checklist:** একাধিক checklist বানান → item add → toggle (done) → progress bar → bulk-add।
3. **Attachment:** drag-drop file upload → image-এ thumbnail → download → delete।
4. **Activity:** task-এ পরিবর্তন করলে activity feed-এ আসে।

**🧪 Edge cases:**
- ১৫ মিনিট পর comment edit → block।
- অন্যের comment delete (member হিসেবে) → block; admin পারে।
- বড় file (>25MB) বা অননুমোদিত type upload → reject।
- Pending (finalize হয়নি) attachment download → 404।

**⚠️ Known issues — এই module-এ বেশি সতর্ক থাকুন:**
- ❌ **Comments + Checklists এ কোনো backend automated test নেই** — তাই এই দুটো **manual-এ সবচেয়ে গভীরভাবে** টেস্ট করুন (এখানেই hidden bug থাকার সম্ভাবনা সবচেয়ে বেশি)।

**✅ Checklist:**
- [ ] Comment create/mention/reply/edit-window/delete-permission · [ ] Checklist + items + toggle + bulk · [ ] Attachment upload/thumbnail/download/delete · [ ] 25MB/MIME limit · [ ] Activity feed · [ ] **Comments/Checklists deep manual pass**

---

# Layer D — Productivity & Intake

## M11. Forms — Builder & Public Intake 👑/🔓
**এক কথায়:** Public intake form বানানো (drag-drop builder) আর login ছাড়াই সেই form-এ submit → auto task তৈরি।

**Backend (13 ep) · `routes/forms.ts` · ✅ auto-tested:**
- Admin: list, list-by-list, create, update, delete · field add/update/delete/reorder · `GET /forms/:id/submissions` (সব 👑/🔐)
- Public 🔓: `GET /public/forms/:slug` · `POST /public/forms/:slug/submit` (rate-limit 30/min/IP)

**Frontend:** `pages/forms/FormsListPage`, `FormBuilderPage` (Builder/Settings/Branding/Preview tab) · `pages/public-form/PublicFormPage`।
**DB:** `forms`, `form_fields`, `form_submissions`।

**🎯 Key flows:**
1. Form বানান → palette থেকে field (task attr + custom field) drag করুন → label/helptext/required সেট করুন → save।
2. Settings (require login, accepting toggle, success message, redirect) + Branding (color, layout)।
3. Public link copy করুন → **incognito-তে** খুলুন (login ছাড়া) → fill করে submit → success message → admin-এ গিয়ে দেখুন **নতুন task তৈরি হয়েছে** + submission list-এ এসেছে।

**🧪 Edge cases:**
- Required field খালি রেখে submit → validation error।
- "Accepting submissions" off করে submit → 403 `form.submission_closed`।
- Public form-এ **file field** anonymous-এ disabled।
- একই custom field দুবার form-এ যোগ → prevent।
- BD phone/money/date/dropdown field public form-এ ঠিকভাবে render+submit।

**✅ Checklist:**
- [ ] Builder drag-drop + field config · [ ] Settings/Branding · [ ] Public submit (incognito) → task created · [ ] Required validation · [ ] Submission-closed (403) · [ ] Submission list · [ ] Custom field types render

---

## M12. Notifications, Inbox & Real-time (SSE) 🔐
**এক কথায়:** In-app inbox — assign/mention/comment ইত্যাদিতে notification, read/unread/snooze, আর live (SSE) stream।

**Backend · ✅ auto-tested:**
- **Notifications (9 ep) `routes/notifications.ts`:** feed · unread-count · mark-all-read · get/update preferences · `:id/read`·`/unread`·`/snooze` · delete
- **SSE (1 ep) `routes/sse.ts`:** `GET /stream/inbox` (cookie auth, long-lived)

**Frontend:** `pages/inbox/InboxPage` · `shared/NotificationBell`।
**DB:** `notifications`, `user_notification_prefs`।

**🎯 Key flows:**
1. **দুটো account দরকার।** Account A দিয়ে B-কে একটা task-এ assign করুন / comment-এ `@mention` করুন → **B-র bell-এ notification** আসে (badge count বাড়ে)।
2. Inbox tab (all/unread/mentions/assigned) → read/unread toggle → snooze (1h/4h/1d) → delete।
3. Mark-all-read।
4. Notification preferences (per-type in-app/email toggle)।

**🧪 Edge cases:**
- Snooze করা notification snooze-time পার হলে আবার unread হয় (background job `snooze-wake` — M18)।
- Real-time: B-র inbox খোলা রেখে A থেকে action করুন → **refresh ছাড়াই** আসে কিনা (SSE — যদি frontend SSE consume করে; নাহলে bell poll করে)।

**⚠️ Note:** Frontend এখনো EventSource (SSE) consume নাও করতে পারে — bell/inbox react-query poll দিয়ে চলে। তাই "live" না হয়ে কয়েক সেকেন্ড delay-তে আসতে পারে — এটা পরিচিত।

**✅ Checklist:**
- [ ] Assign/mention → notification (2 account) · [ ] Read/unread/snooze/delete · [ ] Mark-all-read · [ ] Tab filter + count · [ ] Preferences · [ ] Snooze-wake · [ ] Real-time/poll behavior

---

## M13. Search 🔐
**এক কথায়:** পুরো workspace জুড়ে দ্রুত খোঁজা — task, list, space, user, comment।

**Backend (1 ep) · `routes/search.ts` · ✅ auto-tested:** `GET /search?q=&types=&limit=`।
**Frontend:** `pages/search/SearchPage` · `shared/CommandPaletteTrigger` (topbar search button)।

**🎯 Key flows:**
1. Topbar search → `/search` page → কিছু লিখুন → ৫ type-এ (task/list/space/user/comment) grouped result।
2. Result-এ click → task হলে detail drawer, list হলে list page ইত্যাদি।
3. Type chip দিয়ে filter, count দেখা।

**🧪 Edge cases:**
- খালি query → empty (error নয়)।
- task `custom_id` দিয়ে **exact** match।
- soft-deleted comment / archived task-এর comment result-এ আসে না।
- matching text highlight।

**✅ Checklist:**
- [ ] ৫ type search · [ ] Result navigation · [ ] Type filter + count · [ ] custom_id exact · [ ] Empty query · [ ] Deleted/archived বাদ

---

## M14. Home Dashboard 🔐
**এক কথায়:** Login-এর পরের landing — KPI, my-work, আজকের agenda, recent activity।

**Backend (2 ep) · `routes/home.ts` · ✅ auto-tested:** `GET /home/kpis` · `GET /home/agenda?date=`।
**Frontend:** `pages/home/HomePage` (+ HomeGreeting, KpiRow/KpiCard, MyWorkCard, AgendaCard, LineupCard, RecentActivityCard)।

**🎯 Key flows:**
1. Dashboard-এ ৬ KPI tile (my tasks, due today, overdue, awaiting review, open team, SLA breaches) — সংখ্যা সঠিক কিনা (নিজে কয়েকটা task বানিয়ে মিলিয়ে দেখুন)।
2. My-work card-এর ৫ tab (today/overdue/next/unscheduled/done) সঠিক bucket।
3. Agenda — আজকের due task; date বদলালে সেদিনের।
4. KPI tile-এ click → সংশ্লিষ্ট list/page-এ যায়।

**🧪 Edge cases:**
- নতুন user (কোনো task নেই) → সব 0 / empty state।
- overdue/due-today date boundary (timezone) — ⚠️ Dhaka tz-এ date boundary নিয়ে latent skew থাকতে পারে (নিচে Cross-cutting দেখুন)।

**✅ Checklist:**
- [ ] ৬ KPI সঠিক · [ ] My-work ৫ bucket · [ ] Agenda date-wise · [ ] Tile click navigation · [ ] Empty state · [ ] Date boundary

---

## M15. Templates 👑/🔐
**এক কথায়:** পুনঃব্যবহারযোগ্য task structure (checklist সহ) — একবার বানিয়ে বারবার apply।

**Backend (7 ep) · `routes/templates.ts` · ✅ auto-tested:** list (`?type=&q=`) · get · create 👑 · update 👑 · delete 👑 · `POST /templates/:id/apply` 🔐।
**Frontend:** `pages/settings/TemplatesSettings`।
**DB:** `templates`।

**🎯 Key flows:**
1. Template বানান (task structure + checklist items) → একটা list-এ **apply** করুন → নতুন task + checklist auto-তৈরি হয়।
2. Apply-এর পর `usage_count` বাড়ে।
3. `?type=` / `?q=` filter।

**🧪 Edge cases:**
- খালি structure / অবৈধ task-type/tag → 422।
- Template type immutable (PATCH-এ বদলানো যায় না)।

**⚠️ Note:** 🟡 Per-item due-date (anchor_date/dueOffsetDays) accept করে কিন্তু **materialize করে না** (deferred — `checklist_items.due_date` column নেই)।

**✅ Checklist:**
- [ ] Template CRUD · [ ] Apply → task+checklist · [ ] usage_count · [ ] Filter type/q · [ ] Validation (empty/invalid) · [ ] 🟡 due-date deferred

---

# Layer E — Engineering · AI · Ops

## M16. Engineering Suite (Sprints · On-Call · Bug/Incident · SLA) 🔐/👑
**এক কথায়:** Dev team-এর জন্য বিশেষ — sprint, on-call rotation, bug triage, incident postmortem, SLA, git/story-points।

**Backend · ✅ auto-tested:**
- **Sprints (10 ep) `routes/sprints.ts`:** list · active · get · `:id/tasks` · create/update 👑 · start/close 👑 · add/remove task
- **On-Call (4 ep) `routes/onCall.ts`:** current · schedule · `PUT /:weekStart` 👑 · `DELETE` 👑
- **Engineering (3 ep) `routes/engineering.ts`:** `POST /eng/report-bug` · `GET /eng/home` · `POST /eng/incidents/:id/postmortem`
- **SLA (2 ep) `routes/sla.ts`:** `GET /sla/breached` · `PATCH /tasks/:id/sla` 👑

**Frontend:** `pages/engineering/EngineeringHomePage`, `SprintBoardPage`, `OnCallRotationPage` · `components/task/BugFieldsSection`, `BugSeverityBadge`, `GitIntegrationPanel`, `StoryPointsBadge`/`InlineStoryPointsEdit`, `PostmortemChecklist`, `SLABadge`।
**DB:** `sprints`, `on_call_shifts`, `task_postmortems`।

**🎯 Key flows:**
1. **Sprint:** create → task add → **start** (planned→active, একসাথে একটাই active) → **close** → অসম্পূর্ণ task পরের planned sprint-এ roll-over হয়। SprintBoard-এ দেখুন।
2. **On-Call:** week-wise engineer assign → current week highlight।
3. **Bug:** `report-bug` → "Bug Triage" list-এ Bug task; S0/S1 হলে on-call-কে auto-assign; SLA auto-compute (S0=2h, S1=24h, S2=7d)।
4. **Bug fields:** severity/reproducibility/environment/browser/reporter-team — Bug type task-এ দেখা যায়।
5. **Git panel:** branch name suggest + copy-checkout; PR URL → status (draft/open/merged/closed) detect।
6. **Postmortem:** Incident task resolved হলে ৬-item checklist।
7. **SLA:** breached list; manual override (future date দিতে হবে)।

**🧪 Edge cases:**
- দুটো sprint একসাথে start → 422 `another_active`।
- ভুল state transition (closed sprint-এ task add) → 409।
- On-call-এ deactivated user assign → 422।
- SLA override past date → 422।

**⚠️ Known issues:**
- 🟡 **Postmortem checklist শুধু sessionStorage-এ** save হয় (DB-তে persist হয় না — frontend; backend endpoint আলাদা আছে কিন্তু UI সেটা ব্যবহার নাও করতে পারে)।
- 🟡 PR status = URL keyword heuristic (আসল GitHub API নয়)।
- ⚠️ **SLA timezone:** breached-detection-এ Dhaka tz +6h skew থাকতে পারে (`v_breached_sla` view) — breach time edge case-এ যাচাই করুন।

**✅ Checklist:**
- [ ] Sprint lifecycle + rollover · [ ] Single-active guard · [ ] On-call assign + current · [ ] Report-bug + auto-assign + SLA · [ ] Bug fields · [ ] Git panel · [ ] Postmortem · [ ] SLA breached + override · [ ] Timezone edge

---

## M17. AI Help Assistant 🔐
**এক কথায়:** In-app chatbot (Bangla help-bot) — streaming উত্তর, নিজের data নিয়ে প্রশ্ন (tool-calling)।

**Backend (3 ep) · `routes/assistant.ts` · ⚠️ light auto-test:** `POST /assistant/chat` (SSE/JSON, rate-limit 20/min) · `GET /assistant/conversations` · `GET /assistant/conversations/:id`। OpenAI `gpt-4o-mini`।
**Frontend:** `components/assistant/AssistantWidget` · `stores/chat.ts` · `http/assistant.ts` (fetch-streaming)।
**DB:** `chat_conversations`, `chat_messages`। Config: `server/.env`-এ `OPENAI_API_KEY`।

**🎯 Key flows:**
1. Floating widget খুলুন → প্রশ্ন করুন → উত্তর **stream** হয়ে (টাইপিং-এর মতো) আসে।
2. "আমার আজকের কাজ কী?" / "আমার কয়টা task overdue?" — bot tool ব্যবহার করে **আপনার আসল data** দিয়ে উত্তর দেয়।
3. Conversation persist (পুরোনো chat ফিরে দেখা)।

**🧪 Edge cases:**
- দ্রুত ২০+ message → 429 rate-limit।
- OpenAI key ভুল/missing → graceful error (raw error leak করে না)।
- Stream চলাকালীন stop/abort।

**⚠️ Known issues — টেস্টের আগে অবশ্যই পড়ুন:**
- 🔴 **LIVE BUG:** `client/src/http/assistant.ts:12` — `BASE_URL` fallback **নেই** (`import.meta.env.VITE_BACKEND_API_URL` সরাসরি)। `client/.env` খালি থাকলে (যা default) বা **LAN device** থেকে চালালে chatbot `undefined/assistant/chat`-এ POST করবে → **fail করবে**। localhost-এ `VITE_BACKEND_API_URL` সেট না থাকলে chatbot কাজ নাও করতে পারে। টেস্টের আগে হয় `.env`-এ URL সেট করুন, নাহয় এই bug আগে fix করতে বলুন।
- `OPENAI_API_KEY` না থাকলে পুরো module কাজ করবে না।

**✅ Checklist:**
- [ ] 🔴 আগে assistant.ts BASE_URL bug যাচাই/fix · [ ] Streaming reply · [ ] Tool-call (my tasks/agenda) · [ ] Conversation persist · [ ] Rate-limit (429) · [ ] Error handling (bad key) · [ ] Stop/abort

---

## M18. Admin & Ops (Jobs · Health · Metrics · Audit · Import/Export) 👑/internal
**এক কথায়:** পর্দার আড়ালের জিনিস — background job, health probe, metrics, audit log, import/export।

**Backend · ✅ auto-tested (jobs):**
- **Jobs (4) `routes/jobs.ts`** (internal `X-Internal-Token`): `session-cleanup`, `attachment-janitor`, `r2-purge`, `snooze-wake` — CLI: `npm run job <name>`
- **Health (app-root, auth-free) `routes/health.ts`:** `GET /health` · `/health/ready` (DB ping) · `/health/version` · `GET /metrics` (Prometheus)
- **Workspace Activity (2 ep) `routes/workspaceActivity.ts`:** `GET /activity/recent` · `GET /activity` (audit feed)

**Frontend:** `pages/settings/ImportExportSettings` 🟡 · `pages/home/RecentActivityCard` (audit)।

**🎯 Key flows:**
1. `GET /health` (browser-এ সরাসরি) → `{status:ok}`; `/health/ready` → DB up হলে 200; `/metrics` → Prometheus text।
2. CLI job চালান: `cd server && npm run job snooze-wake` → snoozed notification আবার unread হয়।
3. `attachment-janitor` → পুরোনো pending attachment cleanup।
4. Audit: workspace-এ কিছু করুন → `/activity` feed + RecentActivity card-এ আসে।

**🧪 Edge cases:**
- Job endpoint ভুল/missing `X-Internal-Token` দিয়ে → reject।
- Job dry-run mode (count only)।

**⚠️ Known issues:**
- 🟡 **Import/Export** — importer "coming soon" stub।
- ⚠️ কোনো **cron scheduler wired নেই** — job-গুলো নিজে নিজে চলে না, external cron বা manual CLI দিয়ে trigger করতে হয়।

**✅ Checklist:**
- [ ] /health · /health/ready · /health/version · /metrics · [ ] CLI job (snooze-wake/janitor) · [ ] Internal-token guard · [ ] Audit feed · [ ] 🟡 Import/Export stub · [ ] Job dry-run

---

# 🌐 Cross-Cutting — প্রতিটা module-এ যা মাথায় রাখবেন

এগুলো কোনো একক module নয়, পুরো system জুড়ে — যেকোনো module টেস্ট করার সময় পাশাপাশি যাচাই করুন:

| বিষয় | যা দেখবেন |
|---|---|
| **Permissions (RBAC)** | একই action Owner/Admin/Member/Guest দিয়ে চালান — 👑/🛡️ endpoint-এ member 403 পায় কিনা |
| **Workspace isolation** | কখনো অন্য workspace-এর data দেখা/edit করা যায় কিনা (multi-tenant leak) |
| **Error envelope** | সব error `{error:{code,message,request_id}}` shape-এ আসে কিনা (Network tab) |
| **Validation (422)** | অবৈধ input-এ পরিষ্কার field-wise error |
| **Pagination** | ⚠️ Backend cursor-paginate করে কিন্তু **frontend pagination cursor ফেলে দেয়** → বড় list (১০০+ user/হাজার task) সব একসাথে load হয় — ১০০-জনের scale-এ slowdown যাচাই করুন |
| **camelCase ↔ snake_case** | wire snake_case, UI camelCase — কোনো field mangle/missing হয় কিনা |
| **Timezone (Dhaka)** | due-today/overdue/SLA breach-এর date boundary — server UTC vs Dhaka +6h skew |
| **Responsiveness** | mobile breakpoint (1024px) — sidebar, drawer, dashboard |
| **Loading/Empty/Error states** | প্রতিটা page-এ ৩ অবস্থা |
| **LAN access (in-progress)** | অন্য device থেকে `http://<lan-ip>:5173` খুলে app চলে কিনা (CORS/BASE_URL — M17-এর assistant bug মনে রাখুন) |

---

# 🐛 Bug Report Template (কপি করে ব্যবহার করুন)

```
### Bug #__ — [Module M__: ____]
- **কোথায়:** (page/endpoint)
- **কী করলে:** (steps to reproduce)
  1.
  2.
- **যা হওয়ার কথা ছিল (Expected):**
- **যা হলো (Actual):**
- **Role:** Owner / Admin / Member / Guest
- **Console/Network error:** (screenshot/text)
- **Severity:** 🔴 Critical / 🟠 Major / 🟡 Minor
```

---

# 📋 দ্রুত রেফারেন্স — সবচেয়ে আগে দেখার মতো জায়গা

আমার scan-এ এই জায়গাগুলোতে সমস্যা/gap পাওয়া গেছে — এগুলো manual টেস্টে **আলাদা মনোযোগ** দিন:

1. 🔴 **M17 — AI Assistant `BASE_URL` bug** (empty `.env`/LAN-এ chatbot fail)।
2. ❌ **M10 — Comments + Checklists** এ backend test নেই (hidden bug-এর সম্ভাবনা সর্বোচ্চ)।
3. ⚠️ **Cross-cutting — Pagination** frontend-এ discard হয় (scale concern)।
4. ⚠️ **M14/M16 — Timezone** date-boundary skew (Dhaka tz)।
5. 🟡 **Stub/deferred:** invite-accept (M2), Calendar week-day/Gantt (M8), Postmortem persist (M16), Import/Export (M18), cron scheduler (M18)।

---

*এই ফাইলটা পুরো 2026-06-27 codebase scan-এর ভিত্তিতে তৈরি। প্রতিটা module আলাদাভাবে শেষ করে ✅ checklist টিক দিন। কোনো module আরও deep করতে চাইলে — সেই module-এর জন্য আলাদা detailed test-case sheet বানিয়ে দিতে পারি।*
