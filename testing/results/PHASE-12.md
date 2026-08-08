# PHASE 12 — Custom fields

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB
**Issues filed:** ISS-041, ISS-042 (MEDIUM) · ISS-043 (LOW)
**Deferred items resolved:** guest custom-field redaction (from P4) · `customfield.set_value`
enforcement (from P5)
**Data left behind:** none — spaces 9, lists 14, tasks 51, custom_fields 0, values 0, options 0,
statuses 70, **archived lists 0, archived spaces 0**. Three real Marketing lists that had been
archived since P8 were found and restored here — see ISS-041.

---

## 1. Definition CRUD — all six types

`text` · `phone` · `money` · `date` · `dropdown` · `files` all create successfully.

| case | result |
|---|---|
| unsupported type (`rating`) | 422 `custom_field.unsupported_type` |
| no scope / bogus `scope_type` | 422 |
| `scope_type: "list"` with an unknown id | 422 `custom_field.invalid_scope` |
| `scope_type: "workspace"` **with** a `scope_id` | 422 |
| workspace / space / list scopes | 201 each |
| **duplicate name** | **201 — allowed** |
| **`hidden_from_guests: true`** | **201, stored 0 → ISS-042** |
| delete a definition that has values | 204, values cascade away ✓ |

Custom fields therefore join roles, spaces and lists in the "duplicate names allowed" group,
updating the P11 tally to **3 enforce / 4 do not**.

## 2. Values — per-type envelopes

The value envelope differs by type and is **not** what the field name suggests:

| type | envelope |
|---|---|
| `text` | `{text: string}` |
| `phone` | `{text: string}` — *not* `{phone:…}` |
| `money` | `{amount: integer, currency: string}` |
| `date` | `{date: "YYYY-MM-DD", include_time?}` |
| `dropdown` | `{option_id}` |
| `files` | `{attachment_ids: [...]}` |

Per-type dispatch is sound: a `{text}` payload on a money field → 422; an unknown `option_id` → 422;
an unknown attachment id → 422; a non-integer amount → 422. What is thin is the *depth* of the phone
and money checks — ISS-043.

> **Method note.** The first pass used `{phone:…}` and `{money:…}` and produced a string of 422s
> that looked like "two field types are unusable". Reading `CustomFieldsService.ts:537-561` gave the
> real envelopes; re-run, both types work. The apparent bug was mine.

## 3. Guest redaction — resolves the P4 deferral

The mechanism is **correct**. With `hidden_from_guests` forced on in the database:

```
owner: SECRET-VALUE visible, VISIBLE-VALUE visible
guest: SECRET-VALUE hidden,  VISIBLE-VALUE visible
```

The field *definition* stays visible to the guest (name and type), only the value is withheld —
a reasonable choice.

The problem is that the flag is unreachable through the API (ISS-042), so in practice no value is
ever redacted from a guest.

## 4. `customfield.set_value` — resolves the P5 deferral

```
marketing.only@ (Department Only role, does NOT hold customfield.set_value)
PUT    /tasks/:id/custom-fields/:fieldId  {text:"no-permission"}  -> 200
DELETE /tasks/:id/custom-fields/:fieldId                          -> 204
```

**NOT ENFORCED.** ISS-024's table is updated from 18 to **19 of 56** permissions that do nothing.

## 5. The archive cascade — the phase's most consequential finding

Discovered by accident: a Marketing list could not be written to, because all three Marketing lists
had been archived since P8. Traced, reproduced in a controlled test, and filed as **ISS-041** —
archiving a space cascade-archives its lists, un-archiving it does not bring them back.

## 6. `GET /custom-fields` — not a bug (a correction to my own probe)

An earlier probe reported this endpoint returning 0 rows while 5 fields existed. It does not: it
returns a **bare array**, and the probe was reading `.data` off it. With the raw body inspected, all
three test fields came back correctly, and the client's typing (`api.get<CustomField[]>`) matches.

Worth adding to **ISS-012**'s inventory though: `/custom-fields` and `/lists/:id/custom-fields` are
two more collection endpoints that return a bare array rather than `{data, pagination}`.

## 7. Options

`dropdown` options are created inline with the field (`options: [{label, color}]`) and stored in
`custom_field_options` with positions. Setting a value by `option_id` works; an unknown option id and
a label-instead-of-id are both 422. Option add/reorder/delete as separate operations were not
exercised — no dedicated endpoints appear in the route map, so options are managed through the
field's own create/update payload.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/custom-fields` page and every field renderer on the task drawer | API-only phase | **P36** (settings) · **P35** (renderers) |
| Deleting an in-use dropdown **option** | no separate option endpoint exists; belongs with the field-update payload | **P36** with the UI |

## 9. Coverage vs the plan

7 of the 8 checklist lines executed; the UI line deferred. Both deferred items from earlier phases
were closed. Two of the three findings (ISS-041, ISS-042) are about controls that exist in the data
model but cannot be reached — the recurring theme of this test run.

**Evidence directory:** `testing/evidence/PHASE-12/` — 4 files.
