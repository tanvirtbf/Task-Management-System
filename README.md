# Task Management System

A full-stack task management application built with the **same backend stack as the Ecommerce project**, but with a **React + Vite frontend** (no Next.js).

## Stack

### Backend (`server/`)
- **Express.js 4** + **TypeScript**
- **MySQL 8** via **mysql2** + **Drizzle ORM**
- **JWT** auth (HS256) with httpOnly cookie pair + refresh-token rotation
- **bcrypt** password hashing (10 rounds)
- **express-validator** input validation
- **express-rate-limit** brute-force protection
- **Winston** logging
- Port: **4000**

### Frontend (`client/`)
- **React 19** + **TypeScript**
- **Vite 6** (dev server + build tool)
- **Tailwind CSS v4** (`@tailwindcss/vite` plugin)
- **shadcn/ui** ready (`components.json` configured)
- **React Router v7** for client-side routing
- **TanStack Query v5** for server state (60s staleTime, retry 1)
- **react-hook-form + Zod v4** for forms
- **AuthProvider** context for auth
- Port: **5173**

## Project Structure

```
Task Management System/
├── server/                      # Express backend
│   ├── src/
│   │   ├── app.ts               # Express app, CORS, routes, error handler
│   │   ├── server.ts            # Server bootstrap
│   │   ├── config/              # Env config + Winston logger
│   │   ├── constant/            # Roles, task statuses/priorities, page sizes
│   │   ├── db/
│   │   │   ├── index.ts         # Drizzle client (MySQL pool)
│   │   │   ├── schema.ts        # Re-exports
│   │   │   ├── schema/          # users.ts, tasks.ts
│   │   │   └── migrate.ts       # CLI migration runner
│   │   ├── controllers/         # AuthController, TaskController
│   │   ├── services/            # AuthService, TaskService, TokenService, etc.
│   │   ├── routes/              # auth.ts, task.ts
│   │   ├── middlewares/         # authenticate, canAccess, rate limiters
│   │   ├── validators/          # authValidator, taskValidator
│   │   ├── types/               # authTypes.ts
│   │   └── utils/
│   ├── tests/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   └── nodemon.json
└── client/                      # React + Vite frontend
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx              # Router setup (BrowserRouter + routes)
    │   ├── index.css            # Tailwind v4 import + theme tokens
    │   ├── components/
    │   │   ├── ui/              # shadcn-style primitives (button, input)
    │   │   └── layout/          # AppLayout, ProtectedRoute
    │   ├── pages/               # Login, Register, Dashboard, Tasks
    │   ├── hooks/
    │   │   ├── queries/         # use-tasks
    │   │   └── mutations/       # use-task-mutations
    │   ├── lib/
    │   │   ├── api-client.ts    # fetch wrapper with credentials: include
    │   │   ├── constants.ts
    │   │   ├── utils.ts         # cn() = clsx + twMerge
    │   │   └── validation/      # auth.ts, task.ts (Zod schemas)
    │   ├── providers/
    │   │   ├── auth-provider.tsx
    │   │   └── query-provider.tsx
    │   └── types/index.ts
    ├── index.html
    ├── package.json
    ├── vite.config.ts           # React + Tailwind plugin + /api proxy
    ├── tsconfig.json
    └── components.json          # shadcn config
```

## Getting Started

### 1. Backend setup

```bash
cd "Task Management System/server"
cp .env.example .env
# Edit .env: fill DB credentials + SECRET_KEY (long random string)
npm install
```

Create the MySQL database:
```sql
CREATE DATABASE task_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Generate + run migrations:
```bash
npm run db:generate    # generates SQL from schema
npm run db:push        # syncs schema to DB (dev shortcut)
# OR:
npm run db:migrate     # runs generated migrations
```

Start dev server:
```bash
npm run dev
```
Backend listens on **http://localhost:4000**.

### 2. Frontend setup

```bash
cd "Task Management System/client"
cp .env.example .env   # optional — defaults work with the dev proxy
npm install
npm run dev
```
Frontend runs on **http://localhost:5173**. Vite's dev proxy forwards `/api/*` → `http://localhost:4000/*`, so cookies flow seamlessly with no CORS prompts.

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Auth (`/auth`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/register` | No | Create account |
| POST | `/login` | No | Set access + refresh cookies |
| POST | `/refresh` | Cookie | Rotate token pair |
| POST | `/logout` | No | Revoke refresh token + clear cookies |
| GET | `/me` | Yes | Get current user |

### Tasks (`/tasks`) — all authenticated
| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List tasks (`?page=&perPage=&status=&priority=&assigneeId=`) |
| GET | `/:id` | Get one task (creator/assignee/admin only) |
| POST | `/` | Create task |
| PATCH | `/:id` | Update task |
| DELETE | `/:id` | Soft-delete (creator/admin only) |

## Database Schema

3 tables:
- **`users`** — id, email, password_hash, first_name, last_name, role (admin/member), is_active, soft-delete
- **`refresh_tokens`** — hashed token, device metadata, is_revoked, expires_at
- **`tasks`** — title, description, status (todo/in_progress/done/archived), priority (low/medium/high/urgent), due_date, creator_id, assignee_id, soft-delete
- **`task_comments`** — task_id, user_id, content (ready for future use)

## Architecture Notes

- **Auth flow**: same pattern as ecommerce — JWT in httpOnly cookies, refresh-token rotation on `/refresh`, all refresh tokens hashed (SHA-256) in DB
- **Authorization**: role-based via `canAccess([roles])` middleware
- **Service pattern**: Controllers thin → Services own business logic → Drizzle for DB
- **Frontend state**: TanStack Query (server) + AuthProvider context (auth) — no global store needed
- **Vite proxy** replaces Next.js BFF: cleaner for SPA, no separate proxy server in dev

## Next Steps (not in this basic setup)

- Add task comments routes (table is ready)
- Add user assignment dropdown (needs `/users` listing endpoint)
- Add file attachments (Cloudflare R2 — same setup as ecommerce when needed)
- Add tests (jest + supertest backend, vitest frontend)
