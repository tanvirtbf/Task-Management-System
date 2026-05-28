# BeautyBooth — Final Requirements
## A pure task management system for an ecom company that already has its own systems

> This document **supersedes** the BD-ecom-specific additions in
> `WHAT_SHUTKIHUT_ACTUALLY_NEEDS.md` Part 5 and the integration-heavy items
> in `API_DESIGN.md`. It is the single source of truth for what V1 ships.

---

## 1. The premise — read this first

BeautyBooth already runs on a stack of business systems:

| Existing system | Owns |
|---|---|
| **Website** | Order intake, product catalog, customer accounts, payments (SSLCommerz), shipping label printing |
| **POS** | In-store / walk-in sales |
| **Sales tracker** | Money flow, stock counts, returns, COGS, payouts |
| **Inventory system** | SKUs, batches, expiry dates, reorder levels, supplier database |
| **Courier dashboards** | Pathao / Steadfast / RedX / Sundarban — tracking, status, delivery |
| **Facebook Ads Manager** | Boost spend, ad metrics, ROAS |

**This task management system is a thin coordination layer ON TOP.** It tracks **who-does-what-when**, nothing else.

### The one rule

> If a piece of data is owned by another system, **we do not store it here**.
> We may reference it (by ID, by URL link) but we never duplicate it.

If a feature would require re-typing data that already exists in the website / POS / sales tracker / inventory system, that feature is **out of scope**.

---

## 2. What this system explicitly does NOT do

| Out of scope | Why | Lives in |
|---|---|---|
| ❌ Process payments | We don't take money | Website + SSLCommerz |
| ❌ Integrate with SSLCommerz / bKash / Nagad | Same | Website |
| ❌ Execute refunds | Triggers a payment reversal | Website + SSLCommerz |
| ❌ Call Pathao / Steadfast / RedX / Sundarban APIs | We don't dispatch parcels | Website + courier portals |
| ❌ Receive courier status webhooks | Tracking is the courier dashboard's job | Courier portal |
| ❌ Track inventory levels / stock counts | Real stock data | Inventory system |
| ❌ Batch + expiry tracking | Regulatory inventory feature | Inventory system |
| ❌ Stock movement ledger | Real money + units | Sales tracker + Inventory |
| ❌ Auto-reorder when stock low | Inventory's job | Inventory system |
| ❌ Customer database / CRM | Phone, name, address per customer | Website's customer table |
| ❌ Customer lifetime value, VIP detection | CRM aggregation | Sales tracker |
| ❌ Order history per customer | Order system | Website + sales tracker |
| ❌ Order line items (which products, what price) | Order data | Website |
| ❌ COD reconciliation | Money flow | Sales tracker |
| ❌ SMS sending (Bulk SMS BD) | Customer-facing comms | Website |
| ❌ Daily revenue / sales dashboards | Business reporting | Sales tracker |
| ❌ Product catalog management | E-commerce admin | Website CMS |
| ❌ Influencer fee + ad spend tracking | Marketing finance | Sales tracker + FB Ads |

**The system never integrates with payment gateways or courier APIs.**
**No `SSLCOMMERZ_*`, `PATHAO_*`, `STEADFAST_*`, `BKASH_*`, `SMS_*`, `FB_*` credentials are ever needed.**

---

## 3. What this system DOES do — task management

For all 6 teams, this system answers:
- "What do I need to do today?"
- "Who is working on which task right now?"
- "Where is this piece of work blocked?"
- "Has team X finished their part so team Y can start?"

The unit of work is a **Task** — something a human (or an automated job) needs to do. It has:
- A name
- Optional description (with a link to the actual data if it's in another system)
- A status (where in the workflow)
- One or more assignees
- A due date, priority, tags
- Comments, checklists, attachments — for the people working on it to coordinate

That's it. The system is a coordination layer, not a database of business facts.

---

## 4. The 6 teams — what each one uses tasks for

> A **space** is a team. Tasks live in **lists** inside a space.
> **Each task represents WORK to be done, not business data.**

### 4.1 Operations (≈40 people) — order fulfillment work

| List | Each task represents |
|---|---|
| Facebook Orders | "Process FB order ORD-1042" — referencing the website order |
| Website Orders | "Process website order WS-9831" |
| Returns & Exchange | "Handle return request from order ORD-1042" |
| Daily Operations | "End-of-day cash reconciliation" (recurring) |

Task carries: order ID as a **text reference** + status + assignee + due date.
Task does NOT carry: customer phone, address, COD amount, courier name, tracking ID. The team looks those up in the website admin (one click away).

### 4.2 Inventory (≈5-10 people) — supplier + audit work

| List | Each task represents |
|---|---|
| Purchase Orders | "Follow up with supplier ABC on PO-042" |
| Damaged Stock | "Investigate damaged shipment received 2026-05-15" |

The actual stock levels, batch numbers, expiry dates → **inventory system** (already exists). The task is about the WORK around inventory, not the inventory itself.

### 4.3 Customer Support (≈10 people) — complaint resolution

| List | Each task represents |
|---|---|
| Complaints | "Resolve complaint about late delivery on ORD-1042" |
| Queries | "Reply to FB DM from customer Karim" |

Task carries: order-ID reference (text), issue type, channel, resolution status. Customer history → website CRM.

### 4.4 Product Listing (≈5-10 people) — per-product pipeline

| List | Each task represents |
|---|---|
| New Product Pipeline | "Launch SKU NIC-30 — Niacinamide 30ml" (7-step checklist: source → photo → content → price → upload → FB post → live) |
| Photo Shoots | "Shoot 5 products at studio next Tuesday" |

Task carries: SKU reference, pipeline stage, brief link. Product data itself → website CMS.

### 4.5 Marketing (≈5 people) — campaign + content work

| List | Each task represents |
|---|---|
| Content Calendar | "FB post for Tuesday morning — moisturizer launch" |
| Active Campaigns | "Eid campaign — creative + copy + schedule" (parent task with checklist) |
| Boost Manager | "Boost the Niacinamide reel" |

Task carries: channel, brief link (Google Doc / Figma), scheduled date. Ad spend + ROAS → Facebook Ads Manager.

### 4.6 Engineering (≈5-15 people) — software dev work

| List | Each task represents |
|---|---|
| Bug Triage | "Bug: checkout button unresponsive on mobile Safari" |
| Sprint Board | "Feature: add SSLCommerz hosted checkout (to the website)" |
| Backlog | "Tech debt: refactor admin module" |
| Incidents | "Production: checkout 500 errors" |

Engineering tasks have extra fields (story points, severity, branch name, PR URL, reviewer) — these are **task attributes for software work**, not duplicating any other system. The work being tracked here is about maintaining ALL of the company's systems (website, POS, sales tracker, the task system itself).

---

## 5. Core features — every team uses

| # | Feature | Notes |
|---|---|---|
| 1 | Email + password auth + invitations + password reset | No 2FA |
| 2 | Two effective roles: Admin / Member (Owner is one person) | |
| 3 | 6 spaces + lists inside them | |
| 4 | Per-list status workflows with 4 groups | Workflow templates, not order data |
| 5 | Tasks with name, description, status, priority, assignee(s), due date, tags | |
| 6 | Custom task IDs per list (`ORD-1042`, `FEAT-220`) | For verbal reference |
| 7 | Comments — flat + 1-level threading + delete | |
| 8 | Checklists (single-level) | |
| 9 | Attachments — generic file upload + download | Cloudflare R2 |
| 10 | Tags — workspace-wide | |
| 11 | Generic custom field types: Text, Phone, Money, Date, Dropdown, Files | **No pre-populated order/customer/stock fields** |
| 12 | 3 views: List, Board, Calendar (+ Form for public intake) | |
| 13 | Public form for outside intake | Free-form, any team can use |
| 14 | Notifications: in-app bell + email | |
| 15 | Global search by name + custom ID | |
| 16 | Recurring tasks (Daily / Weekly) | |
| 17 | Per-task activity log + light workspace activity log | |
| 18 | Task templates (e.g., "Festival campaign with 12-step checklist") | Generic — any team can have templates |
| 19 | SLA on tasks — set due window, surface breaches | Pure task feature |
| 20 | Mobile-responsive web | No PWA, no native app |

---

## 6. Engineering-specific features (gated by task type)

Available **only when `task_type.is_dev_type = true`** (Bug, Feature, Tech Debt, Incident, Release). Operational task drawers stay simple — they never see this complexity.

| # | Feature | Notes |
|---|---|---|
| E1 | Real subtasks (parent-child Tasks) | 2 levels max |
| E2 | Task dependencies (blocks / blocked-by) | |
| E3 | Rich text editor for descriptions (TipTap, code blocks, markdown) | |
| E4 | @Mentions + #task-id cross-references in comments | |
| E5 | Sprint system (Sprint Board + story points + capacity bar) | |
| E6 | On-call rotation (weekly, current-week badge) | |
| E7 | Reviewer field (distinct from assignees) | |
| E8 | Git URL fields (branch name, PR URL, PR status — manual paste, no webhook) | |
| E9 | Bug-specific fields (severity S0–S3, repro, env, browser, reporter team) | |
| E10 | Cross-team bug intake — "Report a bug" button in sidebar (visible to all teams) | Routes to Engineering / Bug Triage |
| E11 | Postmortem checklist on resolved incidents | |
| E12 | Deploy / rollback timestamp on tasks | |

---

## 7. What to REMOVE from the current build

### 7.1 Frontend

| Path | Action | Reason |
|---|---|---|
| `client/src/pages/customers/` | DELETE entire directory | CRM = website |
| `client/src/mocks/customers.ts` | DELETE | Same |
| `client/src/components/shared/Sidebar.tsx` | Remove `Customers` nav item | |
| `client/src/router.tsx` | Remove `/customers` route + `CustomersPage` lazy import | |
| `client/src/lib/bd-phone.ts` | KEEP (light helper for the Phone custom field) | Generic utility |
| `client/src/lib/bdt.ts` | KEEP (Money custom field formatting) | Generic utility |
| `client/src/components/shared/Topbar.tsx` "On-call" badge | KEEP — engineering feature | |
| Home page KPIs that reference external data (Today's Orders, COD Collected, Low Stock, Stuck Orders >2h) | DELETE; replace with task-only KPIs (§8) | Duplicate other systems |
| `RemindersDueCard` on Home | DELETE | Reminders dropped per spec |

### 7.2 Mocks — custom fields that duplicate other systems

**Delete** these pre-seeded custom fields from `client/src/mocks/custom-fields.ts`:

```
Operations (Facebook Orders / Website Orders) — DELETE all of:
  cf_customer_name, cf_customer_phone, cf_address,
  cf_products, cf_order_value, cf_cod_amount,
  cf_courier, cf_tracking_id, cf_payment_status

Workspace-wide:
  ORDER_SOURCE_FIELD                         ← DELETE (duplicates website)

Stock Master (entire list deleted — see 7.3):
  cf_sku, cf_current_stock, cf_reorder_level, cf_supplier,
  cf_lead_time, cf_last_restock, cf_stock_status

Returns:
  cf_return_order_number                     ← KEEP (just a text reference)
  cf_return_reason                           ← KEEP (workflow info)

Complaints:
  cf_order_number                            ← KEEP (text reference)
  cf_issue_type                              ← KEEP (workflow categorisation)
  cf_channel                                 ← KEEP (FB / Phone / Web / Courier)
  cf_resolution                              ← KEEP (workflow notes)

New Product Pipeline:
  cf_product_sku                             ← KEEP (text reference)
  cf_category                                ← KEEP (workflow categorisation)
  cf_cost_price                              ← DELETE (sales tracker has cost)
```

Net: drop ~16 of 20 pre-seeded custom fields. The custom-field **types** (Text, Phone, Money, Date, Dropdown, Files) stay so users can still create their own.

### 7.3 Lists — drop the two that duplicate other systems

| List | Action | Reason |
|---|---|---|
| `l-stock` (Stock Master) | **DELETE** | Stock data lives in inventory system |
| `l-cod-issues` (COD Issues) | **DELETE** | Payment data lives in sales tracker; fold into Complaints if needed |
| All other 17 lists | KEEP | They're task coordination buckets |

### 7.4 Database schema — tables + views to remove

| Object | Action | Reason |
|---|---|---|
| Table `customers` | **DELETE** | CRM = website |
| Table `stock_batches` | **DELETE** | Inventory system |
| Table `stock_movements` | **DELETE** | Inventory system |
| View `v_stock_levels` | **DELETE** | Depends on `stock_movements` |
| View `v_expiring_batches` | **DELETE** | Depends on `stock_batches` |
| All other 30 tables | KEEP | Pure task management |

**Schema goes from 33 tables → 30 tables. Views from 7 → 5.**

### 7.5 API design — endpoints to remove

| Section | Endpoints | Action |
|---|---|---|
| §20 Customers (`/customers/*`) | 7 endpoints | **DELETE** |
| §31 Inventory operations (`/inventory/batches`, `/inventory/movements`, `/inventory/levels`) | 9 endpoints | **DELETE** |
| §28 Webhook receivers — `/webhooks/website`, `/pathao`, `/steadfast`, `/sslcommerz`, `/facebook`, `/sms-delivery` | 6 endpoints | **DELETE** |
| §30 Background jobs that touched external services (`pathao-poll`, `steadfast-poll`, `auto-reorder`, `expiring-batches`, `stock-level-sync`) | 5 jobs | **DELETE** |
| §24 Festival campaigns | 2 endpoints | **RENAME** to `GET /templates`, `POST /templates/:id/apply` (generic) |
| §32 SLA management | 3 endpoints | **KEEP** — SLA is pure task management |
| §33 Health & diagnostics | 4 endpoints | **KEEP** |
| §34 Cross-cutting essentials | All | **KEEP** |

**API design goes from 168 endpoints → ~138 endpoints.**

### 7.6 Drizzle schema files

- `server/src/db/schema/customers.ts` — **DELETE file**
- `server/src/db/schema/inventory.ts` — **DELETE file**
- `server/src/db/schema/relations.ts` — remove customer + inventory relations
- `server/src/db/schema/views.ts` — remove `vStockLevels`, `vExpiringBatches`
- `server/src/db/schema/index.ts` — remove the two deleted re-exports
- `server/src/db/migrations/_post.sql` — remove `v_stock_levels` and `v_expiring_batches` view DDL
- Re-run `npx drizzle-kit generate --name initial`

### 7.7 No external service credentials anywhere

Strike from any `.env.example` / docs / comments:

```
SSLCOMMERZ_*    BKASH_*     NAGAD_*
PATHAO_*        STEADFAST_*  REDX_*  SUNDARBAN_*
BULK_SMS_BD_*   SMS_*
FB_APP_*        FB_PAGE_*   FB_WEBHOOK_*
```

The system never calls these APIs. They never appear in code, docs, or env.

---

## 8. Home page — task-only KPIs

Replace the 6 ecom-flavoured KPIs with these task-management metrics:

| KPI | Source query | Comment |
|---|---|---|
| **My open tasks** | `tasks WHERE I'm assigned AND status not done/closed AND archived_at IS NULL` | What I need to do |
| **Due today** | Same + `due_date = CURDATE()` | Today's priority |
| **Overdue** | Same + `due_date < CURDATE()` | Past deadline |
| **Awaiting my review** (engineering) | `tasks WHERE reviewer_id = me AND pr_status = 'open'` | Eng-only — hidden if user isn't in Engineering |
| **Open team tasks** | Workspace-wide count of open tasks, grouped by space | Cross-team visibility |
| **SLA breaches** (CS + Eng) | `WHERE sla_due_at < NOW() AND completed_at IS NULL` | Pure task feature |

Plus retained existing cards:
- `MyWorkCard` (Today / Overdue / Next 7 days / Unscheduled / Done buckets) — KEEP
- `AgendaCard` (today's schedule from due dates) — KEEP, source = tasks (not reminders)
- `LineUpCard` — KEEP
- `RecentActivityCard` — KEEP (workspace activity log)
- `RemindersDueCard` — DELETE

---

## 9. Net effect — before vs after

| Dimension | Before this cleanup | After |
|---|---|---|
| Database tables | 33 | **30** |
| Database views | 7 | **5** |
| API endpoints | 168 | **~138** |
| Frontend page directories | 13 | **12** |
| External service creds needed | 11+ (R2, SMTP, DB, Redis, JWT, SSL, Pathao, Steadfast, bKash, SMS, FB) | **5** (R2, SMTP, DB, Redis, JWT) |
| Pre-seeded custom fields | 20 | **~7** (only workflow categorisation ones) |
| Lists | 19 | **17** |
| Conceptual surface | "BD ecom task system" | **"Generic task management for 6 teams"** |
| Backend implementation surface | 168 endpoints + 6 webhook integrations + 5 polling jobs | **138 endpoints + 0 integrations + 0 polling** |

---

## 10. Effort to apply this cleanup

| # | Step | Effort |
|---|---|---|
| 1 | Delete `customers` page + mocks; strip ecom-specific custom fields from `mocks/custom-fields.ts` | 2 h |
| 2 | Drop Stock Master + COD Issues lists; clean their statuses | 1 h |
| 3 | Delete `customers`, `stock_batches`, `stock_movements` from `database/schema.sql`; re-test in MySQL | 1 h |
| 4 | Delete `customers.ts` + `inventory.ts` from Drizzle schema; update relations + views + index + `_post.sql`; regenerate migration | 1 h |
| 5 | Cut §20, §31, ecom webhooks, ecom background jobs from `API_DESIGN.md`; rename Festivals → generic Templates | 1 h |
| 6 | Rewrite Home KPIs (drop ecom, add task-management) | 2 h |
| 7 | Strip ecom-creds notes from any `.env.example` and docs | 0.5 h |
| 8 | Verify: `tsc --noEmit`, `vite build`, `drizzle-kit generate`, MySQL import, headless browser audit | 1 h |

**Total cleanup: ~1 day before backend implementation begins.**

---

## 11. Credentials list — final, minimal

| # | Credential | Purpose | Setup |
|---|---|---|---|
| 1 | **MySQL** (host / user / password / db) | The task database | VPS self-host OR DigitalOcean managed DB ($15/mo) |
| 2 | **Cloudflare R2** (account id / access key / secret / bucket) | File attachments | Cloudflare dashboard → R2 → create bucket + API token |
| 3 | **SMTP** (Resend / Brevo / SES) | Invitations, password reset, daily digest | Resend free tier (100/day) is enough |
| 4 | **Domain + DNS** | `api.beautybooth.com`, `app.beautybooth.com` | Cloudflare DNS (free) |
| 5 | **VPS** | Where backend runs | Hetzner CCX23 (~৳1600/mo) or DigitalOcean 4GB |
| 6 | **JWT + cookie + webhook secrets** | Auth + session signing | Generated by `openssl rand -base64 48` |
| 7 | **Redis** (optional in V1, mandatory for production-grade rate limiting + caching) | Rate limit, idempotency, sessions cache | Upstash free tier or self-hosted on VPS |

**That's it. 5 external services (R2, SMTP, MySQL, Redis, Domain) + 1 VPS. No SSLCommerz / Pathao / Steadfast / bKash / Nagad / SMS / FB ever.**

---

## 12. The principle going forward

When considering any new feature, run it through this three-question filter:

1. **Does it duplicate data from website / POS / sales tracker / inventory / courier?** → **Reject.**
2. **Does it require an outbound API call to a 3rd-party service that another system already calls?** → **Reject.**
3. **Does it answer "who does what when" for one of the 6 teams?** → **Accept.**

Stay disciplined on this. The strength of a coordination layer is that it's **lightweight and never falls out of sync with the data systems** — because it doesn't try to be a data system.

---

## 13. Open questions for confirmation

Before applying the cleanup in §7, confirm:

1. **Cross-team intake form** — Each space has a public form (via §5 item 13). Customer Support's complaint form was the original use case. Confirm that's still useful even without auto-populating customer fields (it just creates a task with the form data attached).

2. **Festival campaign template** — Currently labeled with BD festival names (Eid, Pohela Boishakh, 11.11). Keep the **mechanism** as a generic "task template" feature, but I'll generalise the label from "Start festival campaign" to "Apply template" with the user able to add their own templates in settings. Confirm.

3. **Bangla phone validation + BDT formatting** — These are 2 small utility files (`lib/bd-phone.ts`, `lib/bdt.ts`). Used by the Phone custom-field renderer and the Money custom-field renderer. Confirm keep as generic locale-friendly helpers (they don't bring any business logic, just formatting).

4. **Engineering space — should it be optional?** — Some companies don't have an in-house dev team. If BeautyBooth ever spins off their tech to a contractor, they wouldn't need the Engineering space. Keep it as default-on but make it possible to hide via a workspace setting? Or always-on?

Answer these and I'll execute the cleanup.

---

*Last updated: 2026-05-28. Single source of truth. If a feature isn't in §5 (core) or §6 (engineering), it's out of V1.*
