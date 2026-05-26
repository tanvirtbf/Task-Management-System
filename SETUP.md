# Project Setup Guide

> **Internal Task Management System for [Company Name]**
>
> Two separate projects in this repository:
> - `server/` — Express + TypeScript + MySQL + Drizzle ORM backend
> - `client/` — React 19 + Vite + TypeScript + Ant Design frontend

## Folder Structure

```
Task Management System/
├── server/                   # Backend (Express + MySQL + Drizzle)
├── client/                   # Frontend (React + Vite)
├── example server/           # Reference auth-service (untouched)
├── example client/           # Reference admin client (untouched)
├── FINAL_Technical_Requirements.md    # Master SRS
├── Company_Required_Requirements.md   # Filtered requirements
├── ClickUp_Complete_Software_Scan.md  # Reference feature scan
└── SETUP.md                  # This file
```

## Prerequisites

- Node.js 20+ (or 22)
- npm 10+
- MySQL 8+ running locally (or Docker)

## First-Time Setup

### 1. MySQL Database

```bash
# Connect to MySQL
mysql -u root -p

# Create database
CREATE DATABASE task_management;
EXIT;
```

### 2. Server Setup

```bash
cd server
npm install

# Copy env template
cp .env.example .env.dev

# Edit .env.dev with your MySQL credentials:
#   DB_HOST=localhost
#   DB_PORT=3306
#   DB_USERNAME=root
#   DB_PASSWORD=your_password
#   DB_NAME=task_management
#   REFRESH_TOKEN_SECRET=<generate 32+ random chars>

# Generate RS256 JWT keys
node scripts/generateKeys.mjs
# This creates certs/private.pem and certs/public.pem
# Copy contents of certs/private.pem into PRIVATE_KEY in .env.dev
# (Escape newlines as \n, OR keep as multi-line in quotes)

# Generate Drizzle migration from schema
npm run db:generate

# Apply migration to database
npm run db:migrate

# (Optional) Seed default admin user
npm run db:seed
# Creates: admin@company.local / Admin@12345
```

### 3. Client Setup

```bash
cd ../client
npm install

# Env
cp .env.example .env
# Should contain: VITE_BACKEND_API_URL=http://localhost:5501
```

## Running Both (Daily Dev Workflow)

Terminal 1 — Server:
```bash
cd server
npm run dev
# Listens on http://localhost:5501
```

Terminal 2 — Client:
```bash
cd client
npm run dev
# Opens http://localhost:5173
```

Visit http://localhost:5173. Login with seeded admin or register a new user via `/auth/login`.

## Tech Stack Summary

### Server (`server/`)
| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript (CommonJS) |
| Framework | Express 4 |
| Database | MySQL 8 |
| ORM | Drizzle ORM |
| Driver | mysql2 |
| Auth | JWT (RS256 access + HS256 refresh) in httpOnly cookies |
| Password hash | bcrypt (saltRounds=10) |
| Validation | express-validator |
| Logging | Winston |
| Test | Jest + Supertest |
| Lint | ESLint + Prettier |

### Client (`client/`)
| Concern | Choice |
|---|---|
| Framework | React 19 |
| Build tool | Vite 7 |
| Language | TypeScript (ESM) |
| UI library | Ant Design 6 |
| State | Zustand 5 |
| Server state | TanStack Query 5 |
| Routing | React Router 7 |
| HTTP | Axios (with 401 → refresh interceptor) |
| Test | Vitest + Testing Library + happy-dom |
| Lint | ESLint flat config |

## Database Workflow (Drizzle)

Whenever you change a schema file in `server/src/db/schema/`:

```bash
cd server
npm run db:generate   # Generates migration SQL in src/db/migrations/
# Review the generated SQL file
npm run db:migrate    # Applies it to the database
```

Other useful commands:
- `npm run db:studio` — opens Drizzle Studio (visual DB browser) at https://local.drizzle.studio
- `npm run db:push` — push schema directly without generating a migration (dev only — destructive)
- `npm run db:drop` — drop a specific migration

## Adding New Entities

1. **Schema:** Create `server/src/db/schema/<entity>.ts` defining the table with Drizzle.
2. **Export:** Add `export * from "./<entity>"` in `server/src/db/schema/index.ts`.
3. **Migration:** `npm run db:generate` then `npm run db:migrate`.
4. **Service:** `server/src/services/<Entity>Service.ts` (class with `db: MySql2Database<typeof schema>` constructor).
5. **Controller:** `server/src/controllers/<Entity>Controller.ts`.
6. **Validators:** `server/src/validators/<entity>-validator.ts`.
7. **Routes:** `server/src/routes/<entity>.ts` and mount in `server/src/app.ts`.

Mirror corresponding API and pages on the client side.

## Auth Flow Overview

1. **Login** — `POST /auth/login` → sets `accessToken` (RS256, 1h) and `refreshToken` (HS256, 365d) as httpOnly cookies.
2. **Self** — Every page load: `GET /auth/self` (uses accessToken).
3. **401 → Refresh** — Client axios interceptor catches 401 → calls `POST /auth/refresh` → retries original request.
4. **Logout** — `POST /auth/logout` deletes server-side refresh token + clears cookies.

The refresh token is **rotated on every refresh** — old DB row deleted, new one inserted.

## Common Issues

### Server won't start: "Database not initialized"
Check MySQL is running and `.env.dev` credentials are correct. The server initializes the pool in `server.ts` **before** importing `app.ts`, so the order matters — don't modify that.

### CORS errors
Client must run on `http://localhost:5173` (default Vite port) unless you change `CLIENT_URL` in server `.env.dev` AND `vite.config.ts`.

### JWT verification fails (401 even with valid token)
Check that:
- `PRIVATE_KEY` in server `.env.dev` is the PEM contents (with `\n` for newlines OR multiline in quotes).
- `JWKS_URI` points to a working JWKS endpoint. For local dev, you can use `mock-jwks` package in tests.
- For production, host your JWKS file at the URL specified in `JWKS_URI`.

### Cookies not set
Browser must support 3rd-party cookies if client and server are on different ports (localhost is fine for same-port localhost). Both `withCredentials: true` (client) and `credentials: true` (server CORS) are required.

## Next Build Steps

Per the master SRS (`FINAL_Technical_Requirements.md`), V1 includes:

**Phase 1 — Foundation** (current scaffolding)
- ✅ Auth + user management + 2FA scaffolding (2FA todo)
- ✅ User + Tenant + RefreshToken entities

**Phase 2 — Hierarchy & Tasks**
- ⏳ Workspace, Space, Folder, List, Task, Subtask, Checklist entities
- ⏳ Custom Statuses, Priorities, Task Types, Tags
- ⏳ Tasks CRUD + List view + Board view

**Phase 3 — Custom Fields + Forms + Filters**

**Phase 4 — Automation + Real-time + Notifications**

**Phase 5 — Dashboards + Time Tracking + Polish**

See `FINAL_Technical_Requirements.md` for the complete spec.
