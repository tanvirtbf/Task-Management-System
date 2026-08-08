# PHASE 08 — Spaces

**Status:** PARTIAL (UI deferred; one guard not reachable — §8)
**Methods:** API · DB
**Issues filed:** ISS-032 (MEDIUM) · ISS-033, ISS-034 (LOW)
**Data left behind:** none. Final state verified: 9 spaces, all six heads intact, none archived, no
duplicates. A duplicate "Marketing" created during testing was identified by `created_at` + list
count and removed.

> Already proven elsewhere and not repeated: `space.create/edit/archive/delete/head_assign/
> members_manage` permission gates (P5 — all ENFORCED), owner-vs-admin on `DELETE /spaces/:id` (P4),
> and the cross-space IDOR sweep (P5 — 84 reads, 0 leaks).

---

## 1. Create — validation

| body | result |
|---|---|
| full valid | 201 |
| `{name}` only | 201 — icon/colour optional |
| empty name / 300-char name | 422 |
| `color: "red"` / `"#GGGGGG"` | 422 — hex enforced |
| `{}` | 422 |
| `is_private: true` | 201 |
| `description: "<script>alert(1)</script>"` | 201, stored raw — rendering is P38's question |
| **`name: "Marketing"` (already exists)** | **201 → ISS-033** |
| **`head_user_id: "u-nope"`** | **201, head silently NULL → ISS-032** |

## 2. Read

`GET /spaces/:id` returns `id, name, description, icon, color, is_private, head_user_id, head,
position, archived_at, created_by, created_at`. **The list and single-read shapes match exactly** —
no field is available in one and missing from the other. Unknown id → 404 `space.not_found`.

## 3. Update

Rename, description, colour, icon, `is_private` all persist. `id` and `workspace_id` return 200 and
are **ignored** — verified in the DB that neither changed, so no mass assignment or tenant hop.

Renaming to an existing space's name → 200 (ISS-033).

## 4. Archive / unarchive

| | |
|---|---|
| archive | 204, **idempotent** (second call also 204) |
| archived space in `GET /spaces` | hidden ✓ |
| `GET /spaces?include_archived=true` | included ✓ |
| direct `GET /spaces/:id` when archived | 200 — still readable |
| **`PATCH` an archived space** | **200 — still editable → ISS-034** |
| `POST /lists` into an archived space | 409 `space.archived` ✓ |
| unarchive | 204, idempotent |

## 5. Delete guards — well designed, and the order matters

The real flow is **archive first, then delete**:

| state | result |
|---|---|
| not archived (even if empty) | 409 `space.not_archived` |
| archived + has a list | 409 `space.not_empty` |
| archived + empty | **204** |
| Marketing — archived, 3 lists, 2 reports | 409 `space.not_empty` |

`space.not_archived` is the outermost gate, which is why the first attempt in this phase never
reached the emptiness check. Re-run correctly, both guards behave.

**`space.has_reports` was not reachable** — `space.not_empty` fires first, so the reports guard can
only be hit by a space with **zero lists but at least one report**. Producing that would mean
deleting a real department's lists, which is not worth the risk to demo data. Recorded, not filed.

## 6. Head assignment — the strongest validation in the phase

| value | result |
|---|---|
| an active member | 200 |
| a **guest** | 422 `space.head_invalid` |
| an **invited** (not yet active) user | 422 `space.head_invalid` |
| unknown id | 422 `space.head_invalid` |
| `null` (clear) | 200 |

All correct **on PATCH**. The same field on **POST** is unvalidated — ISS-032.

## 7. Review endpoints by role — PASS, exactly right

| role | `/review-summary` | `/review-queue` |
|---|---|---|
| owner | 200 | 200 |
| admin | 200 | 200 |
| **the head of that space** | 200 | 200 |
| **a head of a *different* space** | **403 `review.not_head`** | **403** |
| member | 403 | 403 |
| guest | 403 | 403 |

A department head sees their own department and nobody else's. This also confirms the P5 conclusion
that ISS-023's redaction gap is not guest-reachable.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| sidebar space tree, create/rename/archive from the UI, deep link to an archived space | API-only phase | **P36** (shell/navigation) |
| `space.has_reports` guard | unreachable without destroying a real department's lists | **P31** (dept review owns report fixtures) |
| stored `<script>` in `description` — does it render? | XSS is a dedicated pass | **P38** |

## 9. Coverage vs the plan

5 of the 6 checklist lines executed; the UI line deferred. Two of the three findings
(ISS-032, ISS-033) are the same shapes already seen elsewhere — a field silently dropped, and a
name-uniqueness gap — which is starting to look like a systemic pattern rather than isolated bugs.

**Evidence directory:** `testing/evidence/PHASE-08/` — 2 files.
