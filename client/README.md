# Task Management Client

Internal task management system frontend.

**Stack:** React 19 + Vite + TypeScript + Ant Design + TanStack Query + Zustand + React Router

## Quick start

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env
# .env should contain VITE_BACKEND_API_URL=http://localhost:5501

# 3. Start dev
npm run dev
```

Client runs on `http://localhost:5173`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint check |
| `npm test` | Run Vitest (watch) |
| `npm run test:run` | Run Vitest once |

## Project structure

```
src/
├── main.tsx              Entry: React Router + React Query + Antd Theme
├── router.tsx            Route definitions
├── index.css             Global styles
├── store.ts              Zustand store (auth state)
├── type.ts               Shared TypeScript types
├── http/
│   ├── client.ts         Axios instance + interceptors (auto refresh on 401)
│   └── api.ts            API endpoint functions
├── hooks/
│   └── usePermission.ts  Role-based permission helper
├── layouts/
│   ├── Root.tsx          Wraps app, fetches /auth/self on mount
│   ├── Dashboard.tsx     Auth-required layout (sidebar + content)
│   └── NonAuth.tsx       Layout for login/signup pages
├── pages/
│   ├── HomePage.tsx
│   ├── login/
│   │   ├── login.tsx
│   │   └── login.spec.tsx
│   └── users/
│       └── Users.tsx
├── components/
│   └── icons/
└── assets/
```

## Auth flow

1. App mounts → `Root` calls `GET /auth/self` via React Query.
2. If 200 → sets user in Zustand store.
3. If 401 → axios interceptor calls `POST /auth/refresh`; retries original request.
4. If refresh fails → Zustand logout; redirect to `/auth/login`.
5. Login page submits to `POST /auth/login`; on success refetches `self` and stores user.
6. `Dashboard` layout redirects to `/auth/login` if `user === null`.
