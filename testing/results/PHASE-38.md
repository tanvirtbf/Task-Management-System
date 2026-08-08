# PHASE 38 — Security & abuse

**Status:** PARTIAL (rate limiting and the SPA-origin headers deferred — §10)
**Methods:** API · DB · CODE
**Issues filed:** ISS-083 (HIGH) · ISS-084, ISS-085 (MEDIUM) · ISS-086 (LOW)
**Data left behind:** none — tasks 51, lists 14, statuses 70, tags 8, forms 1, notifications 65.
**One account was damaged and repaired:** see §6.

---

## 1. IDOR — 29 endpoints, ids harvested as owner and replayed as a scoped user

Every id was created or read as `owner@company.local`, then replayed as `marketing.only@`, who has
access to one space only.

**26 of 29 were correctly denied** — tasks (read, patch, delete, comments, checklists, attachments,
activity, dependencies, subtasks), comments, checklists, checklist items, lists, spaces, statuses,
attachment downloads, reports (read **and** patch), sprint close, and all three user-admin routes
(`PATCH /users/:id`, deactivate, role change).

The denials are also well-shaped: **404 `*.not_found`** where revealing existence would be an oracle,
**403 `auth.forbidden`** where the resource is legitimately visible but the action is not.

Three came back 200. Two are not defects:

| endpoint | verdict |
|---|---|
| `GET /forms/:id` | **real leak → ISS-084** (re-tested with a form deliberately placed in a space the user cannot see) |
| `GET /forms/:id/submissions` | 500 — that is ISS-025's missing column, not an access grant |
| `GET /sprints/:id` | **by design.** Sprints are workspace-scoped (P28 §6); the sprint's **task list** came back with **0 rows** for this user |

## 2. JWT tampering — PASS, all ten variants

```
alg=none (with and without the signature)  -> 401 auth.invalid_token
a wrong signature / no signature           -> 401
sub swapped to another user                -> 401
exp extended by a year                     -> 401
workspace_id swapped                       -> 401
garbage / empty                            -> 401 / 401 auth.missing_token
```

**A correction worth recording.** The first run reported "role escalated to owner → 200 ACCEPTED".
That was a test artefact: the token being tampered with was the **owner's**, whose role is already
`owner`, so `{...payload, role: "owner"}` re-serialised to a byte-identical payload and the original
signature still validated. Re-run against a **member's** token, where the payload genuinely changes:

```
member token, role forged to "owner" -> GET /auth/me            401 auth.invalid_token
                                     -> PATCH /users/:id/role   401 auth.invalid_token
```

Signature verification is sound.

## 3. Stored XSS — stored verbatim, rendered safely

Six payloads (`<script>`, `<img onerror>`, `javascript:`, `<svg onload>`, an attribute break-out, and
a template-injection string) were written into task names, descriptions, comment bodies and tag names.
All were accepted and returned **byte-for-byte** — the server does no HTML escaping, which is correct
for a JSON API.

The render side is where it matters, and it holds: a repo-wide grep finds `dangerouslySetInnerHTML`
in exactly **three** places — `TiptapEditor` (on already-sanitised content) and two in `SearchPage`,
whose `highlight()` was proven safe in P25 §6 (only the matched slice of *already-escaped* text is
re-inserted; a stored `<script>` renders as visible text). Everything else goes through React, which
escapes by construction. This also closes the P8 deferral about a `<script>` in a space description.

## 4. Injection into filters, sort and search — PASS

Eight payloads (`' OR 1=1--`, `1; DROP TABLE tasks--`, `" OR ""="`, `{$ne:null}`, `../../etc/passwd`,
`%00`, a lone backslash, `1 UNION SELECT 1,2,3`) sent into five parameters each —
`/search?q=`, `/lists/:id/tasks?sort=`, `?status_id=`, `/users?q=`, `/activity?entity_type=`.

Every one returned a normal 200 with no rows, or a 422 where the parameter is enum-validated. The
`tasks` table was intact afterwards. Every query is parameterised.

## 5. Mass assignment — PASS

`PATCH /tasks/:id` refuses `id`, `workspace_id`, `created_by`, `created_at` and `task_number` with
422 — including when a protected key is smuggled alongside a legitimate one (that request is refused
as a whole, not partially applied). `PATCH /me` does not exist (404), so the profile-escalation
vector has no surface.

## 6. Password policy — the phase's main finding, and a repaired account

Only length is enforced (`min: 8`). `password`, `12345678`, `PASSWORD`, `aaaaaaaa` and
`alllowercase` were all accepted → **ISS-083**.

**Damage and repair:** running this probe as the owner actually changed
`owner@company.local`'s password to `alllowercase`. It was caught in the same run (the next probe
returned `auth.incorrect_password`), the hash was rewritten to a fresh bcrypt of `Owner@12345`, and a
live login was verified. The same happened to `arif@` in the follow-up run and was restored through
the API. Both accounts were re-verified against the stored hash at the end.

What is **right** here: bcrypt at cost 10, and no login timing oracle — 68.3 ms for a wrong password
on a real email versus 72.9 ms for an email that does not exist, across five samples each.

## 7. CORS — ISS-085

The allow-list works (configured origins plus a LAN regex), but a **disallowed** origin produces a
**500** rather than a response with no `ACAO` header, because the middleware is handed an `Error`.
`Origin: null` breaks the same way. Not exploitable — no `ACAO` is emitted either way — but it turns
routine browser noise into internal-server-error log lines.

## 8. Response headers — ISS-086

`nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer` are present. `CSP`, `HSTS` and
`COOP` are absent, and `X-Powered-By: Express` is still advertised.

## 9. Secrets — PASS

```
a 404 body      -> {error:{code, message, request_id}}   no stack, no SQL, no internals
/auth/me        -> id, first_name, last_name, email, role, avatar_url, status, timezone,
                   created_at, last_login_at        — no hash, no token, no secret
/users rows     -> the same ten fields
```

## 10. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| rate-limit behaviour and bypass attempts (`X-Forwarded-For`, header casing, token rotation) | this harness runs with `DISABLE_RATE_LIMIT=1`; the limiter is off | **P41** |
| response headers on the **SPA origin** | needs the built client behind its real nginx vhost | **P41** |
| public-form abuse as an anonymous attacker (enumeration, spam, oversized payloads) | the 30/min public limiter is disabled here; the *validation* half was covered in P26 §4 | **P41** |
| stored-XSS **render** verification in a live browser | the source analysis is in §3; a visual pass belongs with the UI phases | **P36** |

## 11. Coverage vs the plan

11 of the 13 checklist lines executed; the two rate-limit lines move to P41 because the harness
disables limiters by design.

The security posture is better than the issue count suggests. Authentication is solid (bcrypt, a
sound signature check, no timing oracle, no secret leakage), injection is comprehensively
parameterised, mass assignment is properly blocked, and 26 of 29 IDOR probes were denied with
correctly-shaped errors. The real problems are a password rule that permits `password`, one more
read path that forgot the space filter, and a CORS rejection misfiled as a server error.

**Evidence directory:** `testing/evidence/PHASE-38/` — 3 files.
