# PHASE 04 — Legacy role authorization (owner / admin / member / guest)

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** ISS-019…ISS-022 (MEDIUM) · ISS-023 (LOW)
**Data left behind:** none. Post-phase verification: users 16, all four demo roles at their baseline
values, spaces with a head 6 (baseline), TEST- tasks 0, TEST- tags 0, TEST-p4 comments 0,
attachments 1 (pre-existing), R2 bucket back to its 2 legitimate objects.

> **Probe technique.** Route-level gates run *before* validators (established in P2), so every
> guarded write was probed with an **invalid payload or a nonexistent id**: `403` means the gate
> fired, `422`/`404` means the request got past it. That produced a complete 4-role matrix over 71
> endpoints **without mutating anything**. Service-level gates (which sit after validation) were
> then tested with real fixtures, all removed afterwards.

---

## 1. The real role matrix — 71 probes × 4 roles

Full grid in `testing/evidence/PHASE-04/role-matrix.txt`. The shape of it:

| | probes denied |
|---|---|
| **owner** | 0 of 71 |
| **admin** | 2 of 71 |
| **member** | 48 of 71 |
| **guest** | 48 of 71 |

**Finding of the matrix: the four roles are really two-and-a-bit tiers.**

- **owner ≡ admin** on 48 of the 50 gated endpoints. The *only* two that separate them are
  `DELETE /spaces/:id` and `DELETE /lists/:id` (owner passes the gate, admin gets 403). That matches
  the documented intent exactly.
- **member ≡ guest** — *identical on all 71 probes*. At the route layer there is **no difference
  whatsoever** between a member and a guest. Everything that distinguishes them lives in service
  code (§4).
- 21 probes denied nobody. 12 of those are the ungated task/comment/checklist/dependency/upload/
  template-apply writes — the route-level half of `SCAN-H1`, independently reconfirmed here. The
  other 9 are reads that are open to everyone by design.

## 2. Reads open to every role

`GET /users`, `/workspace`, `/activity`, `/reports`, `/sla/breached`, `/eng/home`, `/home/kpis`,
`/sprints`, `/on-call/current` all return 200 for a guest.

Checked what a guest actually *gets*:

| endpoint | owner sees | guest sees | verdict |
|---|---|---|---|
| `/reports` | 12 | **0** | filtered correctly in the service |
| `/users` | 16 | 16 (email, role, status, last_login_at) | full staff directory — matches the seeded guest role, which holds `member.view` |
| `/activity` | 14 | 14 | no filtering |
| `/spaces` `/lists` `/sprints` | 9 / 14 / 1 | same | no filtering |
| `/home/kpis` `/eng/home` `/search` `/workspace` | — | same shape, no fields hidden | — |

`GET /spaces/:id/review-summary` and `/review-queue` are the exception: **member and guest both get
403 `review.not_head`** — a real service-level gate.

## 3. Guest redaction — narrower than the name suggests, and one call site skips it

"Guest redaction" in this codebase means exactly one thing: **custom-field values flagged hidden are
withheld from guests**, via a `redactGuest` boolean threaded into
`TasksRepo.customFieldValuesByTask()`. It is not a broad field-level redaction, and the
owner-vs-guest shape diff confirmed that: no other field is hidden on any endpoint.

Ten of the eleven call sites pass the flag; `ReviewsService.ts:515` hardcodes `false` → **ISS-023**
(latent only — that path is head-gated, and guests cannot be heads).

## 4. Service-level gates — all correct

| gate | guest | member | admin | owner |
|---|---|---|---|---|
| `POST /tasks/:id/attachments` (upload) | **403** | 201 | 201 | 201 |
| `DELETE /tasks/:id?hard=true` | 403 | 403 | **204** | **204** |
| `DELETE /comments/:id` (someone else's) | 403 | 403 | **204** | — |

So the only member↔guest difference in the whole system is **attachment upload**, exactly as
`DEMO_ACCOUNTS.md` claims. Verified rather than assumed.

## 5. Self-service rules — all six correct

| rule | result |
|---|---|
| owner changes own role | 403 `user.cannot_change_owner_role` |
| admin demotes the owner | 403 `user.cannot_change_owner_role` |
| owner deactivates self | 403 `user.cannot_deactivate_owner` |
| admin deactivates the owner | 403 `user.cannot_deactivate_owner` |
| admin deactivates self | 403 `user.cannot_self_deactivate` |
| admin promotes anyone to `owner` | 422 — `owner` is not an assignable value |

The owner account is therefore an un-removable floor, which is what makes ISS-020 recoverable.

## 6. Last-admin rule — NOT enforced (ISS-020)

All three admins were demoted and the last one deactivated, leaving **zero active admins**. No
`role.last_admin` anywhere. That error code exists but guards only the dynamic-RBAC assignment path,
not `PATCH /users/:id/role`. All three accounts were restored and verified.

## 7. Role-change staleness — the P3 deferred item, now answered (ISS-021)

A user demoted `member → guest` uploaded an attachment with their **pre-change token** and got
**201**, while a freshly-issued guest token is correctly refused with 403. The read surfaces
(`/auth/me`, `/me/permissions`) report the new role immediately; only enforcement lags, by up to the
15-minute token TTL.

## 8. Discovered by accident, then isolated

Two findings came out of cleaning up after the last-admin test rather than from a planned check:

- **ISS-019** — deactivating a user silently clears `spaces.head_user_id`. Reproduced deliberately
  on a second space/user pair to prove it is deactivation (not the role change) and that reactivate
  does not undo it.
- **ISS-022** — the four attachments uploaded in §4 were still in R2 after their task rows were
  hard-deleted, because the FK cascade removes the rows the purge job relies on. Confirmed the FK
  rule is `CASCADE` and removed the orphans by hand.

## 9. Cleanup performed

- 3 admins restored to `admin`/`active`; `tanvir@` also un-deactivated
- Engineering and Marketing space heads restored (both cleared by ISS-019 during testing)
- All `TEST-p4-*` tasks, comments and tags removed
- 4 orphaned R2 objects deleted; bucket verified back at 2 legitimate objects
- `PATCH /workspace {bogus:1}` was checked for side effects — name, timezone and `week_starts_on`
  unchanged and no `workspace_activity` row, though the probe did bump `updated_at`
- `Accounts` space (created 2026-07-29 16:06, untouched since) predates this session — not ours

## 10. Coverage vs the plan

All 8 checklist lines executed, plus the item deferred from P3. 5 findings filed; the matrix,
guest/member boundary, self-service rules and service gates are all characterised with evidence.

**Evidence directory:** `testing/evidence/PHASE-04/` — 5 files.
