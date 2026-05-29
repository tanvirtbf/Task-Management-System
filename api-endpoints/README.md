# API Endpoints — Category Index

This folder breaks `API_DESIGN.md` down into one file per resource category, so you can pick which group of endpoints to build next and see at a glance what's done and what isn't.

**Source of truth:** [../API_DESIGN.md](../API_DESIGN.md). The files here are pointers + checklists. The full spec for any endpoint lives in API_DESIGN.md under the corresponding `§` section number.

---

## How to use this folder

1. Open the README first to pick a category.
2. Open the category file to see every endpoint in it with method, path, auth tier, size estimate, and status checkbox.
3. Decide which endpoint to build next.
4. Hand it to Claude via `PROMPT 2` (planning) → `PROMPT 3` (implementation) → `PROMPT 4` (testing) from `../API_DEVELOPMENT_PROMPTS.md`.
5. Tick the box in the category file when the endpoint is done, tested, and signed off.

---

## Legend

| Symbol | Meaning |
|---|---|
| 🔓 | Public — no authentication required |
| 🔐 | Member — any authenticated user |
| 👑 | Admin — Admin or Owner role |
| 🛡️ | Owner — Owner role only |
| 🤖 | Internal — gated by `X-Internal-Token` header (cron / system) |
| **S** | Small — single-table read/write, no transactions, < 100 LOC |
| **M** | Medium — basic transaction, FK validation, ~150 LOC |
| **L** | Large — multi-table transaction, side effects (activity log / notification), ~300 LOC |
| **XL** | Extra-large — external service (R2 / SMTP), SSE, batch / long-running |
| ☐ | Not started |
| 🟡 | In progress |
| ✅ | Done + tested |

---

## Master index

| # | Category | File | Endpoints | Recommended tier |
|---|---|---|---:|---:|
| 02 | Authentication | [02-authentication.md](02-authentication.md) | 10 | **1 — foundation** |
| 03 | Workspace | [03-workspace.md](03-workspace.md) | 2 | 1 |
| 04 | Users | [04-users.md](04-users.md) | 8 | 1 |
| 05 | Spaces | [05-spaces.md](05-spaces.md) | 7 | **2 — hierarchy** |
| 06 | Lists | [06-lists.md](06-lists.md) | 8 | 2 |
| 07 | Statuses | [07-statuses.md](07-statuses.md) | 5 | 2 |
| 08 | Task types | [08-task-types.md](08-task-types.md) | 4 | 2 |
| 09 | Tags | [09-tags.md](09-tags.md) | 4 | 2 |
| 10 | Tasks | [10-tasks.md](10-tasks.md) | 11 | **3 — core** |
| 11 | Task membership (assignees/watchers/tags) | [11-task-membership.md](11-task-membership.md) | 6 | 3 |
| 12 | Subtasks & dependencies | [12-subtasks-dependencies.md](12-subtasks-dependencies.md) | 3 | 3 |
| 13 | Task activity | [13-task-activity.md](13-task-activity.md) | 1 | 3 |
| 14 | Comments | [14-comments.md](14-comments.md) | 4 | **4 — task content** |
| 15 | Checklists | [15-checklists.md](15-checklists.md) | 9 | 4 |
| 16 | Attachments | [16-attachments.md](16-attachments.md) | 5 | 4 |
| 17 | Custom fields | [17-custom-fields.md](17-custom-fields.md) | 7 | 4 |
| 18 | Forms | [18-forms.md](18-forms.md) | 11 | **5 — features** |
| 19 | Notifications | [19-notifications.md](19-notifications.md) | 9 | 5 |
| 24 | Search | [24-search.md](24-search.md) | 1 | 5 |
| 25 | Home / KPIs | [25-home-kpis.md](25-home-kpis.md) | 2 | 5 |
| 26 | Workspace activity | [26-workspace-activity.md](26-workspace-activity.md) | 2 | 5 |
| 20 | Sprints | [20-sprints.md](20-sprints.md) | 9 | **6 — engineering** |
| 21 | On-call | [21-on-call.md](21-on-call.md) | 4 | 6 |
| 22 | Engineering specials | [22-engineering-specials.md](22-engineering-specials.md) | 3 | 6 |
| 29 | SLA management | [29-sla.md](29-sla.md) | 2 | 6 |
| 23 | Templates | [23-templates.md](23-templates.md) | 6 | **7 — advanced** |
| 27 | SSE (real-time inbox) | [27-sse.md](27-sse.md) | 1 | 7 |
| 28 | Background jobs | [28-background-jobs.md](28-background-jobs.md) | 7 | 7 |
| 30 | Health & diagnostics | [30-health-diagnostics.md](30-health-diagnostics.md) | 4 | **8 — ops** |

**Total endpoints: 155** (148 public + 7 internal jobs).

---

## Suggested implementation order

The categories are grouped into 8 tiers in the table above. Tiers reflect dependency: tier `n` endpoints can usually assume every tier `< n` is implemented and tested.

You can build out of order — every endpoint is self-contained — but tiers minimise the amount of fixture wiring each test has to bootstrap. For example, testing `POST /api/v1/tasks` is much easier when `POST /api/v1/spaces` and `POST /api/v1/lists` already exist (so the test can create a list to put the task into).

**Suggested first 5 endpoints (in order)**:
1. `POST /api/v1/auth/login` — every other test needs a logged-in client
2. `POST /api/v1/auth/refresh` — completes the token-rotation pair
3. `POST /api/v1/auth/logout` — completes the session lifecycle
4. `GET /api/v1/auth/me` — sanity / `whoami` for the frontend
5. `GET /api/v1/workspace` — first non-auth endpoint, tiny

After that the order is your call — the category files surface dependencies so you can plan.

---

## What's already in the codebase

The foundation (middlewares, error envelope, request-id, rate limit, validate bridge, JSON logger, Drizzle schema, test factories) is in place. See `../server/src/` and `../server/tests/test-utils/`. No `/api/v1/*` endpoint is implemented yet — every category in this folder starts at ☐.

When you add a new endpoint, follow the pattern from the existing scaffolding:
- One file per resource in `server/src/controllers/`, `server/src/services/`, `server/src/routes/`, `server/src/validators/`
- Dependency injection: service → controller → router (see how `TokenService` is wired in the existing test fixtures)
- All errors thrown as `AppError` so the global handler renders the spec envelope
- All validation through `express-validator` + the `validate` middleware
