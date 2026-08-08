# PHASE 23 — Attachments

**Status:** PARTIAL (UI deferred; true R2 outage not simulated — §8)
**Methods:** API · DB · CODE · **live R2 round trip**
**Issues filed:** ISS-071 (MEDIUM)
**Data left behind:** none in MySQL — tasks 51, lists 14, statuses 70, attachments 1 (baseline).
**Left behind in R2:** ~15 small test objects. The API soft-deletes only; the `r2-purge` job removes
the objects 7 days after `deleted_at`, so they clear themselves. Nothing was deleted from the bucket
by hand.

---

## 0. R2 is reachable, and the whole round trip works

This phase ran against the **live Cloudflare R2 bucket**, not a stub. A 71-byte PNG was uploaded
through the API, the signed URL was followed, and the bytes came back byte-for-byte:

```
fetching the signed URL -> 200  image/png  71 bytes  (uploaded 71)
tampering with X-Amz-Signature -> 403
```

## 1. Proxied upload — PASS, every gate exact

| probe | result |
|---|---|
| empty body | 400 `attachment.empty` |
| 1 KB | 201 |
| **exactly 25 MB** | 201 |
| **25 MB + 1 byte** | 413 `attachment.too_large` |
| `application/x-msdownload` | 415 `attachment.mime_not_allowed` |
| `text/html` | 415 |
| `application/pdf` | 201 |
| `IMAGE/PNG` (uppercase) | 201 — the allowlist is case-insensitive |
| no `Content-Type` | 415 |
| **guest** | 403 `auth.forbidden` |

The boundary is exact on both sides of 25 MB.

## 2. `X-Filename` — one crash, and one thing that looks scary but is safe

```
"normal.png"                    -> 201
"file with spaces.png"          -> 201
"../../../etc/passwd.png"       -> 201, stored as the display name only
"..\..\windows\system32.png"    -> 201, same
header missing                  -> 201, name defaults to "file"
"<script>alert(1)</script>.png" -> 201, stored verbatim
244 chars                       -> 201
300 chars                       -> 500 internal      <- ISS-071
```

Traversal is **not** exploitable: `storage_key` is built server-side as
`workspaces/<ws-id>/attachments/<att-id>.<ext>` and never derives from the filename — confirmed on
every row. The filename is a label, nothing more.

## 3. Presign flow — PASS, fully working end to end

The first attempt at this section reported "422 for everything"; the body key is `scope_type`, not
`scope`. Re-run correctly:

```
POST /uploads/sign -> 201 {attachment_id, upload_url, fields, expires_in: 900}
                          real R2 host, X-Amz-Expires=900
PUT to that URL    -> 200
POST /attachments/:id/finalize -> 200, upload_status pending -> complete
```

Every error path is right: bad MIME 415 · over 25 MB 413 · `size_bytes` 0 or negative 422 ·
`scope_type=comment` or a bogus scope 400 `attachment.scope_unsupported` · unknown task 404 ·
300-char filename **422** · guest 403.

`attachment.upload_expired` fires correctly in both situations that should produce it:

```
finalize without ever PUTting  -> 410 attachment.upload_expired   (the object is not in the bucket)
finalize a 2-day-old pending   -> 410 attachment.upload_expired
```

## 4. Download — PASS, two modes, both correct

| call | result |
|---|---|
| `GET /attachments/:id/download` | **302** to a signed R2 URL, `X-Amz-Expires=300` |
| `GET …/download?json=1` | **200** `{url}` — this is what the client uses (`attachmentsApi.freshUrl`) |
| `?json=0` / `?json=bogus` | 302 (the redirect is the default) |
| tampered signature | 403 from R2 |
| object missing from the bucket | **404** — the endpoint HEADs before redirecting |
| unknown id | 404 `attachment.not_found` |
| no token | 401 |
| another member | 302 |
| **a guest** | 302 — guests cannot upload but **can** download |

The 5-minute TTL matches `READ_GET_TTL_SECONDS = 300`, and the client is built around it
(gap-scan M11: it mints a fresh URL at click time rather than caching one).

## 5. Delete — PASS, and the counter is done right

```
a non-uploader member -> 403 auth.forbidden
the uploader          -> 204
again                 -> 404 attachment.not_found
```

Soft delete: the row stays with `deleted_at` set, it disappears from the list, `download` becomes
404, and **`attachments_count` decrements**. That last part is worth naming — `trg_attachments_after_update`
fires on the soft-delete UPDATE and adjusts the counter in both directions. It is exactly the
mechanism `comments` lacks (ISS-065), sitting in the same schema file.

## 6. `deleted_at` and the 6-hour clock — recorded, no operational consequence

The plan asked for the written value. It is six hours behind, as ISS-001 predicts:

```
deleted_at written : 2026-07-30 08:56:31
MySQL NOW()        : 2026-07-30 14:56:31
```

**But the purge is not affected.** `r2Purge.ts` computes `cutoff = new Date(Date.now() - 7d)` and
compares `deleted_at < cutoff`. Both values pass through the same Drizzle skew, so it cancels and the
7-day window is honoured. Recorded here rather than filed — the value is wrong, the behaviour that
depends on it is not.

## 7. Pending rows

`upload_status` starts `pending` on sign and becomes `complete` on finalize. Pending rows are
excluded from `GET /tasks/:id/attachments` and from `attachments_count` (the insert trigger only
counts `complete` rows). Abandoned pending rows are the `attachment-janitor` job's business — **P32**.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| attachments section, upload progress, image preview, delete affordance | API-only phase | **P35** |
| behaviour when R2 is genuinely unreachable (network/credential failure, not a missing object) | needs the config broken deliberately; the missing-object path was tested and is a clean 404 | **P41** |
| the `attachment-janitor` sweep of abandoned `pending` rows | it is a background job | **P32** |

## 9. Coverage vs the plan

All 9 checklist lines executed. Attachments are the best-built module tested in Block D: an exact
size boundary, a real MIME allowlist, server-generated storage keys that make traversal moot, a
working presign→PUT→finalize flow with a correct expiry error, signed URLs with a real TTL that R2
actually enforces, a counter trigger that handles soft delete properly, and a guest gate on both
upload paths. One unvalidated header is the whole finding.

**Evidence directory:** `testing/evidence/PHASE-23/` — 4 files.
