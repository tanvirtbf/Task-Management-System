# PHASE 05 — Dynamic RBAC (the 56-permission system)

**Status:** PARTIAL (5 permissions inconclusive, UI deferred — §8)
**Methods:** API · DB · CODE
**Issues filed:** ISS-024, ISS-025 (HIGH) · ISS-026 (MEDIUM) · ISS-027 (LOW)
**Data left behind:** none. Post-phase: users 16, roles 5, tasks 51, spaces 9, lists 14, tags 8,
custom_fields 0, forms 1, sprints 1, task_types 7 — all baseline. The `Admin` system role name was
restored after ISS-026, and two probe users plus their FK-blocking rows were removed.

---

## 1. The enforcement probe — the phase's main deliverable

**Method.** A throwaway user was invited and accepted, then given a purpose-built custom role as
their *only* assignment. Two passes over all 56 permissions, each against fresh fixtures:

- **Pass 1** — the role grants only `space.view` + `task.view` (the minimum needed to see anything).
- **Pass 2** — the role grants all 56.

`ENFORCED` = denied in pass 1, allowed in pass 2. `NOT ENFORCED` = succeeded in pass 1 with the
permission withheld. A second run then rebuilt the fixtures for the 14 initially inconclusive cases
with correct payloads, and temporarily raised the probe user's *legacy* role to `admin` so the
legacy gates stopped masking the RBAC layer.

**Result**

| verdict | count |
|---|---|
| **ENFORCED** | **30** |
| **NOT ENFORCED** | **18** |
| enforced by another mechanism | 2 — `space.view` (visibility), `task.view` (own-escape) |
| blocked by a different gate, permission moot | 1 — `report.note` |
| inconclusive | 5 |

Full detail in **ISS-024**. Three of SCAN-H1's estimated-unenforced entries turned out to be
enforced (`report.generate`, `review.read`, `space.head_assign`) — the live probe is the
authoritative list now.

The five inconclusive ones (`customfield.set_value`, `template.apply`, `form.view_submissions`,
`postmortem.manage`, `review.perform`) need fixtures their owning phases build anyway → P12, P27,
P26, P29, P31. `form.view_submissions` is blocked by ISS-025, not by a fixture problem.

## 2. `GET /me/permissions` — PASS

| role | keys | is_owner | visible_space_ids |
|---|---|---|---|
| owner | **56** (full floor) | true | null (all) |
| admin | 53 | false | null |
| member | 20 | false | null |
| guest | 19 | false | null |
| Department Only | 8 | false | **1 space** |

Top-level shape `{version, is_owner, role, visible_space_ids, permissions}`. Each entry carries
`{all, space_ids, own, own_space_ids}` — the four scope dimensions. **Zero camelized permission
keys** on the wire, so the client's `SKIP_CAMELIZE_URLS` exception holds.

## 3. Roles CRUD — mostly PASS, two findings

| check | result |
|---|---|
| create / update / delete a custom role | 201 / 200 / 204 |
| delete a **system** role | 409 `role.system_immutable` |
| edit the **Owner** role's permissions | 409 `role.owner_immutable` |
| unknown permission key | 422 `role.unknown_permission` |
| unsupported scope for a key (`workspace.settings` at `own`) | 422 `role.unsupported_scope` |
| `PUT /roles/:id/permissions` — set 2, then set 1 | grants end up **exactly 1** — a true atomic replace, not a merge |
| `GET /roles/:id/holders` | 200 |
| **rename a system role** | **200 — allowed → ISS-026** |
| **duplicate role name** | **201 — allowed → ISS-027** |

## 4. Escalation — PASS

An **admin** (who does not hold `space.delete`) tried to grant `space.delete` to a new role:
**403 `role.escalation_blocked`**. The guard works.

## 5. Space scoping + IDOR sweep — PASS, zero leaks

`marketing.only@` sees exactly one space: **Marketing**.

**84 cross-space reads** were attempted with real ids harvested from **6 foreign spaces**
(Customer Service, Engineering, Politics, Orders & Fulfillment, Product & Inventory, Social Media &
Content) across 14 endpoint families each — space, list, list-tasks, task, comments, activity,
subtasks, reviews, dependencies, attachments, checklists, statuses, forms, custom-fields.

**Result: 0 leaks.**

Writes into a foreign space are refused as 404 (never 403 — so the id is not confirmed to exist):

```
create task in a foreign list   -> 404 list.not_found
edit a foreign task             -> 404 task.not_found
comment on a foreign task       -> 404 task.not_found
archive a foreign task          -> 404 task.not_found
```

This is the strongest part of the RBAC implementation. The *visibility* layer is genuinely solid;
it is the *verb* layer (§1) that is half-finished.

## 6. Revocation is instant — PASS

Revoking `comment.create` from the Department Only role and re-reading `/me/permissions` **with the
same, unrefreshed token**: keys 8 → 7, `version` 35 → 36, the key gone immediately. No 15-minute
window. This is the behaviour the legacy `role` claim does *not* have (ISS-021).

## 7. `is_private`

`lists.is_private` exists, 0 rows use it, and it is referenced in 9 source files. Consistent with
the documented "decorative by design — narrow `space.view` instead" decision. No behaviour to test
while no list is marked private; re-check in P9 if a fixture is created there.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| 5 inconclusive permissions | need fixtures the owning phases build | P12 · P26 · P27 · P29 · P31 |
| `/settings/roles` UI — grid, role creation, permission toggling, save, reload | this phase was API-only | **P36** |
| `own` / `own_space` scope behaviour in depth | the probe used `all`-scoped grants; per-scope narrowing needs task-ownership fixtures | **P15** (task update) |

## 9. Environment note discovered mid-phase

The live dev database is **missing `form_submissions.encrypted_at` and `expires_at`** (ISS-025).
This is the second independent drift between the local database and `schema.sql` (the first being
SCAN-H4's three extra triggers). It must be fixed before **P26 (Forms)** runs, or that phase will
be testing a broken environment.

It also refines a P1 statement: P1 compared schema.sql and Drizzle at *table* level (41/41) and
reported parity. This phase ran the first *column*-level diff — one real discrepancy, everything
else clean.

## 10. Coverage vs the plan

12 of the 14 checklist lines executed; 1 deferred to P36 (UI), 1 partially deferred to P15 (scope
depth). The headline deliverable — a definitive 56-row ENFORCED/NOT-ENFORCED table with evidence per
row — is complete.

**Evidence directory:** `testing/evidence/PHASE-05/` — 6 files.
