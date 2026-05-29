# §16 — Attachments

> Source: [API_DESIGN.md §16](../API_DESIGN.md#16-attachments)

**5 endpoints.** Three-step upload flow with Cloudflare R2: client asks for a signed URL → uploads directly to R2 → tells the server to finalise. Download is a server-side redirect to a signed GET URL.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/uploads/sign` | Issue a signed PUT URL + create a pending `attachments` row | 🔐 | XL | ☐ |
| 2 | POST | `/api/v1/attachments/:id/finalize` | Mark the upload complete after R2 returns 200 | 🔐 | M | ☐ |
| 3 | GET | `/api/v1/tasks/:id/attachments` | List attachments on a task | 🔐 | S | ☐ |
| 4 | DELETE | `/api/v1/attachments/:id` | Soft-delete (R2 object stays until janitor sweeps) | 🔐 (own) / 👑 | S | ☐ |
| 5 | GET | `/api/v1/attachments/:id/download` | 302 redirect to a signed GET URL | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks.
- DB table: `attachments`. Trigger `trg_attachments_*` maintains `tasks.attachments_count`.
- External service: Cloudflare R2. Build a single `R2Service` (using `@aws-sdk/client-s3` against R2's S3-compatible endpoint) and reuse it across these endpoints + the background janitor.
- Env: `CLOUDFLARE_R2_*` already in `.env`.

## Notes

- **#1 sign** must be rate-limited per `uploadSignLimiter` (60/min/user — already in middleware/rateLimit).
- Validate the proposed object key against an allow-list of MIME types + max size (25 MB by spec). Reject before signing — don't trust the client to honour the policy.
- **#2 finalize** verifies the object exists in R2 (HEAD) before flipping the `upload_status` column from `pending` to `complete`.
- **#5 download** must verify the caller has read access to the parent task before issuing the redirect. The signed URL itself has a 10-min default TTL.
