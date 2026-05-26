# Task Management Server

Internal task management system backend.

**Stack:** Express + TypeScript + MySQL + Drizzle ORM

## Quick start

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env.dev
# Edit .env.dev with your MySQL credentials and generate two random secrets:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Put one in ACCESS_TOKEN_SECRET and another in REFRESH_TOKEN_SECRET.

# 3. Create database
mysql -u root -p -e "CREATE DATABASE task_management;"

# 4. Generate + run migrations
npm run db:generate
npm run db:migrate

# 5. (Optional) Seed default owner user
npm run db:seed

# 6. Start dev
npm run dev
```

Server runs on `http://localhost:5501`.

Default seeded user (if you ran `db:seed`):
- Email: `owner@company.local`
- Password: `Owner@12345`

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with nodemon |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server (prod) |
| `npm test` | Run Jest tests |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint autofix |
| `npm run format:fix` | Prettier format |
| `npm run db:generate` | Generate Drizzle migration from schema |
| `npm run db:migrate` | Apply migrations to DB |
| `npm run db:push` | Push schema directly (dev only — destructive) |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run db:drop` | Drop a migration |
| `npm run db:seed` | Seed initial data |

## Project structure

```
src/
├── app.ts                  Express app + middleware + routes mount
├── server.ts               Entrypoint: init DB, start listening
├── config/
│   ├── index.ts            Env vars
│   └── logger.ts           Winston logger
├── constants/
│   └── index.ts            Roles enum (Owner / Admin / Member / Guest)
├── controllers/            HTTP handlers (class-based, DI via constructor)
├── db/
│   ├── client.ts           Drizzle init + pool management
│   ├── migrate.ts          Migration runner
│   ├── seed.ts             Seed script
│   ├── schema/             Table definitions
│   │   ├── index.ts
│   │   ├── users.ts
│   │   ├── tenants.ts
│   │   └── refresh-tokens.ts
│   └── migrations/         Generated SQL migrations (drizzle-kit)
├── middlewares/
│   ├── authenticate.ts     Verify HS256 access token
│   ├── canAccess.ts        Role-based access check
│   ├── parseRefreshToken.ts
│   └── validateRefreshToken.ts  Check refresh token against DB
├── routes/
│   ├── auth.ts
│   ├── user.ts
│   └── tenant.ts
├── services/
│   ├── UserService.ts
│   ├── TenantService.ts
│   ├── TokenService.ts
│   └── CredentialService.ts
├── types/
│   └── index.ts
├── validators/             express-validator schemas
└── utils.ts
```

## Auth flow

- `POST /auth/register` — public; creates user as `member` role.
- `POST /auth/login` — issues `accessToken` (HS256, 1h) + `refreshToken` (HS256, 365d) as httpOnly cookies.
- `GET /auth/self` — current user info (requires accessToken).
- `POST /auth/refresh` — rotates refresh token (deletes old DB row, inserts new one).
- `POST /auth/logout` — clears cookies + deletes server-side refresh token.

Both tokens use HS256 with separate secrets (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`). No key infrastructure required.

## Adding new entities (Drizzle workflow)

1. Add new file in `src/db/schema/<entity>.ts` defining the table.
2. Export from `src/db/schema/index.ts`.
3. Run `npm run db:generate` to create migration SQL in `src/db/migrations/`.
4. Review the generated SQL file.
5. Run `npm run db:migrate` to apply.
6. Create Service, Controller, Routes following existing pattern.

## Docker

```bash
docker build -f docker/dev/Dockerfile -t taskmgmt-server-dev .
docker build -f docker/prod/Dockerfile -t taskmgmt-server-prod .
```
