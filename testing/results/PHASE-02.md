# PHASE 02 — API conventions & the error catalog

**Status:** DONE (2 sub-items deferred with reasons — §9)
**Methods:** API · CODE
**Issues filed:** ISS-007…ISS-011 (MEDIUM) · ISS-012…ISS-014 (LOW)
**Data left behind:** none — 5 soft-deleted `TEST-` tasks hard-removed, 2 stray sprints removed at
the DB level, 0 stray tags. Verified: `TEST-` tasks 0, sprints 1 (seeded), tags 8 (seeded).

---

## 1. Success envelope — 22 endpoints checked

`{data, pagination}` on 9 endpoints, bare object on the single-resource endpoints. Correct.

Four *other* shapes exist for collections — see **ISS-012**. Two of them (`/forms`, `/sprints`
returning bare arrays) match their own spec sections and contradict §1; one
(`/activity/recent`) contradicts its spec directly.

`/home/kpis` correctly comes back camelCase (documented exception) and `/me/permissions` keeps its
snake_case permission keys un-camelized — both verified.

## 2. Pagination object — PASS

`next_cursor`, `has_more`, `total_estimate` present and correctly typed on every enveloped endpoint.
`total_estimate` matched the real row count exactly in all six samples.

## 3. Cursor walk — PASS

Walked six endpoints at `limit=2` and compared against a single `limit=200` fetch:

| endpoint | rows | walked | pages | dupes | missing |
|---|---|---|---|---|---|
| `/users` | 16 | 16 | 8 | 0 | 0 |
| `/notifications` | 15 | 15 | 8 | 0 | 0 |
| `/reports` | 12 | 12 | 6 | 0 | 0 |
| `/activity` | 6 | 6 | 3 | 0 | 0 |
| `/lists` | 14 | 14 | 1 | 0 | 0 |
| `/spaces` | 9 | 9 | 1 | 0 | 0 |

No duplicates and no skips anywhere. (`/lists` and `/spaces` finished in one page because they
ignore `limit` — **ISS-007**.)

## 4. `limit` handling — **FAIL on 4 endpoints (ISS-007)**

`/lists`, `/spaces`, `/tags`, `/task-types` return every row regardless of `limit`, while still
reporting `has_more: false`. Confirmed at source level: `ListsRepo` / `SpacesRepo` contain no
`.limit(params.limit)` — only `.limit(1)` single-row lookups. `UsersRepo` does it correctly
(`limit + 1` to derive `has_more`).

**Limit bounds** on an endpoint that honours it (`/users`):

| value | result |
|---|---|
| `0` | 422 `validation.failed` — correct |
| `-1` | 422 — correct |
| `abc` | 422 — correct |
| `1` | 1 row — correct |
| `200` (max) | all 16 — correct |
| `201`, `1000` | 200 OK, no error | 

Over-max is accepted rather than rejected. Whether it is *clamped* could not be determined —
the dataset (16 rows) is far below the limit. Deferred to **P40**. The users validator's own comment
says the clamp happens in the service layer.

## 5. Cursor tampering — **FAIL (ISS-008)**

Four malformed cursor forms correctly return `400 pagination.invalid_cursor`; two do not:
`garbage` silently restarts at page 1 *while still issuing a next_cursor* (a retrying client never
terminates), and a valid-cursor-plus-suffix returns a different, wrong page.

## 6. Error envelope — PASS, all status codes

| case | status | code | envelope |
|---|---|---|---|
| bad cursor | 400 | `pagination.invalid_cursor` | ok |
| no token | 401 | `auth.missing_token` | ok |
| garbage token | 401 | `auth.invalid_token` | ok |
| forged `alg=none` | 401 | `auth.invalid_token` | ok |
| guest lacks `catalog.tags` | 403 | `auth.forbidden` | ok |
| unknown task id | 404 | `task.not_found` | ok |
| unknown route | 404 | `route.not_found` | ok |
| duplicate tag name | 409 | `tag.duplicate` | ok |
| missing required field | 422 | `validation.failed` | ok |
| bad enum in query | 422 | `validation.failed` | ok |
| malformed JSON body | 400 | `bad_request` | ok |
| body > 1 MB | 413 | `payload.too_large` | ok |

`PUT` / `DELETE` / `PATCH` / `POST` on `/users` all return `404 route.not_found` rather than 405.
The §1 status table does not define 405, so this is consistent with the spec — not filed.

**`request_id`:** present on every error, unique across 5 consecutive calls, format
`req_<uuid>`, and found in winston's `combined.log` under the `requestId` field — correlation works.

**422 `details[]`:** correct shape, e.g.
`[{"field":"primary_list_id","issue":"primary_list_id must be a string"},{"field":"name","issue":"name is required"}]`

**Security headers on 404 / 401 / 422 responses:** all four present on every error path.

## 7. CORS — policy PASS, error reporting FAIL (ISS-009)

All ten origin cases behaved exactly as designed:

| origin | verdict |
|---|---|
| `http://localhost:5173` (configured) | allowed |
| `http://127.0.0.1:5173` | allowed |
| `http://192.168.1.50:5173`, `http://10.0.0.5:3000`, `http://172.16.4.4:80` | allowed (RFC-1918) |
| `http://172.32.0.1:80` (just outside 172.16–31) | denied |
| `https://evil.example.com` | denied |
| `http://localhost.evil.com` (prefix trick) | denied |
| `http://evil.com#localhost` (fragment trick) | denied |
| literal `null` | denied |
| no `Origin` header (curl / server-to-server) | allowed |

Preflight returns 204 with the right allow-methods/headers, and `X-Conversation-Id` is correctly
exposed. The only defect is that a denial surfaces as **500 `internal`** plus an `error`-level log
line — ISS-009.

## 8. Rate limits — PASS, all 7 buckets

| bucket | limit | 429 fired at | code | Retry-After |
|---|---|---|---|---|
| `authStrictLimiter` `/auth/login` | 5/min/IP | request 6 | `auth.rate_limited` | 60 |
| `invitationLimiter` | 5/min/IP | request 6 | `auth.rate_limited` | 60 |
| `reportGenerateLimiter` | 10/min/user | request 11 | `rate.exceeded` | 60 |
| `assistantLimiter` | 20/min/user | request 21 | `rate.exceeded` | 60 |
| `uploadSignLimiter` | 60/min/user | request 61 | `rate.exceeded` | 60 |
| `apiLimiter` | 600/min/user | request 600 | `rate.exceeded` | 58 |
| `publicFormLimiter` | 30/min/IP | — | — | deferred, §9 |

**Bucket keying works.** After the owner exhausted `reportGenerateLimiter`, a second user on the
*same IP* was still served (422, not 429). The `SCAN-M1` per-user keying fix is effective.

Note: the limiter runs *before* the validator on `/assistant/chat` and `/reports/generate`, so the
buckets could be exercised with invalid bodies — no OpenAI call and no report computation was
triggered.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `publicFormLimiter` (30/min/IP) | the one form in the dataset exposes no usable slug through `GET /forms`; the public endpoint could not be addressed | **P26** |
| Is over-max `limit` clamped or honoured? | the largest table has 16 rows — far below the 100/200 caps, so clamping is unobservable | **P40** |

## 10. Error-code catalog sweep

Built a full inventory: every `AppError` throw site plus the framework-emitted codes, mapped
against `API_DESIGN.md` §32.

- **140** codes thrown in `server/src`
- **37** codes documented in §32
- **110** thrown but undocumented → **ISS-010**
- **7** documented but never thrown → **ISS-010**, of which three are unimplemented business rules
  proven live in **ISS-011** (`tag.in_use`, `task.cannot_complete_blocked`, `sprint.overlap`)

Two of the seven (`customer.duplicate_phone`, `customer.invalid_phone`) reference a `customers`
table that does not exist in this system — the same phantom domain as the `customers` /
`stock_batches` / `stock_movements` tables the Drizzle migrations create (`SCAN-H3`). That is now
two independent traces of an earlier, different product scope still embedded in the artifacts.

**16 codes were verified live** in P1+P2; the remaining domain codes are triggered in their owning
phases. The inventory file lists every code with its throw site so no phase has to re-derive it.

**Evidence:** `testing/evidence/PHASE-02/error-code-catalog.txt`

## 11. Coverage vs the plan

All 17 checklist lines executed. 11 passed outright, 4 produced MEDIUM findings, 3 produced LOW
findings, 2 sub-items deferred with reasons.

**Evidence directory:** `testing/evidence/PHASE-02/` — 9 files.
