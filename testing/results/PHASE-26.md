# PHASE 26 — Forms

**Status:** PARTIAL (UI deferred — §9)
**Methods:** API · DB · CODE · **a second API instance booted with no encryption key**
**Issues filed:** ISS-077, ISS-078, ISS-079 (MEDIUM) · ISS-080 (LOW)
**Environment change made and reverted:** see §0.
**Data left behind:** none — tasks 51, lists 14, statuses 70, forms 1, fields 1, submissions 0,
notifications 65.

---

## 0. The blocker — handled the same way as P18's triggers

`STATUS.md` listed this phase as blocked: the dev database is missing
`form_submissions.encrypted_at` and `expires_at`, so `GET /forms/:id/submissions` returns 500
(ISS-025). `database/schema.sql:949-952` **does** declare both columns, and production was
provisioned from that file — so this is dev drift, not a product defect.

```
before      GET /forms/:id/submissions -> 500 internal
ALTER TABLE form_submissions ADD encrypted_at TIMESTAMP NULL, ADD expires_at TIMESTAMP NULL
after       GET /forms/:id/submissions -> 200 {"data":[],"pagination":{…}}
```

The phase then ran at production parity. **Both columns were dropped again afterwards** and the 500
was re-confirmed, so ISS-025 stays reproducible for whoever fixes it. Same protocol as P18.

## 1. Form CRUD and slugs — PASS but for ISS-077

| probe | result |
|---|---|
| create | 201, slug auto-generated, `is_public: true` |
| the same title twice | two distinct slugs (random suffix) |
| an explicit slug already taken | **409 `form.slug_taken`** |
| explicit slug `UPPER-case` / `has spaces` / `trailing-` | 422 each |
| explicit slug `ok-slug-123` | 201 |
| unknown list | 404 `list.not_found` |
| empty title | 422 |
| `GET /forms`, `GET /lists/:id/forms`, `GET /forms/:id` | 200 |
| `GET` unknown | 404 `form.not_found` |

The defect is that a **generated** slug carries a mixed-case suffix that the same validator rejects,
so a form cannot be written back unchanged → **ISS-077**.

## 2. Fields — PASS on validation, ISS-078 on ordering

Correct: `task_attr` keys limited to `name / description / priority / due_date / start_date`
(`workspace_id` → 422 `form.invalid_field_key`); an unknown custom field → 422; a duplicate key →
**409 `form_field.duplicate`**; a bad `field_kind` → 422; `PATCH` unknown → 404
`form_field.not_found`; delete then delete again → 204 then 404.

Reorder (`{items: [{id, position}]}`) works for a complete set and rejects a field from another form
with **422 `form_field.not_in_form`** — but accepts a partial set and duplicate positions →
**ISS-078**.

## 3. Public read — PASS

```
GET /public/forms/:slug (no auth) -> 200 {title, description, public_slug, branding,
                                          success_message, fields}
```

`list_id` and every other internal id are **not** exposed. A custom-field question arrives with
`value_type: "phone"`, `options` and `config`, which is what a renderer needs. Unknown slug → 404.
`is_public: false` → 404 (not a 403 — no existence oracle). `settings.submission_open: false` →
the read still works and **submit** returns 403 `form.submission_closed`, which is the right split.

## 4. Submission — PASS

| probe | result |
|---|---|
| valid, incl. a required custom field | 201 `{submission_id, task_id, message}` |
| empty object / missing a required field | 422 |
| `priority` as a string / out of range | 422 |
| malformed date | 422 |
| 5 000-char name | 422 |
| custom field with the wrong envelope | 422 |
| custom field key not on this form | 201, ignored |
| an extra unknown key | 201, ignored |
| `name` sent as a number | 201 — task named `"<form title> submission"` |

The last two are deliberate, not defects: `FormsService:718-725` falls back to a generated title
unless `name` is a **non-empty string**, and unknown keys are dropped rather than echoed. A public
endpoint that ignores junk instead of erroring is the safer choice. (The plan expected
`form.invalid_field_key` here — that code guards form *definition*, not submission.)

**The created task is correct**: right list, submitted name, description, priority and due date all
mapped, and the custom-field value written through to `task.custom_field_values`.

## 5. Encryption at rest — PASS, verified at the column

```
data column: {"ciphertext":"61d02080baf10a51…","iv":"…","authTag":"…"}
grep for the submitted phone number in the raw column -> not present
GET /forms/:id/submissions on the keyed box -> {"name":"TEST-p26d encrypted row"}   decrypted on read
encrypted_at: set   expires_at: submitted_at + 90 days
```

## 6. No `ENCRYPTION_KEY` — PASS, and better than the plan asked

A second API was booted on :5712 with the key removed. Three distinct behaviours, all correct:

| key state | behaviour |
|---|---|
| **malformed** (`"not-a-valid-64-hex-key"`) | the process **refuses to boot** — *"ENCRYPTION_KEY is set but malformed — need 64 hex chars"* |
| **absent** (`""`) | boots with a warning — *"ENCRYPTION_KEY missing — public form submissions will return 503 until it is set"* |
| absent, then a submit | **503 `form.encryption_unavailable`**, and **no task is created** (tasks on the list: 0 → 0) — gap-scan C4 holds |
| absent, reading existing rows | 200, `data` returned as the raw ciphertext envelope rather than crashing |

## 7. Retention job and counters

`expires_at` is exactly `submitted_at + 90 days`. With a row backdated past retention:

```
?dry_run=true -> {"dry_run":true,"processed":1,"wouldDelete":1}   rows unchanged
?dry_run=1    -> {"dry_run":false,"processed":1,"deleted":1}      row deleted   -> ISS-079
```

After the purge, `submission_count` still reads the pre-purge number → **ISS-080**.

`submission_count` is otherwise accurate on insert, and a `form_submitted` notification is created
for the form's creator on every successful submission.

## 8. Cascades

Deleting a form removes its fields and submissions. Note for future phases: `tasks.primary_list_id`
is `ON DELETE RESTRICT`, so a list cannot be removed while an intake task still points at it — two
cleanup passes hit this.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| form builder, field editor, public form page, submit + confirmation, deep link | API-only phase | **P35** |
| every field type *rendering* on the public page (the API side is covered) | needs the browser | **P35** |
| the 30/min public-form rate limit (deferred into this phase by P2) | this run used `DISABLE_RATE_LIMIT=1`, so the limiter is off | **P38** |

## 10. Coverage vs the plan

12 of the 13 checklist lines executed; the rate-limit line moves to P38 because the harness disables
limiters. Four probes were malformed and re-run rather than reported: the reorder body
(`{items:[{id,position}]}`, not `{field_ids}`), the custom-field body (`scope_type`/`scope_id`, not
`scope`), the closed-form settings key (`submission_open`, not `closed`), and `?dry_run=1` — the last
of which turned out to be a genuine finding in its own right.

The forms module is the most carefully built subsystem tested so far: real AES-256-GCM encryption at
rest with a documented 90-day retention, a boot-time key check that refuses to start on a malformed
key, a clean 503 that fires **before** any row is written, correct public/private separation, and
precise error codes throughout. Its defects are at the edges — a slug it will not accept back, an
ordering endpoint that accepts a corrupt set, and a safety flag that only works when spelled exactly.

**Evidence directory:** `testing/evidence/PHASE-26/` — 6 files.
