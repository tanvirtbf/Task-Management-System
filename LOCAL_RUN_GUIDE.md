# Local Run Guide — BeautyBooth Task Management

> **TL;DR (Bangla):** MySQL চালু করুন → `server/` এ `npm run db:setup && npm run db:seed && npm run dev` → `client/` এ `npm run dev` → ব্রাউজারে **http://localhost:5173** খুলে **owner@company.local / Owner@12345** দিয়ে লগইন করুন। দুটো আলাদা টার্মিনাল লাগবে (একটা server, একটা client)।

The frontend is now fully wired to the real backend (no more mock data for the core app). This guide gets both halves running on your machine.

---

## 1. Prerequisites

| Need | Version | Notes |
|------|---------|-------|
| **Node.js** | 20+ | `node -v` to check |
| **MySQL** | 8.x | Must be running on `localhost:3306` |
| npm | bundled with Node | |

The MySQL credentials the server expects are in `server/.env`:
```
DB_HOST=localhost   DB_PORT=3306
DB_USERNAME=root    DB_PASSWORD=root
DB_NAME=taskmanagement
```
**If your local MySQL uses a different user/password,** edit those two lines in `server/.env` before continuing. Everything else in `.env` (ports, secrets, Cloudflare R2, SMTP) is already filled in.

---

## 2. One-time setup

### Backend (`server/`)
```bash
cd "E:\Task Management System\server"
npm install            # (node_modules already present — safe to re-run)
npm run db:setup       # creates the `taskmanagement` database + all tables/views/triggers
npm run db:seed        # creates the BeautyBooth workspace + the owner login
```
`db:seed` prints:
```
Seed completed. Default owner: owner@company.local / Owner@12345
```

### Frontend (`client/`)
```bash
cd "E:\Task Management System\client"
npm install
```

---

## 3. Run it (two terminals)

**Terminal 1 — API**
```bash
cd "E:\Task Management System\server"
npm run dev
# → Listening on port 5501   (http://localhost:5501/api/v1)
```

**Terminal 2 — Web app**
```bash
cd "E:\Task Management System\client"
npm run dev
# → http://localhost:5173
```

Open **http://localhost:5173** and log in:

| Email | Password |
|-------|----------|
| `owner@company.local` | `Owner@12345` |

---

## 4. First steps after login

The seed creates only the **workspace + owner** — your workspace starts empty. To see the app come alive:

1. **Create a Space** (left sidebar → “+”). 
2. **Add a List** inside it — this auto-creates the 5 default statuses (To Do / In Progress / In Review / Done / Closed).
3. **Add Tasks** — try List, **Board**, and **Calendar** views.
4. Open a task → try **Comments** (@mention, #TASK-ID), **Checklists**, **Subtasks**, **Dependencies**, **Custom fields**, **Activity**.
5. **Settings** → Members (invite teammates), Task Types, Tags, Custom Fields, Statuses, Templates, **Profile → Change password**.
6. **Engineering** space features: Sprints, On-call rotation, Report a bug, Eng home rollup.
7. **Department review (Dept Review V1, 2026-07-22)**: open a Space page → assign a **Department head** in the head card (owner/admin). The head gets a **Department** item in the sidebar (`/dept`): summary tiles, per-member rollup, and the review queue — **Approve ✓ / Flag ⚑ (+note)** completed tasks; assignees get notified. The weekly HR report generates via the `department-report` job (see §9) or the on-demand API; owners/admins + the head get a `report_ready` inbox notification. (The `/reports` viewer UI ships with Stage F of the build plan.)

---

## 5. Ports & CORS (already configured)

| Piece | URL |
|-------|-----|
| API | http://localhost:5501/api/v1 |
| Web | http://localhost:5173 |

`server/.env` → `PORT=5501`, `FRONTEND_URL=http://localhost:5173` (CORS allows the web origin). `client/.env` → `VITE_BACKEND_API_URL=http://localhost:5501/api/v1`. These three must agree; they already do.

---

## 6. Known V1 limitations (by design — not bugs)

- **Both `npm run dev` and `npm run build` work cleanly** (client + server type-check with 0 errors). The legacy mock-data layer (`src/lib/mock-api.ts` + `src/mocks/*`) is no longer imported by any live screen and is excluded from the build — you can delete that folder whenever you like; nothing depends on it.
- **Attachments** require the Cloudflare R2 credentials in `.env` to be valid. They are filled in; if an upload fails, R2 is the place to check.
- **Real-time notifications** refresh by 60-second polling (live SSE push is deferred — it needs a token-in-query change to work with our in-memory-token auth model).
- **Public intake forms** (`/public/forms/:slug`, anonymous): `task_attr` fields (name, description, etc.) work fully; custom-field inputs render as plain text boxes and submit with the `{text}` envelope, so rich custom types (dropdown / money / date / files) on *public* forms are limited in V1. Inside the authenticated app, all custom-field types work.
- ~~Invitation accept-link page is a placeholder~~ **(now built, 2026-06-27).** The full invite→accept flow works end-to-end: an admin invites a teammate (creates the account + emails an `/invitation/<token>` link via Mailtrap), the invitee opens the link, sees the workspace/email, sets a password, and is **auto-logged-in** to the app. Backend: `GET /api/v1/auth/invitation/:token` + `POST /api/v1/auth/accept-invitation`. To test the accept page without reading the Mailtrap email, seed a known-token invitation directly in the dev DB.
- **Sprint board** populates from a list whose id must exist in your data (a sprint’s tasks span lists; the cross-list “tasks by sprint” view is a follow-up). The sprint selector itself is live.

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login/network errors, CORS in console | Confirm API is on **5501** and web on **5173** (don’t change the Vite port). |
| `ECONNREFUSED` / DB errors on server start | Is MySQL running? Do `server/.env` `DB_USERNAME`/`DB_PASSWORD` match your MySQL? |
| `Table ... doesn't exist` | Run `npm run db:setup` (then `npm run db:seed`) in `server/`. |
| Stuck logged-out / 401 loop | Clear cookies for `localhost`, hard-refresh. |
| Port 5501 already in use | Stop the other process, or change `PORT` in `server/.env` **and** `VITE_BACKEND_API_URL` in `client/.env` to match. |
| Want a clean DB | `npm run db:setup:fresh` (drops + recreates), then `npm run db:seed`. |

---

## 8. What’s wired (every screen is on the real API)

Auth, Workspace, Users/Members, Spaces, Lists, Statuses, Task Types, Tags, Tasks (List/Board/Calendar), Subtasks, Dependencies, Task Activity, **Comments (§14)**, **Checklists (§15)**, Attachments, Custom Fields, Forms (admin + public render), Notifications (inbox + bell), Home/KPIs, Search, Sprints, On-call, Engineering home, Report-bug, SLA, Templates, Profile (incl. change-password), Forgot/Reset password.

Backend: **150 `/api/v1` endpoints** across all 29 spec sections (+**11 Dept Review V1 endpoints**: head assignment, review write/reads, queue/summary, reports A-6…A-11), all routers mounted, server type-checks clean.

---

## 9. Background jobs (external cron — no in-process scheduler)

There is deliberately no in-process scheduler; schedule these externally (Windows Task Scheduler locally, real cron on the server):

| Job | Cadence | Trigger |
|-----|---------|---------|
| `snooze-wake` | every 5 min | `POST /api/v1/jobs/snooze-wake` |
| `session-cleanup`, `attachment-janitor`, `r2-purge` | daily | `POST /api/v1/jobs/<slug>` |
| **`department-report`** | **weekly, Monday 09:00 (Asia/Dhaka)** | `POST /api/v1/jobs/department-report` |
| `form-submission-expiry` | daily | CLI only |

- HTTP triggers need the header `X-Internal-Token: <INTERNAL_JOB_TOKEN from server/.env>`.
- CLI (no server needed): `cd server && npm run job <slug>` — add `-- --dry-run` to count without writing (e.g. `npm run job department-report -- --dry-run`).
- `department-report` is idempotent: re-runs refresh the report payload but never re-send notifications, and a missed Monday self-heals one week back on the next run.
