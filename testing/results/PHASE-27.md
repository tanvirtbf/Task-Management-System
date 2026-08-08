# PHASE 27 — Templates

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB · CODE
**Issues filed:** **none** — no new defect survived verification
**Existing issues updated:** ISS-024 (`template.apply` resolved as NOT ENFORCED — the count goes
19 → **20 of 56**) · ISS-068 (the unbounded-checklist surface also reachable through templates)
**Deferred item resolved:** `template.apply` enforcement (deferred out of P5)
**Data left behind:** none — tasks 51, lists 14, statuses 70, templates 0, tags 8.

---

## 1. CRUD — PASS

| probe | result |
|---|---|
| create | 201, full row incl. `structure`, `usage_count` |
| duplicate name | **409 `template.duplicate`** |
| missing `structure` / empty name / bad `type` | 422 |
| `GET` list / one | 200 |
| `GET` unknown | 404 `template.not_found` |
| `PATCH` name / unknown | 200 / 404 |
| `DELETE`, then again | 204 / 404 |

## 2. Validation happens at **create** time — which invalidated three first-pass probes

The first run reported "apply an empty structure → 404", "apply with a dead task type → 404" and
"apply with a dead tag → 404". Those were meaningless: the templates were never created, so the
apply URLs contained `undefined`. Re-run against creation directly:

```
structure {checklistItems: []}          -> 422 template.empty_structure
structure with no checklistItems key    -> 422 template.empty_structure
structure {taskTypeId: "tt-nope", …}    -> 422 template.invalid_task_type
structure {tags: ["tag-nope"], …}       -> 422 template.invalid_tag
structure with no taskTypeId at all     -> 201   (the target list's default covers it)
```

Every documented error code fires — at create.

**And apply re-validates independently.** A template that was valid at creation and later drifted
(its `checklistItems` emptied directly in the database) is refused on apply with
**422 `template.empty_structure`**. The same holds for a tag deleted after the template was saved:

```
create the template with a valid tag -> 201
delete that tag                      -> 204
apply                                -> 422 template.invalid_tag
tasks created by the failed apply    -> 0     clean refusal, nothing partial
```

That is proper defence in depth: validated on the way in, re-validated on the way out, and atomic
when the second check fails.

## 3. The `structure` blob survives the case transform — PASS

The first pass called this "MUTATED"; that verdict was wrong, because the comparison was key-**order**
sensitive. Re-checked on the key **set**:

```
sent (sorted): ["UPPER_KEY","camelCaseKey","checklistItems","nested","snake_case_key","taskTypeId"]
read (sorted): ["UPPER_KEY","camelCaseKey","checklistItems","nested","snake_case_key","taskTypeId"]
nested values: {"innerCamel":4,"inner_snake":5}
```

Identical, including a snake_case key, an UPPER_CASE key, and both cases nested one level down. Only
the JSON key *order* differs, which is MySQL normalising a JSON column — not the API. `skipDecamelize`
does exactly what it claims.

## 4. Apply — PASS

```
POST /templates/:id/apply {list_id} -> 201
  task name = the template's name (or task_name when supplied)
  priority, task type, tags, description all carried over
  checklist "TEST-p27 steps" created with both items, in order
  activity row: created_from_template
```

| probe | result |
|---|---|
| unknown list | 404 `list.not_found` |
| unknown template | 404 `template.not_found` |
| **archived list** | **409 `list.archived`** |
| applied twice | two distinct tasks — **duplicating, not idempotent** |
| `usage_count` | increments per apply (4 after 4) |

The duplicate-on-reapply behaviour is the right one for a template and is recorded here as
characterised, not as a defect.

## 5. Scale — PASS

```
60 checklist items  -> 201 in 32 ms, all 60 materialised
2 000 items in one template -> 201  (no cap on structure size)
```

The size question is the same unbounded surface as ISS-068 (bulk checklist add), so it was folded
into that issue rather than filed twice.

## 6. Permissions — the phase's real result

```
guest  POST /templates            -> 403 auth.forbidden        create is gated
guest  POST /templates/:id/apply  -> 201                       *** apply is not ***
marketing.only apply to a Politics list -> 404 list.not_found  space visibility does hold
```

A guest cannot author a template but can materialise one — creating a real task, with a checklist,
in a list they do not own. `template.apply` was one of the five permissions P5 could not resolve;
this settles it as **NOT ENFORCED**, and ISS-024's measured count moves to **20 of 56**.

Space visibility is a separate mechanism and works: the space-scoped user cannot reach a list outside
their space at all.

## 7. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/templates` and the apply flow in the UI | API-only phase | **P36** |

## 8. Coverage vs the plan

All 7 checklist lines executed. One expectation in the plan does not match the product and is worth
recording: the plan anticipated **nested tasks** in a template. The implemented structure
(`types/templates.ts:33-45`) materialises exactly **one task plus one checklist** — `taskTypeId`,
`priority`, `tags`, `checklistName`, `checklistItems`, `description`. There is no nesting to test.

This is the cleanest module in Block E — every error code reachable and correct, validation on both
ends, atomic failure, and a `usage_count` that actually works. Its only weakness is an authorization
gap shared with 19 other permissions.

**Evidence directory:** `testing/evidence/PHASE-27/` — 2 files.
