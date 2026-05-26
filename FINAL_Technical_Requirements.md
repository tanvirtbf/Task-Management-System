# Final Technical Requirements — Task Management System

> **Document type:** Software Requirements Specification (SRS) — implementation-ready.
> **Project:** Internal task management system for a Bangladesh-based eCommerce company (Facebook + Website + COD + Courier model). Replaces ClickUp/Trello as the company outgrew Trello and cannot justify ClickUp paid plans.
> **Audience:** Engineering team (and/or Claude as implementer). Document is self-contained — no external context required.
> **Source of truth:** This file supersedes any earlier scoping notes (`ClickUp_Complete_Software_Scan.md`, `Company_Required_Requirements.md`, `ClickUp_for_eCommerce_Company_Complete_Bangla_Guide (1).md`).
> **Date:** May 2026.

---

## Table of Contents

0. [Document Conventions](#0-document-conventions)
1. [Project Context & Goals](#1-project-context--goals)
2. [Scope](#2-scope)
3. [Glossary](#3-glossary)
4. [System Architecture](#4-system-architecture)
5. [Technology Stack](#5-technology-stack)
6. [Database Schema (Complete)](#6-database-schema-complete)
7. [Authentication & Session Management](#7-authentication--session-management)
8. [Authorization Model](#8-authorization-model)
9. [Workspace, Space, Folder, List](#9-workspace-space-folder-list)
10. [Tasks (Core)](#10-tasks-core)
11. [Subtasks & Checklists](#11-subtasks--checklists)
12. [Statuses, Priorities, Task Types, Tags](#12-statuses-priorities-task-types-tags)
13. [Dependencies & Recurring Tasks](#13-dependencies--recurring-tasks)
14. [Comments & Mentions](#14-comments--mentions)
15. [Attachments & File Storage](#15-attachments--file-storage)
16. [Custom Fields Engine](#16-custom-fields-engine)
17. [View System](#17-view-system)
18. [Filters, Sorting, Grouping, Me Mode](#18-filters-sorting-grouping-me-mode)
19. [Forms System](#19-forms-system)
20. [Automation Engine](#20-automation-engine)
21. [Notification System](#21-notification-system)
22. [Real-Time Sync (WebSocket)](#22-real-time-sync-websocket)
23. [Email Integration](#23-email-integration)
24. [Calendar Integration](#24-calendar-integration)
25. [Search](#25-search)
26. [Activity Log](#26-activity-log)
27. [Dashboards & Reporting](#27-dashboards--reporting)
28. [Time Tracking](#28-time-tracking)
29. [Templates](#29-templates)
30. [Webhooks](#30-webhooks)
31. [Inbox, Notepad, Reminders](#31-inbox-notepad-reminders)
32. [Background Jobs / Queue](#32-background-jobs--queue)
33. [API Specification](#33-api-specification)
34. [Frontend Architecture](#34-frontend-architecture)
35. [Page Specifications](#35-page-specifications)
36. [UI Components Library](#36-ui-components-library)
37. [PWA & Mobile](#37-pwa--mobile)
38. [Performance Requirements](#38-performance-requirements)
39. [Security Requirements](#39-security-requirements)
40. [Error Handling Conventions](#40-error-handling-conventions)
41. [Logging & Monitoring](#41-logging--monitoring)
42. [Deployment](#42-deployment)
43. [Testing Strategy](#43-testing-strategy)
44. [Project Structure](#44-project-structure)
45. [V1 Acceptance Criteria](#45-v1-acceptance-criteria)
46. [V2 Roadmap (Out of Scope for V1)](#46-v2-roadmap-out-of-scope-for-v1)

---

## 0. Document Conventions

- **MUST / SHALL** = required for V1
- **SHOULD** = strongly recommended for V1
- **MAY** = optional for V1
- **OUT OF SCOPE** = explicitly not building in V1
- **TBD** = open decision; pick reasonable default
- All times stored as **UTC**; display in user's timezone
- All identifiers are **UUID v7** (time-ordered) unless stated otherwise
- All monetary values stored as **integer minor units** (e.g., paisa for BDT) in `bigint`
- All file sizes in bytes (`bigint`)
- API JSON keys are **snake_case**
- Database identifiers are **snake_case**
- Frontend code uses **camelCase** for variables, **PascalCase** for components

---

## 1. Project Context & Goals

### 1.1 Business Context

- Bangladesh-based eCommerce company.
- Sells via Facebook Page + own Website.
- Payment model: **Cash on Delivery (COD)** dominant; some prepay.
- Fulfillment: third-party couriers (Pathao, Steadfast, RedX, Sundarban).
- Team composition (typical 6–30 people):
  - Operations / Order Processing
  - Inventory & Stock
  - Customer Support
  - Product Listing (photography, content, upload)
  - Marketing (Facebook ads, content calendar)
  - Founder / Admin
- Previously used Trello (too limited) and ClickUp (paid plans too expensive, free plan limits hurt).
- Daily order volume: ~30–300; growing.
- Will introduce this software as an internal AI project.

### 1.2 Primary Goals

1. Replace ClickUp for daily ops without per-seat licensing cost.
2. Support all five team workflows (Orders, Inventory, Support, Listing, Marketing) in one system.
3. Be tailored for eCommerce ops (COD tracking, courier zones, return handling, complaint intake).
4. Reduce manual work via automations (assign on status change, notify on overdue, etc.).
5. Provide owner-level dashboards (orders, COD, returns, stock, complaints).
6. Be accessible from mobile (operations staff in the field).

### 1.3 Non-Goals (Explicitly Not Building)

- A multi-tenant SaaS to sell to other companies.
- A billing/subscription system.
- A plan-tier feature gating mechanism.
- Multi-language UI (English only — team is bilingual but works in English internally).
- Compliance certifications (SOC2/ISO/HIPAA) — internal use only.
- A full Slack-replacement chat platform.
- A Notion-replacement docs platform (basic docs only).
- A Zoom-replacement video conferencing.
- Sprint/Agile reporting (not a dev team).
- AI as a primary product feature (basic AI assist allowed via third-party APIs as add-on later).

### 1.4 Success Criteria

| # | Criterion | Target |
|---|---|---|
| 1 | All 5 team workflows operational | 100% in V1 |
| 2 | Daily orders trackable end-to-end (intake → COD collected) | 100% |
| 3 | Average API response time | ≤ 250 ms p95 |
| 4 | Real-time updates appear in another user's UI | ≤ 1 s |
| 5 | Mobile usable on 3G connection | First load ≤ 5 s |
| 6 | Concurrent users supported | 50 |
| 7 | Total tasks the system handles | 1,000,000+ |
| 8 | Storage for files | 100 GB+ (S3-compatible scalable) |

---

## 2. Scope

### 2.1 In Scope for V1

All features listed across sections 7–37 below are V1. Summary:

- Authentication (email/password, invitation-only signup, 2FA TOTP)
- Hierarchy: Workspace → Space → Folder → List → Task → Subtask (up to 5 levels)
- Tasks: full property set, including custom fields, dependencies, recurring
- Subtasks, Checklists
- 9 views: List, Board, Calendar, Gantt, Table, Workload, Map, Form, Activity
- 13 custom field types
- Forms with conditional logic (public link + embed)
- Automation engine (triggers, conditions, actions)
- Notifications (in-app, email, web push)
- Real-time updates via WebSocket
- Email integration (inbound + outbound)
- Google Calendar 2-way sync
- Search (full-text)
- Dashboards (number, pie, bar, line, table, calculation widgets)
- Time tracking (timer + manual)
- Templates (task, list, checklist)
- Webhooks (outbound only)
- Inbox, Notepad, Reminders
- 4 roles: Owner, Admin, Member, Guest
- PWA-ready frontend
- File attachments (S3-compatible storage)
- Activity log

### 2.2 Out of Scope (V1)

See section [46](#46-v2-roadmap-out-of-scope-for-v1) for V2 roadmap. Explicitly excluded from V1:

- Plan tiers / billing / Stripe
- Multi-workspace
- SAML / SCIM / Okta SSO (Google SSO optional in V1.5)
- Multi-language UI
- Sprints / Agile features (Velocity, Burndown, Burnup)
- AI Notetaker / Super Agents / Brain MAX
- ClickUp Brain full clone (basic AI via Anthropic/OpenAI API is V2)
- Mind Map view, Timeline view, Embed view, Box/Team view, Whiteboard
- Docs (Notion-style) full feature — basic markdown notes only in V1
- Native desktop apps
- Native mobile apps (PWA only)
- Public sharing of tasks/docs to non-users
- Audit log compliance export
- Public API for third-party developers (internal API only)
- OAuth provider (we are NOT issuing tokens to third parties)
- SyncUps voice/video
- Slack/Teams/Discord built-in integrations (use webhooks)
- Import from ClickUp/Trello/Asana/Jira (CSV import only)

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Workspace** | The top-level container. There is exactly one Workspace in V1; the model supports multiple for future flexibility. |
| **Space** | A major department/team within the company (e.g., Operations, Inventory). Has its own statuses, custom fields, tags, and members. |
| **Folder** | Optional grouping inside a Space. |
| **List** | A container for tasks; the workflow unit (e.g., "Facebook Orders", "Stock Master"). Lives directly under a Space or inside a Folder. |
| **Task** | The actionable unit of work. Has name, status, assignees, dates, custom fields, etc. |
| **Subtask** | A task nested under a parent task. Has its own status, assignees, dates. |
| **Checklist** | A lightweight list of items inside a task. Items have text + checkbox + optional single assignee. Not full tasks. |
| **Status** | A workflow state (e.g., "New", "Confirmed", "Packed", "Delivered"). Defined per List/Folder/Space. Belongs to one Status Group. |
| **Status Group** | One of: `not_started`, `active`, `done`, `closed`. Used for system-level aggregation and reporting. |
| **Tag** | A free-form label applied to tasks. Defined per Space; name + color. |
| **Task Type** | A semantic category (e.g., "Order", "Complaint", "Product"). Custom per Workspace; has icon + color. |
| **Custom Field** | A user-defined data attribute on tasks (e.g., "COD Amount", "Courier", "Tracking ID"). |
| **View** | A way of displaying tasks in a List/Folder/Space (List, Board, Calendar, etc.). Each view stores its filters, sort, group, columns. |
| **Form** | A public-facing intake form whose submissions create tasks in a target List. |
| **Automation** | A no-code rule: trigger + optional conditions + actions. |
| **Dashboard** | A custom analytics page with widgets. |
| **Inbox** | A user's unified notification feed. |
| **ClickApp** | A modular feature flag (e.g., "Multiple Assignees", "Time Tracking"). Toggleable per Workspace/Space. |
| **COD** | Cash on Delivery. |

---

## 4. System Architecture

### 4.1 High-Level

```
┌────────────────────────────────────────────────────────────────┐
│                          Clients                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Web (Next.js)│  │ PWA (mobile) │  │ Public Form (Next.js)│  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────┘  │
└─────────┼─────────────────┼────────────────────────┼────────────┘
          │ HTTPS/REST       │ HTTPS                   │ HTTPS
          │ WSS (WebSocket)  │                         │
          ▼                  ▼                         ▼
┌────────────────────────────────────────────────────────────────┐
│                       API Gateway / LB                          │
│                          (nginx)                                │
└──────────────────────────┬─────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                              ▼
   ┌──────────────────┐          ┌────────────────────┐
   │  API Server      │          │ WebSocket Server   │
   │  (Bun + Elysia)  │◄─────────┤ (Bun + Elysia WS)  │
   └────┬─────┬───────┘          └──────────┬─────────┘
        │     │                              │
        │     └──────────────┐               │
        ▼                    ▼               ▼
┌─────────────┐      ┌──────────────┐   ┌─────────────┐
│ PostgreSQL  │      │   Redis      │   │  Workers    │
│  (primary)  │◄─────┤ cache+queue  │◄──┤  (BullMQ)   │
└─────────────┘      └──────────────┘   └──────┬──────┘
                                                │
                                ┌───────────────┼───────────────┐
                                ▼               ▼               ▼
                         ┌─────────────┐ ┌────────────┐ ┌────────────┐
                         │ S3 Storage  │ │ Resend     │ │ Web Push   │
                         │ (R2/MinIO)  │ │ (email)    │ │ (VAPID)    │
                         └─────────────┘ └────────────┘ └────────────┘
```

### 4.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| **Web client** | Main app UI, all views, task editing, real-time updates |
| **PWA** | Same as web, with service worker for offline page caching + push notifications |
| **Public Form** | Standalone routes for public form submissions (no auth) |
| **API Server** | REST API, business logic, auth, permission enforcement, automation triggering |
| **WebSocket Server** | Real-time broadcast (can run in same process as API in V1) |
| **PostgreSQL** | Primary data store (all entities) |
| **Redis** | Session storage, rate limit counters, BullMQ queue, pub/sub for WebSocket fan-out |
| **Workers** | Process queue jobs (email, push, webhook delivery, recurring task generation, calendar sync, automation actions) |
| **S3 Storage** | File attachments, avatars, generated PDFs |
| **Resend / SMTP** | Outbound email |
| **Web Push** | Browser push notifications |

### 4.3 Data Flow Example: User Marks Order as "Packed"

1. Client emits `PATCH /api/tasks/:id { status_id: "packed" }`
2. API server validates auth + permission
3. API server updates `tasks.status_id` in Postgres, writes `activity_log` row
4. API server checks for matching `automations` (trigger = status_changed)
5. Each matching automation is enqueued in BullMQ (`automation:run`)
6. API server emits WebSocket event `task.updated` to all subscribers of the task
7. Worker picks up automation job, evaluates conditions, executes actions (e.g., notify courier team, change priority)
8. Each action that creates a notification enqueues a notification dispatch job
9. Notification worker writes to `notifications` table + delivers via email/push if configured

---

## 5. Technology Stack

### 5.1 Recommended Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Runtime** | Bun 1.1+ | Fast, single binary, native TS, included test runner |
| **API Framework** | ElysiaJS | Type-safe end-to-end, fast, lightweight, native Bun |
| **ORM** | Drizzle ORM | Type-safe SQL, no codegen step, supports Postgres + migrations |
| **Database** | PostgreSQL 16 | Reliable, JSONB for flexible fields, full-text search built-in |
| **Cache / Queue** | Redis 7 + BullMQ | Industry standard; BullMQ supports delayed jobs (needed for due-date triggers) |
| **WebSocket** | Elysia WebSocket (server) + native `WebSocket` (client) | Same runtime as API |
| **File Storage** | Cloudflare R2 (S3-compatible) | Cheap, no egress fees; or MinIO self-hosted |
| **Email Outbound** | Resend (managed) or Nodemailer + SMTP | Resend recommended for reliability |
| **Email Inbound** | Mailgun routes or SendGrid Inbound Parse, or self-hosted Postfix → webhook | Mailgun easiest |
| **Push** | `web-push` library (VAPID) | Standard W3C |
| **Auth** | Custom: JWT (access + refresh) + Argon2 + otplib (TOTP) | No vendor lock-in |
| **Search** | PostgreSQL `tsvector` initially; Meilisearch for V2 | Avoids extra infra in V1 |
| **Frontend Framework** | Next.js 15 (App Router) | Server components, file-based routing, image optimization |
| **UI** | React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui | Component-friendly, accessible, customizable |
| **Data Fetching** | TanStack Query v5 | Caching, optimistic updates, refetching |
| **UI State** | Zustand | Lightweight, no boilerplate |
| **Forms** | react-hook-form + Zod | Type-safe validation |
| **Drag-Drop** | dnd-kit | Accessible, lightweight, works for Kanban + nesting |
| **Tables** | TanStack Table v8 | Headless, supports virtualization |
| **Calendar** | FullCalendar (React) | Battle-tested, drag-to-reschedule built-in |
| **Gantt** | `frappe-gantt` or `gantt-task-react` | Open source |
| **Map** | MapLibre GL JS + OpenFreeMap or Mapbox | Free tier; Google Maps as fallback if budget |
| **Charts** | Recharts | React-native; sufficient for V1 |
| **Rich Text** | Tiptap (ProseMirror) | Notion-like blocks, JSON storage |
| **Date/Time** | date-fns + date-fns-tz | Tree-shakeable, timezone-aware |
| **Validation (shared)** | Zod | Same schema for frontend + backend |
| **Containerization** | Docker + docker-compose | Standard, single VPS deploy |
| **Reverse Proxy** | Caddy or Nginx | Caddy = automatic HTTPS |
| **Monitoring** | Sentry (errors) + simple Prometheus + Grafana (V2) | Sentry is enough for V1 |

### 5.2 Acceptable Substitutions

- Runtime: Node.js 22 + Fastify acceptable if team prefers; data model unchanged.
- ORM: Prisma acceptable. Drizzle preferred for raw SQL flexibility on complex aggregations.
- Email: Postmark / AWS SES acceptable.

### 5.3 Repository Structure

```
task-management-system/
├── apps/
│   ├── api/              # Bun + Elysia backend
│   ├── web/              # Next.js frontend
│   └── workers/          # BullMQ workers
├── packages/
│   ├── db/               # Drizzle schema + migrations
│   ├── shared/           # Shared types, Zod schemas, constants
│   └── ui/               # Shared UI components (if needed across apps)
├── docker/
│   ├── docker-compose.yml
│   └── Dockerfile.*
├── docs/
│   └── (this file lives here)
├── .env.example
├── package.json
├── bunfig.toml
└── README.md
```

Use a monorepo manager (Turborepo or just Bun workspaces).

---

## 6. Database Schema (Complete)

> All tables use UUID v7 primary keys unless noted. All tables have `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` unless noted. `updated_at` is maintained by a generic trigger.

### 6.1 Identity

#### `users`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | varchar(320) | UNIQUE, NOT NULL, citext-style case-insensitive index |
| password_hash | varchar(255) | NOT NULL (Argon2id) |
| name | varchar(200) | NOT NULL |
| avatar_url | varchar(500) | NULL |
| phone | varchar(32) | NULL |
| timezone | varchar(64) | NOT NULL, default `'Asia/Dhaka'` |
| locale | varchar(8) | NOT NULL, default `'en'` |
| status | enum | NOT NULL, default `'active'`. Values: `active`, `deactivated`, `invited` |
| role | enum | NOT NULL. Values: `owner`, `admin`, `member`, `guest` |
| two_factor_enabled | boolean | NOT NULL, default false |
| two_factor_secret | varchar(255) | NULL, encrypted (column-level encryption via pgcrypto or app-level) |
| two_factor_backup_codes | jsonb | NULL, array of hashed codes |
| email_verified_at | timestamptz | NULL |
| last_login_at | timestamptz | NULL |
| password_changed_at | timestamptz | NOT NULL, default now() |
| deleted_at | timestamptz | NULL (soft delete) |

Indexes: `(email)`, `(status) WHERE status = 'active'`

#### `sessions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id), NOT NULL |
| refresh_token_hash | varchar(255) | NOT NULL, UNIQUE |
| ip_address | inet | NULL |
| user_agent | text | NULL |
| expires_at | timestamptz | NOT NULL |
| revoked_at | timestamptz | NULL |
| last_used_at | timestamptz | NOT NULL, default now() |

Indexes: `(user_id, expires_at)`, `(refresh_token_hash)`

#### `password_resets`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id), NOT NULL |
| token_hash | varchar(255) | NOT NULL, UNIQUE |
| expires_at | timestamptz | NOT NULL |
| used_at | timestamptz | NULL |

#### `invitations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | varchar(320) | NOT NULL |
| role | enum | NOT NULL (admin/member/guest) |
| invited_by | uuid | FK users(id) |
| token_hash | varchar(255) | NOT NULL, UNIQUE |
| space_ids | uuid[] | NULL — pre-assigned Spaces |
| expires_at | timestamptz | NOT NULL |
| accepted_at | timestamptz | NULL |

Indexes: `(email) WHERE accepted_at IS NULL`

#### `push_subscriptions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id), NOT NULL |
| endpoint | varchar(500) | NOT NULL, UNIQUE |
| p256dh_key | varchar(255) | NOT NULL |
| auth_key | varchar(255) | NOT NULL |
| user_agent | varchar(500) | NULL |
| last_used_at | timestamptz | NOT NULL, default now() |

### 6.2 Hierarchy

#### `workspaces`

(Single row in V1, modeled for future flexibility.)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar(200) | NOT NULL |
| logo_url | varchar(500) | NULL |
| settings | jsonb | NOT NULL, default `'{}'` |

#### `spaces`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK workspaces(id) NOT NULL |
| name | varchar(200) | NOT NULL |
| description | text | NULL |
| icon | varchar(50) | NULL (icon name) |
| color | varchar(7) | NULL (hex) |
| is_private | boolean | NOT NULL default false |
| position | integer | NOT NULL default 0 |
| archived_at | timestamptz | NULL |
| created_by | uuid | FK users(id) |

Indexes: `(workspace_id, archived_at, position)`

#### `space_members`

| Column | Type | Constraints |
|---|---|---|
| space_id | uuid | FK spaces(id) ON DELETE CASCADE |
| user_id | uuid | FK users(id) ON DELETE CASCADE |
| permission | enum | NOT NULL, default `'edit'`. Values: `view`, `comment`, `edit`, `full` |
| added_at | timestamptz | NOT NULL default now() |

PK: (space_id, user_id)

#### `folders`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| space_id | uuid | FK spaces(id) NOT NULL |
| parent_folder_id | uuid | FK folders(id) NULL |
| name | varchar(200) | NOT NULL |
| position | integer | NOT NULL default 0 |
| archived_at | timestamptz | NULL |

Indexes: `(space_id, parent_folder_id, position)`

#### `lists`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| space_id | uuid | FK spaces(id) NOT NULL |
| folder_id | uuid | FK folders(id) NULL |
| name | varchar(200) | NOT NULL |
| description | text | NULL |
| icon | varchar(50) | NULL |
| color | varchar(7) | NULL |
| position | integer | NOT NULL default 0 |
| default_task_type_id | uuid | FK task_types(id) NULL |
| is_private | boolean | NOT NULL default false |
| archived_at | timestamptz | NULL |
| created_by | uuid | FK users(id) |

Indexes: `(space_id, folder_id, position)`

### 6.3 Statuses, Types, Tags

#### `statuses`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| scope_type | enum | NOT NULL. Values: `space`, `folder`, `list` |
| scope_id | uuid | NOT NULL |
| name | varchar(60) | NOT NULL |
| color | varchar(7) | NOT NULL |
| status_group | enum | NOT NULL. Values: `not_started`, `active`, `done`, `closed` |
| position | integer | NOT NULL default 0 |

Indexes: `(scope_type, scope_id, position)`
Constraint: each scope can have at most one status with `status_group='closed'`.

#### `task_types`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK workspaces(id) NOT NULL |
| name | varchar(16) | NOT NULL |
| description | varchar(100) | NULL |
| icon | varchar(50) | NOT NULL |
| color | varchar(7) | NOT NULL |
| is_milestone_type | boolean | NOT NULL default false |
| is_system | boolean | NOT NULL default false (true for built-ins) |

Seed (V1):
- Task (system, default)
- Milestone (system, is_milestone_type=true)
- Order
- Complaint
- Product Listing
- Campaign
- Return

#### `tags`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| space_id | uuid | FK spaces(id) NOT NULL |
| name | varchar(60) | NOT NULL |
| color | varchar(7) | NOT NULL |

Index: `(space_id, lower(name))` UNIQUE

### 6.4 Tasks

#### `tasks`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK workspaces(id) NOT NULL |
| primary_list_id | uuid | FK lists(id) NOT NULL |
| parent_task_id | uuid | FK tasks(id) NULL (self-reference for subtasks) |
| task_number | bigint | NOT NULL (workspace-scoped sequence) |
| name | varchar(1024) | NOT NULL |
| description | jsonb | NULL (Tiptap JSON) |
| status_id | uuid | FK statuses(id) NOT NULL |
| priority | smallint | NOT NULL default 0 — `0=None, 1=Urgent, 2=High, 3=Normal, 4=Low` |
| task_type_id | uuid | FK task_types(id) NOT NULL |
| start_date | timestamptz | NULL |
| due_date | timestamptz | NULL |
| time_estimate_seconds | integer | NULL |
| time_tracked_seconds | integer | NOT NULL default 0 (denormalized aggregate) |
| is_milestone | boolean | NOT NULL default false |
| recurrence_rule_id | uuid | FK recurrence_rules(id) NULL |
| recurring_parent_id | uuid | FK tasks(id) NULL (link to source if regenerated) |
| nesting_depth | smallint | NOT NULL default 0 (0 = top task, max 4 = 5th level) |
| position | numeric(20, 10) | NOT NULL default 0 (fractional indexing for drag-drop) |
| completed_at | timestamptz | NULL |
| completed_by | uuid | FK users(id) NULL |
| created_by | uuid | FK users(id) NOT NULL |
| archived_at | timestamptz | NULL |
| deleted_at | timestamptz | NULL (soft delete; hard delete after 30 days via cron) |

Indexes:
- `(primary_list_id, position) WHERE archived_at IS NULL AND deleted_at IS NULL`
- `(parent_task_id)` for subtasks
- `(due_date) WHERE deleted_at IS NULL` — for due-date triggers
- `(status_id)` — for filtering
- `(workspace_id, task_number)` UNIQUE
- GIN on `(to_tsvector('english', name || ' ' || coalesce(description::text, '')))` for FTS

Constraints:
- `nesting_depth <= 4`
- `name` length >= 1
- If `parent_task_id` IS NULL, `nesting_depth = 0`

#### `task_list_memberships`

For Tasks-in-Multiple-Lists.

| Column | Type | Constraints |
|---|---|---|
| task_id | uuid | FK tasks(id) ON DELETE CASCADE |
| list_id | uuid | FK lists(id) ON DELETE CASCADE |
| is_primary | boolean | NOT NULL default false |
| added_at | timestamptz | NOT NULL default now() |

PK: (task_id, list_id)
Constraint: at least one row per task must have `is_primary=true`; enforce via trigger.

#### `task_assignees`

| Column | Type | Constraints |
|---|---|---|
| task_id | uuid | FK ON DELETE CASCADE |
| user_id | uuid | FK ON DELETE CASCADE |
| assigned_by | uuid | FK users(id) |
| assigned_at | timestamptz | NOT NULL default now() |

PK: (task_id, user_id)

#### `task_watchers`

| Column | Type | Constraints |
|---|---|---|
| task_id | uuid | FK ON DELETE CASCADE |
| user_id | uuid | FK ON DELETE CASCADE |
| auto_added | boolean | NOT NULL default true |
| added_at | timestamptz | NOT NULL default now() |

PK: (task_id, user_id)

#### `task_tags`

PK: (task_id, tag_id)

#### `task_relationships`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| source_task_id | uuid | FK tasks(id) NOT NULL |
| target_task_id | uuid | FK tasks(id) NOT NULL |
| type | enum | NOT NULL. Values: `waiting_on`, `linked` |
| created_by | uuid | FK users(id) |

UNIQUE (source_task_id, target_task_id, type)
Constraint: source ≠ target.

Note: `blocking` is computed as inverse of `waiting_on` (no separate row).

#### `recurrence_rules`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| rrule | text | NOT NULL (RFC 5545 RRULE) |
| trigger_mode | enum | NOT NULL. Values: `on_schedule`, `when_complete` |
| regenerate_mode | enum | NOT NULL. Values: `new_task`, `same_task` |
| end_after_occurrences | integer | NULL |
| end_by_date | timestamptz | NULL |
| last_generated_at | timestamptz | NULL |
| total_occurrences | integer | NOT NULL default 0 |

#### `checklists`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| task_id | uuid | FK tasks(id) ON DELETE CASCADE NOT NULL |
| name | varchar(200) | NOT NULL |
| position | integer | NOT NULL default 0 |

#### `checklist_items`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| checklist_id | uuid | FK ON DELETE CASCADE NOT NULL |
| parent_item_id | uuid | FK checklist_items(id) NULL (5 levels nested) |
| text | varchar(1024) | NOT NULL |
| is_completed | boolean | NOT NULL default false |
| assignee_id | uuid | FK users(id) NULL |
| position | numeric(20, 10) | NOT NULL default 0 |
| completed_at | timestamptz | NULL |
| completed_by | uuid | FK users(id) NULL |
| nesting_depth | smallint | NOT NULL default 0 (max 4) |

Index: `(checklist_id, position)`

### 6.5 Custom Fields

#### `custom_fields`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| scope_type | enum | NOT NULL. Values: `workspace`, `space`, `list` |
| scope_id | uuid | NULL (NULL for workspace scope) |
| name | varchar(100) | NOT NULL |
| type | enum | NOT NULL. Values: `text`, `long_text`, `number`, `money`, `date`, `dropdown`, `labels`, `checkbox`, `phone`, `url`, `files`, `people`, `location`, `formula`, `progress`, `rating`, `email` |
| config | jsonb | NOT NULL default `'{}'` — type-specific config |
| is_required | boolean | NOT NULL default false |
| default_value | jsonb | NULL |
| position | integer | NOT NULL default 0 |
| hidden_from_guests | boolean | NOT NULL default false |
| created_by | uuid | FK users(id) |

Indexes: `(scope_type, scope_id, position)`

`config` examples by type:
- `money`: `{ "currency": "BDT", "precision": 2 }`
- `dropdown`: `{}` (options stored in `custom_field_options`)
- `progress`: `{ "method": "manual", "start": 0, "end": 100 }` or `{ "method": "automatic", "source": "subtasks" }`
- `formula`: `{ "expression": "field('order_value') - field('discount')" }`
- `rating`: `{ "max": 5, "icon": "star" }`
- `number`: `{ "precision": 0 }`
- `date`: `{ "include_time": true }`

#### `custom_field_options`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| custom_field_id | uuid | FK ON DELETE CASCADE NOT NULL |
| label | varchar(100) | NOT NULL |
| color | varchar(7) | NULL |
| position | integer | NOT NULL default 0 |

Constraint: max 500 options per custom_field_id (enforce in app).

#### `custom_field_values`

| Column | Type | Constraints |
|---|---|---|
| task_id | uuid | FK tasks(id) ON DELETE CASCADE NOT NULL |
| custom_field_id | uuid | FK custom_fields(id) ON DELETE CASCADE NOT NULL |
| value | jsonb | NOT NULL |
| updated_by | uuid | FK users(id) |
| updated_at | timestamptz | NOT NULL default now() |

PK: (task_id, custom_field_id)

Value JSON shapes by field type:
- text/long_text/url/email/phone: `{ "text": "..." }`
- number: `{ "number": 123.45 }`
- money: `{ "amount": 120000, "currency": "BDT" }` (integer minor units)
- date: `{ "date": "2026-05-30T10:00:00Z", "include_time": true }`
- dropdown: `{ "option_id": "uuid" }`
- labels: `{ "option_ids": ["uuid1", "uuid2"] }`
- checkbox: `{ "checked": true }`
- files: `{ "attachment_ids": ["uuid"] }`
- people: `{ "user_ids": ["uuid"] }`
- location: `{ "lat": 23.81, "lng": 90.41, "formatted_address": "Mirpur, Dhaka", "place_id": "..." }`
- progress (manual): `{ "current": 45, "start": 0, "end": 100 }`
- progress (automatic): `{ "current": 0.6 }` (computed; read-only)
- rating: `{ "value": 4 }`
- formula: `{ "value": 1200 }` (computed; read-only)

### 6.6 Comments

#### `comments`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| task_id | uuid | FK tasks(id) NULL |
| doc_id | uuid | FK docs(id) NULL (V2; nullable for V1) |
| parent_comment_id | uuid | FK comments(id) NULL |
| author_id | uuid | FK users(id) NOT NULL |
| body | jsonb | NOT NULL (Tiptap JSON) |
| assigned_to | uuid | FK users(id) NULL |
| resolved_at | timestamptz | NULL |
| resolved_by | uuid | FK users(id) NULL |
| edited_at | timestamptz | NULL |
| deleted_at | timestamptz | NULL |

Constraint: at least one of (task_id, doc_id) is non-null.
Indexes: `(task_id, created_at)`, `(assigned_to) WHERE resolved_at IS NULL`

#### `comment_reactions`

| Column | Type | Constraints |
|---|---|---|
| comment_id | uuid | FK ON DELETE CASCADE |
| user_id | uuid | FK ON DELETE CASCADE |
| emoji | varchar(20) | NOT NULL |

PK: (comment_id, user_id, emoji)

#### `comment_mentions`

| Column | Type | Constraints |
|---|---|---|
| comment_id | uuid | FK ON DELETE CASCADE |
| mentioned_user_id | uuid | FK users(id) ON DELETE CASCADE |

PK: (comment_id, mentioned_user_id)

### 6.7 Attachments

#### `attachments`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| task_id | uuid | FK tasks(id) NULL |
| comment_id | uuid | FK comments(id) NULL |
| form_submission_id | uuid | FK NULL |
| filename | varchar(255) | NOT NULL |
| mime_type | varchar(127) | NOT NULL |
| size_bytes | bigint | NOT NULL |
| storage_key | varchar(500) | NOT NULL (S3 object key) |
| thumbnail_key | varchar(500) | NULL |
| width | integer | NULL (for images) |
| height | integer | NULL |
| uploaded_by | uuid | FK users(id) NOT NULL |

Indexes: `(task_id)`, `(comment_id)`

### 6.8 Views, Forms

#### `views`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| scope_type | enum | NOT NULL. Values: `list`, `folder`, `space`, `workspace`, `everything` |
| scope_id | uuid | NULL for `workspace`/`everything` |
| type | enum | NOT NULL. Values: `list`, `board`, `calendar`, `gantt`, `table`, `workload`, `map`, `form`, `activity` |
| name | varchar(100) | NOT NULL |
| is_default | boolean | NOT NULL default false |
| is_protected | boolean | NOT NULL default false |
| is_private | boolean | NOT NULL default false |
| owner_id | uuid | FK users(id) NULL (set if is_private) |
| config | jsonb | NOT NULL default `'{}'` — view-specific config |
| filters | jsonb | NOT NULL default `'{"groups":[]}'` |
| sort | jsonb | NOT NULL default `'[]'` |
| group_by | varchar(100) | NULL |
| columns | jsonb | NOT NULL default `'[]'` — for list/table |
| position | integer | NOT NULL default 0 |
| created_by | uuid | FK users(id) |

`filters` JSON shape (see [§18.1](#181-filter-schema)).

#### `view_shares`

| Column | Type | Constraints |
|---|---|---|
| view_id | uuid | FK ON DELETE CASCADE |
| user_id | uuid | FK ON DELETE CASCADE |
| permission | enum | NOT NULL. Values: `full`, `limited` |

PK: (view_id, user_id)

#### `forms`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| list_id | uuid | FK lists(id) NOT NULL — target list for submissions |
| view_id | uuid | FK views(id) NOT NULL (1-to-1) |
| title | varchar(200) | NOT NULL |
| description | text | NULL |
| is_public | boolean | NOT NULL default true |
| public_slug | varchar(64) | UNIQUE NOT NULL |
| branding | jsonb | NOT NULL default `'{}'` |
| settings | jsonb | NOT NULL default `'{}'` — `{redirect_url, allow_anonymous, enable_recaptcha, require_login}` |
| submission_count | integer | NOT NULL default 0 |
| created_by | uuid | FK users(id) |

#### `form_fields`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| form_id | uuid | FK ON DELETE CASCADE NOT NULL |
| field_kind | enum | NOT NULL. Values: `task_attr`, `custom_field` |
| field_key | varchar(100) | NOT NULL — task attr name (e.g. `name`, `assignees`) or custom_field_id |
| label | varchar(200) | NOT NULL |
| help_text | varchar(500) | NULL |
| is_required | boolean | NOT NULL default false |
| is_hidden | boolean | NOT NULL default false |
| default_value | jsonb | NULL |
| conditional_logic | jsonb | NULL — `[{trigger_field, operator, value, action: "show"|"hide"}]` |
| position | integer | NOT NULL default 0 |

#### `form_submissions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| form_id | uuid | FK NOT NULL |
| task_id | uuid | FK tasks(id) NULL (set after task creation) |
| submitter_email | varchar(320) | NULL |
| submitter_ip | inet | NULL |
| user_agent | text | NULL |
| data | jsonb | NOT NULL |
| recaptcha_score | numeric(3,2) | NULL |
| submitted_at | timestamptz | NOT NULL default now() |

### 6.9 Automations

#### `automations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| scope_type | enum | NOT NULL. Values: `space`, `folder`, `list` |
| scope_id | uuid | NOT NULL |
| name | varchar(200) | NOT NULL |
| description | text | NULL |
| is_active | boolean | NOT NULL default true |
| trigger | jsonb | NOT NULL — `{ "type": "...", "config": {...} }` |
| conditions | jsonb | NOT NULL default `'[]'` |
| actions | jsonb | NOT NULL default `'[]'` |
| last_run_at | timestamptz | NULL |
| run_count | bigint | NOT NULL default 0 |
| created_by | uuid | FK users(id) |

#### `automation_runs`

| Column | Type | Constraints |
|---|---|---|
| id | bigserial | PK |
| automation_id | uuid | FK NOT NULL |
| trigger_event | jsonb | NOT NULL |
| status | enum | NOT NULL. Values: `success`, `failed`, `skipped`, `conditions_not_met` |
| actions_log | jsonb | NOT NULL default `'[]'` |
| error | text | NULL |
| duration_ms | integer | NULL |
| started_at | timestamptz | NOT NULL default now() |
| finished_at | timestamptz | NULL |

Indexes: `(automation_id, started_at DESC)`. Retain 30 days; older purged by worker.

### 6.10 Notifications, Activity, Audit

#### `notifications`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK NOT NULL |
| type | varchar(50) | NOT NULL — see [§21.2](#212-notification-types) |
| entity_type | varchar(50) | NOT NULL |
| entity_id | uuid | NOT NULL |
| actor_id | uuid | FK users(id) NULL |
| title | varchar(500) | NOT NULL |
| body | text | NULL |
| payload | jsonb | NOT NULL default `'{}'` |
| is_read | boolean | NOT NULL default false |
| read_at | timestamptz | NULL |
| is_archived | boolean | NOT NULL default false |
| snoozed_until | timestamptz | NULL |
| delivered_channels | jsonb | NOT NULL default `'[]'` — array of `{channel, delivered_at}` |

Indexes:
- `(user_id, is_read, created_at DESC) WHERE is_read = false AND is_archived = false`
- `(user_id, is_archived, created_at DESC)`
- `(snoozed_until) WHERE snoozed_until IS NOT NULL`

#### `notification_settings`

| Column | Type | Constraints |
|---|---|---|
| user_id | uuid | PK, FK users(id) |
| channels | jsonb | NOT NULL — per-trigger channel mapping |
| dnd_start_time | time | NULL |
| dnd_end_time | time | NULL |
| smart_notifications | boolean | NOT NULL default true |
| auto_follow | jsonb | NOT NULL default `'{}'` |

Default `channels`:
```json
{
  "assigned":       {"in_app": true, "email": true, "push": true},
  "mentioned":      {"in_app": true, "email": true, "push": true},
  "comment":        {"in_app": true, "email": false, "push": false},
  "status_change":  {"in_app": true, "email": false, "push": false},
  "due_soon":       {"in_app": true, "email": true, "push": true},
  "overdue":        {"in_app": true, "email": true, "push": true}
}
```

#### `activity_log`

| Column | Type | Constraints |
|---|---|---|
| id | bigserial | PK |
| workspace_id | uuid | FK NOT NULL |
| entity_type | varchar(50) | NOT NULL |
| entity_id | uuid | NOT NULL |
| action | varchar(50) | NOT NULL |
| changes | jsonb | NULL — `{"field": {"before": x, "after": y}}` |
| actor_id | uuid | FK users(id) NULL (NULL for system actions) |
| context | jsonb | NOT NULL default `'{}'` |

Indexes:
- `(entity_type, entity_id, created_at DESC)`
- `(workspace_id, created_at DESC)`
- `(actor_id, created_at DESC)`

Retain 1 year; older partitioned away.

### 6.11 Time Tracking, Reminders, Notepad

#### `time_entries`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| task_id | uuid | FK tasks(id) NULL |
| user_id | uuid | FK NOT NULL |
| description | varchar(500) | NULL |
| start_time | timestamptz | NOT NULL |
| end_time | timestamptz | NULL (NULL = currently running) |
| duration_seconds | integer | NOT NULL (computed on stop or manual entry) |
| is_billable | boolean | NOT NULL default false |
| tags | text[] | NOT NULL default `'{}'` |

Indexes: `(user_id, start_time DESC)`, `(task_id, start_time DESC)`, `(user_id) WHERE end_time IS NULL`

Constraint: at most one row per user with `end_time IS NULL` (one running timer per user).

#### `reminders`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK NOT NULL (owner) |
| assigned_to | uuid | FK users(id) NOT NULL (defaults to user_id) |
| task_id | uuid | FK tasks(id) NULL |
| title | varchar(500) | NOT NULL |
| notes | text | NULL |
| due_at | timestamptz | NOT NULL |
| recurrence | jsonb | NULL |
| is_completed | boolean | NOT NULL default false |
| completed_at | timestamptz | NULL |
| notification_sent_at | timestamptz | NULL |

Indexes: `(assigned_to, due_at) WHERE is_completed = false`

#### `notepad_notes`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK NOT NULL |
| title | varchar(200) | NULL |
| content | jsonb | NOT NULL (Tiptap JSON) |
| position | integer | NOT NULL default 0 |

### 6.12 Templates, Webhooks, Integrations

#### `templates`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| type | enum | NOT NULL. Values: `task`, `list`, `folder`, `space`, `checklist`, `view`, `form` |
| name | varchar(200) | NOT NULL |
| description | text | NULL |
| structure | jsonb | NOT NULL — serialized template definition |
| sharing | enum | NOT NULL default `'members'`. Values: `private`, `members`, `admins` |
| created_by | uuid | FK users(id) |

#### `webhooks`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| url | varchar(2000) | NOT NULL |
| events | text[] | NOT NULL — array of event types |
| secret | varchar(64) | NOT NULL (for HMAC SHA-256) |
| is_active | boolean | NOT NULL default true |
| fail_count | integer | NOT NULL default 0 |
| last_success_at | timestamptz | NULL |
| last_failure_at | timestamptz | NULL |
| created_by | uuid | FK users(id) |

#### `webhook_deliveries`

| Column | Type | Constraints |
|---|---|---|
| id | bigserial | PK |
| webhook_id | uuid | FK NOT NULL |
| event_type | varchar(50) | NOT NULL |
| payload | jsonb | NOT NULL |
| response_status | integer | NULL |
| response_body | text | NULL |
| attempt_count | integer | NOT NULL default 1 |
| delivered_at | timestamptz | NULL |
| failed_at | timestamptz | NULL |
| next_retry_at | timestamptz | NULL |

#### `email_integrations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK NOT NULL |
| provider | enum | NOT NULL. Values: `gmail`, `outlook`, `imap_smtp` |
| email | varchar(320) | NOT NULL |
| oauth_tokens | jsonb | NULL (encrypted) |
| imap_config | jsonb | NULL (encrypted) — `{host, port, ssl, username, password}` |
| smtp_config | jsonb | NULL (encrypted) |
| is_active | boolean | NOT NULL default true |

#### `email_to_task_addresses`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| scope_type | enum | NOT NULL. Values: `workspace`, `space`, `list`, `task` |
| scope_id | uuid | NOT NULL |
| local_part | varchar(64) | NOT NULL UNIQUE — used as inbound address |
| created_by | uuid | FK users(id) |

Inbound address format: `{local_part}@inbox.yourdomain.com`

#### `calendar_integrations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK NOT NULL |
| provider | enum | NOT NULL. Values: `google`, `outlook` |
| calendar_id | varchar(255) | NOT NULL |
| calendar_name | varchar(255) | NULL |
| oauth_tokens | jsonb | NOT NULL (encrypted) |
| sync_direction | enum | NOT NULL default `'both'`. Values: `import`, `export`, `both` |
| sync_scope | jsonb | NOT NULL — `{ list_ids: [], space_ids: [], folder_ids: [] }` |
| last_synced_at | timestamptz | NULL |
| sync_token | varchar(255) | NULL (Google incremental sync) |

### 6.13 Dashboards

#### `dashboards`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | FK NOT NULL |
| scope_type | enum | NOT NULL default `'workspace'`. Values: `workspace`, `space` |
| scope_id | uuid | NULL |
| name | varchar(200) | NOT NULL |
| description | text | NULL |
| is_private | boolean | NOT NULL default true |
| filters | jsonb | NOT NULL default `'{}'` — dashboard-wide filters |
| date_range | jsonb | NOT NULL default `'{"preset": "this_week"}'` |
| created_by | uuid | FK users(id) |

#### `dashboard_widgets`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| dashboard_id | uuid | FK ON DELETE CASCADE NOT NULL |
| type | enum | NOT NULL. Values: `number`, `pie`, `bar`, `line`, `area`, `table`, `task_list`, `calculation`, `embed`, `text` |
| title | varchar(200) | NULL |
| config | jsonb | NOT NULL |
| position | jsonb | NOT NULL — `{ "x": 0, "y": 0, "w": 4, "h": 2 }` (12-col grid) |

### 6.14 ClickApps / Settings

#### `clickapp_settings`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| scope_type | enum | NOT NULL. Values: `workspace`, `space` |
| scope_id | uuid | NOT NULL |
| clickapp_key | varchar(50) | NOT NULL |
| is_enabled | boolean | NOT NULL default true |
| config | jsonb | NOT NULL default `'{}'` |

UNIQUE (scope_type, scope_id, clickapp_key)

V1 ClickApps (all default enabled unless noted):
- `multiple_assignees` (default ON)
- `custom_fields` (ON)
- `dependencies` (ON)
- `reschedule_dependencies` (OFF)
- `dependency_warning` (ON)
- `time_tracking` (ON)
- `time_estimates` (ON)
- `tasks_in_multiple_lists` (OFF)
- `nested_subtasks` (ON; config: `{"max_depth": 5}`)
- `tags` (ON)
- `priorities` (ON)
- `milestones` (ON)
- `recurring_tasks` (ON)
- `forms` (ON)
- `automations` (ON)
- `comment_reactions` (ON)
- `threaded_comments` (ON)
- `email_in_task` (ON)
- `google_calendar` (ON)
- `webhooks` (ON)

### 6.15 Search

#### Full-Text Search

V1 uses Postgres `tsvector` columns maintained by triggers.

```sql
ALTER TABLE tasks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description::text, '')), 'B')
  ) STORED;

CREATE INDEX tasks_search_idx ON tasks USING GIN(search_vector);
```

Similar for `comments`, `docs` (V2), `notepad_notes`.

---

## 7. Authentication & Session Management

### 7.1 Signup (Invitation-Only)

Public signup is **disabled**. The first user is created via seed script (CLI). All other users are invited.

**Flow:**

1. Admin/Owner clicks "Invite User" → fills email + role + optional space assignments.
2. Backend creates `invitations` row with `token = randomBytes(32).toString('base64url')`. Stores `token_hash` only (SHA-256).
3. Email sent with link: `https://app/invite/accept?token={raw}`.
4. Recipient opens link → page renders "Set Password" form (name + password + confirm).
5. POST `/api/auth/accept-invitation`:
   - Validates token (lookup by hash, check expiry, check `accepted_at IS NULL`).
   - Creates `users` row (status=`active`, role from invitation, password_hash via Argon2id).
   - Auto-adds to assigned Spaces.
   - Marks invitation accepted.
   - Issues access + refresh tokens.
6. Redirect to `/` (workspace home).

### 7.2 Login

POST `/api/auth/login` with `{ email, password }`.

1. Lookup user by email (case-insensitive).
2. Verify Argon2id hash.
3. If `two_factor_enabled`:
   - Return `{ requires_2fa: true, mfa_token: "<short-lived JWT 5min>" }` (don't issue access token yet).
   - Client prompts for TOTP code.
   - POST `/api/auth/2fa/verify` with `{ mfa_token, code }`.
   - Verify with `otplib.authenticator.check(code, secret)` (allow ±1 step window).
   - Issue tokens.
4. Else issue tokens immediately.

### 7.3 Token Strategy

- **Access token:** JWT signed HS256, 15-min expiry, payload `{ sub: user_id, role, jti, iat, exp }`.
- **Refresh token:** Opaque random 32-byte, stored in DB (`sessions.refresh_token_hash` = SHA-256 of raw). 30-day expiry.
- **Storage on client:**
  - Access token in **httpOnly + Secure + SameSite=Lax cookie** named `at`.
  - Refresh token in **httpOnly + Secure + SameSite=Strict cookie** named `rt`.
- **Refresh flow:** POST `/api/auth/refresh` → validate `rt` cookie → check session not revoked → rotate refresh token (revoke old, issue new) → return new access token.
- **Logout:** POST `/api/auth/logout` → revoke current session → clear both cookies.
- **CSRF:** Use `SameSite=Lax` + double-submit cookie pattern for state-changing requests (header `X-CSRF-Token`).

### 7.4 Password Reset

POST `/api/auth/forgot-password { email }` → always returns 200 (no email enumeration). If user exists, send email with reset link.
POST `/api/auth/reset-password { token, new_password }` → validate, update password_hash, revoke all sessions, send confirmation email.

### 7.5 2FA Setup

POST `/api/auth/2fa/setup` (auth'd):
- Generate secret: `otplib.authenticator.generateSecret()`.
- Generate provisioning URI for QR: `otplib.authenticator.keyuri(email, 'TaskMgmt', secret)`.
- Return `{ secret, qr_uri }`. Don't enable yet.
POST `/api/auth/2fa/enable { code }`:
- Verify code matches secret.
- Set `users.two_factor_enabled = true`, `two_factor_secret = encrypt(secret)`.
- Generate 10 backup codes, store hashes, return raw to user **once**.

POST `/api/auth/2fa/disable { password }` (password reverification required).

### 7.6 Password Policy

- Minimum 10 characters.
- Must contain at least one of each: lowercase, uppercase, digit, special.
- Check against known-breached list (haveibeenpwned API optional V2).
- Argon2id parameters: `memory=64MB, iterations=3, parallelism=2`.

---

## 8. Authorization Model

### 8.1 Role Hierarchy

| Role | Capability |
|---|---|
| **Owner** | Single user. Workspace-level admin. Can transfer ownership, delete workspace (disabled in V1). Cannot be deactivated by others. |
| **Admin** | Manage users, integrations, ClickApps, automations. Cannot delete the workspace or change owner. |
| **Member** | Create/edit content in assigned Spaces. Cannot manage users or workspace settings. |
| **Guest** | Restricted access; explicit item-level shares only. Cannot see workspace member list. |

### 8.2 Permission Resolution Algorithm

When checking "can user U perform action A on entity E":

1. If U.status ≠ active → DENY.
2. If U.role = owner → ALLOW (full).
3. Resolve scope chain: E → list → folder → space.
4. Compute effective permission at each scope level by checking:
   - Workspace role permissions (admin: full, member: see below, guest: see below).
   - `space_members` row for (U.id, space_id).
   - Per-list overrides (if implemented as `list_permissions` table — V1: inherits from space).
5. Apply most-specific override (item-level beats list-level beats space-level).
6. Map permission to action:

| Permission | Read | Comment | Edit Task | Create Task | Manage List | Manage Space |
|---|---|---|---|---|---|---|
| view | ✓ | | | | | |
| comment | ✓ | ✓ | | | | |
| edit | ✓ | ✓ | ✓ | ✓ | | |
| full | ✓ | ✓ | ✓ | ✓ | ✓ | |
| admin (role) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### 8.3 Implementation

```typescript
// packages/shared/permissions.ts
export type Action =
  | 'workspace.manage'
  | 'space.create' | 'space.manage' | 'space.archive'
  | 'list.create' | 'list.manage' | 'list.delete'
  | 'task.read' | 'task.create' | 'task.edit' | 'task.delete' | 'task.assign'
  | 'comment.create' | 'comment.edit_any' | 'comment.delete_any'
  | 'automation.manage' | 'webhook.manage' | 'integration.manage'
  | 'user.invite' | 'user.deactivate' | 'user.change_role'
  | 'view.create' | 'view.protect' | 'view.delete'
  | 'dashboard.create' | 'dashboard.share'
  | 'custom_field.manage' | 'status.manage' | 'tag.manage'
  | 'form.create' | 'form.manage'
  | 'template.create' | 'template.use';

export interface PermissionContext {
  user: { id: string; role: Role; status: UserStatus };
  scope?: { spaceId?: string; listId?: string; taskId?: string };
}

export function can(action: Action, ctx: PermissionContext): boolean { ... }
```

Backend checks at controller layer. Frontend mirrors for UI gating but never trusts client-side.

### 8.4 Guest-Specific Rules

- Guests **cannot** see the workspace user list (`/api/users` excludes them).
- Guests **cannot** be assigned `admin` role.
- Guests' tasks/lists visible only via direct space/list invitation.
- Guests cannot create Spaces.
- Custom fields with `hidden_from_guests = true` are filtered from responses.

### 8.5 Per-Endpoint Permission Matrix (Excerpt)

| Endpoint | Required Action |
|---|---|
| `POST /api/spaces` | `space.create` (admin or owner) |
| `PATCH /api/spaces/:id` | `space.manage` |
| `POST /api/lists` | `list.create` (edit on parent space) |
| `POST /api/tasks` | `task.create` (edit on list) |
| `PATCH /api/tasks/:id` | `task.edit` |
| `DELETE /api/tasks/:id` | `task.delete` (full on list, or creator within 1 hour) |
| `POST /api/comments` | `comment.create` |
| `PATCH /api/comments/:id` | author OR `comment.edit_any` |
| `POST /api/automations` | `automation.manage` |
| `POST /api/users/invitations` | `user.invite` |

---

---

## 9. Workspace, Space, Folder, List

### 9.1 Workspace

- Exactly one row exists at all times. Created during initial system seed.
- Settings JSON shape:
  ```json
  {
    "timezone": "Asia/Dhaka",
    "default_locale": "en",
    "week_starts_on": 6,
    "fiscal_year_start_month": 7,
    "business_hours": { "start": "09:00", "end": "18:00" },
    "working_days": [0, 1, 2, 3, 4]
  }
  ```
- Editable only by Owner.

### 9.2 Space

**Purpose:** A major team/department container. V1 seeds 5: Operations, Inventory, Customer Support, Product Listing, Marketing. Users can add more.

**Operations:**
- `POST /api/spaces` (Admin+) — create
- `PATCH /api/spaces/:id` — rename, change icon/color, set private
- `POST /api/spaces/:id/archive` — soft-archive (hides from main list, retains data)
- `POST /api/spaces/:id/unarchive`
- `DELETE /api/spaces/:id` — Owner-only; hard delete after confirmation; cascades to all children
- `POST /api/spaces/:id/members` — add member(s) with permission
- `DELETE /api/spaces/:id/members/:user_id` — remove
- `PATCH /api/spaces/:id/members/:user_id { permission }` — change permission

**Business rules:**
- Space name unique within workspace (case-insensitive).
- Private space → only listed members + owner see it.
- Public space → all Members see it; Guests still need explicit invitation.
- Cannot archive the last non-archived space.

**Events emitted:** `space.created`, `space.updated`, `space.archived`, `space.deleted`, `space.member_added`, `space.member_removed`.

### 9.3 Folder

**Purpose:** Optional grouping inside a Space. Useful for "Q2 Campaigns" inside Marketing space, etc.

**Operations:**
- `POST /api/folders` `{ space_id, parent_folder_id?, name }` — create
- `PATCH /api/folders/:id` — rename, reorder
- `POST /api/folders/:id/move { space_id, parent_folder_id? }`
- `POST /api/folders/:id/archive`
- `DELETE /api/folders/:id` — cascade

**Business rules:**
- Max nesting depth: 3 levels. Enforce in app logic.
- Folder name unique within its parent (space + parent_folder_id).
- Creating a Folder does **not** auto-create a List in V1 (simpler than ClickUp).

### 9.4 List

**Purpose:** The main task container. Direct children of Space or Folder. Has its own views, statuses (inherited or overridden), automations.

**Operations:**
- `POST /api/lists { space_id, folder_id?, name, icon?, color?, default_task_type_id? }`
- `PATCH /api/lists/:id`
- `POST /api/lists/:id/move { space_id, folder_id? }` — recompute position; if statuses differ, prompt user to map old→new statuses for existing tasks (returns 409 with `mapping_required` if mapping needed)
- `POST /api/lists/:id/duplicate { include_tasks: bool }`
- `POST /api/lists/:id/archive`
- `DELETE /api/lists/:id`
- `GET /api/lists/:id/views` — list views for this list

**Business rules:**
- List name unique within (space_id, folder_id).
- Deleting a list with active tasks requires `?force=true` query param.
- A list MUST have at least one status assigned (auto-create defaults `Open` + `Closed` if none).
- `default_task_type_id` applied to all tasks created in this list unless overridden.

**Default views auto-created on list creation:**
- "List" (type=list, is_default=true)
- "Board" (type=board)

### 9.5 Tasks-in-Multiple-Lists (V1.5 optional)

ClickApp `tasks_in_multiple_lists` default OFF in V1. If enabled:
- `POST /api/tasks/:id/lists { list_id }` — add task to additional list
- `DELETE /api/tasks/:id/lists/:list_id` — remove from list (must not be primary)
- `PATCH /api/tasks/:id/primary-list { list_id }` — change primary

Status of task always resolved from primary list's status set.

---

## 10. Tasks (Core)

### 10.1 Task Lifecycle

```
[created] → [active statuses ...] → [done status] → [closed (auto)]
                  ↓
              [archived]
                  ↓
              [soft-deleted] → (30 days) → [hard-deleted]
```

### 10.2 Task Property Reference

| Property | Validation | Default | Behavior |
|---|---|---|---|
| `name` | 1–1024 chars | required | Inline editable in list/board |
| `description` | Tiptap JSON; max 1 MB serialized | NULL | Block editor; supports headings, lists, code, embeds, mentions, task references |
| `status_id` | FK valid for list's status scope chain | List's first non-`closed` status | On change, fires `task.status_changed` event |
| `priority` | 0,1,2,3,4 | 0 (None) | Hardcoded 5 levels |
| `task_type_id` | FK | List default OR workspace `Task` | Influences icon shown |
| `start_date` | ISO 8601 timestamptz | NULL | If both set, must be ≤ due_date |
| `due_date` | ISO 8601 | NULL | Triggers `due_soon` / `overdue` notifications |
| `time_estimate_seconds` | non-negative int | NULL | Sum of subtasks rolled up to parent |
| `assignees` | array of user ids (workspace members or guests with edit on list) | [] | Multiple Assignees ClickApp |
| `watchers` | array of user ids | auto-populated | Auto-add on assign/comment/@mention |
| `tags` | array of tag ids in this Space | [] | |
| `is_milestone` | bool | false | Shows diamond icon in Gantt |
| `recurrence_rule_id` | FK | NULL | When set, regeneration runs on schedule/complete |

### 10.3 Task Number / Custom ID

- `task_number` is a workspace-wide monotonic integer (1, 2, 3, ...).
- Custom Task IDs (e.g., `ORD-1234`) supported via per-Space prefix:
  - `spaces.task_id_prefix` (varchar(16), nullable). If set, displayed ID is `{prefix}-{seq_within_space}` where seq is space-scoped.
  - When prefix set, additional column `space_task_seq bigint` per task.

Resolve task by both:
- `GET /api/tasks/:identifier` where identifier matches numeric `task_number` OR `{prefix}-{seq}`.

### 10.4 Create Task

`POST /api/tasks`

Request:
```json
{
  "list_id": "uuid",
  "name": "string",
  "description": null | tiptapJson,
  "parent_task_id": null | "uuid",
  "status_id": null | "uuid",
  "priority": 0,
  "task_type_id": null,
  "assignees": [],
  "watchers": [],
  "tags": [],
  "start_date": null,
  "due_date": null,
  "time_estimate_seconds": null,
  "custom_fields": { "<custom_field_id>": <value> },
  "from_template_id": null
}
```

Response: full task object (see [§33.5](#335-task-response-shape)).

**Backend logic:**

1. Validate list permission `task.create`.
2. If `parent_task_id`, validate same list, depth check (`parent.nesting_depth + 1 ≤ 4`).
3. Compute `task_number` via sequence.
4. Compute initial `position` = max(position of list tasks) + 1000 (or 0 if empty list).
5. Apply status_id default if NULL.
6. Insert `tasks` row.
7. Insert `task_list_memberships` row with `is_primary=true`.
8. Insert assignees, watchers (also auto-add creator + assignees to watchers), tags.
9. Insert `custom_field_values` rows for provided fields. Validate against field type config; reject if required fields missing.
10. If `from_template_id`, instantiate template (subtasks, checklists, etc. — see [§29](#29-templates)).
11. Write `activity_log` row.
12. Fire automation triggers (`task_created`).
13. Emit WebSocket event `task.created` to list subscribers.

### 10.5 Update Task

`PATCH /api/tasks/:id` — partial update.

Only provided fields are changed. Special handling:
- `status_id` change → emit `task.status_changed` event with `{ from, to }`, fire automations.
- `assignees` array replace → diff against current, emit `task.assigned`/`task.unassigned` events per change.
- `due_date` change → recompute scheduled `due_soon`/`overdue` reminders.
- `parent_task_id` change → re-check depth; reposition.

Custom field updates use separate endpoint:
`PATCH /api/tasks/:id/custom-fields/:field_id { value }`

### 10.6 Delete & Restore

- `DELETE /api/tasks/:id` → soft delete (sets `deleted_at`). Children/subtasks soft-deleted too.
- `POST /api/tasks/:id/restore` → undelete within 30 days.
- Cron job hard-deletes records older than 30 days (and cascades attachments from S3).

### 10.7 Archive

- `POST /api/tasks/:id/archive` — sets `archived_at`. Excluded from default views (filter `archived_at IS NULL`).
- `POST /api/tasks/:id/unarchive` — clears `archived_at`.

### 10.8 Move / Copy

- `POST /api/tasks/:id/move { list_id, position? }` — transfers to another list. If destination has different status set, fail with 409 unless `status_mapping` provided.
- `POST /api/tasks/:id/duplicate { list_id?, include_subtasks: bool, include_attachments: bool }` — creates copy.

### 10.9 Bulk Operations

`POST /api/tasks/bulk` with `{ task_ids: [], operation: 'update'|'move'|'delete'|'archive', payload: {} }`.

Bulk update validates each task individually (return per-id result map).

### 10.10 Drag-Drop Reordering

`PATCH /api/tasks/:id/reorder { before_task_id?, after_task_id? }` — backend computes new `position` = midpoint between neighbors (fractional indexing).

When values grow too dense, rebalance entire list (background job): renumber `position` as `1000, 2000, 3000, ...`.

---

## 11. Subtasks & Checklists

### 11.1 Subtasks

A subtask is a Task with `parent_task_id` set. **All task semantics apply** to subtasks (custom fields, comments, attachments, status, assignees, etc.).

**Nesting:**
- Max depth: 5 levels (root = depth 0; deepest subtask = depth 4).
- Configurable via ClickApp `nested_subtasks.config.max_depth`.

**Inheritance rules:**
- Subtask does NOT inherit parent's assignees, dates, status, priority, custom fields.
- Subtask uses parent's List's status workflow (since it lives in the same list).
- Completion of subtask does NOT auto-complete parent (and vice versa).
- Time tracked rollup: parent's `time_tracked_seconds` is `parent's own + sum of all descendants` (denormalized via trigger or recomputed on read).

**Display modes (frontend):**
- Collapsed under parent
- Expanded under parent
- Flattened as separate rows (filter-aware)

**Closed subtasks:** filtered out by default in list view; toggleable via "Show closed".

### 11.2 Subtask API

- `POST /api/tasks` with `parent_task_id` set.
- `GET /api/tasks/:id/subtasks` — direct children.
- `GET /api/tasks/:id/subtasks?recursive=true` — full subtree (uses recursive CTE).
- `PATCH /api/tasks/:id { parent_task_id }` — re-parent (validate depth).

### 11.3 Checklists

Lightweight to-do list inside a task. **Not full tasks.**

| Property | Check List Item |
|---|---|
| Multiple assignees | No (single only) |
| Due date | No |
| Status | None (just checked/unchecked) |
| Custom fields | No |
| Comments | No |
| Nested | Up to 5 levels |
| Auto-progress contribution | Yes (counts toward Progress custom field) |

**API:**
- `POST /api/tasks/:task_id/checklists { name }`
- `PATCH /api/checklists/:id { name, position }`
- `DELETE /api/checklists/:id`
- `POST /api/checklists/:id/items { text, parent_item_id?, assignee_id?, position? }`
- `PATCH /api/checklist-items/:id { text, is_completed, assignee_id, parent_item_id, position }`
- `DELETE /api/checklist-items/:id`
- `POST /api/checklist-items/bulk` — reorder/check multiple at once

### 11.4 Checklist Templates

- Save: `POST /api/templates` with `type='checklist'`, `structure: { items: [{text, depth, assignee_default}] }`.
- Apply: `POST /api/tasks/:task_id/checklists/from-template { template_id, name? }`.

---

## 12. Statuses, Priorities, Task Types, Tags

### 12.1 Statuses

**Scoping:**
- A status belongs to one of three scope levels: `list`, `folder`, `space`.
- A list resolves its statuses via inheritance chain: own statuses → folder's → space's.
- When a status is created at `list` scope, it overrides inheritance for that list.

**Status Groups (system enum, hardcoded):**
- `not_started` — queue, not yet active
- `active` — in progress
- `done` — work finished, kept open/editable
- `closed` — terminal; only 1 closed status per scope

**Default seed (Operations Space example):**

| Group | Name | Color |
|---|---|---|
| not_started | New Order | #94A3B8 |
| active | Confirmed | #3B82F6 |
| active | Packed | #8B5CF6 |
| active | Handed to Courier | #06B6D4 |
| active | Out for Delivery | #F59E0B |
| active | Delivered | #10B981 |
| done | COD Collected | #059669 |
| closed | Completed | #6B7280 |
| closed | Cancelled | #EF4444 (override default Closed) — actually keep one closed; use Done group for Cancelled/Returned variants |

**API:**
- `GET /api/scopes/:scope_type/:scope_id/statuses`
- `POST /api/statuses { scope_type, scope_id, name, color, status_group, position }`
- `PATCH /api/statuses/:id`
- `DELETE /api/statuses/:id` — fails if any task is in this status (must reassign first)
- `POST /api/statuses/reorder { scope_type, scope_id, ordered_ids[] }`

**Status Templates:**
- `POST /api/templates type=status_set` — save the current status set as reusable.
- `POST /api/scopes/:scope_type/:scope_id/statuses/apply-template { template_id }`.

### 12.2 Priorities

**Hardcoded** (no DB table needed beyond `tasks.priority`):

| Value | Name | Color | Icon |
|---|---|---|---|
| 1 | Urgent | #EF4444 | flag-filled |
| 2 | High | #F59E0B | flag-filled |
| 3 | Normal | #3B82F6 | flag-filled |
| 4 | Low | #9CA3AF | flag-filled |
| 0 | None | transparent | flag-outline |

Frontend renders flag. Filterable, sortable, groupable.

### 12.3 Task Types

Seeded on workspace creation. Owners/Admins can add/edit/delete via `/api/task-types`.

- `POST /api/task-types { name, icon, color, description? }`
- `PATCH /api/task-types/:id`
- `DELETE /api/task-types/:id` — fails if any task uses it; suggest reassign to default `Task`.

System types (`is_system=true`):
- Task (default)
- Milestone (`is_milestone_type=true`)

V1 seeded business types:
- Order (icon: shopping-cart)
- Complaint (icon: alert-circle)
- Product Listing (icon: package)
- Campaign (icon: megaphone)
- Return (icon: arrow-left-circle)

### 12.4 Tags

- Tags scoped to a Space.
- Display: chip with background color.
- A task in Space A cannot use Tag from Space B. If a task moves between spaces, tags by same name are auto-mapped; unmapped tags are stripped (with confirmation).

**API:**
- `GET /api/spaces/:id/tags`
- `POST /api/spaces/:id/tags { name, color }`
- `PATCH /api/tags/:id`
- `DELETE /api/tags/:id` — also removes from all tasks
- `POST /api/tasks/:id/tags { tag_id }`
- `DELETE /api/tasks/:id/tags/:tag_id`

---

## 13. Dependencies & Recurring Tasks

### 13.1 Dependencies

**Types:**
- `waiting_on` — source task waits on target task (target blocks source). Reciprocal "blocking" is computed.
- `linked` — informational; no scheduling/completion enforcement.

**API:**
- `POST /api/tasks/:id/relationships { target_task_id, type }`
- `DELETE /api/relationships/:id`
- `GET /api/tasks/:id/relationships` — returns both directions: `{ waiting_on: [], blocking: [], linked: [] }`

**Behaviors:**

1. **Dependency Warning ClickApp** (default ON): when user closes a task that has unresolved `waiting_on` (target task not in `done`/`closed`), backend returns 200 with `{ warnings: [{...}] }`. UI shows confirmation modal. User can still proceed.

2. **Reschedule Dependencies ClickApp** (default OFF): when source task's `due_date` changes, dependent tasks' `start_date`/`due_date` shift to maintain the original gap. Enqueued as worker job to avoid request-time cascade.

3. **Visualization:**
   - Gantt view: arrows between bars.
   - Task detail: "Relationships" panel showing all three groups.
   - List view: badge icons when relationships exist.

**Constraints:**
- Cannot create circular `waiting_on` (cycle detection on insert via recursive CTE; reject 409 if cycle).
- Cannot relate a task to itself.

### 13.2 Recurring Tasks

**RRULE storage** (RFC 5545):

```
FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1;UNTIL=20261231T235959Z
```

**Trigger modes:**
- `on_schedule` — next instance generated at scheduled date regardless of current state.
- `when_complete` — next instance generated when current marked complete (done or closed group).

**Regenerate modes:**
- `new_task` — generate a fresh task; original retained as history.
- `same_task` — reuse same row; reset status, shift dates forward.

**End conditions:**
- No end
- After N occurrences (`end_after_occurrences`)
- By date (`end_by_date`)

**Worker job:** `recurring-task-generator` runs every 5 minutes:
1. Query recurrence_rules with `trigger_mode='on_schedule'` and next occurrence ≤ now.
2. For each, compute next occurrence using `rrule` library.
3. Apply regeneration logic.
4. Update `last_generated_at` and `total_occurrences`.

For `when_complete` mode, generation happens inline when task moves to a done/closed status (in `task.status_changed` handler).

**API:**
- `POST /api/tasks/:id/recurrence { rrule, trigger_mode, regenerate_mode, end_after_occurrences?, end_by_date? }`
- `DELETE /api/tasks/:id/recurrence` — stops the series.
- `GET /api/tasks/:id/recurrence` — returns rule + next 5 occurrences (computed).

---

## 14. Comments & Mentions

### 14.1 Comment Model

- Threaded: `parent_comment_id` points to root or `NULL` for top-level.
- Body stored as Tiptap JSON; rendered as HTML on display.
- Reactions: emoji chips with counts; clicking adds/removes current user's reaction.
- Assigned comments: a comment can have `assigned_to`; appears in assignee's Inbox "Assigned Comments".
- Resolve: setting `resolved_at` marks the thread as resolved. Top-level resolve hides children visually (collapsed).
- Mentions: parsed from Tiptap JSON for user-mention nodes; written to `comment_mentions` join.

### 14.2 Comment API

- `GET /api/tasks/:id/comments?limit=50&before=cursor`
- `POST /api/tasks/:id/comments { body, parent_comment_id?, assigned_to?, attachment_ids? }`
- `PATCH /api/comments/:id { body, assigned_to }`
- `POST /api/comments/:id/resolve`
- `POST /api/comments/:id/unresolve`
- `DELETE /api/comments/:id` — author or admin within 24h; later marks deleted (soft); body shown as "[deleted]"
- `POST /api/comments/:id/reactions { emoji }` — toggle
- `GET /api/users/me/assigned-comments?status=open|resolved`

### 14.3 Mention Aliases

- `@user-name` — specific user
- `@everyone` / `@all` — all users with view access to the task
- `@watchers` — current watchers of the task
- `@assignees` — current assignees of the task

Parsed at submission. Resolved to actual user IDs and stored in `comment_mentions`.

### 14.4 Notification Flow

When a comment is created:
1. Determine recipients:
   - Direct @mentions → notification type `mentioned`.
   - Watchers of the task (excluding author) → notification type `comment`.
   - `assigned_to` user → notification type `comment_assigned`.
2. Auto-add @mentioned users as watchers.
3. Enqueue notification jobs (per user, channel-aware).

---

## 15. Attachments & File Storage

### 15.1 Upload Flow

**Direct upload via signed URL (recommended for large files):**

1. Client requests `POST /api/attachments/sign { filename, mime_type, size_bytes, target_type, target_id }`.
2. Backend validates: user has edit access on target, size within plan limit (V1: 100 MB/file enforced).
3. Backend generates S3 presigned PUT URL (valid 5 min) with key `attachments/{workspace_id}/{yyyy}/{mm}/{uuid}{ext}`.
4. Backend creates `attachments` row with status `pending`.
5. Client uploads directly to S3.
6. Client confirms: `POST /api/attachments/:id/complete`.
7. Backend marks row complete; for images, triggers thumbnail job; emits `attachment.created`.

**Smaller files (<5 MB) may use proxied POST** to `POST /api/attachments` with multipart/form-data; backend streams to S3.

### 15.2 Image Processing

- For mime_type matching `image/*`, generate two thumbnails:
  - `_thumb` 256×256 (cropped to square)
  - `_preview` 1280px max width (proportional)
- Storage keys: append `_thumb` / `_preview` to base key.
- Generated via Sharp (Bun-compatible).

### 15.3 Download Flow

`GET /api/attachments/:id/download`:
- Validate user has read access on parent task/comment.
- Generate signed S3 GET URL (valid 5 min).
- Redirect (302) to URL.

### 15.4 Garbage Collection

Worker job `attachment-gc` runs daily:
1. Find attachments with `target_id` referencing soft-deleted tasks (older than 30 days).
2. Find attachments where `target_id` is NULL and `created_at < 24h ago` (orphaned uploads).
3. Delete from S3 + DB.

### 15.5 Limits (V1)

- Max file size: 100 MB per file (configurable in workspace settings).
- Max attachments per task: 100 (soft limit; warn user).
- Allowed mime types: any (no restriction in V1; antivirus scanning V2).
- Disallowed extensions for executable safety: `.exe`, `.bat`, `.cmd`, `.com`, `.scr`, `.msi`, `.ps1`, `.vbs`, `.js`, `.jse` — blocked at API layer.

### 15.6 Storage Backend Config

Env vars:
```
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=task-mgmt-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://files.yourdomain.com  # optional CDN
```

For self-hosted MinIO, point `S3_ENDPOINT` to MinIO instance.

---

## 16. Custom Fields Engine

### 16.1 Field Types & Config Schema

For each `type`, `config` JSON validates against a per-type Zod schema:

```typescript
// packages/shared/custom-fields.ts
export const customFieldConfig = {
  text: z.object({ max_length: z.number().int().default(500) }),
  long_text: z.object({ max_length: z.number().int().default(50000) }),
  number: z.object({
    precision: z.number().int().min(0).max(10).default(0),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().max(16).optional()
  }),
  money: z.object({
    currency: z.string().length(3).default('BDT'),
    precision: z.number().int().min(0).max(4).default(2)
  }),
  date: z.object({
    include_time: z.boolean().default(false)
  }),
  dropdown: z.object({
    sort_options_alphabetically: z.boolean().default(false)
  }),
  labels: z.object({
    sort_options_alphabetically: z.boolean().default(false)
  }),
  checkbox: z.object({}),
  phone: z.object({
    default_country: z.string().length(2).default('BD')
  }),
  url: z.object({}),
  email: z.object({}),
  files: z.object({
    max_files: z.number().int().default(10)
  }),
  people: z.object({
    allow_multiple: z.boolean().default(false)
  }),
  location: z.object({
    map_provider: z.enum(['maplibre', 'google']).default('maplibre')
  }),
  rating: z.object({
    max: z.number().int().min(1).max(10).default(5),
    icon: z.enum(['star', 'heart', 'thumbs', 'circle']).default('star')
  }),
  progress: z.object({
    method: z.enum(['manual', 'automatic']).default('manual'),
    start: z.number().default(0),
    end: z.number().default(100),
    source: z.enum(['subtasks', 'checklist']).optional() // for automatic
  }),
  formula: z.object({
    expression: z.string().min(1).max(2000),
    output_type: z.enum(['number', 'text', 'date', 'boolean']).default('number')
  })
};
```

### 16.2 Value Storage

Single table `custom_field_values` stores all values as JSONB. Backend serializes per-type. See [§6.5](#65-custom-fields) for shape.

### 16.3 Validation Rules

| Type | Rule |
|---|---|
| text | length ≤ config.max_length |
| number | within [config.min, config.max]; precision rounding |
| money | amount is integer; currency matches config |
| date | valid ISO 8601 |
| dropdown | option_id must be in `custom_field_options` for this field |
| labels | each option_id must be in field's options; min 0 |
| checkbox | strict boolean |
| phone | E.164 format (validate via `libphonenumber-js`) |
| url | valid URL; auto-prepend `https://` if scheme missing |
| email | RFC 5322 |
| files | each attachment_id exists, belongs to same workspace |
| people | each user_id exists, is workspace member |
| location | lat ∈ [-90, 90], lng ∈ [-180, 180] |
| rating | 0 ≤ value ≤ config.max |
| progress (manual) | start ≤ current ≤ end |
| progress (automatic) | computed; read-only |
| formula | computed; read-only |

If `is_required=true`, value must be present and non-empty. Validated on task create AND when field becomes required (existing tasks flagged).

### 16.4 Field Management API

- `GET /api/custom-fields?scope_type=&scope_id=` — list applicable to scope
- `POST /api/custom-fields { scope_type, scope_id, name, type, config, is_required, default_value, position }`
- `PATCH /api/custom-fields/:id` — rename, config changes (validate non-destructive); changing `type` is **disallowed** (delete + recreate)
- `DELETE /api/custom-fields/:id` — also deletes all values
- `POST /api/custom-fields/:id/options { label, color }` (dropdown/labels only)
- `PATCH /api/custom-fields/:id/options/:option_id`
- `DELETE /api/custom-fields/:id/options/:option_id` — reassigns tasks: if option deleted, value becomes NULL with confirm
- `POST /api/custom-fields/:id/reorder { ordered_option_ids: [] }`

### 16.5 Value Update API

- `PATCH /api/tasks/:id/custom-fields/:field_id { value }` — set/update value
- `DELETE /api/tasks/:id/custom-fields/:field_id` — unset

### 16.6 Formula Engine

V1 supports a limited expression syntax via a custom parser (built with chevrotain or a hand-rolled recursive descent parser). Supported:

**Operators:** `+ - * / %`, `=`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`
**Functions:**
- `field("field_id_or_slug")` — reference another custom field value (numeric or date)
- `IF(cond, then, else)`
- `AND(...)`, `OR(...)`, `NOT(x)`
- `SUM(...)`, `MIN(...)`, `MAX(...)`, `AVG(...)`
- `ROUND(x, digits)`, `FLOOR(x)`, `CEIL(x)`, `ABS(x)`
- `DAYS(date1, date2)` → integer days between
- `TODAY()` → current date
- `DATE_ADD(date, n_days)`
- `DUE_DATE()`, `START_DATE()`, `TIME_ESTIMATE()` — task built-ins
- `STATUS_GROUP()` — `'not_started'|'active'|'done'|'closed'`

**Evaluation:**
- Server-side on every read of a task with formula fields (or computed and cached on dependency change).
- For performance: maintain a `formula_dependencies` table; recompute affected tasks asynchronously on dependency change.

```
formula_dependencies
  - formula_field_id (FK)
  - referenced_field_id (FK)
```

When any referenced field changes for a task → enqueue `recompute-formula` job for that task + formula.

### 16.7 Field Permissions (V1 simplified)

Per-field setting: `hidden_from_guests` boolean only. Granular per-role/per-user editing is V2.

### 16.8 Default V1 Custom Fields (seeded per Space)

**Operations Space, "Facebook Orders" List:**

| Field | Type | Config |
|---|---|---|
| Customer Name | text | max 200 |
| Customer Phone | phone | BD |
| Address | location | maplibre |
| Order Source | dropdown | options: Facebook, Website |
| Products | long_text | max 5000 |
| Order Value | money | BDT, precision 2 |
| COD Amount | money | BDT, precision 2 |
| Courier | dropdown | options: Pathao, Steadfast, RedX, Sundarban |
| Tracking ID | text | max 100 |
| COD Status | dropdown | options: Pending, Collected, Returned |

**Inventory Space, "Stock Master" List:**

| Field | Type | Config |
|---|---|---|
| SKU | text | max 50 |
| Current Stock | number | int |
| Reorder Level | number | int |
| Supplier | text | max 100 |
| Lead Time (days) | number | int |
| Last Restock Date | date | no time |
| Stock Status | dropdown | options: In Stock, Low, Out |

**Customer Support Space, "Complaints" List:**

| Field | Type | Config |
|---|---|---|
| Order # | text | max 50 |
| Issue Type | dropdown | options: Wrong Item, Damaged, Late, Refund, Other |
| Channel | dropdown | options: Facebook, Phone, Website, Courier |
| Resolution | long_text | max 5000 |

**Marketing Space, "Content Calendar" List:**

| Field | Type | Config |
|---|---|---|
| Platform | dropdown | options: Facebook, Instagram, Website, Email |
| Content Type | dropdown | options: Image, Video, Reel, Offer, Blog |
| Campaign | dropdown | options: Eid, Pohela Boishakh, 11.11, Regular |
| Publish Date | date | with time |
| Designer | people | single |
| Boost Budget | money | BDT |

---

## 17. View System

### 17.1 Common View Properties

Every view stores:
```typescript
{
  id, scope_type, scope_id, type, name,
  is_default, is_protected, is_private, owner_id,
  filters, sort, group_by, columns,
  config, // type-specific
  position
}
```

### 17.2 List View

**Config:**
```json
{
  "show_subtasks_as": "collapsed" | "expanded" | "separate",
  "row_density": "compact" | "comfortable" | "expanded",
  "show_closed_tasks": false
}
```

**Columns** array example:
```json
[
  { "id": "name", "type": "system", "width": 400, "frozen": true },
  { "id": "status", "type": "system", "width": 140 },
  { "id": "assignees", "type": "system", "width": 120 },
  { "id": "due_date", "type": "system", "width": 140 },
  { "id": "cf:uuid-of-order-value", "type": "custom_field", "width": 120 },
  { "id": "priority", "type": "system", "width": 100 }
]
```

**Group by:** `none`, `status`, `assignee`, `priority`, `tags`, `due_date`, `task_type`, `cf:<field_id>`

**Column calculations** (footer): for numeric columns, support: `sum`, `avg`, `min`, `max`, `median`, `range`, `count`, `count_unique`, `count_empty`, `pct_empty`, `pct_not_empty`, `earliest`, `latest`.

**Bulk action toolbar** (frontend): appears when 1+ task selected. Actions: change status, assign, set priority, set due date, add/remove tag, set custom field, move/copy, archive, delete.

**Inline editing:** click any cell to edit. Save on blur or Enter. Optimistic update.

### 17.3 Board View (Kanban)

**Config:**
```json
{
  "group_by_field": "status",
  "subgroup_by_field": null,
  "wip_limits": { "<status_id>": 5 },
  "card_fields": ["priority", "due_date", "assignees", "tags"],
  "collapse_done": true
}
```

**Behaviors:**
- Drag card across columns → updates `group_by_field` value (e.g., status).
- WIP limit visual: column header shows red badge when count > limit.
- Multi-select drag: shift-click to select multiple cards, drag together.
- Subgroups: when `subgroup_by_field` set, columns become rows of swimlanes.
- Group "Add status" inline if user has `status.manage`.

### 17.4 Calendar View

**Config:**
```json
{
  "default_mode": "month" | "week" | "4day" | "day",
  "show_weekends": true,
  "show_unscheduled_panel": true,
  "first_day_of_week": 6
}
```

**Behaviors:**
- Tasks plotted by `due_date` (or `start_date`-to-`due_date` span if both set).
- Drag task to new date → update due_date.
- Drag edge → adjust duration (changes start_date).
- Click empty slot → create task with that date.
- Unscheduled panel (right side): tasks without dates; drag onto calendar to schedule.

### 17.5 Gantt View

**Config:**
```json
{
  "zoom": "day" | "week" | "month",
  "show_dependencies": true,
  "show_critical_path": false,
  "show_milestones": true,
  "show_progress": true
}
```

**Behaviors:**
- Bars span `start_date` to `due_date`. If only one set, single-day bar.
- Drag bar to shift dates; drag edge to resize.
- Click + drag from bar edge to another bar → create `waiting_on` relationship.
- Milestones: diamond at `due_date`.
- Critical path: compute longest dependency chain (topological sort + DP). Highlight in red.
- Progress: bar fill % based on `progress` custom field if exists, else `completed / total subtasks`.

### 17.6 Table View

Similar to List View but optimized for spreadsheet-like editing. Same columns, group by, calculate footer. Differs in:
- Denser default layout (no card-style spacing).
- Cell-level keyboard nav (arrow keys, Tab, Enter).
- Copy/paste cell values supported.
- Export to CSV/XLSX prominent.

### 17.7 Workload View

**Config:**
```json
{
  "effort_unit": "task_count" | "time_estimate" | "story_points",
  "time_period": "day" | "week" | "month",
  "capacity_per_user": { "<user_id>": 28800 }, // seconds per day
  "default_capacity_seconds": 28800,
  "exclude_weekends": true
}
```

**Display:**
- Rows: assignees (filtered).
- Columns: time buckets (days/weeks/months from now to +N).
- Cell color: green (< 80% capacity), yellow (80–100%), red (> 100%).
- Drag task between rows to reassign.

**Computation:**
- For each task with start + due, distribute time_estimate evenly across working days in range.
- Sum per user per day → compare to capacity.

### 17.8 Map View

**Config:**
```json
{
  "location_field_id": "<custom_field_id>",
  "color_by_field": "status" | "priority" | "cf:<field_id>",
  "default_center": { "lat": 23.81, "lng": 90.41 },
  "default_zoom": 11,
  "cluster_pins": true
}
```

**Behaviors:**
- Render pins for tasks with valid location custom field value.
- Click pin → side panel with task summary + link.
- Cluster pins when >100 in view.
- Pin color from `color_by_field`.

### 17.9 Form View

See [§19](#19-forms-system).

### 17.10 Activity View

**Config:**
```json
{
  "scope_filter": { "user_ids": [], "action_types": [] },
  "date_range": { "preset": "last_7_days" }
}
```

**Behaviors:**
- Renders chronological activity_log entries.
- Filters: by user, by action type, by date range.
- Each entry: avatar, who, what, when, before→after diff (when relevant).

---

## 18. Filters, Sorting, Grouping, Me Mode

### 18.1 Filter Schema

```json
{
  "groups": [
    {
      "logic": "AND",
      "rules": [
        { "field": "status_id", "op": "in", "value": ["uuid1", "uuid2"] },
        { "field": "due_date", "op": "before", "value": "today+7d" },
        { "field": "cf:<field_id>", "op": "eq", "value": "..." }
      ]
    }
  ],
  "group_logic": "AND"
}
```

**Operators by field type:**

| Type | Operators |
|---|---|
| All | `eq`, `neq`, `is_empty`, `is_not_empty`, `in`, `not_in` |
| number/money/rating/progress | `gt`, `gte`, `lt`, `lte`, `between` |
| date | `before`, `after`, `on`, `between`, dynamic values: `today`, `yesterday`, `tomorrow`, `this_week`, `last_week`, `next_week`, `this_month`, `overdue`, `today+Nd`, `today-Nd` |
| text/long_text/url/email/phone | `contains`, `not_contains`, `starts_with`, `ends_with`, `regex` (V2) |
| dropdown | `eq`, `neq`, `in`, `not_in` |
| labels | `contains_any`, `contains_all`, `contains_none` |
| people | `contains` (any of users), `is_me` (special) |
| checkbox | `is_true`, `is_false` |

**Built-in pseudo-fields:**
- `assignee` (alias for assignees array)
- `watcher`
- `created_by`
- `created_at`, `updated_at`
- `is_archived`, `is_completed`
- `has_subtasks`, `has_dependencies`, `is_recurring`

### 18.2 Sort Schema

```json
[
  { "field": "priority", "direction": "asc" },
  { "field": "due_date", "direction": "asc" }
]
```

Multi-column sort applied in order. When grouped, sort applies within each group.

### 18.3 Me Mode

A view-level toggle stored per-user (not in shared `views.config`). Frontend-only — adds an implicit filter `assignee is_me` on top of view's saved filters.

**Sub-toggles:**
- "Tasks where I'm an assignee" (default ON)
- "Tasks where I have an assigned comment"
- "Tasks where subtasks are assigned to me"
- "Tasks where checklist items are assigned to me"

Stored in user preferences:
```sql
CREATE TABLE user_view_preferences (
  user_id uuid,
  view_id uuid,
  preferences jsonb, -- {me_mode: {...}, hidden_columns: [], ...}
  updated_at timestamptz,
  PRIMARY KEY (user_id, view_id)
);
```

### 18.4 View Permissions

**Shared view (default):**
- Visible to everyone with read access on scope.
- Anyone with edit access can modify.

**Private view:**
- Visible to `owner_id` only by default.
- Can grant `view` or `full` access to specific users via `view_shares`.

**Protected (locked) view:**
- Filters/sort/group are locked.
- Personal display preferences still adjustable (column widths, hidden columns, Me Mode).
- Only `owner_id` (creator) or full-access shareholders can unlock.

**API:**
- `POST /api/views { ... }` — create
- `PATCH /api/views/:id`
- `POST /api/views/:id/protect`
- `POST /api/views/:id/unprotect`
- `POST /api/views/:id/share { user_id, permission }`
- `DELETE /api/views/:id/share/:user_id`

---

## 19. Forms System

### 19.1 Form Builder

**API:**
- `POST /api/forms { list_id, title, description?, branding?, settings? }` — creates form + associated view + a public_slug.
- `PATCH /api/forms/:id`
- `POST /api/forms/:id/fields { field_kind, field_key, label, ... }` — add field
- `PATCH /api/form-fields/:id`
- `DELETE /api/form-fields/:id`
- `POST /api/forms/:id/fields/reorder { ordered_ids: [] }`
- `POST /api/forms/:id/regenerate-slug` — invalidate old public link

### 19.2 Field Kinds

- `task_attr` — maps to a built-in task attribute (`name`, `description`, `assignees`, `priority`, `due_date`, `tags`).
- `custom_field` — maps to a `custom_fields.id` (must belong to the target list's scope).

`field_key`:
- For `task_attr`: one of the task attribute names.
- For `custom_field`: the custom_field UUID.

### 19.3 Conditional Logic

```json
{
  "conditional_logic": {
    "logic": "AND",
    "rules": [
      { "trigger_field_id": "uuid-of-dropdown-issue-type", "operator": "eq", "value": "Damaged" }
    ],
    "action": "show"
  }
}
```

Evaluated client-side as user fills the form. Also re-evaluated server-side at submission to ensure hidden fields are dropped (security: client could send hidden field values).

Triggers supported: dropdown, labels, checkbox, priority, people, status (rarely used in forms).

### 19.4 Public Form Rendering

`GET /forms/[public_slug]` (frontend route):
- Public, unauthenticated.
- Fetch form definition: `GET /api/public/forms/:public_slug`.
- Render fields per `form_fields` order, apply conditional logic.
- Submit → `POST /api/public/forms/:public_slug/submit` with `{ field_values: {field_id: value}, recaptcha_token? }`.

### 19.5 Submission Flow

1. Rate limit: 60 submissions per IP per hour (Redis sliding window).
2. Validate reCAPTCHA if enabled (Google v3, score ≥ 0.5).
3. Validate each field against its config + conditional logic (drop fields whose `conditional_logic.action === 'hide'` resolves true).
4. Create `form_submissions` row with raw data.
5. Create task in `forms.list_id`:
   - Map `task_attr` fields to task attributes.
   - Map `custom_field` fields to custom_field_values.
   - Set `created_by` to a system user (`forms@system`).
   - Apply `default_task_type_id` from list, or override if mapped.
6. Update `form_submissions.task_id`.
7. Increment `forms.submission_count`.
8. Fire automation triggers (`task_created`, `form_submitted`).
9. Emit `form.submitted` WebSocket event to subscribers.
10. If `settings.redirect_url`, response includes `{ redirect_to }`.

### 19.6 Branding

```json
{
  "branding": {
    "theme": "light" | "dark",
    "primary_color": "#3B82F6",
    "logo_url": "...",
    "background_image_url": "...",
    "layout": "single_column" | "two_column",
    "hide_app_branding": false
  }
}
```

### 19.7 Settings

```json
{
  "settings": {
    "require_login": false,
    "allow_anonymous": true,
    "enable_recaptcha": true,
    "redirect_url": "https://thank-you.example.com",
    "max_submissions_per_ip_per_hour": 60,
    "submission_open": true,
    "open_at": null,
    "close_at": null
  }
}
```

### 19.8 V1 Form Use Cases

- **Facebook Complaint Intake** (Customer Support Space, "Complaints" list)
- **New Product Sourcing Request** (Product Listing Space)
- **Vendor/Supplier Onboarding** (Inventory Space)

---

## 20. Automation Engine

### 20.1 Architecture

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Event     │────▶│ Automation       │────▶│ Action Executor  │
│  Emitter   │     │ Matcher          │     │ (BullMQ workers) │
└────────────┘     └──────────────────┘     └──────────────────┘
       │                    │                         │
       │ Domain events       │ Matching rules         │ Side effects
       ▼                    ▼                         ▼
  task.created       Query automations         Modify task
  task.updated       WHERE trigger matches     Send notification
  task.status_changed AND scope contains task  Post comment
  comment.created    AND is_active             Create subtask
  date.due_soon      Filter via conditions     Call webhook
  form.submitted                               Apply template
```

### 20.2 Trigger Types

| Trigger | Config | Fires when |
|---|---|---|
| `task_created` | `{ list_id? }` | Task created in scope |
| `task_status_changed` | `{ from_status_id?, to_status_id?, from_group?, to_group? }` | Status changes |
| `task_assigned` | `{ user_id? }` | Assignee added |
| `task_unassigned` | `{ user_id? }` | Assignee removed |
| `task_field_changed` | `{ custom_field_id, from?, to? }` | Custom field updated |
| `task_priority_changed` | `{ from?, to? }` | Priority changes |
| `task_due_date_changed` | `{}` | Due date set/changed/cleared |
| `task_due_soon` | `{ days_before: 1 }` | Cron-evaluated: due_date within N days |
| `task_overdue` | `{}` | Cron-evaluated: due_date passed, status not done/closed |
| `task_tag_added` | `{ tag_id? }` | Tag attached |
| `task_tag_removed` | `{ tag_id? }` | Tag removed |
| `comment_posted` | `{}` | New comment on task in scope |
| `subtask_completed` | `{}` | Subtask moved to done/closed |
| `checklist_completed` | `{}` | Entire checklist all items checked |
| `form_submitted` | `{ form_id? }` | Form submission creates task |
| `time_tracked` | `{}` | Time entry added |
| `recurring_schedule` | `{ cron: "0 9 * * MON" }` | Cron-based |
| `webhook_inbound` | `{ webhook_path: "auto-generated" }` | Generates inbound URL; called externally |

### 20.3 Condition Schema

```json
{
  "conditions": {
    "logic": "AND",
    "rules": [
      { "field": "priority", "op": "in", "value": [1, 2] },
      { "field": "assignees", "op": "contains", "value": "<user_id>" },
      { "field": "cf:<id>", "op": "eq", "value": "COD" }
    ]
  }
}
```

Conditions use the same filter schema as views (see [§18.1](#181-filter-schema)).

### 20.4 Action Types

| Action | Config |
|---|---|
| `set_status` | `{ status_id }` or `{ status_group: 'done' }` |
| `assign_user` | `{ user_ids: [], mode: 'replace'|'add'|'remove' }` |
| `set_priority` | `{ priority: 1 }` |
| `set_due_date` | `{ due_date: 'today+7d' | iso }` |
| `set_start_date` | `{ start_date: 'today' }` |
| `add_tag` | `{ tag_id }` |
| `remove_tag` | `{ tag_id }` |
| `set_custom_field` | `{ custom_field_id, value }` |
| `add_watcher` | `{ user_ids: [] }` |
| `move_to_list` | `{ list_id }` |
| `copy_to_list` | `{ list_id }` |
| `archive_task` | `{}` |
| `create_subtask` | `{ name_template: "Follow up on {{task.name}}", assignee_ids?, due_date_offset_seconds? }` |
| `create_task` | `{ list_id, name_template, assignee_ids?, custom_fields? }` |
| `apply_template` | `{ template_id }` |
| `post_comment` | `{ body_template: "Hello @assignees, please review.", assigned_to? }` |
| `send_email` | `{ to: ['assignees', 'specific:user@x.com'], subject_template, body_template }` |
| `send_notification` | `{ user_ids: [], message_template }` |
| `call_webhook` | `{ url, method: 'POST', headers?, body_template? }` |
| `delay` | `{ seconds: 3600 }` — pause before next action |

### 20.5 Template String Syntax

Mustache-like `{{ }}` interpolation with task context:

```
{{task.name}}
{{task.id}}
{{task.status.name}}
{{task.priority_name}}
{{task.due_date | date('YYYY-MM-DD')}}
{{task.assignees | map(name) | join(', ')}}
{{task.custom_fields.order_value | money}}
{{task.url}}
{{trigger.actor.name}}
{{trigger.event_type}}
{{now | date('YYYY-MM-DD HH:mm')}}
```

Filters supported in V1: `date`, `time`, `money`, `upper`, `lower`, `title`, `default`, `join`, `map`.

### 20.6 Execution Model

When a domain event fires:

1. **Event Emitter** publishes event to Redis pub/sub channel `automation:events`.
2. **Matcher** (a worker) consumes event, queries automations:
   ```sql
   SELECT * FROM automations
   WHERE is_active = true
     AND (scope_type, scope_id) matches event's task hierarchy
     AND trigger->>'type' = event.type
   ```
3. For each match:
   - Evaluate conditions against task snapshot.
   - If pass → enqueue `automation:run` BullMQ job with `{ automation_id, event_payload }`.
4. **Action Executor** worker:
   - Resolves template strings.
   - Executes actions sequentially.
   - Logs each action result.
   - Inserts `automation_runs` row.

**Failure handling:**
- Each action wrapped in try/catch.
- On failure, log error, continue to next action (unless `stop_on_error: true` in action config).
- Run marked `failed` if any action errored; `success` otherwise.

**Recursion prevention:**
- Track event chain via `causation_id` in event payload.
- An automation cannot trigger itself within the same causation chain.
- Max causation depth: 5 (prevents runaway loops).

### 20.7 Automation Builder UI

Three-step wizard:
1. **Trigger** — select trigger type, configure.
2. **Conditions** (optional) — add filter rules.
3. **Actions** — add one or more actions in sequence.

Natural-language preview: "When a task's status changes to **Confirmed**, if its priority is **Urgent**, then **assign to @PackingTeam** and **send email to ops@company**."

### 20.8 V1 Seed Automations

Created on workspace seed:

1. **Auto-assign confirmer on new Facebook Order**
   - Trigger: `task_created` (scope: Facebook Orders list)
   - Actions: `assign_user(ops_team_id)`, `add_watcher(supervisor_id)`

2. **Notify packing on confirmation**
   - Trigger: `task_status_changed (to: Confirmed)`
   - Actions: `assign_user(packing_team_id)`, `send_notification(packing_team_id, "{{task.name}} ready to pack")`

3. **Low-stock alert**
   - Trigger: `task_field_changed (custom_field=current_stock)`
   - Conditions: `current_stock <= reorder_level`
   - Actions: `set_custom_field(stock_status, 'Low')`, `create_task(in Purchase Orders list, name="Reorder {{task.name}}")`, `send_notification(inventory_manager_id, ...)`

4. **Urgent complaint escalation**
   - Trigger: `task_created` (scope: Complaints)
   - Conditions: `priority = Urgent`
   - Actions: `assign_user(support_lead_id)`, `add_watcher(founder_id)`, `send_email(founder, ...)`

5. **Overdue delivery follow-up**
   - Trigger: `task_overdue`
   - Conditions: `status = Out for Delivery`
   - Actions: `create_subtask(name="Check courier for {{task.name}}", assignee=ops_team)`

### 20.9 No Per-Workspace Limits

V1 has no automation-run quota (internal use). Recommend monitoring `automation_runs` table size; partition by month after 6 months.

---

## 21. Notification System

### 21.1 Generation

Notifications generated by:
- Domain events (e.g., `task.assigned`, `comment.created`).
- Cron jobs (`due_soon`, `overdue`, `reminder_due`).
- Automation `send_notification` action.

Each notification creation:
1. Determine recipients (e.g., assignees + watchers for `comment.created`).
2. For each recipient, consult `notification_settings.channels[type]`.
3. Insert `notifications` row.
4. For each enabled channel (besides `in_app` which is just the row), enqueue delivery job.

### 21.2 Notification Types

| Type | Default channels |
|---|---|
| `assigned` | in_app, email, push |
| `unassigned` | in_app |
| `mentioned` | in_app, email, push |
| `comment` | in_app |
| `comment_assigned` | in_app, email, push |
| `comment_reaction` | in_app |
| `status_change` | in_app |
| `priority_change` | in_app |
| `due_date_change` | in_app |
| `due_soon` | in_app, email, push |
| `overdue` | in_app, email, push |
| `dependency_resolved` | in_app |
| `dependency_warning` | in_app |
| `subtask_created` | in_app |
| `subtask_completed` | in_app |
| `task_archived` | in_app |
| `automation_failed` | in_app (admin/owner only) |
| `form_submitted` | in_app, email (form owner) |
| `reminder_due` | in_app, email, push |
| `workspace_invite_accepted` | in_app (inviter) |

### 21.3 Channel Delivery

**In-app:** the `notifications` row itself; UI polls or receives WebSocket push.

**Email:**
- Templated HTML via React Email (or MJML).
- Subject: configurable per type.
- Body: rich, includes task link with deep-link.
- Sent via Resend / SMTP.
- Throttle: same user + same type within 60s → batched (single email).

**Web Push:**
- Sent via `web-push` library using stored VAPID subscriptions.
- Payload kept small (<4 KB): title, body, icon, deep_link, notification_id.
- On click, frontend opens deep_link.

### 21.4 Smart Notifications

If `smart_notifications=true` (default), defer push delivery if user is **active on web** within last 5 minutes (tracked via heartbeat). Email still sent immediately.

"Active" detection:
- Frontend pings `POST /api/users/me/heartbeat` every 60s while tab is foregrounded.
- Backend stores `last_active_at` in Redis with 5min TTL.

### 21.5 Aggregation / Digest

Out of scope for V1 beyond simple batching. V2: daily digest email summarizing yesterday's activity.

### 21.6 Snooze

`POST /api/notifications/:id/snooze { until: "2026-05-30T09:00:00Z" }` — sets `snoozed_until`. Notifications with `snoozed_until > now` hidden from default Inbox view, surfaced again after the time.

Worker `notification-resurfacer` runs every minute: find rows where `snoozed_until <= now` and `is_read = false` → clear `snoozed_until` so they reappear; optionally re-emit push.

### 21.7 Inbox Behavior

`GET /api/notifications?status=unread|read|all|snoozed&type=&since=cursor&limit=50`

Returns paginated list, newest first. Includes denormalized entity preview for fast rendering.

`POST /api/notifications/mark-read { ids: [] }` — bulk mark read.
`POST /api/notifications/mark-all-read`
`POST /api/notifications/:id/archive`

### 21.8 Do Not Disturb

`notification_settings.dnd_start_time` / `dnd_end_time` (in user's timezone). During DND:
- In-app: still saved, no push.
- Push: suppressed.
- Email: still sent.

---

## 22. Real-Time Sync (WebSocket)

### 22.1 Architecture

- Single WebSocket endpoint: `wss://app/realtime` (uses same auth cookie).
- Backed by Elysia's WebSocket support (or Socket.io for namespace patterns).
- Redis pub/sub for fan-out across multiple API server instances.

### 22.2 Connection Lifecycle

1. Client connects to `wss://app/realtime` with cookie auth.
2. Server validates session, attaches `user_id`.
3. Server sends `{ type: 'connected', server_time }`.
4. Client subscribes to channels:
   ```json
   { "type": "subscribe", "channels": ["task:uuid", "list:uuid", "workspace"] }
   ```
5. Server validates each channel against user's permissions; replies `{ type: 'subscribed', channels: [allowed] }`.
6. On disconnect, subscriptions cleaned up.

### 22.3 Channel Conventions

| Pattern | Purpose |
|---|---|
| `user:<user_id>` | Personal notifications, inbox updates (auto-subscribed) |
| `workspace` | Workspace-level events (member changes, etc.) |
| `space:<space_id>` | Space-level events |
| `list:<list_id>` | List events (task added/removed) — also implicit task events for tasks in this list |
| `task:<task_id>` | Task-specific (comments, field changes, assignees) |
| `dashboard:<dashboard_id>` | Dashboard data updates |

### 22.4 Event Types

All events carry `{ type, channel, data, ts, causation_id }`.

| Event | Channel | Data |
|---|---|---|
| `task.created` | list | full task |
| `task.updated` | task, list | `{ id, changes: {field: {before, after}} }` |
| `task.deleted` | task, list | `{ id }` |
| `task.moved` | source list, dest list | `{ id, from_list, to_list }` |
| `task.status_changed` | task, list | `{ id, from_status_id, to_status_id }` |
| `task.assigned` | task, list, user:assignee | `{ id, user_id, assigned_by }` |
| `task.unassigned` | task, list | `{ id, user_id }` |
| `task.custom_field_changed` | task | `{ id, field_id, value }` |
| `task.position_changed` | list | `{ id, position }` |
| `comment.created` | task | full comment |
| `comment.updated` | task | `{ id, body }` |
| `comment.deleted` | task | `{ id }` |
| `comment.reacted` | task | `{ comment_id, user_id, emoji, action: 'add'|'remove' }` |
| `list.updated` | space, list | `{ id, changes }` |
| `list.archived` | space, list | `{ id }` |
| `view.updated` | scope of view | `{ id }` |
| `automation.executed` | list (silent for non-creators) | `{ automation_id, task_id }` |
| `notification.created` | user | full notification |
| `user.presence` | task (if user is viewing) | `{ user_id, presence: 'active'|'away' }` |
| `user.typing` | task | `{ user_id, location: 'comment_input' }` |

### 22.5 Optimistic Updates

Frontend uses TanStack Query mutations with `onMutate` to update cache immediately. When server WebSocket event arrives, reconcile (server is source of truth).

For conflicting concurrent edits, last-write-wins. Document-style CRDT collaboration is V2.

### 22.6 Presence

Lightweight: when a user opens a task detail page, send `{ type: 'presence', target: 'task:uuid', action: 'enter' }`. Server broadcasts to other subscribers. On unload / unsubscribe, broadcast `leave`. Avatar stack in task header shows currently-viewing users.

### 22.7 Reconnect & Resync

Client maintains a `last_event_id` cursor (server-issued sequential ID per channel).
On reconnect: client sends `{ type: 'resubscribe', channels: [...], since_event_id: 12345 }`.
Server replays missed events from a 5-minute Redis ring buffer. If gap too large, server responds `{ type: 'resync_required' }` → client refetches data via REST.

### 22.8 Scaling

For V1 single-VPS, single Node process handles 500+ concurrent connections fine. Future scaling: sticky sessions at load balancer + Redis pub/sub for cross-instance fan-out.

---

## 23. Email Integration

### 23.1 Outbound

**Provider:** Resend (default) or SMTP fallback.

**Use cases:**
- Transactional: invitations, password reset, verification, 2FA codes (if SMS unavailable).
- Notification emails (assigned, mentioned, due_soon, overdue).
- Form submission alerts.
- Automation action `send_email`.

**Sending API:**
```typescript
interface EmailJob {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string; // auto-derived from html
  reply_to?: string;
  attachments?: { filename, content_base64, content_type }[];
  headers?: Record<string, string>;
  // Metadata
  workspace_id?: string;
  user_id?: string;
  category: 'transactional'|'notification'|'form'|'automation';
}
```

Enqueued via BullMQ `email-out` queue. Worker:
1. Retries 3 times on failure (exponential backoff).
2. Logs every send to `email_log` table:
   ```
   email_log: id, to_address, subject, category, status (queued|sent|failed|bounced), provider_message_id, error, sent_at
   ```
3. Resend webhook callbacks update `status` (delivered, bounced, complained).

**Templates:** React Email components in `apps/api/src/emails/`. One template per notification type + transactional types.

### 23.2 Per-User Outbound (Send Email from Task)

A user with a connected `email_integrations` row can send email from inside a task:
- `POST /api/tasks/:id/emails { to, cc?, subject, body, attachment_ids? }`
- Backend constructs message, sends via user's OAuth tokens (Gmail API or Microsoft Graph), or stored SMTP creds.
- Records the email as a special comment with `kind='email_out'` for thread tracking.

### 23.3 Inbound — Email-to-Task

**Setup:**
- Configure DNS MX for `inbox.yourdomain.com` to a mail receiver (Mailgun routes, SES inbound, or self-hosted Postfix → forwarder).
- Receiver POSTs parsed mail to `POST /api/webhooks/email-inbound` with `{ to, from, subject, body_text, body_html, attachments[] }`.

**Routing:**
1. Extract `to.local_part` from incoming address.
2. Lookup `email_to_task_addresses` by `local_part`:
   - `scope_type='list'` → create task in that list.
   - `scope_type='task'` → append to that task as comment.
   - `scope_type='space'` → create task in space's "Inbox" list.
3. Validate sender:
   - If `from` matches a `users.email` → set `created_by = user.id`.
   - Else → set `created_by = system user`; store original sender in custom field or task description preamble.
4. Map fields:
   - Subject → task name (truncate 1024 chars).
   - Body (prefer text; fallback to stripped HTML) → task description.
   - Attachments → uploaded to S3, attached to task.
5. Save form_submission-like record in `email_inbound_log`.

### 23.4 Reply-to-Comment via Email

Each notification email sent for a task includes a `reply-to` address: `{task_local_part}+{user_id}@inbox.yourdomain.com`.
When user replies, inbound parser detects pattern, appends body to task comment thread (author = user_id from address).

### 23.5 Per-User Email Integration Setup

`POST /api/integrations/email/oauth/start { provider: 'gmail' }` → redirects to OAuth.
`GET /api/integrations/email/oauth/callback?code=` → exchanges, stores encrypted tokens, marks integration active.
`DELETE /api/integrations/email/:id` → revokes tokens, removes row.

For IMAP/SMTP: `POST /api/integrations/email/imap { host, port, ssl, username, password }` — stored encrypted.

---

## 24. Calendar Integration

### 24.1 Provider Support (V1)

- **Google Calendar** — OAuth 2.0, two-way sync.
- Outlook in V2.

### 24.2 OAuth Setup

`POST /api/integrations/calendar/google/start { sync_scope: { list_ids: [], space_ids: [] }, sync_direction }` → redirect to Google OAuth (scopes: `https://www.googleapis.com/auth/calendar`).
`GET /api/integrations/calendar/google/callback?code=`:
- Exchange for access + refresh token.
- Fetch user's calendars list.
- User picks one (or auto-create "ClickUp Sync" calendar).
- Store `calendar_integrations` row.

### 24.3 Sync Algorithm

**Outbound (ClickUp → Google):**
- When task with `due_date` (and within sync scope) is created/updated, enqueue `calendar-push` job.
- Worker:
  - If task has no `external_event_id` → create Google Calendar event, store ID in `task_calendar_links`.
  - Else → patch event.
  - Event title = task name; description = link + brief; start/end = task start_date/due_date (or all-day if only one).

**Inbound (Google → ClickUp):**
- Use Google's `events.list?syncToken` for incremental sync. Store `sync_token` per integration.
- Worker `calendar-pull` runs every 5 minutes:
  - Fetch incremental updates.
  - For events that originated from us (have our metadata), update corresponding task.
  - For new external events: optionally create tasks (configurable; V1 default OFF for safety).
  - For deleted events: clear linked task's `due_date` (don't delete task).

**Two-way conflict resolution:**
- Use Google's `etag`. If we have a stale etag, fetch latest before patch.
- "Last writer wins" — if both sides edited, take the most recent (compare `updated_at` vs Google `updated`).

**`task_calendar_links` table:**
```
task_id (FK), integration_id (FK), external_event_id, external_etag, last_synced_at
PK: (task_id, integration_id)
```

### 24.4 iCal Feed (Read-Only Export)

`GET /ical/:secret_token.ics` — public URL, no auth (token in URL acts as secret).
Returns `Content-Type: text/calendar` with all tasks visible to the user owning the token.

Generated on the fly; cache 5 minutes.

---

## 25. Search

### 25.1 Indexed Entities

V1: tasks, comments, notepad_notes, lists, custom field text values.

### 25.2 Implementation (V1)

Postgres FTS using `tsvector` columns + GIN indexes. See [§6.15](#615-search).

Combined search query:
```sql
WITH q AS (SELECT websearch_to_tsquery('english', $1) AS query)
SELECT 'task' AS kind, id, name AS title, ts_headline('english', name, q.query) AS snippet,
       ts_rank(search_vector, q.query) AS rank
FROM tasks, q
WHERE search_vector @@ q.query AND deleted_at IS NULL AND archived_at IS NULL
  AND <permission filter>
UNION ALL
SELECT 'comment' AS kind, id, ... FROM comments, q WHERE ...
ORDER BY rank DESC LIMIT 50;
```

### 25.3 API

`GET /api/search?q=&types=task,comment&scope=&limit=50&offset=0`

Response:
```json
{
  "results": [
    {
      "kind": "task",
      "id": "uuid",
      "title": "Order #1042 — Rahim",
      "snippet": "...<mark>delivery</mark> address...",
      "rank": 0.91,
      "url": "/t/ORD-1042",
      "context": { "list_id": "...", "list_name": "Facebook Orders" }
    }
  ],
  "total": 18,
  "limit": 50,
  "offset": 0
}
```

### 25.4 Filtered Search

Combine free-text search with view-style filters:
`POST /api/search { q, types, filters: {<view filter schema>}, scope, limit, offset }`

### 25.5 Recent Items

Stored per-user in Redis (LRU list, 20 items):
- Keyed `recent:{user_id}` — sorted set with timestamp scores.
- Updated on any task/list/doc open.

`GET /api/users/me/recent?limit=20`

### 25.6 Saved Searches

Stored as private List views with a special config flag. Not a separate entity in V1.

---

## 26. Activity Log

### 26.1 What's Logged

Every state change to:
- Workspace, Space, Folder, List (created, renamed, archived, deleted)
- Tasks (every field change, status change, assign/unassign, watcher add/remove, archive, delete, restore)
- Subtasks
- Comments (created, edited, resolved, deleted)
- Custom field definitions (created, edited, deleted, option add/remove)
- Custom field values (changed)
- Attachments (uploaded, deleted)
- Views (created, modified, deleted)
- Automations (created, edited, run results — see automation_runs)
- Integrations (connected, disconnected)
- Users (created, deactivated, role changed)
- Permissions (granted, revoked)

### 26.2 Log Row Shape

```json
{
  "id": 1234567,
  "workspace_id": "uuid",
  "entity_type": "task",
  "entity_id": "uuid",
  "action": "status_changed",
  "actor_id": "uuid",
  "changes": {
    "status_id": { "before": "uuid1", "after": "uuid2" }
  },
  "context": {
    "task_name": "Order #1042",
    "list_id": "uuid",
    "list_name": "Facebook Orders",
    "ip": "10.0.0.1",
    "user_agent": "..."
  },
  "created_at": "2026-05-26T10:30:00Z"
}
```

### 26.3 Writing

Centralized helper `logActivity(actor, entity, action, changes, context)` called from every mutation endpoint. Implemented as a Postgres `INSERT` within the same transaction as the state change (to ensure consistency).

### 26.4 Reading

- Per-entity: `GET /api/activity?entity_type=task&entity_id=uuid&limit=50`
- Workspace-wide (Activity View): `GET /api/activity?date_from=&date_to=&actor_id=&action=&limit=`

### 26.5 Retention

- Hot retention: 12 months in `activity_log` table.
- Beyond 12 months: monthly partitions, oldest partitions cold-archived to S3 as compressed JSON (V2).

### 26.6 Indexes

Already covered in [§6.10](#610-notifications-activity-audit). Additional partial index for high-activity types:
```sql
CREATE INDEX activity_log_recent ON activity_log (workspace_id, created_at DESC)
  WHERE created_at > now() - interval '30 days';
```

---

## 27. Dashboards & Reporting

### 27.1 Widget Types

| Widget | Purpose | Data source | Config |
|---|---|---|---|
| `number` | Single KPI (e.g., today's orders count) | Aggregate query | `{ aggregation, filters, label, format }` |
| `pie` | Distribution (e.g., orders by status) | Group-by aggregation | `{ group_by, value_aggregation, filters, colors }` |
| `bar` | Categorical comparison | Group-by aggregation | `{ x_field, y_aggregation, filters, orientation }` |
| `line` | Time series | Time-bucketed aggregation | `{ x_field=created_at/due_date, y_aggregation, bucket, filters }` |
| `area` | Stacked time series | Same as line | `{ stack_by }` |
| `table` | Tabular data | Raw query (paginated) | `{ columns, filters, sort, limit }` |
| `task_list` | Embedded list view | Tasks query | `{ list_id?, filters, sort, columns }` |
| `calculation` | Formula across fields | Aggregation | `{ expression, filters, label, format }` |
| `embed` | External iframe | URL | `{ url, height }` |
| `text` | Markdown notes | Static | `{ content }` |

### 27.2 Aggregation Engine

Common backend service `dashboardQuery(widget_config, scope, dashboard_filters, user)`:
1. Build SQL based on widget type.
2. Apply user's permission filter (only show tasks user has read access to).
3. Apply dashboard-wide filters merged with widget filters.
4. Execute, return result.

Cache results in Redis for 30 seconds (configurable per dashboard).

### 27.3 V1 Seed Dashboards

**Owner Dashboard** (workspace-scoped, shared):
- Number: Today's Orders
- Pie: Orders by Status
- Number: COD Collected (today)
- Number: COD Pending
- Line: Revenue (Order Value sum, last 14 days)
- Number: Return Rate (last 30 days)
- Number: Low Stock Items
- Number: Open Complaints
- Bar: Team Workload (tasks per assignee, open only)

**Operations Dashboard** (Operations space):
- Number: Pending Confirmation
- Number: In Packing
- Number: Handed to Courier today
- Table: Today's COD pickups by courier

**Support Dashboard**:
- Number: Open Complaints
- Pie: Complaints by Issue Type
- Number: Avg Resolution Time
- Bar: Complaints by Channel

**Marketing Dashboard**:
- Calendar: Scheduled content (next 30 days)
- Number: Posts Published (this week)
- Pie: Content by Platform

### 27.4 Dashboard API

- `GET /api/dashboards`
- `POST /api/dashboards { name, scope_type, scope_id?, ... }`
- `PATCH /api/dashboards/:id`
- `DELETE /api/dashboards/:id`
- `POST /api/dashboards/:id/share { user_id, permission }`
- `POST /api/dashboards/:id/widgets { type, config, position }`
- `PATCH /api/dashboard-widgets/:id`
- `DELETE /api/dashboard-widgets/:id`
- `POST /api/dashboard-widgets/:id/refresh` — bypass cache
- `GET /api/dashboard-widgets/:id/data?date_range=` — fetch widget data

---

## 28. Time Tracking

### 28.1 Timer Service

Each user has at most ONE running timer at a time. Enforced by partial unique index.

**API:**
- `POST /api/time-entries/start { task_id?, description? }` — starts timer; if another running, error 409.
- `POST /api/time-entries/stop` — stops current running timer; computes duration.
- `POST /api/time-entries/switch { task_id }` — stops current, starts new on different task atomically.
- `GET /api/users/me/time-entries/running` — current running timer if any.

**Manual entry:**
- `POST /api/time-entries { task_id?, start_time, end_time, description, is_billable, tags }`
- `PATCH /api/time-entries/:id`
- `DELETE /api/time-entries/:id`

### 28.2 Rollup

`tasks.time_tracked_seconds` = SUM of own time_entries + recursive SUM of subtasks' time_tracked_seconds.

Implemented as: on INSERT/UPDATE/DELETE of `time_entries`, trigger recomputes the affected task. Subtask change propagates up via trigger (or recompute on read with caching).

### 28.3 Reports

`GET /api/reports/time?user_id=&start=&end=&group_by=user|task|list|day`

Returns aggregated time per group, billable vs non-billable.

### 28.4 Time Estimates

`tasks.time_estimate_seconds` set per task; rollup similar to time_tracked.

Per-assignee estimates (V1.5): separate table `task_assignee_estimates(task_id, user_id, seconds)`.

### 28.5 Time in Status

Optional ClickApp `time_in_status`. When enabled, captures duration in each status:

```
time_in_status: id, task_id, status_id, entered_at, exited_at, duration_seconds
```

Triggered on every `task.status_changed` event. The currently-active row has `exited_at = NULL`.

---

## 29. Templates

### 29.1 Capture

- `POST /api/templates { type, name, source: { entity_type, entity_id } }` — captures current state.
- Backend serializes:
  - For `task`: name, description, custom_fields, checklists, subtasks (recursive), assignees (by role tag rather than user ID — V2; for V1 store user IDs and require remap on apply).
  - For `list`: list + views + statuses + automations + custom fields + (optional) sample tasks.
  - For `space`: full subtree.

### 29.2 Apply

- `POST /api/templates/:id/apply { target: { scope_type, scope_id }, options: { remap_users: {}, date_offset_days: 0, include_attachments: false } }`
- Backend deserializes into new entities in target scope.

### 29.3 Date Remapping

Templates may have relative dates (e.g., due 3 days after start). On apply, convert relative dates to absolute based on `start_anchor`.

Date storage format in template:
```json
{ "type": "relative", "anchor": "start", "offset_days": 3 }
```
vs absolute:
```json
{ "type": "absolute", "value": "2026-05-30T..." }
```

### 29.4 Sharing

`templates.sharing`: `private` (only creator), `members` (all workspace members), `admins` (admins only). Cross-workspace sharing is V2.

### 29.5 Template Library UI

`GET /api/templates?type=&sharing=&q=` — searchable list.

V1 seeded templates:
- Task: "New Order Intake" (Operations)
- Task: "New Product Listing" (Product Listing)
- Task: "Campaign Plan" (Marketing)
- List: "Sprint" pattern (out of scope for V1 actually — skip)
- Checklist: "Packing Checklist"
- Checklist: "QC Checklist"
- Checklist: "Festival Campaign Launch"

---

## 30. Webhooks

### 30.1 Outbound Webhook Model

Workspace admin can register URLs to receive event payloads.

`POST /api/webhooks { url, events: ['task.created', 'task.status_changed'] }` → returns `{ id, secret }`. Secret shown ONCE.

Events available: subset of internal domain events, with stable JSON shapes:
- `task.created`, `task.updated`, `task.deleted`, `task.status_changed`, `task.assigned`, `task.completed`
- `list.created`, `list.deleted`
- `comment.created`
- `form.submitted`

### 30.2 Delivery

On event fire:
1. Find subscribed webhooks where `events @> [event_type]` AND `is_active = true`.
2. For each: enqueue `webhook-delivery` job with payload.

Worker:
1. POST to `webhook.url` with:
   - `Content-Type: application/json`
   - `X-Webhook-Signature: sha256=<hmac>` (HMAC-SHA256 of body using `webhook.secret`)
   - `X-Webhook-Event: <event_type>`
   - `X-Webhook-Delivery-Id: <delivery_id>`
   - Timeout: 7 seconds.
2. Expected response: 2xx → mark `delivered_at`.
3. Else: log failure, schedule retry.

### 30.3 Retry Policy

Exponential backoff: 30s, 2m, 10m, 1h, 6h. Max 5 attempts.

After 5 failures within 24 hours, set `webhook.is_active=false` and notify creator.

### 30.4 Signature Verification (client side)

```typescript
const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');
if (timingSafeEqual(received, expected)) { /* valid */ }
```

### 30.5 Inbound Webhooks (for Automations)

Automation trigger `webhook_inbound` generates a unique URL:
`https://app/api/automations/inbound/:slug`

Posting any JSON to it fires the automation. Body available as `{{trigger.body.*}}` in templates.

---

## 31. Inbox, Notepad, Reminders

### 31.1 Inbox

The Inbox is the unified notification feed UI built on `notifications` table. See [§21](#21-notification-system) for full spec.

**Layout:**
- Left: notification list (newest first, grouped by date)
- Right: opened item context (task, comment, etc.)
- Top tabs: Unread / Snoozed / Cleared
- Bulk actions: mark read, snooze, archive

### 31.2 Notepad

Personal note tool per user.

- `GET /api/users/me/notes`
- `POST /api/users/me/notes { title?, content }`
- `PATCH /api/users/me/notes/:id`
- `DELETE /api/users/me/notes/:id`
- `POST /api/users/me/notes/:id/convert-to-task { list_id }` — creates task with note content as description.

Editor: same Tiptap editor as task description.

### 31.3 Reminders

- `GET /api/users/me/reminders?status=pending|completed`
- `POST /api/users/me/reminders { title, due_at, notes?, assigned_to?, task_id?, recurrence? }`
- `PATCH /api/reminders/:id`
- `POST /api/reminders/:id/complete`
- `DELETE /api/reminders/:id`

**Notification:** Worker `reminder-dispatcher` runs every minute, finds reminders where `due_at ≤ now AND notification_sent_at IS NULL AND is_completed = false`, creates a notification of type `reminder_due`, marks `notification_sent_at`.

**Delegation:** Admin/Owner can assign reminder to another user via `assigned_to`.

---

## 32. Background Jobs / Queue

### 32.1 Queue Setup

BullMQ on Redis. Multiple named queues by purpose:

| Queue | Purpose | Concurrency | Retry |
|---|---|---|---|
| `email-out` | Outbound email | 10 | 3 |
| `push-out` | Web push | 20 | 3 |
| `webhook-delivery` | Outbound webhooks | 10 | 5 (exponential) |
| `automation-run` | Execute automations | 10 | 2 |
| `attachment-thumbnail` | Image thumbnailing | 4 | 2 |
| `attachment-gc` | File cleanup | 1 | 1 |
| `calendar-pull` | Inbound calendar sync | 2 | 2 |
| `calendar-push` | Outbound calendar sync | 4 | 3 |
| `recurring-task-generator` | Recurring task generation | 1 | 1 |
| `notification-resurfacer` | Snooze expiry | 1 | 1 |
| `reminder-dispatcher` | Reminder notifications | 1 | 1 |
| `due-soon-cron` | Due-soon / overdue triggers | 1 | 1 |
| `search-reindex` | Reindex (V2 Meilisearch) | 2 | 2 |
| `email-inbound-parse` | Parse incoming email | 5 | 3 |
| `recompute-formula` | Recompute formula values | 5 | 2 |

### 32.2 Cron Jobs (Schedulers)

| Cron | Schedule | Action |
|---|---|---|
| recurring-task-generator | `*/5 * * * *` | Process due RRULE schedules |
| notification-resurfacer | `* * * * *` | Unsnooze due notifications |
| reminder-dispatcher | `* * * * *` | Fire due reminders |
| due-soon-cron | `0 */1 * * *` (hourly) | Find tasks due in 1d, 2h windows; trigger automations |
| overdue-cron | `0 * * * *` (hourly) | Find overdue tasks; trigger automations |
| attachment-gc | `0 3 * * *` (daily 3 AM) | Cleanup orphaned/deleted attachments |
| activity-log-partition | `0 4 1 * *` (monthly) | Manage partitions |
| sessions-cleanup | `0 5 * * *` | Delete expired sessions |
| webhook-deactivate | `0 6 * * *` | Deactivate webhooks with 5+ consecutive failures |
| backup-trigger | `0 2 * * *` | DB backup snapshot |

### 32.3 Worker Process

Single workers Bun process per queue type or grouped. Recommended: 2 worker processes (light + heavy) on the same VPS for V1.

---

## 33. API Specification

### 33.1 Conventions

- **Base URL:** `https://app.yourdomain.com/api`
- **Format:** JSON request and response bodies; `Content-Type: application/json`
- **Auth:** Cookie-based (httpOnly `at` access token + `rt` refresh token). API token (for external use) optional in V2.
- **Versioning:** No explicit version in V1 (internal use). Breaking changes via deprecation headers.
- **HTTP methods:**
  - GET: read
  - POST: create / actions (idempotent actions OK, e.g., `/archive`)
  - PATCH: partial update
  - PUT: full replace (rare)
  - DELETE: soft-delete or remove

### 33.2 Standard Response Shapes

**Single resource:**
```json
{ "data": { ... } }
```

**Collection (paginated):**
```json
{
  "data": [ ... ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1234,
    "has_more": true,
    "next_cursor": "opaque"
  }
}
```

**Error:**
```json
{
  "error": {
    "code": "validation_error",
    "message": "Field 'name' is required",
    "details": { "fields": { "name": "required" } },
    "request_id": "uuid"
  }
}
```

### 33.3 Error Codes (Catalog)

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `validation_error` | Request body validation failed |
| 400 | `invalid_field_value` | Custom field value invalid |
| 401 | `unauthenticated` | Missing/invalid auth |
| 401 | `2fa_required` | Login partial; 2FA needed |
| 403 | `forbidden` | Authenticated but no permission |
| 404 | `not_found` | Resource missing |
| 409 | `conflict` | Concurrent edit / state mismatch |
| 409 | `circular_dependency` | Cycle in dependencies |
| 409 | `status_mapping_required` | Moving task to list with diff statuses |
| 409 | `nesting_depth_exceeded` | Subtask depth > 5 |
| 422 | `unprocessable` | Business rule violation |
| 423 | `view_protected` | Trying to edit protected view |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal_error` | Server bug |
| 503 | `service_unavailable` | Maintenance or dependency down |

### 33.4 Pagination

**Offset-based** (default for sortable lists):
- Query: `?limit=50&offset=100&sort=...`

**Cursor-based** (for activity_log, comments — append-only):
- Query: `?limit=50&before=<cursor>`
- Cursor = opaque base64 of `{ id, created_at }`.

Default limit: 50. Max limit: 200.

### 33.5 Task Response Shape

```json
{
  "id": "uuid",
  "task_number": 1042,
  "custom_id": "ORD-1042",
  "name": "Order #1042 — Rahim Uddin",
  "description": { "type": "doc", "content": [...] },
  "status": {
    "id": "uuid",
    "name": "Confirmed",
    "color": "#3B82F6",
    "status_group": "active"
  },
  "priority": 1,
  "priority_name": "Urgent",
  "task_type": {
    "id": "uuid",
    "name": "Order",
    "icon": "shopping-cart",
    "color": "#10B981"
  },
  "primary_list": { "id": "uuid", "name": "Facebook Orders" },
  "parent_task_id": null,
  "nesting_depth": 0,
  "is_milestone": false,
  "start_date": null,
  "due_date": "2026-05-28T18:00:00Z",
  "time_estimate_seconds": 3600,
  "time_tracked_seconds": 1200,
  "assignees": [
    { "id": "uuid", "name": "Ali", "avatar_url": "..." }
  ],
  "watchers": [
    { "id": "uuid", "name": "Ali" }
  ],
  "tags": [
    { "id": "uuid", "name": "VIP", "color": "#EF4444" }
  ],
  "custom_fields": {
    "<custom_field_id>": { "value": ..., "field": { "name": "Order Value", "type": "money", "config": {...} } }
  },
  "subtasks_count": 2,
  "subtasks_completed": 1,
  "comments_count": 3,
  "attachments_count": 1,
  "checklists": [
    { "id": "uuid", "name": "Packing", "items_count": 5, "items_completed": 2 }
  ],
  "relationships": {
    "waiting_on": [{ "task_id": "uuid", "name": "..." }],
    "blocking": [],
    "linked": []
  },
  "recurrence": null,
  "url": "/t/ORD-1042",
  "created_at": "...",
  "updated_at": "...",
  "created_by": { "id": "...", "name": "..." },
  "completed_at": null
}
```

`?expand=` supports selective expansion to avoid over-fetching: `?expand=subtasks,comments,activity`.

### 33.6 Endpoint Inventory

**Auth**
- `POST /api/auth/login`
- `POST /api/auth/2fa/verify`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/accept-invitation`
- `POST /api/auth/2fa/setup`
- `POST /api/auth/2fa/enable`
- `POST /api/auth/2fa/disable`

**Users**
- `GET /api/users` (admin+)
- `GET /api/users/:id`
- `GET /api/users/me`
- `PATCH /api/users/me`
- `PATCH /api/users/:id` (admin+)
- `POST /api/users/:id/deactivate` (admin+)
- `POST /api/users/me/password { current, new }`
- `POST /api/users/me/avatar` (multipart)
- `POST /api/users/me/heartbeat` (presence)
- `GET /api/users/me/preferences`
- `PATCH /api/users/me/preferences`
- `POST /api/users/invitations`
- `GET /api/users/invitations`
- `DELETE /api/users/invitations/:id`
- `POST /api/users/invitations/:id/resend`

**Workspace**
- `GET /api/workspace`
- `PATCH /api/workspace` (owner)

**Spaces** — see [§9.2](#92-space)
**Folders** — see [§9.3](#93-folder)
**Lists** — see [§9.4](#94-list)
**Statuses** — see [§12.1](#121-statuses)
**Task Types** — see [§12.3](#123-task-types)
**Tags** — see [§12.4](#124-tags)
**Tasks** — see [§10](#10-tasks-core)
**Subtasks/Checklists** — see [§11](#11-subtasks--checklists)
**Custom Fields** — see [§16](#16-custom-fields-engine)
**Views** — see [§17](#17-view-system) and [§18.4](#184-view-permissions)
**Forms** — see [§19](#19-forms-system)
**Public form**
- `GET /api/public/forms/:slug`
- `POST /api/public/forms/:slug/submit`

**Comments** — see [§14.2](#142-comment-api)
**Attachments** — see [§15.1](#151-upload-flow)
**Activity** — see [§26.4](#264-reading)
**Search** — see [§25.3](#253-api)
**Time Tracking** — see [§28](#28-time-tracking)
**Reminders** — see [§31.3](#313-reminders)
**Notepad** — see [§31.2](#312-notepad)
**Dashboards** — see [§27.4](#274-dashboard-api)
**Automations**
- `GET /api/automations?scope_type=&scope_id=`
- `POST /api/automations`
- `PATCH /api/automations/:id`
- `DELETE /api/automations/:id`
- `POST /api/automations/:id/test { fake_event }` — dry-run
- `GET /api/automations/:id/runs?limit=50`
**Webhooks**
- `GET /api/webhooks`
- `POST /api/webhooks`
- `PATCH /api/webhooks/:id`
- `DELETE /api/webhooks/:id`
- `GET /api/webhooks/:id/deliveries?limit=50`
- `POST /api/webhooks/:id/retry/:delivery_id`
**Integrations**
- `GET /api/integrations`
- `POST /api/integrations/email/oauth/start`
- `GET /api/integrations/email/oauth/callback`
- `POST /api/integrations/calendar/google/start`
- `GET /api/integrations/calendar/google/callback`
- `DELETE /api/integrations/:id`
**Templates** — see [§29.4](#294-sharing)
**Inbox**
- `GET /api/notifications`
- `POST /api/notifications/mark-read`
- `POST /api/notifications/mark-all-read`
- `POST /api/notifications/:id/snooze`
- `POST /api/notifications/:id/archive`
**ClickApps**
- `GET /api/clickapps?scope_type=&scope_id=`
- `PATCH /api/clickapps/:scope_type/:scope_id/:key { is_enabled, config }`
**Health**
- `GET /api/health` (liveness)
- `GET /api/health/ready` (readiness)

### 33.7 Rate Limits

Applied per user (auth'd) or per IP (anonymous):

| Endpoint group | Limit |
|---|---|
| Auth (login, password reset) | 10 / min / IP |
| Public form submit | 60 / hr / IP |
| Authenticated read endpoints | 600 / min / user |
| Authenticated write endpoints | 120 / min / user |
| Bulk operations | 30 / min / user |
| Search | 60 / min / user |

Implemented via Redis sliding window (e.g., `rate-limiter-flexible` or custom Lua script).

Response on limit hit: `429` with `Retry-After` header.

### 33.8 Idempotency

For mutations, accept optional `Idempotency-Key` header. Backend stores result for 24 hours; replays return cached response.

Critical for form submissions and webhook-triggered actions.

---

## 34. Frontend Architecture

### 34.1 Tech Stack Recap

- Next.js 15 (App Router, RSC where appropriate)
- React 19
- TypeScript strict mode
- Tailwind CSS 4 + shadcn/ui components
- TanStack Query v5 (server state)
- Zustand (UI state)
- TanStack Table (lists, tables)
- dnd-kit (drag-drop)
- FullCalendar (calendar view)
- frappe-gantt or gantt-task-react (gantt)
- MapLibre GL JS (map view)
- Recharts (dashboards)
- Tiptap (rich text)
- react-hook-form + Zod (forms)
- date-fns + date-fns-tz
- Socket.io-client or native WebSocket (realtime)
- Web Push API (PWA notifications)
- Service Worker via next-pwa

### 34.2 Folder Structure

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── invitation/[token]/
│   │   ├── forgot-password/
│   │   └── reset-password/[token]/
│   ├── (app)/
│   │   ├── layout.tsx       # Sidebar + topbar
│   │   ├── page.tsx          # Home / My Tasks
│   │   ├── inbox/
│   │   ├── search/
│   │   ├── s/[spaceId]/      # Space view
│   │   │   ├── page.tsx
│   │   │   ├── f/[folderId]/
│   │   │   └── l/[listId]/[viewId]/page.tsx
│   │   ├── t/[taskKey]/page.tsx  # Task detail (modal or page)
│   │   ├── dashboards/[id]/
│   │   ├── automations/
│   │   ├── settings/
│   │   │   ├── profile/
│   │   │   ├── notifications/
│   │   │   ├── integrations/
│   │   │   ├── users/
│   │   │   ├── workspace/
│   │   │   ├── statuses/
│   │   │   ├── task-types/
│   │   │   ├── custom-fields/
│   │   │   ├── clickapps/
│   │   │   ├── webhooks/
│   │   │   └── templates/
│   │   ├── notepad/
│   │   └── reminders/
│   ├── forms/[slug]/          # Public form (no app shell)
│   └── api/                   # Optional: server-side route handlers for SSR helpers
├── components/
│   ├── ui/                    # shadcn primitives
│   ├── views/                 # ListView, BoardView, etc.
│   ├── task/                  # TaskCard, TaskDetail, etc.
│   ├── editor/                # Tiptap editor
│   ├── automation/            # Builder UI
│   ├── dashboard/             # Widgets
│   └── shared/
├── hooks/                     # useTasks, useView, useRealtimeChannel, etc.
├── lib/
│   ├── api-client.ts          # Typed fetch wrapper
│   ├── websocket.ts
│   ├── permissions.ts         # Mirror of backend
│   ├── filter-engine.ts       # Client-side filter eval
│   └── utils/
├── stores/                    # Zustand stores
└── public/
    └── manifest.webmanifest
```

### 34.3 Data Fetching Pattern

- Use TanStack Query for all server state.
- Query keys: `['tasks', { listId, filters, sort }]`, `['task', taskId]`, `['comments', taskId]`, etc.
- Mutations use `onMutate` for optimistic updates with rollback on error.
- WebSocket events invalidate or directly update query cache.

Example:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ['tasks', { listId, filters }],
  queryFn: () => api.tasks.list({ listId, filters }),
});

const updateTask = useMutation({
  mutationFn: api.tasks.update,
  onMutate: async (input) => {
    await queryClient.cancelQueries(['task', input.id]);
    const prev = queryClient.getQueryData(['task', input.id]);
    queryClient.setQueryData(['task', input.id], (old) => ({ ...old, ...input }));
    return { prev };
  },
  onError: (err, input, ctx) => {
    queryClient.setQueryData(['task', input.id], ctx.prev);
  },
  onSettled: (data, _, input) => {
    queryClient.invalidateQueries(['task', input.id]);
  },
});
```

### 34.4 State Management

| State type | Where |
|---|---|
| Server data | TanStack Query |
| UI state (modal open, sidebar collapsed, drag state) | Zustand |
| Form state | react-hook-form |
| URL state (filters, view selection) | nuqs or built-in `useSearchParams` |
| User preferences | Local persisted Zustand + sync to backend |

### 34.5 Routing Strategy

- **Task detail:** intercepting modal route. Path `/t/[taskKey]` works both as standalone page and as modal overlay.
- **View selection:** `/s/{space}/l/{list}/{viewId}`. View tabs at top.
- **Deep links:** every entity has a stable URL.

### 34.6 Real-Time Integration

- WebSocket connection initialized on app mount.
- Auto-subscribe to `user:{me}` and `workspace` channels.
- On opening a list/task page, subscribe to that channel.
- On leaving, unsubscribe.
- Event handlers update TanStack Query cache directly:
  ```typescript
  socket.on('task.updated', (event) => {
    queryClient.setQueryData(['task', event.data.id], (old) =>
      old ? { ...old, ...event.data.changes_resolved } : old
    );
  });
  ```

---

## 35. Page Specifications

### 35.1 Login Page (`/login`)

- Email + password fields.
- "Forgot password?" link.
- Submit → `POST /api/auth/login`.
- If `2fa_required`, show 6-digit code input.
- On success, redirect to original URL or `/`.

### 35.2 Invitation Accept (`/invitation/[token]`)

- Verify token via `GET /api/auth/invitations/:token` (returns email + role + workspace name).
- Show form: name + password + confirm password.
- Submit → `POST /api/auth/accept-invitation`.
- Auto-login and redirect to `/`.

### 35.3 Home / My Tasks (`/`)

Personalized landing. Cards:
- **LineUp** — manually prioritized queue (drag to reorder).
- **Agenda** — today's tasks (assigned, due today) + calendar events.
- **My Work** — tabs: Today / Overdue / Next 7 days / Unscheduled / Done.
- **Comments assigned to me** (latest 10).
- **Notifications preview** (latest 5 unread).
- **Reminders due today**.

Each card editable / refreshable. Drag to rearrange dashboard.

### 35.4 Space Page (`/s/[spaceId]`)

- Space header: icon, name, member avatars, action buttons.
- Sidebar: tree of Folders + Lists.
- Default tab: "Overview" with stats (task counts, recent activity).
- Tabs: Overview, Tasks (all tasks across all lists in space), Dashboards, Settings.

### 35.5 List Page (`/s/[spaceId]/l/[listId]/[viewId?]`)

**Layout:**
```
┌──────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Operations / Facebook Orders                          │
│ List header: name, description, members                           │
│ View tabs: [List] [Board] [Calendar] [Gantt] [Table] [+ Add View] │
├──────────────────────────────────────────────────────────────────┤
│ Toolbar: Group by ▼ | Filter ▼ | Sort ▼ | Me Mode | Search        │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│                       (View renders here)                          │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Each view component** is responsible for:
- Rendering tasks
- Inline editing
- Selection state (for bulk action toolbar)
- Drag-drop
- Drilling into task detail

### 35.6 Task Detail (`/t/[taskKey]`)

**Modal or full-page (intercepting route).**

**Sections:**
1. Header: task name (inline editable), status pill, priority, assignees, due date.
2. Description: Tiptap editor.
3. Subtasks: nested list with inline add.
4. Checklists: collapsible checklists with add-item input.
5. Custom fields: form-like grid of all applicable fields.
6. Attachments: drag-drop upload zone + list.
7. Comments: thread with composer.
8. Activity: tab showing per-task activity log.
9. Relationships: sidebar panel.
10. Actions sidebar: assign, watch, time tracking start/stop, duplicate, archive, delete.

### 35.7 Form Builder (`/settings/forms/[id]/edit`)

Three-panel layout:
- Left: field types palette.
- Middle: form canvas with drag-drop fields.
- Right: properties panel for selected field (label, required, conditional logic, etc.).

Preview tab to test.

Settings tab: branding, redirect URL, anti-spam, sharing.

### 35.8 Automation Builder (`/automations/new` or `/automations/[id]/edit`)

Wizard or single-page editor:
1. **Trigger** card: select trigger type, configure parameters.
2. **Conditions** card: add filter rules (uses same UI as view filter builder).
3. **Actions** cards: list of actions in sequence; drag to reorder; "+ Add Action" button.

Test mode: simulate a trigger event and show what would happen.

### 35.9 Dashboard Page (`/dashboards/[id]`)

Grid of widgets. Edit mode toggles drag-resize handles.

Add Widget button → modal to choose widget type → configure → save.

### 35.10 Settings Pages

Each settings section is a sub-page under `/settings`:

- `/settings/profile` — user profile, password, 2FA setup, avatar
- `/settings/notifications` — channel preferences
- `/settings/integrations` — email, calendar connections
- `/settings/users` (admin+) — invite, manage roles, deactivate
- `/settings/workspace` (admin+) — workspace name, logo, timezone
- `/settings/statuses` — manage statuses across spaces
- `/settings/task-types` — manage task types
- `/settings/custom-fields` — workspace-level custom fields
- `/settings/clickapps` — toggle modular features
- `/settings/webhooks` — manage outbound webhooks
- `/settings/templates` — manage templates

### 35.11 Inbox (`/inbox`)

Split view:
- Left list with notification rows (compact: actor avatar, summary, time, snooze button).
- Right detail showing the underlying entity (task, comment).
- Keyboard navigation: J/K up/down, E archive, Z snooze, X mark read.

### 35.12 Search (`/search?q=...`)

- Search input at top.
- Filter chips: type (task/comment/note), space, date range.
- Results grouped by type.
- Click result → navigate to entity.

### 35.13 Public Form Page (`/forms/[slug]`)

Standalone layout (no app shell):
- Logo + title.
- Rendered fields per schema.
- Submit button.
- After submission: "Thank you" page or redirect to configured URL.
- No login required.

---

## 36. UI Components Library

### 36.1 Primitives (from shadcn/ui)

Button, Input, Textarea, Select, Combobox, DatePicker, Dialog, Sheet, Popover, Tooltip, Dropdown Menu, Context Menu, Tabs, Accordion, Avatar, AvatarStack, Badge, Card, Separator, Switch, Checkbox, Radio, Toggle, Toast (Sonner), Command (cmd-k palette).

### 36.2 App-Specific Components

| Component | Description |
|---|---|
| `<TaskCard>` | Card representation (board, list, search results) |
| `<TaskRow>` | Compact list row |
| `<StatusPill>` | Status dropdown with color |
| `<PriorityFlag>` | Priority icon |
| `<AssigneeStack>` | Avatar stack + add-assignee popover |
| `<TagChips>` | Tag display + editor |
| `<DueDateBadge>` | Date with red/yellow/green color logic |
| `<CustomFieldRenderer>` | Switches on field type to render appropriate input |
| `<RichTextEditor>` | Tiptap-based |
| `<MentionInput>` | Combobox for @-mentions |
| `<FilterBuilder>` | Builds filter JSON visually |
| `<ViewSwitcher>` | Tabs for view types |
| `<KanbanBoard>` | Board view |
| `<ListView>` | List view |
| `<CalendarGrid>` | Calendar view |
| `<GanttChart>` | Gantt view |
| `<WorkloadGrid>` | Workload view |
| `<TaskMap>` | Map view |
| `<ActivityFeed>` | Activity view |
| `<CommentThread>` | Threaded comments |
| `<AttachmentDropzone>` | File upload |
| `<NotificationListItem>` | Inbox row |
| `<CommandPalette>` | Cmd-K global search/actions |
| `<TimerWidget>` | Floating timer pill |
| `<DashboardWidget>` | Base widget renderer |
| `<AutomationBuilder>` | Trigger/Condition/Actions UI |
| `<FormBuilder>` | Form editor |
| `<PermissionMatrix>` | Manage permissions UI |
| `<SpaceTreeSidebar>` | Sidebar tree |

### 36.3 Design Tokens

```css
:root {
  --color-bg-primary: 248 250 252;   /* slate-50 */
  --color-bg-secondary: 241 245 249; /* slate-100 */
  --color-text-primary: 15 23 42;
  --color-text-muted: 100 116 139;
  --color-border: 226 232 240;
  --color-accent: 59 130 246;
  --color-success: 16 185 129;
  --color-warning: 245 158 11;
  --color-danger: 239 68 68;
  --radius: 8px;
}
```

Dark mode via `[data-theme="dark"]` overrides.

### 36.4 Accessibility

- All interactive components keyboard-navigable.
- Focus indicators visible.
- `aria-` attributes on custom widgets.
- Form fields associated with labels.
- Min contrast ratio 4.5:1 for text.

---

## 37. PWA & Mobile

### 37.1 PWA Manifest

```json
{
  "name": "TaskMgmt",
  "short_name": "TaskMgmt",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#3B82F6",
  "background_color": "#FFFFFF",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 37.2 Service Worker (via next-pwa)

- Cache `/` shell + static assets (stale-while-revalidate).
- Cache API GET requests under `/api/users/me`, `/api/workspace`, `/api/clickapps` (long TTL with WS-invalidation on update).
- Tasks/lists API: network-first with 5s timeout fallback to cache.
- Offline indicator banner when offline.

### 37.3 Push Notifications

- On login (or post-permission grant), call `navigator.serviceWorker.ready` → `subscription = subscribe({ userVisibleOnly: true, applicationServerKey: VAPID })`.
- POST subscription to `/api/users/me/push-subscriptions`.
- Service worker `push` event handler: decode payload → `self.registration.showNotification(...)`.
- Click handler: focus existing window or open `deep_link`.

### 37.4 Mobile-Specific UX

- Touch targets ≥ 44 px.
- Long-press to multi-select.
- Swipe-left on inbox row to snooze; swipe-right to mark read.
- Bottom navigation bar on mobile (Home / Inbox / Search / Profile).
- Native share API for sharing task URLs.

### 37.5 Offline Support (V1 scope)

- View recently visited pages from cache.
- Read offline: tasks, comments cached during the session remain available.
- Write offline: queue mutations in IndexedDB (via TanStack Query offline plugin); flush on reconnect.
- Mark new tasks created offline with a pending indicator.

---

## 38. Performance Requirements

### 38.1 Latency Targets

| Operation | p50 | p95 |
|---|---|---|
| API GET endpoints | 80 ms | 250 ms |
| API write endpoints | 120 ms | 400 ms |
| List view initial render (100 tasks) | 200 ms | 600 ms |
| Task detail open | 100 ms | 300 ms |
| Search query | 150 ms | 500 ms |
| WebSocket event echo | 50 ms | 200 ms |
| Form submission | 200 ms | 600 ms |

### 38.2 Throughput Targets (V1)

- 50 concurrent users
- 200 API requests/second peak
- 100 WebSocket events/second
- 1M total tasks in DB
- 10M total activity_log rows

### 38.3 Database Optimization

- Use prepared statements for hot paths.
- Connection pooling: PgBouncer in transaction mode; pool size 20.
- Partial indexes on common filter predicates.
- BRIN indexes on append-only tables (`activity_log`, `automation_runs`).
- Periodic `VACUUM ANALYZE`.

### 38.4 Frontend Optimization

- Code-split routes (Next.js automatic).
- Lazy-load heavy views (Gantt, Map) via `dynamic(import(...))`.
- Virtual scrolling for lists > 100 items (TanStack Virtual).
- Image lazy-load + `next/image`.
- Avoid waterfalls; parallel fetches via `Promise.all`.

---

## 39. Security Requirements

### 39.1 Input Validation

- All API endpoints use Zod schemas at the controller layer.
- Reject malformed JSON with 400 + `validation_error`.
- Reject unknown fields by default.

### 39.2 Output Encoding

- HTML rendered from rich text (Tiptap) sanitized via DOMPurify on render.
- No raw HTML in API responses for user-generated content.
- Email HTML sanitized server-side before send.

### 39.3 SQL Injection

- Drizzle ORM uses parameterized queries throughout.
- No raw concatenation in queries.
- Raw SQL escape hatches require code review.

### 39.4 Authentication Security

- Argon2id for password hashing.
- TOTP for 2FA (no SMS in V1 to avoid SMS interception cost/risk).
- Refresh tokens rotated on every use; old tokens revoked.
- Session expiry: refresh token 30 days, sliding window.
- Brute force protection: 5 failed logins → lockout 15 minutes; logged.

### 39.5 CSRF

- All state-changing endpoints require `X-CSRF-Token` header matching CSRF cookie value (double-submit pattern).
- CSRF cookie issued on first GET; rotated on login.

### 39.6 CORS

- Strict origin allowlist: only the configured frontend origin.
- `credentials: true` for cookie auth.

### 39.7 Rate Limiting

See [§33.7](#337-rate-limits).

### 39.8 File Upload Security

- Verify mime type via magic bytes, not just `Content-Type` header.
- Disallow executable extensions (see [§15.5](#155-limits-v1)).
- Generated thumbnails sandboxed (Sharp runs in worker process).
- S3 bucket: no public listing; objects accessed only via signed URLs.

### 39.9 Secrets Management

- All secrets in environment variables; never in source.
- `.env.example` template committed; actual `.env` gitignored.
- For production: use Docker secrets, Kubernetes secrets, or HashiCorp Vault.
- Rotation policy: secrets rotated every 90 days.

### 39.10 Transport Security

- HTTPS enforced; HTTP redirects to HTTPS.
- HSTS header: `max-age=31536000; includeSubDomains`.
- Secure cookies (`Secure` flag).
- TLS 1.2+.

### 39.11 Permission Enforcement

- ALWAYS check at backend, never trust frontend.
- Permission filter applied at SQL query level (e.g., `WHERE list_id IN (SELECT list_id FROM accessible_lists(user_id))`) to prevent IDOR.

### 39.12 Audit Trail

All security-relevant events logged to `activity_log` with `entity_type='security'`:
- Login success/failure
- 2FA enable/disable
- Password change
- Role change
- Permission grant/revoke
- API token creation (V2)

---

## 40. Error Handling Conventions

### 40.1 Backend

```typescript
class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: any
  ) {
    super(message);
  }
}

// Throw
throw new AppError('not_found', 404, 'Task not found');
throw new AppError('validation_error', 400, 'Invalid input', { fields: { ... } });
```

Global error handler middleware catches `AppError`, formats response:
```json
{ "error": { "code", "message", "details", "request_id" } }
```

Unhandled errors → 500 with `internal_error`; logged to Sentry with stack trace; response body strips internals.

### 40.2 Frontend

- TanStack Query `onError` handlers show toast with friendly message.
- Distinguish `403` (show "no permission" UI) from `404` ("not found" page) from `500` ("something went wrong, retry").
- Network errors → "Offline?" banner + retry button.

---

## 41. Logging & Monitoring

### 41.1 Application Logs

- Structured logging via Pino (JSON output).
- Fields: `level, time, request_id, user_id, msg, ...context`.
- Levels: trace, debug, info, warn, error, fatal.
- Production: log to stdout; collected by Docker → Loki/CloudWatch/etc.

### 41.2 Request Logging

Middleware logs each request:
- method, path, status, duration_ms, user_id, ip, user_agent.
- Slow requests (>500ms) logged at WARN.

### 41.3 Error Tracking

Sentry SDK in API + Frontend.
- Captures exceptions, stack traces, breadcrumbs.
- User context attached (id only, no PII).
- Source maps uploaded for frontend.

### 41.4 Metrics (V2)

Prometheus + Grafana:
- HTTP request rate / duration / errors
- Queue depths, job durations
- DB pool usage, query latency
- WebSocket connections

### 41.5 Health Checks

- `/api/health` — returns 200 if process alive.
- `/api/health/ready` — checks DB, Redis, S3 connectivity; returns 200 only if all healthy.

---

## 42. Deployment

### 42.1 Environments

- **Local:** docker-compose with Postgres, Redis, MinIO.
- **Staging:** mirror of production; smaller VPS.
- **Production:** single VPS for V1 (4 CPU, 8 GB RAM, 100 GB SSD).

### 42.2 Docker Compose (production sketch)

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: taskmgmt
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    restart: unless-stopped

  api:
    build: ./apps/api
    env_file: .env
    depends_on: [postgres, redis]
    restart: unless-stopped
    deploy:
      replicas: 1

  workers:
    build: ./apps/workers
    env_file: .env
    depends_on: [postgres, redis]
    restart: unless-stopped

  web:
    build: ./apps/web
    env_file: .env.web
    depends_on: [api]
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddydata:/data
    depends_on: [api, web]
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
  caddydata:
```

### 42.3 Environment Variables

```
# Database
DATABASE_URL=postgresql://...
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://...

# S3 (Cloudflare R2 or MinIO)
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_URL=

# Email
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com
EMAIL_INBOUND_DOMAIN=inbox.yourdomain.com

# Web push
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@yourdomain.com

# Auth
JWT_SECRET=<32+ bytes>
SESSION_SECRET=<32+ bytes>
ENCRYPTION_KEY=<32 bytes base64>  # for column encryption

# Frontend
NEXT_PUBLIC_API_URL=https://app.yourdomain.com/api
NEXT_PUBLIC_WS_URL=wss://app.yourdomain.com/realtime

# Sentry
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# Google
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URL=

# reCAPTCHA
RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=

# Application
APP_URL=https://app.yourdomain.com
APP_NAME=TaskMgmt
NODE_ENV=production
```

### 42.4 Migrations

Drizzle migrations:
- `drizzle-kit generate` → SQL files in `packages/db/migrations/`.
- On container start, run `drizzle-kit migrate` (idempotent).
- Migration files committed to repo.

### 42.5 Seeding

`packages/db/seed.ts`:
- Create workspace, owner user.
- Seed default Spaces, statuses, task types, custom fields per [§16.8](#168-default-v1-custom-fields-seeded-per-space).
- Seed default automations per [§20.8](#208-v1-seed-automations).
- Seed default dashboards per [§27.3](#273-v1-seed-dashboards).
- Seed default templates per [§29.5](#295-template-library-ui).

Run via CLI: `bun run seed`.

### 42.6 Backup

- Postgres: `pg_dump` daily via cron at 2 AM; encrypted, uploaded to off-VPS S3 bucket.
- Retention: 7 daily, 4 weekly, 6 monthly.
- S3 files: Cloudflare R2 has versioning; no separate backup.
- Restore tested monthly.

### 42.7 Zero-Downtime Deploy

- Database migrations: backward-compatible only (deploy migration before code that uses new columns; deploy column-drop after old code retired).
- Blue-green via `docker compose up -d --no-deps --build api` after migrations succeed.
- WebSocket: clients auto-reconnect on disconnect.

---

## 43. Testing Strategy

### 43.1 Levels

- **Unit:** business logic (permission resolver, formula engine, RRULE handling). Vitest or Bun's test runner.
- **Integration:** API endpoints against a real Postgres test DB. Test container via `testcontainers`.
- **E2E:** Playwright for critical user flows (login, create task, drag-drop, form submission).

### 43.2 Critical E2E Scenarios

1. Login → 2FA verify → land on home.
2. Create task in list, drag across statuses on board, see real-time update in another browser.
3. Create automation (status change → assign user) and verify it fires.
4. Submit public form → task appears in target list.
5. Filter list by custom field; verify results.
6. Upload attachment; see thumbnail.
7. Receive notification on @mention; click → opens task.

### 43.3 Coverage Target

- Backend unit: 70% line coverage on core logic (permissions, automation, formula).
- Integration: every API endpoint has at least one happy-path + one auth-failure test.
- E2E: 7 critical scenarios above.

---

## 44. Project Structure

(See [§5.3](#53-repository-structure) for high-level. Detailed below.)

```
task-management-system/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts          # Elysia app entry
│   │   │   ├── routes/           # Endpoint definitions per resource
│   │   │   │   ├── auth/
│   │   │   │   ├── tasks/
│   │   │   │   ├── lists/
│   │   │   │   ├── ... (one folder per resource)
│   │   │   ├── services/          # Business logic
│   │   │   ├── middleware/        # Auth, CORS, rate limit, error handler
│   │   │   ├── lib/               # Shared helpers
│   │   │   ├── emails/            # React Email templates
│   │   │   ├── automation/        # Engine, evaluator, executor
│   │   │   ├── events/            # Domain event emitter
│   │   │   ├── realtime/          # WebSocket
│   │   │   └── validators/        # Zod schemas (shared with packages/shared)
│   │   ├── tests/
│   │   └── package.json
│   ├── web/                       # Next.js (structure in §34.2)
│   └── workers/
│       ├── src/
│       │   ├── index.ts            # BullMQ workers entry
│       │   ├── jobs/               # One file per job type
│       │   └── crons/              # Cron schedulers
│       └── package.json
├── packages/
│   ├── db/
│   │   ├── schema.ts               # Drizzle schema
│   │   ├── migrations/
│   │   ├── seed.ts
│   │   └── index.ts
│   ├── shared/
│   │   ├── types/                  # TS types
│   │   ├── schemas/                # Zod schemas
│   │   ├── permissions.ts
│   │   ├── filter-engine.ts
│   │   ├── formula-engine.ts
│   │   └── constants.ts
│   └── ui/ (optional)              # Shared components if web has shareable bits
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── Caddyfile
├── scripts/
│   ├── seed.sh
│   ├── backup.sh
│   └── restore.sh
├── docs/
│   └── FINAL_Technical_Requirements.md (this file)
├── .env.example
├── .gitignore
├── bun.lockb
├── package.json
├── turbo.json
└── README.md
```

---

## 45. V1 Acceptance Criteria

The V1 release is complete when ALL of the following are true:

### 45.1 Functional

- [ ] Owner can be seeded via CLI; logs in.
- [ ] Owner can invite Admin/Member/Guest; invite email delivered.
- [ ] Invited user accepts via link, sets password, lands in workspace.
- [ ] 2FA setup works; TOTP verified on next login.
- [ ] Password reset flow end-to-end works.
- [ ] All 5 default Spaces seeded with their lists, statuses, custom fields, task types.
- [ ] Create/edit/delete: Space, Folder, List, Task, Subtask, Checklist, Comment, Tag.
- [ ] All 13 custom field types render input + store/retrieve values correctly.
- [ ] All 9 view types render: List, Board, Calendar, Gantt, Table, Workload, Map, Form, Activity.
- [ ] List view: drag-to-reorder, inline edit, group/sort/filter, calculate columns.
- [ ] Board view: drag-drop across columns, WIP limits, multi-select.
- [ ] Calendar: drag-reschedule, click-to-create, sync to Google Calendar (one task tested).
- [ ] Gantt: dependency arrows, drag bars.
- [ ] Table: spreadsheet-like editing, export to CSV.
- [ ] Workload: capacity colors, drag to reassign.
- [ ] Map: pins by location, color by status.
- [ ] Form: builder + public submission creates task + conditional logic works.
- [ ] Recurring task generates next instance on schedule (cron test).
- [ ] Dependencies block close (warning displayed).
- [ ] Tasks-in-Multiple-Lists ClickApp toggle works (if enabled, task can be added to additional list).
- [ ] Attachments upload + download + thumbnail.
- [ ] Comments: threaded, mentions notify, reactions, assign + resolve.
- [ ] Activity log: every state change appears.
- [ ] Notifications: in-app, email, push — all 3 channels deliver for `assigned` event.
- [ ] Snooze + unsnooze cycle works.
- [ ] DND respects time window.
- [ ] Real-time: editing task in browser A reflects in browser B within 1s.
- [ ] Email-to-task: sending email to list address creates task.
- [ ] Outbound emails: invitation, password reset, notification — all received.
- [ ] Calendar 2-way sync verified for Google.
- [ ] Search: full-text query returns tasks + comments + notes.
- [ ] All 5 seed automations work as specified.
- [ ] Custom automation can be built via UI and runs.
- [ ] Webhooks: outbound delivery + HMAC verified by recipient.
- [ ] Dashboards: all 4 seed dashboards render with live data.
- [ ] Time tracker: start/stop, switch task, manual entry, report.
- [ ] Reminders: create + delegate + receive notification at due time.
- [ ] Notepad: create note + convert to task.
- [ ] Inbox: shows notifications, mark read, snooze, archive.
- [ ] Templates: capture from existing task; apply to new list; date remap works.
- [ ] PWA: installable on mobile; push notifications received.
- [ ] Offline: cached pages viewable; queued writes flush on reconnect.

### 45.2 Non-Functional

- [ ] p95 API latency ≤ 250ms on 1000-task list under load.
- [ ] WebSocket latency ≤ 1s between two clients.
- [ ] 50 concurrent users tested (k6 or Artillery).
- [ ] Backup script runs nightly, restore from backup verified.
- [ ] All endpoints respect permission rules (auth/authz test suite passes).
- [ ] Rate limits enforced (verified via load test).
- [ ] Sentry receives test errors.
- [ ] HTTPS enforced, HSTS header present, CSRF tokens validated.
- [ ] No high-severity findings from a basic OWASP ZAP scan.
- [ ] Lighthouse score: Performance ≥ 80, Accessibility ≥ 90, PWA ≥ 90.

### 45.3 Operational

- [ ] One-command local setup: `docker compose up`.
- [ ] One-command seed: `bun run seed`.
- [ ] CI runs lint + typecheck + tests on every PR.
- [ ] Deployment runs migrations before code switch.
- [ ] Rollback procedure documented and tested.

---

## 46. V2 Roadmap (Out of Scope for V1)

Roadmap items to revisit after V1 ships and runs stably for 2–3 months.

### Higher Priority V2
- **Docs module** (Notion-style hierarchical pages with collaborative editing).
- **Whiteboard module** (shapes, sticky notes, connect-to-task).
- **AI integration via Anthropic/OpenAI:**
  - AI-summarize task threads
  - AI-draft comment replies
  - AI custom field type (sentiment, classification)
  - AI search ("show me overdue COD orders for Pathao")
- **Goals / OKR module.**
- **Custom roles** beyond Admin/Member/Guest.
- **Granular per-field permissions.**
- **Outlook Calendar integration.**
- **Slack/Discord notification mirroring.**
- **Mind Map view.**
- **Timeline view.**
- **Sprint module** (if dev team work expands).
- **Native mobile apps** (iOS + Android, React Native).
- **Better offline support** with full mutation queue.
- **Custom Task ID per-space prefixes** UI.
- **CSV import wizard** (general purpose).
- **Workspace audit log full export.**
- **Public API + API tokens** (for ops team to write small integrations).
- **Daily digest emails.**
- **Smart notification batching.**
- **Meilisearch** for richer search.
- **Per-day capacity** in Workload.
- **Workload exclusion of holidays (Bangladesh calendar).**

### Lower Priority V2
- Google SSO.
- View-only public sharing (read-only task page).
- Box View, Embed view, Mind Map view.
- Multi-workspace support.
- Multi-language UI (Bangla, Hindi).
- AI Notetaker for Zoom/Meet.
- Super Agents.
- Whiteboard advanced (image generation, AI sketch-to-task).
- Audit Log compliance certs.
- HIPAA-grade encryption.

---

> **End of Document.** This SRS is the single source of truth for V1. Any deviation MUST be documented as an ADR (Architecture Decision Record) in `/docs/adr/`.





