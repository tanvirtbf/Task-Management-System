# PHASE 07 — Users & members

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB · CODE
**Issues filed:** ISS-030 (MEDIUM) · ISS-031 (LOW)
**Data left behind:** none, but see §9 — this phase damaged real demo data mid-run and repaired it.
Final state verified: **16 users**, every name / email / role / status back to baseline, tasks 51,
invitations 1.

> Overlap with earlier phases: the invitation flow (P3), the role matrix and all six self-service
> rules (P4), and the deactivation token window (P3) were already proven. This phase covers what was
> *not* yet tested: list filtering, single reads, profile PATCH field-by-field, invite edge cases,
> what deactivation does to a person's work, and admin reset-password end to end.

---

## 1. `GET /users` — filters PASS, sorting does not exist

| query | result |
|---|---|
| `status=active` / `invited` / `deactivated` | 15 / 1 / 0 — correct |
| `status=bogus` | 422 |
| `role=owner/admin/member/guest` | 1 / 4 / 10 / 1 — correct |
| `role=bogus` | 422 |
| `q=nusrat` and `q=NUSRAT` | 1 each — case-insensitive |
| `q=beautybooth` | 14 (matches the email domain) |
| `q=@` / `q=` (empty) | 16 — no filtering, reasonable |
| `q=<300 chars>` | 422 |
| `role=admin&status=active` | 3 — filters combine correctly |

Default ordering is **stable** across identical calls.

**No sorting support.** `sort=name`, `sort=-name`, `sort=created_at`, `sort=-created_at`,
`order=desc` and `sort_by=email` all return a list byte-identical to the default — silently ignored
(instance of ISS-014). The default order is the `internal_id` keyset, which is neither alphabetical
nor chronological, so a members list of 100 people has no usable ordering.

## 2. `GET /users/:id` — PASS

Owner and member both 200. Unknown id → 404 `user.not_found`. Payload carries
`id, first_name, last_name, email, role, avatar_url, status, timezone, created_at, last_login_at`
and **no password or hash** (checked by string search for `password` and `$2b$`).

## 3. `PATCH /users/:id` — self-edit boundary is correct, one field leaks

| attempt | result |
|---|---|
| member edits **another** user | 403 `user.forbidden_edit` |
| member edits themselves | 200 |
| owner edits another user | 200 |
| `role: "owner"` (self escalation) | 422 |
| `status: "active"` (self status change) | 422 |
| `id: "u-hacked"` | 422 |
| `password: "..."` | 422 |
| `avatar_url: "javascript:alert(1)"` | 422 |
| `first_name: ""` / 300 chars | 422 |
| `timezone: "Not/AZone"` | **200, written → ISS-031** |
| `email: "attacker@evil.com"` | **200, written → ISS-030** |

Everything that would be an escalation is blocked. The two that get through are the timezone (no
IANA check, unlike the workspace endpoint) and the email (no verification).

## 4. Invite edge cases — PASS

| case | result |
|---|---|
| new address | 201 |
| re-invite while still pending | 409 `user.email_already_exists` |
| `notanemail` / `""` / `a@b` | 422 |
| `A@BEAUTYBOOTH.COM.BD` | 201 — address is **lower-cased** before storing, so no case-duplicate accounts |
| `role: "owner"` | 422 — the owner role cannot be handed out by invite |
| invitation rows after a re-invite | 1 — no duplicate row accumulation |

Invitation email delivery was already confirmed in P3 (real send via Mailtrap).

## 5. Deactivation — what happens to their work

| | before | after |
|---|---|---|
| task assignments | 1 | **1** — the task keeps them as assignee |
| watcher rows | 1 | 1 |
| live sessions | 1 | **0** — revoked |

The user stays in `GET /users` with `status: "deactivated"`, and the task still lists them in
`assignees`. That is a defensible choice (history stays intact), but it means a deactivated person
keeps showing up on task cards with no visual distinction — worth a UI check in P35.

Deactivate and reactivate are **idempotent** (204 on a repeat, no error). The catalog's
`user.not_active` / `user.not_deactivated` codes therefore never fire on this path — folded into
ISS-010 rather than filed separately, since idempotency is a reasonable design.

> Separately confirmed in P4: deactivation also **silently clears the person's space headship**
> (ISS-019).

## 6. Admin reset-password — PASS, correct design

```
POST /users/:id/reset-password        -> 202 {}
login with the OLD password           -> 200   (still valid — a LINK was sent, nothing was changed)
unconsumed reset tokens for them      -> 1
POST /auth/reset-password <token>     -> 204
login with the NEW password           -> 200
login with the OLD password           -> 401
```

The admin never learns or sets the password; the user completes it through the single-use link.
That is the right shape.

## 7. Permission gates

`member.invite`, `member.role_change`, `member.deactivate`, `member.reset_password` are all
**ENFORCED** (P5 probe). `member.view` and `member.edit_profile` are **NOT enforced** (P5, ISS-024).

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/members` and `/settings/profile` UI | this phase was API + source level | **P36** |
| Does a deactivated assignee render distinctly on a task card? | UI question raised by §5 | **P35** |

## 9. Damage caused and repaired during this phase

Worth recording plainly, because it *is* the evidence for ISS-030.

The field-by-field PATCH test changed Arif Chowdhury's email to `newmail@beautybooth.com.bd` — the
endpoint accepted it. That freed `arif@beautybooth.com.bd`, so the *next* test ("invite someone who
is already a member") did not hit `user.email_already_exists`; it created a **second, different
account** at that address named "A B". A third account, `a@beautybooth.com.bd`, came from the
uppercase-email invite probe.

Repaired: both created accounts deleted along with their role/session/activity rows, and Arif's
email restored. Verified afterwards — 16 users, all sixteen names, emails, roles and statuses
matching baseline exactly. Guest was deactivated and reactivated by the idempotency test and is
`active`.

## 10. Coverage vs the plan

8 of the 10 checklist lines executed here; 2 deferred to the UI phases; 3 more (invitation accept,
role matrix, deactivated-token window) were already completed in P3/P4 and are cross-referenced
rather than repeated.

**Evidence directory:** `testing/evidence/PHASE-07/` — 2 files.
