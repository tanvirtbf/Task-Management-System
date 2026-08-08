# Issue Log — Testing Phase

Master log for every issue found in TESTING MODE. Format + severity scale: `TESTING_MASTER_PLAN.md` §2.

**Rules:** nothing here is fixed during testing. Already-known items from
`FULL_SYSTEM_SCAN_2026-07-29.md` are referenced as `dup: SCAN-H1` etc., never re-filed.

## Counts

| Severity | Open |
|---|---|
| CRITICAL | 1 |
| HIGH | 10 |
| MEDIUM | 47 |
| LOW | 33 |
| GAP | 1 |
| **Total** | **92** |

Phase breakdown: **P1** ISS-001…006 · **P2** ISS-007…014 · **P3** ISS-015…018 ·
**P4** ISS-019…023 · **P5** ISS-024…027 · **P6** ISS-028…029 · **P7** ISS-030…031 · **P8** ISS-032…034 · **P9** ISS-035…036 · **P10** ISS-037…038 · **P11** ISS-039…040 · **P12** ISS-041…043 · **P13** ISS-044…045 · **P14** ISS-046 · **P15** ISS-047…049 · **P16** ISS-050…051 · **P17** ISS-052 · **P18** ISS-053…055 · **P19** ISS-056…059 · **P20** ISS-060…062 · **P21** ISS-063…066 · **P22** ISS-067…070 · **P23** ISS-071 · **P24** ISS-072…073 · **P25** ISS-074…076 · **P26** ISS-077…080 · **P30** ISS-081…082 · **P38** ISS-083…086 · **P40** ISS-087…088 · **P41** ISS-089…091 · **F3 (fixing)** ISS-092

---

### ISS-001 · [P1] CRITICAL · Every timestamp is stored 6 hours off — Drizzle reads/writes TIMESTAMP as UTC while the MySQL session is Dhaka

- **Severity:** CRITICAL
- **Type:** DATA
- **Phase:** P1 — Environment, build & health
- **Area:** `server/src/db/client.ts:50-73` (pool `timezone` + `SET time_zone`) · Drizzle `timestamp()`
  columns in `server/src/db/schema/*.ts` · affects all 106 TIMESTAMP columns
- **Account:** owner@company.local (also reproduced with no auth, at the driver level)

**What happens**

Drizzle's `timestamp()` column parses and formats MySQL `DATETIME` strings as **UTC**, ignoring the
mysql2 `timezone` option that `db/client.ts` carefully sets. mysql2 itself is fine — the raw pool
returns correct Dates. The mismatch is Drizzle-vs-session, so the app is only correct when the
**MySQL session time zone is `+00:00`**.

Two separate consequences:

1. **App-written timestamps are stored 6 hours EARLIER than intended.** Drizzle serialises a JS Date
   to a UTC wall-clock string; MySQL (session = Dhaka) reads that string as Dhaka time and stores
   the corresponding — earlier — instant. Everything MySQL evaluates itself is then wrong: the 5
   views, the triggers, every cron cutoff, every `NOW()`/`UTC_TIMESTAMP()` comparison.
2. **DB-generated timestamps (`created_at`, `updated_at`, `DEFAULT CURRENT_TIMESTAMP`) reach the API
   6 hours in the FUTURE**, and the browser renders them that way.

The API round-trip *hides* consequence 1 (write-as-UTC / read-as-UTC is self-consistent), which is
why this has not been obvious.

**Repro A — a future deadline is stored in the past**
1. Boot the API against a schema.sql database (any `DB_TIMEZONE`, or none).
2. `POST /api/v1/tasks` → get an id.
3. `PATCH /api/v1/tasks/:id/sla` with `sla_due_at` = **now + 60 minutes** (ISO).
4. In MySQL: `SELECT TIMESTAMPDIFF(MINUTE, NOW(), sla_due_at), (sla_due_at < NOW()) FROM tasks WHERE id=…`

| DB_TIMEZONE | stored value | MySQL says | truth |
|---|---|---|---|
| unset (dev default) | `2026-07-30 05:14:56` | **−299 min**, `< NOW()` = **true** | +60 min, not breached |
| `+06:00` (**the documented prod setting**) | `2026-07-30 05:14:57` | **−300 min**, `< NOW()` = **true** | +60 min, not breached |
| `+00:00` | `2026-07-30 11:14:59` | **+60 min**, `< NOW()` = false | ✓ correct |

**Repro B — `created_at` comes back 6 h in the future (REAL dev DB, default config)**
```
raw created_at in DB (Dhaka session) : 2026-07-29 16:13:48
API returns                          : 2026-07-29T16:13:48.000Z
browser renders (Dhaka local)        : 2026-07-29 22:13:48   <- 6 h later than reality
```

**Repro C — the layer that is at fault**

Same pool, same connection:
```
raw mysql2 NOW()          -> 2026-07-30T04:13:35.000Z   OK
drizzle tasks.createdAt   -> UTC rendering equals the Dhaka wall-clock string   6 h ahead
```
Driver matrix (`driver-timezone-matrix.txt`) confirms mysql2 is correct whenever its `timezone`
matches the session; Drizzle is correct **only** when the session is `+00:00`.

- **Expected:** a deadline set 60 minutes in the future is 60 minutes in the future for MySQL too;
  `created_at` renders as the real creation time.
- **Actual:** stored 5 hours in the past; `created_at` renders 6 hours in the future.
- **Evidence:** `testing/evidence/PHASE-01/timestamp-storage-offset.txt` ·
  `drizzle-timestamp-path.txt` · `driver-timezone-matrix.txt` · `real-db-created-at.txt` ·
  `db-timezone-roundtrip.txt`
- **Status:** **FIXED in F3** (2026-08-03) — `DB_TIMEZONE=+00:00` pins the MySQL session to UTC,
  which is the assumption Drizzle's timestamp mapper hardcodes. All 12 drifting observations are at
  0.00 h in **both** the `TZ=Asia/Dhaka` and `TZ=UTC` frames. DATE writes/reads were re-centred on
  UTC midnight and the on-call `CURDATE()` paths moved to `dhakaToday()` in the same phase — see
  `fixing/results/F03.md` §2. Gate: `node fixing/evidence/F01/clock-probe.cjs` exits 0.
- **Notes:**
  - **This supersedes and re-frames `SCAN-H2`.** That scan measured the *raw mysql2* path (a bound
    JS Date), which the application does not use — the app writes through Drizzle. The
    `UTC_TIMESTAMP()` vs `NOW()` question in `SlaRepo.ts` / `v_breached_sla` cannot be answered
    until this storage offset is settled; fixing H2 alone would move the error, not remove it.
  - **Deploy-relevant:** the prod runbook prescribes `DB_TIMEZONE=+06:00`. On a UTC prod box, that
    setting *introduces* the bug on a machine that would otherwise be correct (`+00:00` behaviour).
    The scan/deploy notes need revisiting alongside the fix.
  - The three candidate fixes (pin the session to UTC, configure Drizzle's timestamp mode, or move
    to `datetime` with explicit UTC handling) are a **fixing-phase** decision — not made here.

---

### ISS-002 · [P1] HIGH · `npm run db:seed:demo` bypasses the production guard and wipes the database

- **Severity:** HIGH
- **Type:** BUG (data loss)
- **Phase:** P1
- **Area:** `server/package.json` `"db:seed:demo": "cross-env NODE_ENV=dev tsx src/db/seed-demo.ts"`
  · guard at `server/src/db/seed-demo.ts:59-74`
- **Account:** n/a (operator/CLI)

**What happens**

`seed-demo.ts` has two guards: `Config.IS_PROD` (are you on production?) and `ALLOW_DEMO_SEED=1`
(did you mean it?). They are meant to be independent layers. But the npm script hard-codes
`cross-env NODE_ENV=dev`, which overwrites the real environment, so **`Config.IS_PROD` is always
false on the documented invocation path** and only the `ALLOW_DEMO_SEED` layer remains.

The script's own comment says *"The npm script's `cross-env NODE_ENV=dev` is NOT a guard"* — and
then relies on `Config.IS_PROD`, which that very `cross-env` defeats.

The trap closes because the first guard's error message *tells the operator what to type next*:
`"Re-run with ALLOW_DEMO_SEED=1 if that is really what you want."` Following that instruction on a
production box wipes the database.

**Repro** (run against a scratch DB — this truncates everything)
1. `NODE_ENV=prod ALLOW_DEMO_SEED=1 npx tsx src/db/seed-demo.ts` -> **REFUSED**
   `REFUSING to run the demo seed: NODE_ENV=prod.`
2. `NODE_ENV=prod ALLOW_DEMO_SEED=1 npm run db:seed:demo` -> **RUNS**
   `Wiped 41 tables` ... `Demo seed complete {"u":12,...}`

- **Expected:** step 2 refuses exactly like step 1.
- **Actual:** step 2 truncated all 41 tables and reseeded (verified: users 0 -> 12, tasks 0 -> 46).
- **Evidence:** transcript in `testing/results/PHASE-01.md` §4; scratch DB `tms_p1_setup`
- **Status:** **FIXED in F14** (2026-08-05). Two changes. (1) `cross-env NODE_ENV=dev`
  removed from the `db:seed:demo` npm script — that was what made `Config.IS_PROD`
  permanently false on the documented path, i.e. the script disabled the very layer meant to stop
  a production run. (2) A THIRD guard that depends on no environment variable at all, mirroring
  what `db:setup` does with its table count: any user account the demo seed did not create means
  this looks like a real workspace, and the seed refuses. `ALLOW_DEMO_SEED_OVER_DATA=1` is the
  deliberate, separate override.
  **Verified by RUNNING the real script three ways** (`fixing/evidence/F14/f14-probe.txt`):
  prod+ALLOW -> exit 1; dev+no-ALLOW -> exit 1; dev+ALLOW+one non-demo account -> exit 1 — and
  `tasks` stayed at 46 across all three, so nothing was truncated to prove it.
- **Notes:** Partially re-opens `SCAN-B4`, which was recorded as fixed. The fix *is* effective for a
  direct `tsx` invocation; it is not effective through the npm script. `db:setup:fresh` has no
  `cross-env` and its guard **does** work (verified). `db:seed` (non-demo) is non-destructive.

---

### ISS-003 · [P1] MEDIUM · A missing `REFRESH_TOKEN_SECRET` boots a server that reports READY but cannot log anyone in

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P1
- **Area:** `server/src/config/index.ts` (no validation) · `server/src/services/TokenService.ts:26`
  · `server/src/routes/health.ts:71` (`/health/ready`)
- **Account:** owner@company.local

**What happens**

`ACCESS_TOKEN_SECRET` is effectively boot-validated — express-jwt refuses to construct and the
process exits 1 with `express-jwt: 'secret' is a required option`. `REFRESH_TOKEN_SECRET` is not:
the server boots, `/health` and `/health/ready` both return **200 ready**, and then *every* login
returns **500 `auth.token_config_missing`**.

A load balancer, k8s probe, or uptime monitor sees a perfectly healthy instance that no user can
authenticate against.

**Repro**
1. Start the API with `REFRESH_TOKEN_SECRET=""`.
2. `GET /health` -> 200 · `GET /health/ready` -> 200 `{"status":"ready"}`
3. `POST /api/v1/auth/login` (valid credentials) -> **500**
   `{"error":{"code":"auth.token_config_missing","message":"Refresh token secret not configured"}}`
   and no `Set-Cookie`.

- **Expected:** either refuse to boot (matching `ACCESS_TOKEN_SECRET`), or report not-ready.
- **Actual:** boots, reports ready, 500s on every login.
- **Evidence:** `testing/evidence/PHASE-01/missing-secrets-behaviour.txt` · `env-boot-matrix.txt`
- **Status:** **FIXED in F14** (2026-08-05). `server.ts` now refuses to boot when
  either `ACCESS_TOKEN_SECRET` or `REFRESH_TOKEN_SECRET` is missing or blank — same place and
  same shape as the existing `ENCRYPTION_KEY` check. **Verified:**
  `fixing/evidence/F14/f14-probe.txt` — with `REFRESH_TOKEN_SECRET=""` the process exits 1
  with "refusing to boot. Without it the server would report READY and fail every login", and it
  never prints "Listening". The failure mode this issue describes — a healthy-looking instance
  nobody can authenticate against — can no longer exist.
- **Notes:** Concrete instance of `SCAN-M8` (no boot-time env validation). Filed separately because
  the specific defect — **the readiness probe lying** — is not what M8 describes and is what makes
  it hard to diagnose in production.

---

### ISS-004 · [P1] LOW · `COOKIE_SECRET` is a dead configuration key

- **Severity:** LOW
- **Type:** DOC / dead config
- **Phase:** P1
- **Area:** `server/src/app.ts:103` `cookieParser(Config.COOKIE_SECRET)` · `server/.env` ·
  `server/.env.example`
- **Repro:** boot with `COOKIE_SECRET=""` -> login 200 with a valid `bb_refresh` cookie ->
  `POST /auth/refresh` with that cookie -> 200 with a new access token. Full round-trip unaffected.
- **Expected:** a required secret matters, or it is not presented as one.
- **Actual:** nothing uses signed cookies (`bb_refresh` is a plain httpOnly cookie carrying a
  self-signed JWT), so the value is inert. It sits in `.env` and `.env.example` looking mandatory.
- **Evidence:** `testing/evidence/PHASE-01/missing-secrets-behaviour.txt`
- **Status:** **FIXED in F14** (2026-08-05). `COOKIE_SECRET` removed from
  `config/index.ts`, `app.ts` (`cookieParser()` now takes no argument), `.env` and
  `.env.example`. Nothing signs a cookie — `bb_refresh` is a plain httpOnly cookie carrying a
  self-signed JWT, exactly as this issue measured. The three dead keys it groups with
  (`SECRET_KEY`, `REDIS_URL`, `CLOUDFLARE_TOKEN_VALUE` — the SCAN-M8 family) went in the
  same pass. **Verified:** `fixing/evidence/F14/f14-probe.txt`.
- **Notes:** Same family as the `REDIS_URL` / `SECRET_KEY` / `CLOUDFLARE_TOKEN_VALUE` dead keys in
  `SCAN-M8`. Listed so the fixing phase can remove all four together.

---

### ISS-005 · [P1] LOW · `tsx` dev boot takes ~16.7 s versus 1.2 s for the compiled build

- **Severity:** LOW
- **Type:** PERF (developer experience)
- **Phase:** P1
- **Area:** `server/package.json` dev command · `tsx` on-the-fly transpilation of 286 files
- **Repro:** `PORT=x npx tsx src/server.ts` vs `PORT=y node dist/server.js`, timed from spawn to the
  port accepting connections.

| command | DB ready | listening |
|---|---|---|
| `npx tsx src/server.ts` | 2.2 s | **16.7 s** |
| `node dist/server.js` | 0.39 s | **1.2 s** |

- **Impact:** `tsx watch` restarts on every save, so each edit costs ~15 s before the API answers
  again. Not a production concern — the prod path is the fast one.
- **Evidence:** `testing/evidence/PHASE-01/boot-tsx-vs-dist-and-shutdown.txt`
- **Status:** **CLOSED in F30** (2026-08-06) — re-measured, does not reproduce: tsx boot is 4.1 s on today (bigger) tree vs the recorded 16.7 s; dist 2.0 s. Probe kept (fixing/evidence/F30/boot-probe.cjs); nothing built for a 2 s delta.
- **Notes:** A one-off 24 s `dist` boot was observed immediately after `npm run build` (cold file
  cache on 286 freshly-written files). It did not reproduce — steady state is 1.2 s. **Not** an
  issue; recorded here so it is not re-investigated.

---

### ISS-006 · [P1] LOW · Client bundle: 1.45 MB main chunk, 547 kB task drawer; vite emits a size warning

- **Severity:** LOW
- **Type:** PERF
- **Phase:** P1 (surfaced during the build check; deeper analysis belongs to P40)
- **Area:** `client/vite.config.ts` (no `manualChunks`)
- **Actual:** `index-BE8V4Iiz.js` **1,450.97 kB** (448.59 kB gzip) ·
  `TaskDetailDrawer-Cf9_mE5z.js` **547.09 kB** (172.06 kB gzip). Vite warns
  *"Some chunks are larger than 500 kB after minification."*
- **Expected:** no build warning; a first-load payload appropriate for a ~100-person internal tool
  on Bangladeshi network conditions.
- **Evidence:** build output in `testing/results/PHASE-01.md` §1
- **Status:** **FIXED in F30** (2026-08-06). react/editor/icons/map manualChunks: entry 1450->1146 kB (448->351 gz), drawer 551->171 kB with the editor lazy-split; antd bucket TRIED AND REJECTED by measurement (+130 gz eager); warning resolved with the measurement as justification.
- **Notes:** P40 owns the full performance pass (first paint, route chunks, largest component).
  Logged now because the build itself flags it.

---

### ISS-007 · [P2] MEDIUM · `limit` is silently ignored on 4 collection endpoints that advertise pagination

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P2 — API conventions
- **Area:** `server/src/repositories/ListsRepo.ts` · `SpacesRepo.ts` · `TagsRepo.ts` ·
  `TaskTypesRepo.ts` — none applies the caller's limit (only `.limit(1)` single-row lookups)
- **Account:** owner@company.local

`GET /lists`, `/spaces`, `/tags`, `/task-types` return the full `{data, pagination}` envelope — with
`has_more: false` and `next_cursor: null` — no matter what `limit` is passed. They always return
every row. `API_DESIGN.md` §1 assigns this family a default of 100 and a max of 200.

**Repro**

| endpoint | `limit=1` | `limit=3` | `limit=200` | |
|---|---|---|---|---|
| `/users` | 1 | 3 | 16 | honoured |
| `/notifications` | 1 | 3 | 15 | honoured |
| `/activity` | 1 | 3 | 6 | honoured |
| `/reports` | 1 | 3 | 12 | honoured |
| **`/lists`** | **14** | **14** | 14 | **ignored** |
| **`/spaces`** | **9** | **9** | 9 | **ignored** |
| **`/tags`** | **8** | **8** | 8 | **ignored** |
| **`/task-types`** | **7** | **7** | 7 | **ignored** |

- **Expected:** `limit=1` returns 1 row and `has_more: true`.
- **Actual:** every row returned; the pagination object reports there is nothing more.
- **Impact:** harmless at BeautyBooth's current size (8 spaces, 14 lists), but the payload grows
  without bound and the envelope actively lies to a paging client.
- **Evidence:** `testing/evidence/PHASE-02/limit-cursor-params.txt` · `pagination.txt`
- **Status:** **FIXED in F23** (2026-08-06). The four §1 endpoints (`/lists`,
  `/spaces`, `/tags`, `/task-types`) honour `limit` (default 100 / max 200) with a truthful
  `has_more` and a WORKING opaque cursor, via a shared `paginateArray`
  (`utils/pagination.ts`) over the position-ordered sets. **Verified:** `?limit=2` → 2 rows +
  cursor; following the cursor pages without overlap; `limit=0` → 422.
  `fixing/evidence/F23/f23-probe.txt`.
- **Notes:** `/forms`, `/sprints`, `/templates` could not be judged — 0–1 rows each. Re-check at
  scale in **P40**.

---

### ISS-008 · [P2] MEDIUM · Invalid cursors are handled inconsistently — one form makes a paging client loop forever

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P2
- **Area:** cursor decode in the paginated repositories

Some malformed cursors correctly produce `400 pagination.invalid_cursor`; others are silently
accepted and change which rows come back.

| cursor | result |
|---|---|
| `!!!!` | 400 `pagination.invalid_cursor` — correct |
| base64 of `{"id":"drop"}` | 400 — correct |
| base64 of `{"internal_id":999999999}` | 400 — correct |
| base64 of `not json` | 400 — correct |
| empty string | 422 `validation.failed` — correct |
| **`garbage`** | **200 — returns PAGE 1 again, with a `next_cursor`** |
| **valid cursor + `XX`** | **200 — returns a different, wrong page** |

- **Expected:** every cursor this server did not issue produces `400 pagination.invalid_cursor`.
- **Actual:** `garbage` restarts pagination at page 1 *and still hands back a next_cursor*, so a
  client that retries on a corrupted cursor never terminates. A tampered-but-plausible cursor
  silently shifts the data window.
- **Evidence:** `testing/evidence/PHASE-02/pagination.txt` (§7) · `limit-cursor-params.txt` (§B)
- **Status:** **FIXED in F23** (2026-08-06). `strictDecodeCursor` (round-trip
  byte-exact + printable-ASCII) backs all six cursor decoders; users additionally enforces its
  id-shape. `garbage` no longer restarts pagination with a fresh next_cursor (the forever-loop),
  and a tampered `<cursor>XX` no longer shifts the window. **Verified:** six foreign-cursor forms
  → `400 pagination.invalid_cursor`; an issued cursor still works.
  `fixing/evidence/F23/f23-probe.txt`.

---

### ISS-009 · [P2] MEDIUM · A disallowed CORS origin returns HTTP 500 and writes an error-log line every time

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P2
- **Area:** `server/src/app.ts:84-91` — the CORS `origin` callback calls `cb(new Error(...))`, which
  reaches the global handler as an unknown error

The **policy itself is correct** — all 10 origin cases behaved exactly as designed, including the
prefix trick (`localhost.evil.com`), the fragment trick, a literal `null` origin, and `172.32.x`
just outside the RFC-1918 block. The problem is only how a rejection is reported.

**Repro**
```
GET /api/v1/workspace   Origin: https://evil.example.com
-> 500 {"error":{"code":"internal","message":"Internal server error","request_id":"req_..."}}
server log: error [req_...] Unhandled error Origin https://evil.example.com not allowed by CORS
```
5 requests from 5 disallowed origins produced 5 `Unhandled error` lines.

- **Expected:** a rejected origin is a client-side condition (403 / simply no CORS headers), not a
  server fault, and should not be logged at `error` level.
- **Actual:** 500 plus an `error`-level log line per request.
- **Impact:** every real 500 is now buried among CORS noise, and the error log — which the deploy
  notes already flag as a disk risk on a 79%-full shared box — can be filled by anyone with a
  browser.
- **Evidence:** `testing/evidence/PHASE-02/cors-denied-and-logs.txt`
- **Status:** **FIXED in F13** (2026-08-05) — same one-line change as ISS-085
  (`cb(null, false)` in the CORS origin callback). The `Unhandled error` log lines are gone
  with the 500s: a rejected origin is a client-side condition and is no longer reported as a
  server fault. **Verified:** `fixing/evidence/F13/f13-probe.txt`.

---

### ISS-010 · [P2] MEDIUM · The published error catalog covers 37 codes; the server throws 140

- **Severity:** MEDIUM
- **Type:** DOC
- **Phase:** P2
- **Area:** `API_DESIGN.md` §32 vs `server/src/**`

**110 codes are thrown but undocumented** — a client written against the spec will meet codes it has
never heard of (`comment.edit_window_expired`, `role.escalation_blocked`, `form.invalid_field_key`,
`assistant.timeout`, and 106 more).

**7 codes are documented but never thrown:**

| code | why |
|---|---|
| `customer.duplicate_phone` · `customer.invalid_phone` | there is **no `customers` table** in this system — leftovers from a different product scope (the same phantom domain as the `customers` / `stock_batches` / `stock_movements` tables in `SCAN-H3`) |
| `health.dependency_down` | `/health/ready` returns a plain `{status:"not_ready"}` body, never this code |
| `list.has_open_tasks` | the server actually raises `list.not_empty` — a naming mismatch |
| `tag.in_use` · `task.cannot_complete_blocked` · `sprint.overlap` | the rules themselves are not implemented — see **ISS-011** |

- **Evidence:** `testing/evidence/PHASE-02/error-code-catalog.txt` (full 140-row inventory, each
  code mapped to its throw site)
- **Status:** **FIXED in F23** (2026-08-06) — the §32 catalog is REGENERATED FROM THE
  CODE: 129 distinct codes (the table said 37 while the server threw 140). The generator ships as
  `fixing/evidence/F23/regen-catalog.cjs` (re-run it after adding codes); a curated meanings
  table for the load-bearing codes follows the generated list. Several formerly
  documented-but-never-thrown codes became REAL in F22 (`tag.in_use`,
  `task.cannot_complete_blocked`, `sprint.overlap`, `role.last_admin`).
- **Notes:** The inventory file lets the fixing phase either document or delete each code without
  re-deriving the list.

---

### ISS-011 · [P2] MEDIUM · Three business rules the spec promises are not enforced (proven live)

- **Severity:** MEDIUM
- **Type:** GAP in behaviour, filed as a bug because §32 states the rule
- **Phase:** P2 (surfaced by the catalog sweep; owning phases are P11, P18, P28)
- **Account:** owner@company.local

**1 — `tag.in_use`: an in-use tag can be deleted, and is silently stripped from its tasks**
```
POST   /tags {name:"TEST-p2-tag"}          -> 201
POST   /tasks/:id/tags {tag_ids:[tag]}     -> 204    task tags = ["tag-80_k..."]
DELETE /tags/:tagId                        -> 204    *** expected 409 tag.in_use ***
GET    /tasks/:id                          -> tags = []   (silently detached)
```

**2 — `task.cannot_complete_blocked`: a blocked task can be moved to Done**
```
POST  /task-dependencies {task_id:B, related_task_id:A, type:"blocks"}  -> 201
(A is still open)
PATCH /tasks/B {status_id:<Done>}                                       -> 200  *** allowed ***
```

**3 — `sprint.overlap`: two sprints may cover overlapping dates**
```
POST /sprints {name:"s1", start 2027-01-04, end 2027-01-17}  -> 201
POST /sprints {name:"s2", start 2027-01-10, end 2027-01-24}  -> 201  *** allowed ***
```

- **Expected:** 409 in each case, per the §32 catalog.
- **Actual:** all three succeed.
- **Impact:** #1 loses categorisation data with no warning. #2 removes the point of a `blocks`
  dependency. #3 lets two overlapping sprints coexist for the engineering team.
- **Evidence:** `testing/evidence/PHASE-02/unreachable-spec-codes.txt`
- **Status:** **FIXED in F22** (2026-08-06) — all three §32 promises kept.
  **`tag.in_use` 409** (was: 204 + the FK silently stripping the tag from every task; the probe
  proves the task KEEPS its tag and an unused tag still deletes).
  **`task.cannot_complete_blocked` 409** on both the single PATCH and the fail-atomic BULK path
  while an open, non-archived blocker exists; completing the blocker first unblocks.
  **`sprint.overlap` 409** on create AND date-changing update (self excluded); back-to-back stays
  legal. **Verified:** `fixing/evidence/F22/f22-probe.txt` (19/19) + the day-in-the-life re-run
  47/47 — which itself caught a backwards dependency edge in the F7 fixture that only became
  visible when the rule became real.
- **Notes:** All test data was removed afterwards — 5 soft-deleted `TEST-` tasks hard-removed, 2
  stray sprints deleted at the DB level (see ISS-013 for why the API could not remove them).

---

### ISS-012 · [P2] LOW · Collection endpoints use four different response shapes, and `/activity/recent` contradicts its own spec

- **Severity:** LOW
- **Type:** DOC / consistency
- **Phase:** P2
- **Area:** `API_DESIGN.md` §1 vs §18 / §20 / §26, and the corresponding routers

§1 defines one list format, `{data, pagination}`. In practice there are four:

| shape | endpoints | spec'd? |
|---|---|---|
| `{data, pagination}` | `/spaces` `/lists` `/users` `/tags` `/task-types` `/templates` `/notifications` `/activity` `/reports` | §1 — yes |
| bare array | `/forms` `/sprints` `/sla/breached` | §18/§20 say `Form[]` / `Sprint[]` — spec and code agree, but both contradict §1 |
| `{data}` only | `/activity/recent` `/roles` | **`/activity/recent` spec says `RecentActivityEntry[]` — MISMATCH** |
| custom buckets | `/search` (`{tasks,lists,...,total}`) · `/tasks/my-work` (5 buckets) · `/home/kpis` | yes |

- **Impact:** the client cannot write one generic list handler; every call site must know its shape.
- **Evidence:** `testing/evidence/PHASE-02/envelope-shapes.txt`
- **Status:** **FIXED in F23** (2026-08-06), per D10 (documentation-only + the one true
  mismatch). §1 now documents the FOUR response families as deliberate exceptions with reasons, and
  `/activity/recent`'s spec — the only place spec and code genuinely contradicted — now says
  `{data}` (what the server always returned and the shipped client reads). Re-shaping
  `/forms`/`/sprints`/`/sla/breached` would break the only client for zero functional gain;
  revisit if a second client appears.

---

### ISS-013 · [P2] LOW · There is no `DELETE /sprints/:id` — a sprint can never be removed

- **Severity:** LOW
- **Type:** GAP
- **Phase:** P2 (owning phase P28)
- **Area:** `server/src/routes/sprints.ts` — has `DELETE /sprints/:id/tasks/:taskId` but no
  `DELETE /sprints/:id`
- **Repro:** `DELETE /api/v1/sprints/<any id>` -> `404 route.not_found`
- **Impact:** a sprint created by mistake (wrong dates, typo'd name) stays in the list forever;
  removing it needs direct SQL. Hit for real while cleaning up this phase's test data.
- **Evidence:** `testing/evidence/PHASE-02/unreachable-spec-codes.txt`
- **Status:** **FIXED in F28** (2026-08-06, D12.6). `DELETE /sprints/:id` built behind `sprint.manage`; tasks DETACH (`ON DELETE SET NULL`); an ACTIVE sprint refuses with 409 `sprint.active_immutable`.

---

### ISS-014 · [P2] LOW · Unknown query parameters are silently ignored

- **Severity:** LOW
- **Type:** UX
- **Phase:** P2
- **Area:** all list endpoints — express-validator whitelists the known params and ignores the rest
- **Repro** (`/users` holds 16 rows):

| query | result |
|---|---|
| `?q=zzzz` | 0 items — a real filter |
| `?role=guest` | 1 item — a real filter |
| `?status=active` | 15 items — a real filter |
| `?search=zzzz` | **16 items — silently ignored** |
| `?filter=zzzz` | **16 items — silently ignored** |
| `?totallyMadeUpParam=1` | **16 items — silently ignored** |

- **Impact:** a client that mistypes a filter name (`search` instead of `q`) silently receives the
  entire unfiltered set instead of an error.
- **Evidence:** `testing/evidence/PHASE-02/limit-cursor-params.txt` (§D)
- **Status:** **FIXED in F23** (2026-08-06). An `allowQuery` middleware refuses unknown
  query parameters with a 422 that names the parameter AND the accepted set — applied to the five
  primary collection endpoints (`/users` — the issue's evidence — plus `/spaces`, `/lists`,
  `/tags`, `/task-types`). Extending to every list endpoint is mechanical and left for the F32
  sweep. **Verified:** `/users?search=zzzz` → 422 naming `search` (was: all rows);
  `?q=` still filters. `fixing/evidence/F23/f23-probe.txt`.

---

### ISS-015 · [P3] MEDIUM · Changing your password does not sign out your other sessions — resetting it does

- **Severity:** MEDIUM
- **Type:** SECURITY
- **Phase:** P3 — Authentication
- **Area:** `server/src/services/AuthService.ts` — `changePassword` does not revoke sessions;
  the reset path does
- **Account:** a throwaway invited user (`p3.testuser@…`), removed afterwards

The two password paths disagree, and the *more common* one is the unsafe one.

**Repro — change-password**
```
3 devices signed in                    live sessions = 4
device1: POST /auth/change-password -> 204
                                       live sessions = 4   (unchanged)
device2: POST /auth/refresh         -> 200   *** still signed in ***
device3: GET  /auth/me              -> 200   *** still signed in ***
```

**Repro — reset-password (the correct behaviour)**
```
2 devices signed in                    live sessions = 6
POST /auth/reset-password           -> 204
                                       live sessions = 0
a pre-reset device: POST /auth/refresh -> 401  revoked
```

- **Expected:** changing a password ends every other session — that is usually *why* someone
  changes it. OWASP treats it as a baseline control, and the sibling reset flow already does it.
- **Actual:** every other session survives, and each holds a refresh cookie valid for **30 days**.
- **Impact:** a user who suspects their account is compromised changes their password and is told it
  succeeded — while the intruder stays signed in for up to a month.
- **Evidence:** `testing/evidence/PHASE-03/session-revocation-and-staleness.txt` ·
  `invitation-password-flows.txt`
- **Status:** **FIXED in F10** (2026-08-04) — `AuthService.changePassword` now calls
  `revokeAllForUser` after the hash write, the same line the reset path always had. 3 live sessions
  → 0; another device's refresh → 401 (was 200); the new password signs in. The two password paths
  agree again. Proof: `fixing/evidence/F10/f10-probe.txt` §ISS-015.
- **Notes:** The machinery already exists — `POST /auth/logout-all` revokes every session correctly
  (verified in this phase). The change-password handler simply does not call it.

---

### ISS-016 · [P3] MEDIUM · An access token with no `exp` claim is accepted and never expires

- **Severity:** MEDIUM
- **Type:** SECURITY
- **Phase:** P3
- **Area:** `server/src/middlewares/authenticate.ts` — `expressjwt({secret, algorithms:["HS256"]})`
  with no `requiredClaims` / `maxAge`

**Repro** — sign a payload with the real `ACCESS_TOKEN_SECRET` but omit `iat`/`exp`:
```
jwt.sign({sub, role, workspaceId}, ACCESS_TOKEN_SECRET, {noTimestamp:true})
GET /auth/me  ->  200 OK
```
Every other malformed variant is correctly rejected: expired -> 401 `auth.expired_token`,
`alg=none` -> 401, wrong signature -> 401, signed with the refresh secret -> 401, HS512 -> 401.
Only the missing-`exp` case slips through.

- **Expected:** a token without an expiry is refused.
- **Actual:** accepted, and since **access tokens are never checked against the `sessions` table**
  (only refresh tokens are), such a token cannot be revoked by logout, logout-all, deactivation, or
  a password reset. It is a permanent credential.
- **Impact:** this is not remotely exploitable on its own — it needs the signing secret. It matters
  because it converts a secret leak from "15-minute exposure" into "permanent, unrevocable
  access". The repo's own history makes that relevant: secrets were committed to git once and,
  per the project notes, provider-side rotation is still outstanding.
- **Evidence:** `testing/evidence/PHASE-03/jwt-attacks.txt`
- **Status:** **FIXED in F10** (2026-08-04) — `middlewares/authenticate.ts` now REQUIRES an `exp`
  claim after verification (express-jwt only validates one when present), raising its own
  `UnauthorizedError` so the envelope stays 401 `auth.invalid_token`. exp-less → 401 (was 200);
  normal + expired tokens unchanged. Proof: `fixing/evidence/F10/f10-probe.txt` §ISS-016.
- **Notes:** One-line fix shape — `requiredClaims: ["exp"]` (or a `maxAge`) on the express-jwt
  config. Related but distinct from ISS-018.

---

### ISS-017 · [P3] LOW · Every token refresh inserts a new `sessions` row; the table grows ~3.2k rows/day

- **Severity:** LOW
- **Type:** PERF / capacity
- **Phase:** P3
- **Area:** `server/src/services/AuthService.ts` refresh path · `server/src/jobs/sessionCleanup.ts`

Refresh **rotates** correctly — a new session id is issued and the old row is revoked, and replaying
the old cookie is refused (verified). But rotation means an INSERT, not an UPDATE.

**Measured:** 5 refreshes -> `sessions` grew from 259 to 264 rows (delta exactly 5).

**Projection at BeautyBooth scale:** an access token lives 15 minutes, so an active user refreshes
~32 times in an 8-hour day, plus once per page reload. 100 users -> **~3,200 rows/day**.
`session-cleanup` only deletes rows whose `expires_at` is more than 30 days past, and `expires_at`
is set 30 days out — so a revoked row survives ~60 days. Steady state ≈ **190k rows**.

The dev database already holds 267 session rows for 16 users, 246 of them revoked.

- **Impact:** not urgent — the table is indexed and the rows are small. But `sessions` is read on
  every refresh, it grows without a matching cleanup rule for *revoked* rows, and this is a shared
  box whose disk the deploy notes already flag.
- **Evidence:** `testing/evidence/PHASE-03/auth-flows.txt` (§12)
- **Status:** **FIXED in F10** (2026-08-04) — `session-cleanup` gained a second rule:
  `revoked_at < now − 7 days` (a revoked session can never authenticate again; 7 days keeps a
  forensic window). Projected steady state ~190k → ~23k rows. The 30-day expiry rule is untouched;
  the dry run counts both rules ONCE (`countPrunable`, an OR-count). The old test that asserted the
  pre-fix behaviour was updated, and a keep-the-fresh-revoked-row case added.
  Proof: `fixing/evidence/F10/f10-probe.txt` §ISS-017.
- **Notes:** Cheapest fix is to have `session-cleanup` also delete rows that are revoked and older
  than a few days, rather than waiting for `expires_at + 30d`.

---

### ISS-018 · [P3] LOW · Logging out does not invalidate the access token (up to 15 minutes)

- **Severity:** LOW
- **Type:** SECURITY (documented design, recorded with a measured bound)
- **Phase:** P3
- **Area:** `server/src/middlewares/authenticate.ts` — access tokens are verified by signature only

**Repro**
```
POST /auth/logout            -> 204   sessions.revoked_at SET, cookie cleared, live sessions 0
POST /auth/refresh (cookie)  -> 401   auth.invalid_refresh          correct
GET  /auth/me   (old access) -> 200   *** still accepted ***
```

The same holds after deactivation:
```
POST /users/:id/deactivate   -> 204   status=deactivated, live sessions 0
GET  /auth/me   (old access) -> 200   still accepted
POST /auth/refresh           -> 401   rejected — so the window is BOUNDED, not renewable
fresh login                  -> 401   correctly refused
```

- **Expected / documented:** the project notes record the deactivated-user window as an accepted
  auth-layer decision. This entry records the measured facts: the window is **at most 15 minutes**
  (the access-token TTL), it **cannot be extended** (refresh is refused immediately), and it applies
  to plain logout as well as deactivation.
- **Impact:** low in the SPA — the token is held in memory only and is dropped on logout. It matters
  for any non-browser client, and for the "fired employee" case, where 15 minutes of API access
  remains after the admin deactivates the account.
- **Evidence:** `testing/evidence/PHASE-03/session-lifecycle.txt` ·
  `session-revocation-and-staleness.txt`
- **Status:** **WON'T FIX — documented decision (D4, 2026-08-04)**, re-measured in F10. The user
  chose the live-role check over a shorter TTL, so the ≤15-minute window on a LOGGED-OUT token
  stands: logout 204 · refresh 401 (the window cannot be renewed) · the old access token is accepted
  for the remainder of its ≤15 min. Note what DID change: a **demoted** user now loses the elevated
  gates on the next request (ISS-021/F10) — this row is only about a logged-out token still
  authenticating. Closing it needs a per-request sessions lookup or a TTL cut; neither was chosen.
  Measurement: `fixing/evidence/F10/f10-probe.txt` §ISS-018.
- **Notes:** Filed so the fixing phase makes the call once, for logout + deactivation + ISS-016
  together. Options: check `sessions.revoked_at` in `authenticate`, or shorten the access TTL.

---

### ISS-019 · [P4] MEDIUM · Deactivating a user silently strips their department headship, and reactivating does not give it back

- **Severity:** MEDIUM
- **Type:** DATA (silent config loss)
- **Phase:** P4 — Legacy role authorization
- **Area:** `POST /users/:id/deactivate` · `spaces.head_user_id`
- **Account:** owner@company.local acting on `nusrat@` (Marketing head)

**Isolated with a controlled, reverted experiment**

```
start:              Marketing head = u-ia1-Y219…   nusrat role = member
POST /users/:id/deactivate  -> 204   head now = NULL      <-- cleared here
POST /users/:id/reactivate  -> 204   head now = NULL      <-- NOT restored
PATCH role -> guest         -> 200   head now = NULL      (role change is not the cause)
PATCH role -> member        -> 200   head now = NULL
```

`workspace_activity` recorded `deactivated` and `reactivated` for the user — and **nothing at all for
the space**. The headship simply disappears.

- **Expected:** either headship survives a deactivation (and is restored on reactivate), or the
  system refuses / warns / logs it.
- **Actual:** cleared silently, permanently, with no audit row.
- **Impact:** 6 of BeautyBooth's 9 spaces have a head. Deactivating any of those six — ordinary HR
  practice for leave, suspension or a temporary exit — silently orphans that department: the weekly
  HR report generates with no head, and `/dept` review-queue and review-summary access is lost
  (both are head-gated, verified 403 `review.not_head` for non-heads). Nobody is told, and
  reactivating the person does not fix it.
- **Evidence:** `testing/evidence/PHASE-04/last-admin-and-orphans.txt`; hit for real when the
  last-admin test deactivated `tanvir@` and Engineering lost its head — restored manually.
- **Status:** **FIXED in F22** (2026-08-06). Headship SURVIVES deactivation — the
  `clearHeadships` call is gone. The issue's own Expected line offers this option, and it is the
  cheapest correct one: a deactivated head cannot log in anyway (F10 revokes every session), a
  returning head finds the department intact, and replacing them remains a one-PATCH admin act.
  **Verified:** deactivate the Marketing head → `head_user_id` KEPT; reactivate → identical.
  `fixing/evidence/F22/f22-probe.txt`.

---

### ISS-020 · [P4] MEDIUM · The last-admin rule is not enforced — a workspace can be left with zero active admins

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P4
- **Area:** `PATCH /users/:id/role` · `POST /users/:id/deactivate` — no last-admin guard.
  `role.last_admin` exists in `RolesAdminService.ts` but guards only the **dynamic-RBAC** role
  assignment path, not the legacy `users.role` column.

**Repro** (executed, then fully restored)

```
active admins: farhana@, rakib@, tanvir@
PATCH farhana -> member                 -> 200
PATCH rakib   -> member                 -> 200
PATCH tanvir  -> member   (LAST admin)  -> 200   *** expected 409 role.last_admin ***
POST  tanvir  /deactivate               -> 204   *** the last admin is now gone ***
result: 0 active admins
```

- **Expected:** 409 `role.last_admin` on the final demotion or deactivation — the code has the error
  code for exactly this.
- **Actual:** both succeed. Every admin can be removed.
- **Impact:** recoverable in practice, because the **owner** cannot be demoted or deactivated
  (verified — 403 `user.cannot_change_owner_role` / `user.cannot_deactivate_owner`), so there is
  always one account that can restore an admin. But until someone notices, no one can reach
  Settings → Roles, invite members, or manage the catalog.
- **Evidence:** `testing/evidence/PHASE-04/last-admin-and-orphans.txt`
- **Status:** **FIXED in F22** (2026-08-06). The legacy role-PATCH and deactivate paths
  now refuse any transition that would leave ZERO active admin-capable (owner|admin) accounts —
  `409 role.last_admin`, mirroring the dynamic-RBAC path's existing rule. **Stated honestly:**
  while an ACTIVE owner exists the guard is unreachable (the owner cannot be demoted/deactivated —
  pre-existing guards — and an owner who can log in can always fix things, the issue's own
  rationale inverted); it protects the workspace whose owner is inactive (imports, hand edits).
  **Verified by forcing that state** and restoring it: demote-last → 409, deactivate-last → 409;
  with the owner active, demoting an admin stays 200. `fixing/evidence/F22/f22-probe.txt`.
- **Notes:** All three admins were restored and verified after the test.

---

### ISS-021 · [P4] MEDIUM · A role downgrade does not take effect for up to 15 minutes — the stale token wins on service-level gates

- **Severity:** MEDIUM
- **Type:** SECURITY
- **Phase:** P4 (resolves the item deferred from P3)
- **Area:** the access token carries `role`; the service-level gates read `req.auth.role`
  (`AttachmentsService:108,186,350`, `CommentsService:190`, `TaskWriteService:928`,
  `ReviewsService:156,349`, `ReportsService:226`)

**Repro**
```
member's access token claims role = member
owner: PATCH /users/:id/role {role:"guest"}   -> 200,  DB role = guest
same (now-guest) user, same pre-change token:
POST /tasks/:id/attachments                   -> 201   *** ALLOWED ***
```
A fresh guest token is correctly refused on that endpoint (403 `auth.forbidden`), so the gate works
— it is reading a stale claim.

- **Expected:** downgrading someone's role takes effect on their next request.
- **Actual:** their existing token keeps the old authority until it expires — up to 15 minutes.
- **Impact:** the read surfaces are honest — `GET /auth/me` and `GET /me/permissions` both report
  the fresh DB role — so an admin who demotes someone and then checks sees the change and believes
  it is done. The *enforcement* has not caught up.
- **Evidence:** `testing/evidence/PHASE-04/service-role-gates.txt` (§J)
- **Status:** **FIXED in F10** (2026-08-04, D4 = live check) — the eight service gates that read
  `req.auth.role` now call `liveLegacyRole()` (`rbac/scopeGuard.ts`), which returns the role the RBAC
  resolver already reads per request (version-stamped cache — no extra query). Repro flipped: after
  a demotion the SAME old token gets **403** on the very next hard-delete (was 204 for ≤15 min),
  while its member powers still work. Sites: TaskWriteService.del · CommentsService.delete ·
  AttachmentsService ×3 · UserService.updateProfile · ReportsService ×3 · ReviewsService ×2.
  Proof: `fixing/evidence/F10/f10-probe.txt` §ISS-021.
- **Notes:** Same family as ISS-018 (logout / deactivation window). The dynamic-RBAC layer does not
  have this problem — it resolves from the database and bumps `permissions_version`, so a
  revocation there is instant. Only the **legacy `role` claim** is stale. Worth fixing once for
  ISS-016 / ISS-018 / ISS-021 together.

---

### ISS-022 · [P4] MEDIUM · Hard-deleting a task orphans its files in R2 forever

- **Severity:** MEDIUM
- **Type:** DATA / cost
- **Phase:** P4
- **Area:** `attachments → tasks` FK is `ON DELETE CASCADE` (verified in
  `information_schema.REFERENTIAL_CONSTRAINTS`) · `server/src/jobs/r2Purge.ts` scans
  `attachments WHERE deleted_at < cutoff`

`DELETE /tasks/:id?hard=true` (admin/owner) removes the task row. The FK cascade removes its
`attachments` rows **immediately** — so the r2-purge job, which finds objects to delete by reading
soft-deleted attachment rows, never learns those objects exist. The bytes stay in R2 permanently.

**Proven during this phase:** four attachments were uploaded to a fixture task and the task rows were
then removed. The DB rows vanished; the four objects were still in the bucket and had to be deleted
by hand:
```
objects in bucket 'taskmanager': 6
workspaces/ws-…/attachments/att-1Ret3T4rVls4ymfsG1nDJg.png   5B
workspaces/ws-…/attachments/att-8RemUVm18G3yt-6GgaxsHg.png  14B
workspaces/ws-…/attachments/att-DERzs32cfm2BWLmx8wlrIQ.png  14B
workspaces/ws-…/attachments/att-dfliBhWVTa4GHI1nKuByGw.png  14B
-> all four deleted manually; 2 legitimate objects remain
```

- **Expected:** deleting a task also schedules its objects for removal.
- **Actual:** the objects are stranded — invisible to the app, still billed, still fetchable by
  anyone holding the (unguessable) key.
- **Impact:** storage cost grows monotonically, and files a user believes they deleted are still
  stored. Relevant for the form-submission PII retention story too.
- **Evidence:** `testing/evidence/PHASE-04/r2-cleanup.txt` · `last-admin-and-orphans.txt` (§K)
- **Status:** **FIXED in F16** (2026-08-06). New `r2_purge_queue` table
  (X4: `upgrades/007` + schema.sql + Drizzle): the hard-delete transaction copies the subtree's
  storage keys (main + thumbnail) into it BEFORE the task row goes — same transaction, so either the
  task is deleted with its keys queued or nothing happens; the window in which bytes could orphan
  does not exist. The r2-purge job drains the queue on its normal schedule with the same
  objects-first-row-second crash contract it already had; dry run reports `wouldDrainQueue`.
  **Soft-deleted attachments are queued too** — their rows also cascade, before the ordinary 7-day
  purge would reach them. No grace period: the task is already permanently gone.
  **Verified with real R2 traffic:** `fixing/evidence/F16/f16-probe.txt` — 3 uploads (one
  soft-deleted), hard delete -> all 3 keys queued incl. the child's; job dry run reports 3 without
  draining; real run: queueDrained 3, r2Errors 0, queue empty.
- **Notes:** This test also **positively confirms R2 is correctly configured and working** — the
  uploads reached the real bucket. Good news for P23.

---

### ISS-023 · [P4] LOW · One of the eleven guest-redaction call sites hardcodes the flag to `false`

- **Severity:** LOW (latent — not reachable by a guest today)
- **Type:** BUG
- **Phase:** P4
- **Area:** `server/src/services/ReviewsService.ts:515`

The only guest redaction the system implements is "hide custom-field values flagged hidden", applied
by passing a `redactGuest` flag into `TasksRepo.customFieldValuesByTask()`. Ten of the eleven call
sites pass the computed flag. One does not:

```
EngineeringService.ts:423      customFieldValuesByTask(ids, redactGuest)
HomeService.ts:141             customFieldValuesByTask(ids, redactGuest)
SearchService.ts:170           customFieldValuesByTask(ids, redactGuest)
TaskDependenciesService.ts:343 customFieldValuesByTask(presentIds, redactGuest)
TasksService.ts:98,147,195,231 customFieldValuesByTask(…, redactGuest)
TaskWriteService.ts:1000,1227  customFieldValuesByTask(ids, redactGuest)
ReviewsService.ts:515          customFieldValuesByTask(taskIds, false)      <-- hardcoded
```

- **Why it is LOW, not MEDIUM:** that call site serves `GET /spaces/:id/review-queue`, which is
  head-gated in the service — verified live: owner 200, admin 200, **member 403 `review.not_head`,
  guest 403 `review.not_head`**. And `SpacesService:236` refuses to make a guest a space head. So no
  guest can currently reach it.
- **Why it still matters:** it is a redaction control that silently does not apply on one path, and
  nothing prevents the head gate from being relaxed later. There are also 0 custom fields in the
  database today, so nothing is leaking right now either.
- **Evidence:** `testing/evidence/PHASE-04/guest-redaction.txt` · `service-role-gates.txt` (§E, §L)
- **Status:** **FIXED in F26** (2026-08-06). `ReviewsService` computes `redactGuest`
  the way its ten siblings do, instead of passing a literal `false` — so a guest reading the
  review queue no longer sees custom-field values the other ten sites redact. Latent until ISS-042
  made the flag settable at all; both were fixed in the same phase for that reason.
  **Verified:** `fixing/evidence/F26/f26-probe.txt`.

---

### ISS-024 · [P5] HIGH · Definitive RBAC enforcement table — 18 of 56 permissions do nothing (refines SCAN-H1)

- **Severity:** HIGH
- **Type:** SECURITY
- **Phase:** P5 — Dynamic RBAC
- **Area:** the 56-permission catalog vs actual enforcement
- **Account:** a purpose-built probe user holding a custom role with a controlled grant set

`SCAN-H1` estimated 25 unenforced permissions from static analysis. This phase measured it by
executing every permission's governing endpoint twice — once with the permission **withheld**, once
with it **granted** — against real fixtures. The measured answer is different and is now definitive.

| verdict | count |
|---|---|
| **ENFORCED** (denied without the grant, allowed with it) | **30** |
| **NOT ENFORCED** (action succeeds with the permission withheld) | **18** |
| enforced by another mechanism (visibility / own-escape) | 2 — `space.view`, `task.view` |
| blocked by a *different* gate, so the permission is moot | 1 — `report.note` (snapshot-head-only) |
| inconclusive, needs a richer fixture | 5 |

**UPDATE (P12):** `customfield.set_value` was resolved as **NOT ENFORCED** — a Department Only user
without the grant set a custom-field value and got 200. The count is therefore **19 of 56**.

**UPDATE (P29):** `postmortem.manage` resolved as **NOT ENFORCED** — a **guest** saved an incident
postmortem (200) on a resolved incident. A guest also filed a bug through `POST /eng/report-bug` (201),
re-confirming `bug.report`. That clears the fourth of P5's five inconclusive rows; the measured count
is now **21 of 56**. Only `review.perform` and `form.view_submissions` remain unresolved.

**UPDATE (P28):** `sprint.assign_tasks` re-confirmed NOT ENFORCED, and the asymmetry is stark: a
**member** cannot create a sprint (403 `auth.forbidden`) and cannot close one (403), but a **guest**
added tasks to the active sprint (204) and removed them again. Sprint composition is the thing the
engineering team actually manages day to day, and it is the one part with no gate. No count change.

**UPDATE (P27):** `template.apply` resolved as **NOT ENFORCED** — a **guest** was refused when
creating a template (403 `auth.forbidden`) and then successfully **applied** one (201), materialising a
real task with its checklist. That was one of the five inconclusive rows; the count is now **20 of 56**.

**UPDATE (P18):** `dependency.manage` re-confirmed at the route level — `routes/taskDependencies.ts`
carries **no `requirePermission` at all** on any of its three endpoints ("🔐 any authenticated
member" in its own header comment). A **guest** account created a dependency (201) and deleted it
(204). No count change; this is one of the 18 already listed.

**The 18 proven NOT ENFORCED:**
```
member.view            member.edit_profile    task.create          task.edit
task.assign            task.archive           task.delete          task.delete_hard
comment.create         comment.delete_any     checklist.manage     attachment.upload
attachment.delete_any  dependency.manage      sprint.assign_tasks  bug.report
report.view            activity.view
```
Each was verified with the grant withheld and the endpoint returning **2xx** — e.g. `task.delete`
→ `204`, `attachment.upload` → `201`, `comment.delete_any` → `204`, `bug.report` → `201`.

**`task.delete_hard` and `comment.delete_any` deserve a special note.** With the probe user's legacy
role temporarily raised to `admin` (to unmask the legacy gate), granting or withholding the RBAC
permission made **no difference at all** — 204 either way. So the toggle in the roles grid is inert:
the only thing deciding those two actions is the legacy `users.role` column.

**Three corrections to SCAN-H1** — these *are* enforced, contrary to the static estimate:
`report.generate` (403 `report.forbidden` without the grant), `review.read` (403 `review.forbidden`),
and `space.head_assign` (403 `auth.forbidden`).

- **Expected:** unchecking a permission in `/settings/roles` changes what the holder can do.
- **Actual:** for 18 of 56 it changes nothing.
- **Evidence:** `testing/evidence/PHASE-05/enforcement-probe.txt` (the 56-row two-pass table) ·
  `enforcement-resolve.txt` (the second pass that resolved 9 of the 14 initially inconclusive)
- **Status:** **FIXED in F7** (2026-08-04) — all 21 now enforce. 34 route gates (17 keys) + 6
  service composes per `fixing/evidence/F06/ROUTE_PERMISSION_MAP.md`; D3.1 = COMPOSE (admin branch
  `legacyAdmin && holds(key)`, feature branches free), so the two inert-toggle special cases
  (`task.delete_hard`, `comment.delete_any`) are real toggles now and compose cannot widen access.
  Seeded grants unchanged (asserted zero-drift). Proof: the P5 two-pass probe re-run — **NOT
  ENFORCED 21 → 0** (`fixing/evidence/F07/f7-enforcement-probe.txt`, exit 0) — and the P39
  day-in-the-life re-run **47/47** (“nobody lost a job function”). `space.head_assign` (enforced
  nowhere, found in F6) is also live now, body-conditional under `PATCH /spaces/:id`.
- **Notes:** Supersedes the *count* in `SCAN-H1`; the finding itself is the same one. The five still
  inconclusive (`customfield.set_value`, `template.apply`, `form.view_submissions`,
  `postmortem.manage`, `review.perform`) need fixtures their owning phases will build anyway —
  P12, P27, P26, P29, P31 respectively. `form.view_submissions` is untestable for a different
  reason — see **ISS-025**.

---

### ISS-025 · [P5] HIGH · `GET /forms/:id/submissions` returns 500 for everyone — the dev database is missing two columns

- **Severity:** HIGH (dev/QA environment; production is believed unaffected)
- **Type:** DATA / schema drift
- **Phase:** P5
- **Area:** `form_submissions` table · `server/src/db/schema/forms.ts:114` ·
  `server/src/services/FormsService.ts:770` · `server/src/db/migrations/0005_form_encryption.sql`

**Repro** — as the **owner**, on a freshly created form:
```
POST /api/v1/forms                        -> 201
GET  /api/v1/forms/<id>/submissions       -> 500 {"error":{"code":"internal", …}}
server log: Unhandled error  Unknown column 'encrypted_at' in 'field list'
```

**Root cause — a column-level drift a table-level check cannot see.** A full column diff of the live
dev database against `database/schema.sql` found exactly one discrepancy:

```
form_submissions   missing: encrypted_at, expires_at
```

Both columns are declared in `database/schema.sql:951`, in the Drizzle schema
(`forms.ts:114`), and added by `migrations/0005_form_encryption.sql` — but the live
`taskmanagement` database predates that change and was never upgraded.

- **Blast radius on the dev box:** `GET /forms/:id/submissions` is dead; `FormsService:770` writes
  `encryptedAt` on submission, so **public form intake would fail too**; the
  `form-submission-expiry` job filters on `expires_at`, so it cannot work either. The whole Forms
  feature is untestable locally.
- **Production:** provisioned from `schema.sql` (verified 41 tables / 5 views / 7 triggers in P1),
  which *has* both columns — so prod is expected to be fine. Not verifiable from here.
- **Fix on the dev + QA databases:**
  `ALTER TABLE form_submissions ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL, ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL;`
  (or re-provision from `schema.sql`).
- **Evidence:** `testing/evidence/PHASE-05/column-drift.txt` · `remaining-resolution.txt`
- **Status:** **FIXED in F17** (2026-08-06), by the documented upgrade path:
  `database/upgrades/008_form_submission_retention.sql` — `encrypted_at`, `expires_at`, and
  `idx_form_submissions_expires_at` (the retention job scans it), each gated on information_schema
  via prepared statements (MySQL 8 has no ADD COLUMN IF NOT EXISTS). Applied to dev + QA;
  **idempotent, proven by applying twice (16/16 both times)**. QA already had the columns (fresh
  provision) — the before-capture shows dev 0/2 vs QA 2/2, exactly the asymmetry this issue
  describes.
  **All three failure surfaces reproduced live first, then re-verified green**
  (`fixing/evidence/F17/before.txt` / `after.txt`): submissions list 500 -> 200; public intake
  500 -> 201 with `encrypted_at` set and `expires_at = submitted_at + exactly 90 days`; the
  expiry job "Unknown column" -> ok:true.
  **Backfill judgement, stated:** legacy rows keep `encrypted_at = NULL` (they were stored
  unencrypted; back-dating would hide which rows predate encryption) but get
  `expires_at = submitted_at + 90d` so PII still ages out.
  **Rule X9's first half is RETIRED** — and the F7/F8/F15 probes' add/drop protocol was DEFUSED
  (their cleanup DROPs would have silently reintroduced the drift on any re-run; zero DROP COLUMN
  lines remain under fixing/evidence/). With F15's trigger drop, both X9 states are now closed.
- **Notes:**
  - Same family as `SCAN-H4` (dev DB drifted from `schema.sql`) — that one was extra triggers, this
    one is missing columns. **Two independent drifts now.** The local database is not a faithful
    copy of what `db:setup` produces.
  - **This must be fixed before P26 (Forms, XL)**, which would otherwise test a broken environment.
  - It also corrects a limitation of my own P1 result: that phase compared *table names* (41/41) and
    reported schema parity. The comparison was table-level; this is the first column-level check,
    and it found the one real difference. The rest of the schema is clean —
    `business_hours_start/end` initially looked like drift but is declared in `schema.sql` as `TIME`
    and was a parser artefact.

---

### ISS-026 · [P5] MEDIUM · System roles can be renamed, though they cannot be deleted

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P5
- **Area:** `PATCH /roles/:id` vs `DELETE /roles/:id` — the immutability guard covers delete only

**Repro** (executed, then restored)
```
DELETE /roles/<system role>   -> 409 role.system_immutable      correct
PATCH  /roles/<system role> {name:"hacked"}   -> 200            *** allowed ***
DB: roles.role_key='admin', is_system=1, name='hacked'
```
The `Admin` system role was renamed and had to be restored by hand.

- **Expected:** `role.system_immutable` on rename too — a system role's identity is what the seeded
  behaviour and the docs refer to.
- **Actual:** the name of `Owner`, `Admin`, `Member` or `Guest` can be changed to anything by anyone
  holding `role.manage`. `role_key` stays correct, so nothing breaks functionally — but the roles
  grid, `DEMO_ACCOUNTS.md`, the permission matrix and every support conversation now disagree with
  what the UI shows.
- **Evidence:** `testing/evidence/PHASE-05/rbac-crud-scoping-idor.txt` (§2)
- **Status:** **FIXED in F27** (2026-08-06). A system role's NAME is immutable, using the
  SAME guard shape the delete path has — description and colour stay editable (cosmetic; the name is
  the identifier people navigate by), and a no-op rename to a role's own name is not an error.
  **One correction to this issue's repro:** it records the delete guard as "409
  role.system_immutable". Verified live, `DELETE` on a system role has ALWAYS answered **403**
  (`AppError.forbidden`); the rename guard therefore answers 403 too, and the probe asserts both
  endpoints AND that they agree. **Verified:** `fixing/evidence/F27/f27-probe.txt`.

---

### ISS-027 · [P5] LOW · Two roles can share the same display name

- **Severity:** LOW
- **Type:** UX
- **Phase:** P5
- **Area:** `POST /roles` — `role_key` is de-duplicated, the display `name` is not

```
POST /roles {name:"TEST-p5-dupe"}  -> 201   role_key = test-p5-dupe
POST /roles {name:"TEST-p5-dupe"}  -> 201   role_key = test-p5-dupe-2   <-- same NAME
```

`role.key_taken` exists in the error catalog and never fires, because the server silently suffixes
the key instead. The name collides freely.

- **Impact:** `/settings/roles` shows two visually identical rows, and an admin assigning "Marketing
  Lead" to someone has no way to tell which one they picked.
- **Evidence:** `testing/evidence/PHASE-05/rbac-crud-scoping-idor.txt` (§2)
- **Status:** **FIXED in F27** (2026-08-06). `UNIQUE (workspace_id, name)` on
  `roles` → `409 role.name_taken`, create and rename. `role_key`'s silent numeric suffixing —
  the reason `role.key_taken` existed and never fired — is untouched; it is the DISPLAY name that
  is unique now, which is what collided in the roles grid. **Schema (X4):** `upgrades/010` +
  schema.sql + Drizzle. **Verified:** `fixing/evidence/F27/f27-probe.txt`.
- **Notes:** Related to `ISS-010` — `role.key_taken` is one of the documented-but-never-thrown codes.

---

### ISS-028 · [P6] MEDIUM · The "Default locale" control in Workspace settings silently discards what you choose

- **Severity:** MEDIUM
- **Type:** BUG (silent data loss in a form)
- **Phase:** P6 — Workspace
- **Area:** `client/src/pages/settings/WorkspaceSettings.tsx:140-152` (editable `<Select>`) ·
  `client/src/http/mappers.ts:69-89` (`workspaceToWire` omits it) ·
  `server/src/validators/workspace.ts` (the API rejects it outright)

Three layers disagree about whether `default_locale` is editable:

| layer | behaviour |
|---|---|
| `GET /workspace` | returns `default_locale: "en-US"` |
| Settings UI | renders a **fully editable** locale `<Select>` bound to `draft.settings.defaultLocale` |
| `workspaceToWire` | **never emits it** — the mapper maps name, logoUrl, timezone, weekStartsOn, workingDays, businessHours, fiscalYearStartMonth, and nothing else |
| `PATCH /workspace` | if it *were* sent: **422 `default_locale cannot be updated via this endpoint`** (verified) |

So a user opens Workspace settings, changes the locale, clicks **Save**, and sees
**"Workspace saved"** — while the value is dropped by the mapper before the request is even built.
Reload, and it is back to what it was.

- **Expected:** either the control is disabled with a hint (the page already does exactly that for
  "Workspace ID" — `disabled` with *"cannot be changed"*), or the value is actually saved.
- **Actual:** editable, accepted, silently discarded, success toast.
- **Evidence:** `testing/evidence/PHASE-06/workspace-settings.txt` (§2 shows the 422) plus the
  mapper and component source
- **Status:** **FIXED in F28** (2026-08-06, D12.5). The locale Select is disabled with an honest hint — nothing in the client reads a locale, so a working control would store a value with no consumer.
- **Notes:** Checked before filing that the mapper omission does **not** break the Save button — the
  full client payload (name + all mapped settings, unchanged) returns **200**. The page saves fine;
  only this one field is a no-op.

---

### ISS-029 · [P6] MEDIUM · Four workspace settings are configurable but read by nothing — including business hours, which SLA deadlines ignore

- **Severity:** MEDIUM
- **Type:** GAP
- **Phase:** P6
- **Area:** `workspaces.working_days`, `business_hours_start`, `business_hours_end`,
  `fiscal_year_start_month` · `server/src/services/TaskWriteService.ts:55-75` (`computeSlaDueAt`)

Every one of these is stored, validated carefully, and exposed as an editable control in
`/settings/workspace`. A grep across `server/src` (excluding the workspace module's own schema,
validator, serializer, repo, service and controller — i.e. looking only for real *consumers*) finds:

| setting | server consumers | client consumers |
|---|---|---|
| `week_starts_on` | none | **`CalendarMonthGrid.tsx`, `CalendarView.tsx`, `date-utils.ts`** — genuinely used |
| `working_days` | **none** | settings form only |
| `business_hours_start` / `_end` | **none** | settings form only |
| `fiscal_year_start_month` | **none** | settings form only |
| `default_locale` | seed scripts only | settings form only (see ISS-028) |

**The sharpest consequence is SLA.** `computeSlaDueAt` is pure wall-clock arithmetic:

```js
if (t === "bug") switch (severity) {
    case "S0": return new Date(now.getTime() + 2 * HOUR_MS);
    case "S1": return new Date(now.getTime() + 24 * HOUR_MS);
    case "S2": return new Date(now.getTime() + 7 * DAY_MS);
}
if (t === "complaint") return new Date(now.getTime() + 24 * HOUR_MS);
```

BeautyBooth's workspace is configured `working_days = sun,mon,tue,wed,thu` and
`business_hours 09:00–18:00`. An **S0 bug filed at 17:30 on Thursday** gets a deadline of
**19:30 Thursday** — after hours, on the last working day before the weekend. The team is measured
against a deadline nobody was at work for. A complaint filed Thursday afternoon is due Friday
afternoon, during the weekend.

- **Expected:** either SLA/due-date maths respects `working_days` + `business_hours`, or the
  settings are not offered.
- **Actual:** carefully validated (`workspace.invalid_business_hours` fires correctly on
  start ≥ end, and even on a one-sided update that would break the invariant — verified) and then
  never consulted.
- **Evidence:** `testing/evidence/PHASE-06/workspace-settings.txt` (§6) plus the consumer grep
- **Status:** **FIXED in F28** (2026-08-06, D12.2). `working_days` + `business_hours` now drive SLA deadlines (the business clock, `utils/dhakaTime.ts`); `fiscal_year_start_month` DROPPED end-to-end (`upgrades/012`).
- **Notes:** Same family as ISS-010/ISS-011/M1 — a control the UI presents as meaningful that the
  server does not read. Interacts with **ISS-001**: SLA deadlines are already stored 6 hours off, so
  the two would need fixing together.

---

### ISS-030 · [P7] MEDIUM · A member can change their own login email to any address, with no verification and no notification

- **Severity:** MEDIUM
- **Type:** SECURITY
- **Phase:** P7 — Users & members
- **Area:** `PATCH /users/:id` — `email` is a writable profile field
  (`server/src/validators/users.ts:210`) · `users` table has no verification column
- **Account:** `arif@beautybooth.com.bd` (plain member), acting on themselves

**What is correctly guarded**

| attempt | result |
|---|---|
| change to another user's email | 409 `user.email_already_exists` |
| change to the owner's email | 409 `user.email_already_exists` |
| malformed address | 422 `validation.failed` |

**What is not**

```
PATCH /users/<self> {"email":"attacker@evil.com"}   -> 200, written
```

The `users` table columns are
`id, workspace_id, first_name, last_name, email, password_hash, role, avatar_url, status,
timezone, last_login_at, created_at, updated_at` — there is **no `email_verified` and no
`pending_email`**. The new address becomes the login identity immediately, with no confirmation to
either the old or the new mailbox.

**Why it matters beyond "users can edit their profile"**

1. The change is **silent** — the original owner of the account is never told.
2. It **frees the old corporate address**. A later invite to `arif@beautybooth.com.bd` then creates a
   *brand-new, different account* at that address. This is not hypothetical: it happened by accident
   during this phase, and the two records had to be untangled by hand.
3. Combined with forgot-password it is a **persistence primitive** — brief access to a signed-in
   session (a shared machine, an unlocked laptop: ordinary in a 100-person office) is enough to move
   the account to an attacker-controlled mailbox and keep it after any password reset.

- **Expected:** an email change is confirmed via the new address (and ideally notified to the old
  one) before it becomes the login identity — or it is admin-only.
- **Evidence:** `testing/evidence/PHASE-07/email-change-and-sorting.txt`
- **Status:** **FIXED in F12** (2026-08-05). Changing a login email is now **admin-only**:
  a non-admin gets `403 user.email_change_forbidden` and the row is untouched. This issue's own
  Expected line offers two acceptable outcomes — verify the new address, or make it admin-only —
  and admin-only is what ships: no schema column, no mail round-trip, and these are corporate
  addresses created by invite, so self-service email change was never a needed capability.
  A same-value echo is still allowed, so an ordinary profile PATCH that includes the current
  address does not start failing; the rest of the profile stays self-editable.
  **Verified:** `fixing/evidence/F12/f12-probe.txt` — the repro returns 403 and the address does
  not change; an admin can still change it; the echo still passes. Two new permanent specs in
  `tests/users/update.test.ts`. The pre-existing test that asserted the VULNERABLE behaviour
  (a member lowercasing their own changed email) was rewritten to go through an admin.
- **Notes:** All other self-escalation attempts through this endpoint are correctly refused —
  `role`, `status`, `id` and `password` all return 422, and `user.forbidden_edit` (403) blocks
  editing anyone else. Email is the one field that slips through.

---

### ISS-031 · [P7] LOW · A bogus IANA timezone is rejected on the workspace but accepted on a user profile

- **Severity:** LOW
- **Type:** BUG (inconsistent validation)
- **Phase:** P7
- **Area:** `server/src/validators/users.ts:225` (`timezone`) vs
  `server/src/validators/workspace.ts` (`timezone`)

```
PATCH /workspace     {"timezone":"Not/AZone"}  -> 422 validation.failed     (P6)
PATCH /users/<self>  {"timezone":"Not/AZone"}  -> 200, written              (P7)
```

The workspace validator checks the value against the IANA zone list; the user validator only checks
it is a string.

- **Impact:** a user profile can hold a timezone that no date library can resolve. `users.timezone`
  is surfaced in `GET /users` and `GET /auth/me`, so any client that does
  `Intl.DateTimeFormat(undefined, {timeZone: user.timezone})` will throw a `RangeError` on that
  user's row.
- **Evidence:** `testing/evidence/PHASE-07/users-and-members.txt` (§3)
- **Status:** **FIXED in F12** (2026-08-05). `validators/users.ts` now applies the SAME
  `isIanaTimezone` check `PATCH /workspace` has always had — imported and shared, not copied,
  since a second copy is how the two drifted apart. `Not/AZone` is 422 on both surfaces now.
  **Verified:** `fixing/evidence/F12/f12-probe.txt`. Note: the pre-existing test
  *"accepts a timezone at exactly the 64-char boundary"* asserted this very bug (the column is
  VARCHAR(64), so length was the only rule). The IANA rule is strictly narrower — the longest real
  zone is ~32 chars — so **the 64-char boundary is unreachable BY DESIGN**; the spec was replaced
  with "a 64-char non-zone is refused" plus "a long real zone is accepted".

---

### ISS-032 · [P8] MEDIUM · `POST /spaces` silently discards an invalid `head_user_id` that `PATCH` correctly rejects

- **Severity:** MEDIUM
- **Type:** BUG (silent data loss + inconsistent validation)
- **Phase:** P8 — Spaces
- **Area:** `server/src/validators/spaces.ts` — `createSpaceValidator` does not validate
  `head_user_id`; `updateSpaceValidator` / `SpacesService` do

The two paths disagree about the same field:

```
POST  /spaces {name:"…", head_user_id:"u-nope"}   -> 201   DB head_user_id = NULL  (dropped)
PATCH /spaces/:id {head_user_id:"u-nope"}         -> 422 space.head_invalid
```

`PATCH` validates it thoroughly and correctly — an unknown id, a **guest**, and an **invited
(not-yet-active)** user are all refused with `space.head_invalid`, and `null` clears it. `POST`
performs none of those checks and simply drops whatever it cannot use.

- **Expected:** create and update apply the same rule.
- **Actual:** an admin creating "Accounts" and naming a head in the same request gets **201 Created**
  and a space with **no head** — no error, no warning. The dept-review and weekly-report flows for
  that space are then silently inert until someone notices and sets the head again.
- **Evidence:** `testing/evidence/PHASE-08/spaces.txt` (§1, §6) ·
  `delete-guards-and-archive.txt` (§C)
- **Status:** **FIXED in F18** (2026-08-06). One rule, both paths, at every layer: the
  update validator's `head_user_id` shape rule added to `createSpaceValidator`; the service's
  three checks (exists-in-workspace / active / not-guest -> 422 `space.head_invalid`) extracted to
  a shared `assertValidHead` used by create AND update so they cannot drift again; the value
  carried controller -> service -> repo and WRITTEN; and create now requires the same
  `space.head_assign` permission PATCH acquired in F7 (without it, create was a bypass around that
  gate). Explicit null still creates headless.
  **Verified:** unknown head 422 (was 201+NULL), guest head 422, valid head WRITTEN to the row (was
  silently dropped), null 201. `fixing/evidence/F18/f18-probe.txt`.
- **Notes:** Same shape as ISS-028 (a value accepted by the UI/API and quietly thrown away) and
  ISS-019 (headship lost silently). Headship is turning out to be the least-guarded field in the
  system.

---

### ISS-033 · [P8] LOW · Two spaces can carry the same name — on create and on rename

- **Severity:** LOW
- **Type:** UX
- **Phase:** P8
- **Area:** `POST /spaces` and `PATCH /spaces/:id` — no uniqueness check on `name`

```
POST  /spaces {name:"Marketing"}          -> 201   (a real "Marketing" already exists)
PATCH /spaces/:id {name:"Marketing"}      -> 200
```

The workspace then holds two spaces called **Marketing** — one with 3 lists and a head, one empty —
and the sidebar space tree renders them identically. This happened for real during the phase and had
to be untangled by matching on `created_at` and list count.

- **Impact:** in a sidebar that is the primary navigation for the whole app, two identical entries
  with no distinguishing mark is a genuine trap. Picking the wrong one puts work in an orphan space.
- **Evidence:** `testing/evidence/PHASE-08/spaces.txt` (§1, §3) ·
  `delete-guards-and-archive.txt` (§A)
- **Status:** **FIXED in F27** (2026-08-06). `UNIQUE (workspace_id, name)` on
  `spaces` — the same `utf8mb4_unicode_ci` unique-index pattern the three catalog resources
  always used, so it is case-insensitive and race-free — mapped to `409 space.duplicate`.
  **D11: enforced on CREATE and RENAME**, which is what this issue's own two-line repro asks for.
  Archived rows are included deliberately: a restore must not be able to recreate the duplicate.
  **Schema (X4):** `upgrades/010_name_uniqueness.sql` + schema.sql + Drizzle.
  **Verified:** `fixing/evidence/F27/f27-probe.txt` — create 409, case-insensitive 409, rename
  409, and a non-colliding rename still 200.
- **Notes:** Third instance of the same defect class — **ISS-027** (two roles may share a name) and,
  to be confirmed in P11, tags and task types. Worth one decision covering all named resources.

---

### ISS-034 · [P8] LOW · An archived space can still be renamed and re-assigned a head

- **Severity:** LOW
- **Type:** BUG (inconsistent state machine)
- **Phase:** P8
- **Area:** `PATCH /spaces/:id` has no archived check; `POST /lists` has one

```
POST  /spaces/:id/archive                          -> 204
PATCH /spaces/:id {name:"renamed-while-archived"}  -> 200   name changed, still archived
PATCH /spaces/:id {head_user_id:<member>}          -> 200
POST  /lists {space_id:<archived space>}           -> 409 space.archived
```

So "archived" blocks creating children but not mutating the space itself.

- **Expected:** one rule — either an archived space is frozen (409 `space.archived` on PATCH too), or
  it stays editable and list creation is allowed as well.
- **Evidence:** `testing/evidence/PHASE-08/delete-guards-and-archive.txt` (§D)
- **Status:** **FIXED in F22** (2026-08-06). `PATCH /spaces/:id` on an archived space →
  `409 space.archived` (lists were the model — always frozen). Unarchive first and the edit
  works. **Verified:** `fixing/evidence/F22/f22-probe.txt`.
- **Notes:** The task-level equivalent is stricter — editing an archived *task* returns
  `task.archived` (per the API design). Spaces are the odd one out. Re-check the same question for
  lists in **P9**.

---

### ISS-035 · [P9] LOW · Duplicate list names are accepted inside the same space — the fourth resource with this gap

- **Severity:** LOW
- **Type:** UX
- **Phase:** P9 — Lists
- **Area:** `POST /lists` — no uniqueness check on `(space_id, name)`

```
POST /lists {space_id:<Politics>, name:"TEST-p9-dupe"}  -> 201
POST /lists {space_id:<Politics>, name:"TEST-p9-dupe"}  -> 201   same space, same name
```

- **Impact:** the sidebar renders a space's lists by name, so two identical children appear under one
  space with nothing to tell them apart. Same trap as ISS-033, one level deeper in the tree.
- **Evidence:** `testing/evidence/PHASE-09/lists.txt` (§1)
- **Status:** **FIXED in F27** (2026-08-06). `UNIQUE (space_id, name)` on `lists` →
  `409 list.duplicate`, on create AND rename (D11). Scope is the SPACE: the same list name in a
  DIFFERENT space is still legal (verified explicitly — that is the correct boundary, not an
  oversight). **Schema (X4):** `upgrades/010` + schema.sql + Drizzle.
  **Verified:** `fixing/evidence/F27/f27-probe.txt`.
- **Notes:** **This is now a system-wide pattern, not a per-resource bug** — roles (ISS-027), spaces
  (ISS-033) and lists all accept duplicate display names. Tags and task types are checked in P11.
  Worth one decision covering every named resource rather than four separate fixes.

---

### ISS-036 · [P9] LOW · A list can never be moved to another space, and `is_private` is frozen after creation

- **Severity:** LOW
- **Type:** GAP
- **Phase:** P9
- **Area:** `server/src/validators/lists.ts` `updateListValidator` — accepts only
  `name`, `description`, `icon`, `color`, `default_task_type_id`

```
PATCH /lists/:id {space_id:<another space>}  -> 422 validation.failed
PATCH /lists/:id {is_private:true}           -> 422 validation.failed
```

Both fields are settable at **create** time (`is_private` is accepted by `POST /lists`), so the
system can express these states — it just cannot change them afterwards.

- **Impact:** a list created in the wrong department is stuck there. The only route is to create a
  replacement in the right space and move every task by hand — and there is no bulk move. For an
  8-department workspace where "Complaint" work could plausibly start in Customer Service and belong
  in Complain Department, this will come up.
- **Evidence:** `testing/evidence/PHASE-09/lists-corrected.txt` (§3b)
- **Status:** **FIXED in F28** (2026-08-06, D12.7). `PATCH /lists/:id {space_id}` moves a list (404 / 409-archived / 409-duplicate guards); `is_private` stays frozen BY DESIGN (enforced nowhere) and is spec-pinned.
- **Notes:** Not a validation bug — the PATCH surface is deliberately narrow and otherwise strict
  (an empty body and an unknown-only body both 422, which is *better* than `PATCH /workspace`).
  This is a missing capability, recorded so the fixing phase can decide whether it is wanted.

---

### ISS-037 · [P10] LOW · The status reorder endpoint accepts payloads that are not a valid permutation

- **Severity:** LOW (not reachable from the UI today — see ISS-038)
- **Type:** BUG
- **Phase:** P10 — Statuses
- **Area:** `PATCH /lists/:listId/statuses/reorder` ·
  `server/src/controllers/StatusesController.ts:218` (`parseReorderItems`)

The body is a bare array of `{id, position}`. Validation is otherwise **good** — duplicate *ids*,
unknown ids, ids belonging to another list, an empty array, a non-array body, negative positions and
a missing `position` are all rejected precisely, with per-item detail like
`{"field":"[1].id","issue":"Duplicate id \"st-…\" in reorder"}`.

What it does **not** check is that the resulting `position` set is a valid permutation:

**Every status at position 0 → 200**
```
PATCH …/reorder  [{id:A,position:0},{id:B,position:0},{id:C,position:0},{id:D,position:0},{id:E,position:0}]
-> 200
DB: In Review=0, Done=0, In Progress=0, Closed=0, To Do=0
```
Three consecutive GETs return the same order, so there *is* a stable tiebreak — but it is not the
order anyone asked for, and no further reorder can express intent while every position is equal.

**A partial payload leaves collisions → 200**
```
normalised:  To Do@0 > In Progress@1 > In Review@2 > Done@3 > Closed@4
PATCH …/reorder  [{id:Closed, position:0}]        -> 200
DB: Closed=0, To Do=0, In Progress=1, In Review=2, Done=3
colliding: Closed@0, To Do@0
```

- **Expected:** either require the full set and reject duplicate positions, or renumber the
  remaining items so positions stay contiguous and unique.
- **Actual:** the board's column order silently stops matching what was requested, and repeated
  partial moves degrade it further.
- **Evidence:** `testing/evidence/PHASE-10/reorder.txt` · `reorder-collisions.txt`
- **Status:** **FIXED in F18** (2026-08-06). The reorder must now be a valid PERMUTATION —
  the issue's own Expected line: every status of the list exactly once (dupe ids were already
  refused, so equal count ⇒ complete) and distinct positions. Violations are 422 with messages that
  name the rule ("got 1 of 5"). **Verified:** all-at-position-0 -> 422 (was 200, order destroyed);
  a partial payload -> 422; a full reversed permutation -> 200 and the order actually flips.
  `fixing/evidence/F18/f18-probe.txt`. (ISS-038's note stands: nothing in the client calls this
  endpoint yet — the first drag-to-reorder implementation would have hit this immediately.)
- **Notes:** LOW only because nothing in the client calls this endpoint (ISS-038). If drag-to-reorder
  is ever wired up — the obvious implementation sends only the moved item — this becomes the first
  bug it hits.

---

### ISS-038 · [P10] LOW · Board column order cannot be changed — the reorder endpoint has no UI caller

- **Severity:** LOW
- **Type:** GAP (built but no UI)
- **Phase:** P10
- **Area:** `PATCH /lists/:listId/statuses/reorder` (server) ·
  `client/src/http/api.ts:385` `statusesApi.reorder` (wrapper) · **no call site**

The server endpoint works, and the client even has a typed wrapper for it —
*"Bulk-reposition a list's statuses; body is a bare `{id,position}[]`"* — but a search across the
whole client finds **no caller**. `/settings/statuses` only *reads* `position` to sort the display
(`StatusesSettings.tsx:52`); there is no drag handle, no move-up/down control, and no `DndContext`.

- **Impact:** the order of columns on the Board view is fixed at whatever the list defaults created
  (`To Do > In Progress > In Review > Done > Closed`). An admin who adds a status gets it appended at
  the end and can never move it. For a team that adds e.g. "Waiting on supplier" between
  *In Progress* and *In Review*, that column will always sit last.
- **Evidence:** `testing/evidence/PHASE-10/statuses.txt` (§2 — a new status lands at position 5, the
  end) plus the client search
- **Status:** **FIXED in F26** (2026-08-06). `/settings/statuses` has move-earlier /
  move-later arrows per status — the first caller `statusesApi.reorder` has ever had, so board
  column order is changeable at last (it was frozen at whatever the list defaults created, with any
  new status appended forever). **Arrows rather than drag-and-drop on purpose:** the page is a
  read-only summary today, it needs no new dependency, and F18 made the endpoint require a COMPLETE
  permutation with distinct positions — which a swap satisfies by construction while a drag
  library's incremental payloads would not. Gated on `status.manage`.
  **Verified:** `fixing/evidence/F26/f26-probe.txt` builds the exact payload the arrows build,
  proves the server accepts it and the order flips, then restores the original order.
- **Notes:** Same family as the other built-but-no-UI items (`SCAN-L4`, ISS-024's `report.view`).
  Recorded here so the fixing phase can decide whether to wire the UI or drop the endpoint — and if
  it wires it, ISS-037 must be fixed first.

---

### ISS-039 · [P11] MEDIUM · `is_dev_type` does not gate the engineering fields — any task can carry branch, PR and bug severity

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P11 — Task types & tags
- **Area:** `server/src/services/TaskWriteService.ts` (create/update) · the schema comment in
  `server/src/db/schema/tasks.ts` promises the gate

`tasks.ts` documents the intent plainly: the engineering columns *"are NULL for non-dev task types
and gated by `task_types.is_dev_type` in the application layer."* They are not.

**Repro** — the same engineering payload, two task types:

```
POST /tasks {task_type_id:<Bug   is_dev_type=true >, story_points:5, branch_name:"feat/x",
                                  pr_url:"https://github.com/x/y/pull/1", bug_severity:"S1"}
-> 201  stored: story_points 5, branch_name feat/x, pr_url …, bug_severity S1, sla_due_at set

POST /tasks {task_type_id:<Order is_dev_type=false>, …identical payload…}
-> 201  stored: story_points 5, branch_name feat/x, pr_url …, bug_severity S1, sla_due_at NULL
```

The **only** difference is `sla_due_at`, and that is decided by `computeSlaDueAt`, which switches on
the type **name** (`"bug"` / `"complaint"`), not on `is_dev_type`.

- **Expected:** a non-dev task type either rejects the engineering fields (422) or stores them as
  NULL.
- **Actual:** a Marketing "Campaign" or a "Order" task can hold `branch_name`,
  `pr_url` and `bug_severity: S1`. The task drawer's Git panel and bug-severity badge key off those
  fields, so they will render on non-engineering work.
- **Extra wrinkle:** such a task carries `bug_severity` but gets **no SLA**, because the SLA switch
  keys off the type name. So the record looks like an S1 bug and is invisible to every SLA view — a
  state the data model was supposed to make impossible.
- **Evidence:** `testing/evidence/PHASE-11/task-types-and-tags.txt` (§3)
- **Status:** **FIXED in F29** (2026-08-06). Caller-supplied git/planning fields now 422 `task.not_dev_type` on a non-dev type; `bug_severity` 422 `task.severity_requires_bug_type` off a bug-NAMED type (severity and its SLA travel together); re-typing to non-dev CLEARS stored git fields + severity + SLA.
- **Notes:** `is_dev_type` is otherwise real — it is settable on create, flippable on update, and is
  used by the `/sla/breached?team=engineering` alias. It just does not gate writes.

---

### ISS-040 · [P11] LOW · `POST` silently drops protected fields that `PATCH` rejects — now confirmed on three resources

- **Severity:** LOW
- **Type:** BUG (inconsistent validation)
- **Phase:** P11 (pattern spans P8–P11)

The same asymmetry appears on every resource tested so far: **create ignores what update refuses.**

| resource | field | `POST` | `PATCH` |
|---|---|---|---|
| task types | `is_system` | **201**, stored `is_system=0` (dropped) | **422** `validation.failed` |
| spaces | `head_user_id` (invalid) | **201**, stored NULL (dropped) — ISS-032 | **422** `space.head_invalid` |
| lists | unknown keys (e.g. `task_type_id`) | **201**, dropped | **422** (unknown-only body) |

Good news first: **no privilege escalation** — the flag is genuinely discarded, so nobody can
self-promote a task type to `is_system` or make themselves a space head.

The problem is silence. A caller who sends the wrong field name, or a protected one, gets **201
Created** and a resource that does not match what they asked for. That is exactly how P9 lost a
list's task type and how P8's head assignment vanished — both were mistaken for API bugs until the
stored row was inspected.

- **Expected:** one rule per resource. If `PATCH` refuses a field, `POST` should refuse it too.
- **Evidence:** `testing/evidence/PHASE-11/task-types-and-tags.txt` (§1) ·
  `PHASE-08/delete-guards-and-archive.txt` (§C) · `PHASE-09/lists.txt` (§1)
- **Status:** **FIXED in F23** (2026-08-06) for the remaining half: `POST /task-types`
  now refuses the server-owned `is_system`/`position` with a 422 (was: 201 with the flag
  silently dropped to 0) — one rule per resource, matching PATCH. The spaces half (head_user_id)
  was closed in F18; the lists row in this issue's table is the empty-patch guard, not a
  create-side drop. **Verified:** `fixing/evidence/F23/f23-probe.txt`.
- **Notes:** Consolidates ISS-032's mechanism into a cross-resource statement. Related to ISS-014
  (unknown query params silently ignored) — the same "accept and discard" philosophy on the read side.

---

### ISS-041 · [P12] MEDIUM · Un-archiving a space does not restore the lists that archiving it archived

- **Severity:** MEDIUM
- **Type:** BUG (silent data disappearance)
- **Phase:** P12 (discovered here; caused during P8)
- **Area:** `POST /spaces/:id/archive` cascades to `lists`; `POST /spaces/:id/unarchive` does not

**Controlled repro** — a fresh space with two lists and one task:

```
initial               space=active    lists=[l1:act,  l2:act ]  tasks=[act]
POST /spaces/:id/archive    -> 204
                      space=ARCHIVED  lists=[l1:ARCH, l2:ARCH]  tasks=[act]
POST /spaces/:id/unarchive  -> 204
                      space=active    lists=[l1:ARCH, l2:ARCH]  tasks=[act]
```

Archive cascades **one level** (lists, but not tasks). Unarchive cascades **not at all**.

- **Expected:** unarchive restores whatever archive took down, or archive does not cascade.
- **Actual:** the space comes back empty. Every list it owned stays hidden, and nothing tells the
  admin.
- **This is not hypothetical.** P8 archived the **Marketing** space for two seconds to test a delete
  guard, then un-archived it. All three Marketing lists — *Eid Campaign 2026*, *Influencer Outreach*,
  *Email & SMS* — stayed archived and were invisible in the app for roughly ninety minutes, until
  P12 noticed and restored them. An admin doing the same thing in production would lose a whole
  department's boards with no error and no audit entry.
- **Evidence:** `testing/evidence/PHASE-12/archive-cascade-and-rbac.txt` (§A)
- **Status:** **FIXED in F16** (2026-08-06). Unarchive now restores EXACTLY the lists the
  matching archive took down. The discriminator already existed: the archive cascade stamps every
  list with the SAME instant the space gets, and skips already-archived lists (they keep their
  earlier timestamp) — so restoring `archived_at = <the space's archivedAt>`
  (`ListsRepo.unarchiveBySpaceArchivedAt`, inside the unarchive transaction, before the space's
  stamp is cleared) is the exact inverse and can never resurrect an independently-archived list.
  That was the stated reason the old code refused to cascade at all; the code comment arguing it has
  been replaced. The audit row now carries `lists_restored`.
  **Verified with the discriminating case:** `fixing/evidence/F16/f16-probe.txt` — archive L1
  individually, then archive the space (takes L2), unarchive the space -> **L2 back, L1 STAYS
  archived**, audit says lists_restored: 1.
  *Recorded edge:* `archived_at` is second-precision, so a list archived independently in the SAME
  second as the space-archive would be restored with it — sub-second, harmless, and fixing it would
  need a schema column.
- **Notes:** Related to ISS-034 (an archived space stays editable) — the space archive state machine
  is the weakest of the three. Lists get theirs right (P9 §4).

---

### ISS-042 · [P12] MEDIUM · `hidden_from_guests` is absent from the entire API — the one guest-redaction control cannot be switched on

- **Severity:** MEDIUM
- **Type:** GAP
- **Phase:** P12 (resolves the item deferred from P4)
- **Area:** `custom_fields.hidden_from_guests` exists in the schema and drives
  `TasksRepo.customFieldValuesByTask(ids, redactGuest)`; it appears in **no** validator and **no**
  serializer

**The redaction logic itself is correct.** With the flag forced on directly in the database:

```
owner sees SECRET-VALUE: true   VISIBLE-VALUE: true
guest sees SECRET-VALUE: false  VISIBLE-VALUE: true      -> redaction works
```

But the flag cannot be set through the API:

```
POST  /custom-fields {..., hidden_from_guests:true}   -> 201, stored 0
PATCH /custom-fields/:id {hidden_from_guests:true}    -> 200, stored 0
GET   /custom-fields                                  -> the field is not in the response at all
```

The serialised shape is `{id, scope_type, scope_id, name, type, config, is_required,
default_value, position}` — `hidden_from_guests` is simply not part of the contract.

- **Impact:** P4 established that guest redaction in this system means exactly one thing — hiding
  flagged custom-field values. That mechanism works, and **no administrator can ever turn it on.**
  Every custom-field value is visible to every guest. For a workspace that would plausibly store a
  customer phone number or an order value in a custom field, that is the whole point of the feature.
- **Evidence:** `testing/evidence/PHASE-12/custom-fields-corrected.txt` (§2b, §5b) ·
  `get-custom-fields-envelope.txt`
- **Status:** **FIXED in F26** (2026-08-06). `hidden_from_guests` reaches the API:
  create accepts it, PATCH toggles it, a non-boolean is a clean 422, and every wire custom field
  carries it (validator + serializer + repo projection + service input, none of which mentioned the
  column before — which is why the one guest-redaction control the product implements could only be
  switched on by editing the database by hand). **Verified:**
  `fixing/evidence/F26/f26-probe.txt` — set on create, STORED (not silently dropped), toggled off
  by PATCH.
  Fixed together with ISS-023 deliberately: connecting this control while one of its eleven call
  sites still hardcoded `false` would have shipped a feature with a hole in it.
- **Notes:** Same family as ISS-040 (POST silently drops protected fields) but more serious, because
  here **no** path can set it — not create, not update, not even a read-back to notice it is off.
  ISS-023's redaction bypass in `ReviewsService` is moot while this is unfixed.

---

### ISS-043 · [P12] LOW · The `phone` and `money` field types validate less than their names promise

- **Severity:** LOW
- **Type:** BUG
- **Phase:** P12
- **Area:** `server/src/services/CustomFieldsService.ts:537-561`

**`phone`** — the BD-format check is written but only runs when `config.default_country === "BD"`,
and nothing sets that by default:

```
{text:"01712345678"}    valid BD mobile      -> 200
{text:"01234567890"}    invalid prefix (012) -> 200   accepted
{text:"+8801712345678"} with country code    -> 200   accepted
```
So a `phone` field is free text. The regex `^01[3-9][0-9]{8}$` exists and never fires.

**`money`** — integer and non-empty currency are enforced, the rest is not:

```
{amount:1500,   currency:"BDT"}          -> 200
{amount:1500.5, currency:"BDT"}          -> 422   integer enforced
{amount:1500}                            -> 422   currency required
{amount:1500,   currency:""}             -> 422   non-empty enforced
{amount:-500,   currency:"BDT"}          -> 200   negative accepted
{amount:1500,   currency:"NOTACURRENCY"} -> 200   any string accepted
```

- **Impact:** a "Order value" money field can hold −500 NOTACURRENCY; a "Customer phone" field can
  hold anything. Both feed reports and the customer-facing form intake.
- **Evidence:** `testing/evidence/PHASE-12/custom-fields-corrected.txt` (§4b)
- **Status:** **FIXED in F29** (2026-08-06). phone: `default_country` defaults to BD so the regex finally fires (local + +880/880 spellings; other countries opt out); money: negative refused, currency must be a real ISO-4217 code (ICU list — BDT/USD in, NOTACURRENCY/XYZ/bdt out).
- **Notes:** Cross-type envelopes are correctly refused (a `{text}` payload on a money field → 422),
  and `dropdown` rejects an unknown `option_id` — so the per-type dispatch is sound. This is about
  the depth of the checks inside two of the six types.

---

### ISS-044 · [P13] MEDIUM · `POST /tasks` with an unknown `reviewer_id` returns 500 — the only unvalidated reference on the create path

- **Severity:** MEDIUM
- **Type:** BUG
- **Phase:** P13 — Task creation
- **Area:** `server/src/services/TaskWriteService.ts` — the reviewer check lives at line 678-690,
  **inside `update()`** (which begins at line 615). `create()` has no equivalent.

Every other reference on create is validated and returns a clean domain error:

| field | unknown value |
|---|---|
| `status_id` | 422 `task.invalid_status` |
| `task_type_id` | 422 `task.invalid_task_type` |
| `assignees` | 422 `task.invalid_assignee` |
| `tags` | 422 `task.invalid_tag` |
| `primary_list_id` | 404 `list.not_found` |
| **`reviewer_id`** | **500 `internal`** |

Server log:
```
Unhandled error  Cannot add or update a child row: a foreign key constraint fails
(`taskmanagement`.`tasks`, CONSTRAINT `fk_tasks_reviewer` FOREIGN KEY (`reviewer_id`)
 REFERENCES `users` (`id`) ...)
```

The raw MySQL FK violation escapes as an unhandled error. `task.invalid_reviewer` — which is in the
error catalog and *is* implemented — only ever fires on `PATCH`.

- **Expected:** 422 `task.invalid_reviewer`, matching the update path and the other four references.
- **Actual:** 500, an `error`-level log line, and no usable message for the client.
- **Evidence:** `testing/evidence/PHASE-13/task-creation.txt` (§2)
- **Status:** **FIXED in F18** (2026-08-06). `create()` now runs the SAME reviewer check
  `update()` has always had — 422 `task.invalid_reviewer`, active-member rule — closing the one
  unvalidated reference on the create path. **Verified:** `fixing/evidence/F18/f18-probe.txt` —
  unknown reviewer 422 (was 500); a valid reviewer still creates 201 with the reviewer set.
- **Notes:**
  - Same create-vs-update asymmetry as ISS-040, but this one surfaces as a server fault rather than
    a silent drop.
  - **A guest can be set as reviewer** — `reviewer_id: <guest>` returns 201 on create. Guests cannot
    hold `review.perform`, so the task carries a reviewer who can never review it. Worth fixing in
    the same pass, since both are the reviewer field's validation.

---

### ISS-045 · [P13] LOW · `pr_url` accepts `javascript:` while every other URL field rejects it

- **Severity:** LOW
- **Type:** SECURITY (stored; exploitability depends on rendering — P38)
- **Phase:** P13
- **Area:** `server/src/validators/tasks.ts` — `pr_url` is checked as a string, not as a URL

```
POST /tasks {..., pr_url:"javascript:alert(1)"}   -> 201, stored verbatim
```

Compare, from earlier phases:
```
PATCH /workspace  {logo_url:"javascript:alert(1)"}   -> 422   (P6)
PATCH /users/:id  {avatar_url:"javascript:alert(1)"} -> 422   (P7)
```

- **Impact:** the task drawer's Git panel renders `pr_url` as a link. A `javascript:` href there is a
  stored self-XSS at minimum, and a trap for any colleague who clicks "open PR".
- **Evidence:** `testing/evidence/PHASE-13/task-creation.txt` (§7)
- **Status:** **FIXED in F29** (2026-08-06). `pr_url` is checked as an http(s) URL on create AND update, the same rule `logo_url`/`avatar_url` have had since P6/P7; `javascript:` is a 422; null still clears.
- **Notes:** Whether it actually executes is P38's question; the storage-layer inconsistency is the
  finding here. Note also that `pr_url` is settable on **any** task type, not just dev types
  (ISS-039), so this reaches non-engineering work too.

---

### ISS-046 · [P14] MEDIUM · `subtasks_count` / `subtasks_completed` are never maintained — every task reports 0/0 in production

- **Severity:** MEDIUM
- **Type:** DATA
- **Phase:** P14 — Task reading
- **Area:** `tasks.subtasks_count`, `tasks.subtasks_completed` · `database/schema.sql:1482-1488` ·
  no writer anywhere in `server/src`

**Repro**
```
create parent                       counters {sc:0, sd:0}
create child 1 (parent_task_id=P)   counters {sc:0, sd:0}
create child 2 (parent_task_id=P)   counters {sc:0, sd:0}
SELECT COUNT(*) FROM tasks WHERE parent_task_id=P  ->  2
GET /tasks/P/subtasks               ->  200, returns both children
```

The subtasks themselves are perfectly readable; only the counters are wrong.

**Why this is production-affecting, not a dev-database artefact.** `schema.sql:1482-1488` records the
decision in full:

> *"Subtask counters: NO triggers. MySQL forbids a trigger on `tasks` from modifying `tasks` … the
> former `trg_subtasks_after_{insert,update,delete}` triggers could not maintain these counters AND
> actively crashed every subtask status change with a raw 500. Removed 2026-07-14. The counters keep
> their 0 default; **accurate maintenance must be done app-side (recompute on subtask create /
> status-change / delete) — tracked as a gate follow-up.**"*

That follow-up was never implemented. A grep for `subtasksCount` / `subtasks_count` across
`server/src` finds only the serializer reading them, `TemplateApplyService:298` writing a literal
`0`, and two comments confirming they *"keep their 0 default"*. **No code ever increments them.**

Production was provisioned from `schema.sql`, so it has no triggers and no app-side maintenance —
the counters are permanently `0/0` there.

- **Expected:** a parent with 2 subtasks, 1 done, reports `subtasks_count: 2, subtasks_completed: 1`.
- **Actual:** `0 / 0` for every task, forever.
- **Impact:** these two fields are on the wire in every task payload (`taskSerializer.ts:125-126`),
  so any "3/5 subtasks" progress indicator on a card or in the drawer reads 0/0.
- **Evidence:** `testing/evidence/PHASE-14/subtask-counters.txt` ·
  `testing/evidence/PHASE-18/subtasks-deps-part2.txt` (§5)

**UPDATE (P18) — measured with the stale dev triggers removed, and the client consequence pinned
down.** A parent with **3 subtasks, 1 of them moved to Done** still reports `subtasks_count: 0,
subtasks_completed: 0` on the wire. Two client call sites read these fields, and they behave
differently:

| call site | effect |
|---|---|
| `SubtasksSection.tsx` (task drawer) | **unaffected** — it fetches `GET /tasks/:id/subtasks` and computes `done/total` itself, so the drawer shows the right numbers |
| `BoardCard.tsx:198,208,217` | **broken** — the badge is rendered only `if (task.subtasksCount > 0)`, which is never true, so **the subtask indicator never appears on any board card**, for any task, ever |

So the visible symptom is not "0/0 is displayed" — it is that the board silently has no subtask
signal at all. Worth knowing when the fix lands: the badge will appear on cards for the first time.
- **Status:** **FIXED in F15** (2026-08-05), APP-SIDE as `schema.sql:1482-1488`
  requires. New `TasksRepo.recomputeSubtaskCounters(parentId)` — a RECOMPUTE, not an increment,
  because the other two counter bugs in this phase were both increment rules that drifted the
  moment a write took a path their author had not pictured; an absolute recompute repairs whatever
  a caller misses. Called from six sites: create-with-parent, status change, archive, unarchive,
  hard delete, and bulk (one recompute per DISTINCT parent). "Counts" = a live, non-archived child,
  matching what `GET /tasks/:id/subtasks` returns, so the badge and the list agree by
  construction. Existing rows backfilled by `database/upgrades/006_counters.sql`.
  **Verified:** `fixing/evidence/F15/f15-probe.txt` — 2 children -> 2/0 (was 0/0 everywhere);
  done -> 2/1; back to open -> 2/0; archive -> 1/0 and the LIST also returns 1; unarchive -> 2/0;
  bulk -> 2/2; hard delete -> 1/1.
  **Two things this uncovered.** (1) **SCAN-H4 is closed as a precondition**: the first run turned
  every subtask status change into a 500 with
  `ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG`, because the dev DB still carried the three stale
  `trg_subtasks_after_*` triggers (absent from schema.sql, the QA DB and production). They were
  preserved deliberately under fixing rule X9 so this phase could confirm the crash first-hand —
  it did, and `006_counters.sql` drops them as step 0. (2) MySQL error **1093** ("can't specify
  target table for update in FROM clause") rejects the obvious correlated-subquery form of both
  the recompute and the backfill; both use a JOIN against a DERIVED table instead, noted inline
  because the next person will write the subquery first too.
  **EXPECT A NEW BADGE:** `BoardCard.tsx:198` renders the subtask badge only when
  `subtasksCount > 0`, which was never true anywhere. It will now appear on cards. That is the
  fix working.
- **Notes:** Distinct from `SCAN-H4`. H4 is the *dev database* still carrying the three removed
  triggers, which is an environment problem. This is the *application* half of the same 2026-07-14
  decision, and it affects every environment.

---

### ISS-047 · [P15] HIGH · `own` scope does not narrow anything — a user with `task.edit` scoped to `own` edited someone else's task

- **Severity:** HIGH
- **Type:** SECURITY
- **Phase:** P15 (resolves the scope-depth item deferred from P5)
- **Area:** the RBAC scope dimension (`own` / `own_space`) is materialised in `/me/permissions` but
  not consulted on writes
- **Account:** `marketing.only@beautybooth.com.bd` — role *Department Only*, which grants
  `task.edit` at scope **`own`**

**Repro**
```
GET /me/permissions  ->  "task.edit": {all:false, space_ids:[Marketing], own:true, own_space_ids:[]}

PATCH /tasks/<a task THEY created>              -> 200   expected
PATCH /tasks/<a task ANOTHER user created>      -> 200   *** and the value changed ***
   target: "Eid Sale banner design (homepage + app)" (created by someone else)
   priority actually written: 3
```

The write landed on a real task in the database. It was restored to its seeded value afterwards.

**Why this is worse than ISS-024.** ISS-024 established that `task.edit` is not enforced *as a
permission* — anyone can edit. This adds the second dimension: even for the permissions that *are*
enforced, the **scope** attached to a grant is not applied to writes. `/me/permissions` reports the
four scope fields faithfully (`all`, `space_ids`, `own`, `own_space_ids`), the admin UI lets you pick
between them, and the write path consults none of it.

- **Expected:** 403 (or 404) when editing a task the actor did not create and is not assigned to.
- **Actual:** 200, value written.
- **Scoping that *does* work:** space-level **visibility** is solid — P5's 84-read IDOR sweep found
  zero leaks, and this same user cannot even see tasks outside Marketing. The gap is specifically
  `own`-within-a-visible-space.
- **Evidence:** `testing/evidence/PHASE-15/task-update.txt` (§8)
- **Status:** **FIXED in F8** (2026-08-04) — the service-layer scope guard the issue asked for now
  exists (`rbac/scopeGuard.ts`) and runs on every task write: create/update/archive/unarchive/
  delete/bulk (`TaskWriteService`) + assignee add/remove (`TaskMembershipService`). The repro is
  the proof: marketing.only@ editing someone else's task in their visible space → **403
  `task.forbidden`/`not_own`, value unchanged** (was 200-and-written); their own or assigned tasks
  still 200. Space scope narrows create/assign; own scope narrows archive/delete; bulk is
  fail-atomic. Seeded roles hold everything at scope `all` (asserted) — zero behaviour change —
  and no-actor paths (public submit, jobs) pass untouched. Proof:
  `fixing/evidence/F08/f8-scope-probe.txt` (21/21, exit 0). **Boundary:** content permissions
  (comment/checklist/attachment/dependency/customfield/sprint-assign) stay verb-level — the
  RBAC plan's P20–22 remainder, mechanism now ready.
- **Notes:** Fixing ISS-024 alone would not close this — a `requirePermission("task.edit")` gate
  would pass this user, because they *do* hold the permission. The scope has to be checked against
  the resolved row, which is exactly the `assertCan(actor, key, {spaceId, isOwn})` layer that
  `requirePermission`'s docblock promises and that ISS-024 showed does not exist.

---

### ISS-048 · [P15] LOW · Sending `assignees` or `tags` in a task PATCH reports "Provide at least one field to update"

- **Severity:** LOW
- **Type:** UX (misleading error)
- **Phase:** P15
- **Area:** `updateTaskValidator` does not list `assignees` / `tags` / `parent_task_id` /
  `primary_list_id`; the "at least one field" guard then fires

```
PATCH /tasks/:id {"assignees":["u-..."]}     -> 422  "Provide at least one field to update"
PATCH /tasks/:id {"tags":["tag-..."]}        -> 422  "Provide at least one field to update"
PATCH /tasks/:id {"parent_task_id":"t-..."}  -> 422  "Provide at least one field to update"
```

The client sent a field and is told it sent none. The catalog already contains
`patch.assignee_add` and `patch.tag_add` — codes meant to say *"use `POST /tasks/:id/assignees`
instead"* — and neither ever fires (they are on ISS-010's never-thrown list).

- **Impact:** a client following the task shape from `GET /tasks/:id` and PATCHing it back gets an
  error that gives no hint which field is the problem. The dedicated membership endpoints exist and
  work (P17); nothing points to them.
- **Evidence:** `testing/evidence/PHASE-15/task-update.txt` (§2)
- **Status:** **FIXED in F23** (2026-08-06). A task PATCH carrying `assignees`,
  `tags`, `parent_task_id` or `primary_list_id` now gets a 422 that NAMES THE RIGHT DOOR
  (`POST /tasks/:id/assignees`, the tags endpoints, parent is create-only) instead of "Provide at
  least one field to update" — you sent a field; being told you sent none was a lie. A genuinely
  empty body keeps the old message. **Verified:** `fixing/evidence/F23/f23-probe.txt`.
- **Notes:** The guard itself is good — it is what blocks `id`, `workspace_id`, `created_by`,
  `subtasks_count` and `archived_at` from being written (all verified rejected, no mass assignment).
  Only the message is wrong for the four fields that are legitimately managed elsewhere.

---

### ISS-049 · [P15] LOW · The activity log records which fields changed but not their values, and logs no-op updates

- **Severity:** LOW
- **Type:** DATA (audit quality)
- **Phase:** P15
- **Area:** `task_activity.context` for `task_updated`

```
PATCH {name}                          -> +1 row   context {"fields":["name"]}
PATCH {priority, description, story_points} -> +1 row   (one row for three fields)
PATCH {name: <the value it already has>}    -> +1 row   (no-op still logged)
```

`status_changed` is the exception and does it properly: `{"to":"st-…","from":"st-…"}`.

- **Impact:** hit for real in this phase. A test wrote `priority: 3` onto a demo task; the audit row
  said only `{"fields":["priority"]}`, so the previous value had to be recovered from
  `seed-demo.ts` rather than from the log. For a workspace whose whole point is accountability, "who
  changed the due date, and from what?" is unanswerable.
- **Evidence:** `testing/evidence/PHASE-15/task-update.txt` (§7) ·
  `testing/evidence/PHASE-20/activity-part2.txt` (§1) · `activity-part3.txt` (§1)
- **Status:** **FIXED in F21** (2026-08-06). `task_updated` context now carries per-field
  `{from, to}` (wire names) via a diff against the current row; a NO-OP patch writes NO row; a
  status-only patch writes only its `status_changed` row. **Bulk records per-task values** —
  each target diffs against ITS OWN pre-update row (they were already in memory), and an unchanged
  target gets no row; `{"bulk":true}` alone is gone. **Verified:**
  `fixing/evidence/F21/f21-probe.txt` — rename+priority yields
  `{changes:{name:{from,to},priority:{from:2,to:4}}}`, the no-op writes nothing, bulk shows
  `{from:1,to:3}` for the changed task and nothing for the already-at-3 one.
- **Notes:** Recording a no-op as a change also inflates the feed — a user re-saving an unchanged
  form produces audit noise.

**UPDATE (P20) — the bulk path records even less.** `POST /tasks/bulk` writes exactly one
`task_updated` row per task (correct — not one per field, and it is fail-atomic: a single bad id in
the batch writes nothing), but its context is:

```
patch {priority, due_date, start_date} on 3 tasks -> 3 rows, each context {"bulk":true}
```

No field list at all. So a bulk edit across 200 tasks leaves 200 audit rows that record only *that*
something was bulk-changed. A no-op bulk also writes a full set of rows, same as the single PATCH.

---

### ISS-050 · [P16] MEDIUM · "Delete" and "Archive" are the same irreversible action in the UI, and neither can be undone

- **Severity:** MEDIUM
- **Type:** UX / DATA expectation
- **Phase:** P16 — Task lifecycle
- **Area:** `client/src/http/api.ts:587-592` · `TaskDetailDrawer.tsx:139,156` ·
  `BulkActionToolbar.tsx:299,317` · `useTaskMutations.ts:102,114`

The client offers **two** destructive actions on a task, from both the drawer and the bulk toolbar:

```ts
archive: (id) => api.post(`/tasks/${id}/archive`)
delete:  (id) => api.delete(`/tasks/${id}`)
```

Server-side they do the same thing. `DELETE /tasks/:id` is a **soft delete**, verified:

```
DELETE /tasks/:id        -> 204
row still present: true   archived_at: set
GET /tasks/:id           -> 200   (still fully readable)
```

Hard deletion exists but only via `?hard=true`, which the client never sends (member → 403,
owner → 204, confirmed).

And **neither is reversible from the UI**: `tasksApi` has no `unarchive` at all, and a search of the
whole client finds **0 callers** for a task unarchive — while `POST /tasks/:id/unarchive` works
perfectly on the server (204, idempotent, PATCH succeeds again afterwards).

- **Expected:** either the two actions differ, or only one is offered; and an archived task can be
  restored from the UI.
- **Actual:** two differently-labelled buttons perform one operation, a user who clicks **Delete**
  believes the task is gone while it is merely hidden and still readable by anyone with the id, and
  there is no way back through the interface.
- **Evidence:** `testing/evidence/PHASE-16/task-lifecycle.txt` (§1, §2, §6)
- **Status:** **FIXED in F25** (2026-08-06). The two actions are now genuinely different
  and archiving is reversible. `tasksApi.unarchive` exists (the endpoint always worked and had
  ZERO callers); the drawer menu TOGGLES — "Archive" on a live task, "Restore" on an archived one;
  and "Delete" became "Delete permanently", which sends `?hard=true` and confirms first, naming
  what goes with it and pointing at Archive as the reversible option. The bulk toolbar got the same
  treatment. **Verified:** `fixing/evidence/F25/f25-probe.txt` — archive→unarchive round-trips,
  the plain DELETE is confirmed to still be a SOFT delete server-side, and `?hard=true` really
  removes the row.
- **Notes:** Confirms and extends `SCAN-L5`, which recorded only "no unarchive call". The sharper
  problem is that **Delete is not a delete**, and combined with the missing unarchive it makes both
  actions one-way. Spaces and lists both have working unarchive endpoints too — the gap is entirely
  client-side.

---

### ISS-051 · [P16] LOW · An archived task still accepts new comments

- **Severity:** LOW
- **Type:** BUG (inconsistent state machine)
- **Phase:** P16
- **Area:** `CommentsService.create` has no archived check; `TaskWriteService` and the membership
  endpoints do

```
POST /tasks/:id/archive              -> 204
PATCH /tasks/:id {name}              -> 409 task.archived
POST  /tasks/:id/assignees           -> 409 task.archived
POST  /tasks/:id/comments            -> 201   *** accepted ***
```

- **Impact:** discussion can continue on a task the workspace considers deleted, and — because
  `DELETE` is a soft delete (ISS-050) — on a task the author believes they removed.
- **Evidence:** `testing/evidence/PHASE-16/task-lifecycle.txt` (§1)
- **Status:** **FIXED in F22** (2026-08-06), BOTH halves. Comment on an archived task →
  `409 task.archived` (edits/assignment already refused; discussion could continue on a task the
  workspace considers deleted). And per the P18 update: a dependency edge with an ARCHIVED endpoint
  → 409 too. **Verified:** `fixing/evidence/F22/f22-probe.txt`.
- **Notes:** Third instance of the archived-state machine being applied unevenly: archived **spaces**
  stay fully editable (ISS-034), archived **lists** are correctly frozen (P9 §4), archived **tasks**
  are frozen for edits but open for comments. Lists are the model to copy.

**UPDATE (P18):** comments are not the only write that slips past the archived guard —
`POST /task-dependencies` also accepts an **archived** task as an endpoint (201), and the new edge
then renders on the live task's dependency list. Same defect, one more path; fix them together.
```
POST /tasks/:id/archive                                 -> 204
POST /task-dependencies {live, related: <archived>}     -> 201   *** accepted ***
GET  /tasks/<live>/dependencies                         -> 200, 1 edge
```

---

### ISS-052 · [P17] MEDIUM · `updated_at` runs on two different clocks and moves backwards — the ETag with it

- **Severity:** MEDIUM
- **Type:** DATA
- **Phase:** P17 — Task membership
- **Area:** `server/src/repositories/TasksRepo.ts:163-171` (`touchUpdatedAt` writes
  `updatedAt: new Date()` through Drizzle) vs MySQL's `ON UPDATE CURRENT_TIMESTAMP`
  (`database/schema.sql:121`)

The same column is written by two different writers, on two different clocks:

| what you do | who sets `updated_at` | value returned |
|---|---|---|
| `POST /tasks` | MySQL `DEFAULT CURRENT_TIMESTAMP` | `2026-07-30T14:01:57Z` |
| `PATCH /tasks/:id` | MySQL `ON UPDATE CURRENT_TIMESTAMP` | `2026-07-30T14:02:39Z` |
| **`POST /tasks/:id/assignees`** | **`touchUpdatedAt()` via Drizzle** | **`2026-07-30T08:01:58Z`** |
| **`POST /tasks/:id/tags`** | **`touchUpdatedAt()` via Drizzle** | **`2026-07-30T08:02:00Z`** |

Measured in one run:
```
create       updated_at = 2026-07-30T14:01:57.000Z
+assignee    updated_at = 2026-07-30T08:01:58.000Z   <- SIX HOURS EARLIER than the create
+tag         updated_at = 2026-07-30T08:02:00.000Z
```

- **Expected:** `updated_at` is monotonic and never precedes `created_at`.
- **Actual:** assigning someone moves `updated_at` **6 hours into the past**, behind the task's own
  `created_at`. Doing a plain `PATCH` afterwards jumps it forward 6 hours again.
- **Impact:**
  - Sorting or filtering by "recently updated" interleaves the two clocks, so a task edited seconds
    ago can rank below one edited yesterday.
  - `updated_at` **is** the ETag (`GET` returns it in the `ETag` header and `If-Match` is honoured —
    P15 §3). A client that caches the ETag, then assigns someone, receives an ETag six hours older
    than the one it holds.
  - Any "last activity" display on a card or in a report is wrong for exactly the tasks that had
    people assigned to them.
- **Evidence:** `testing/evidence/PHASE-17/task-membership.txt` (§6) ·
  `updated-at-regression.txt`
- **Status:** **FIXED in F3** (2026-08-03) — `updated_at >= created_at` now holds. The two writers
  (Drizzle `touchUpdatedAt` and MySQL `ON UPDATE CURRENT_TIMESTAMP`) still exist, but they no longer
  run on different clocks, so the column cannot move backwards. Proof: `fixing/evidence/F03/after.txt`.
- **Notes:** This is a consequence of **ISS-001** (Drizzle writes UTC while the MySQL session is
  Dhaka), but filed separately because it is a distinct, independently visible defect: the problem
  here is not the absolute offset, it is that **one column has two writers on two clocks**, which
  makes the value non-monotonic. Fixing ISS-001 fixes this too; if ISS-001 is deferred, this one can
  be closed on its own by letting MySQL own the column everywhere.

---

### ISS-053 · [P18] HIGH · A dependency edge leaks the full task detail of a space the user cannot see

- **Severity:** HIGH
- **Type:** SECURITY (read-authorization bypass, cross-space)
- **Phase:** P18 — Subtasks & dependencies
- **Area:** `TaskDependenciesService.getForTask` / `TaskDependenciesRepo` — the other-end hydration
  is not filtered by space visibility, unlike every other read path
- **Account:** `marketing.only@beautybooth.com.bd` (custom "department-only" role, sees Marketing only)

**Repro**

The owner links a Marketing task to a Politics task (allowed — dependencies are workspace-scoped,
not space-scoped). Then, as the space-scoped user:

```
GET /tasks/<politics id>                  -> 404 task.not_found        (correctly denied)
GET /search?q=CONFIDENTIAL                -> []                        (correctly denied)
GET /tasks/<their own marketing task>/dependencies
                                          -> 200, and the edge carries:
   {
    "name": "TEST-p18c CONFIDENTIAL board memo",
    "description": "Politics-space only: salary review outcome",
    "list": "l-j5F8XbnK_pJYkP_67hOaug",
    "assignees": ["u-O_2loELtxZKyecnzH7KnGw"]
   }
   -> the full 50-key Task object
DELETE /task-dependencies/<edge id>       -> 204                       (they can also unlink it)
```

- **Expected:** the edge is either hidden, or hydrated to an opaque stub, for a user who cannot see
  the space the other task lives in — the same rule `GET /tasks/:id` and `/search` already apply.
- **Actual:** name, description, dates, priority, assignees, list and status of an invisible task are
  returned in full, and the user can delete the edge.
- **Impact:** this defeats the entire point of the space-scoped "department only" role. One
  cross-department link — which any admin can create, and which is a normal thing to want — exposes
  that task's content to everyone in the other department. `description` is the field most likely to
  carry the sensitive part.
- **Evidence:** `testing/evidence/PHASE-18/cross-space-dep-leak.txt` ·
  `subtasks-deps-part2.txt` (§3)
- **Status:** **FIXED in F9** (2026-08-04) — `findTaskRowsByIds` (the other-end hydration) now
  carries the same `listScopeFilter` + own-escape as SearchRepo: an invisible other end does not
  hydrate and the edge is dropped from the response. The unlink hole closed too: `delete` resolves
  BOTH endpoints through the filtered read → 404 when either is invisible (the create path's rule).
  Repro flipped: blocks [] + DELETE 404 for the narrowed user; the owner's view unchanged.
  Proof: `fixing/evidence/F09/f9-leak-probe.txt` §ISS-053.
- **Notes:** Not a cross-*tenant* leak — workspace scoping holds (a task in another workspace is
  404). The scoped user also **cannot create** such an edge themselves: `POST /task-dependencies`
  resolves `related_task_id` through the visibility-filtered repo and returns 404. So the write path
  is guarded and only the read path is not — which is why this is a repo-hydration bug, not a design
  decision. Related to ISS-024/ISS-047 (RBAC not narrowing) but a different mechanism: this one
  bypasses **space visibility**, which does work everywhere else.

---

### ISS-054 · [P18] MEDIUM · The dependency UI can only ever create "blocks" — the "Blocked by" direction is unreachable

- **Severity:** MEDIUM
- **Type:** BUG (dead state / half-built control)
- **Phase:** P18
- **Area:** `client/src/components/task/DependenciesSection.tsx`

The component holds `showPicker: "blocks" | "blocked_by" | null`, renders a **Blocked by** group, and
styles it in the danger colour — but the only thing that ever opens the picker is:

```tsx
onClick={() => setShowPicker("blocks")}       // the single "Link" button
...
create.mutate({ relatedTaskId: pickedTaskId }) // direction is never read from showPicker
```

`dependenciesApi.create` sends `{task_id, related_task_id}` with no direction, so the edge is always
*this task blocks that one*. `showPicker === "blocked_by"` is unreachable dead state.

- **Expected:** "Blocked by" can be added from the section that displays it.
- **Actual:** to record "A is blocked by B" the user must find B, open it, and link B → A. Nothing in
  the UI says so; the visible **+ Link** button next to a "Blocked by" heading implies otherwise.
- **Impact:** the more natural direction (the person looking at a stuck task wants to say what is
  blocking it) is the one that cannot be entered.
- **Evidence:** `DependenciesSection.tsx` lines 18-20, 36-46, 93-101, 139-185 (read in P18)
- **Status:** **FIXED in F25** (2026-08-06). Two buttons now — **Blocks** and **Blocked
  by** — and the mutation READS the direction: the stored edge is always
  `(task_id BLOCKS related_task_id)`, so "blocked by" sends the pair reversed. The dead state the
  component always held is reachable at last. **Verified:**
  `fixing/evidence/F25/f25-probe.txt` (a reversed edge renders in the `blocked_by` group).
- **Notes:** The API supports it with no change — `POST /task-dependencies` with the ids swapped is
  exactly a `blocked_by` edge. This is purely a client wiring gap.

---

### ISS-055 · [P18] LOW · The dependency picker only offers tasks from the same list

- **Severity:** LOW
- **Type:** GAP-shaped UX limit
- **Phase:** P18
- **Area:** `client/src/components/task/DependenciesSection.tsx` — `candidates` comes from
  `tasksApi.listByList(listId)`

The API allows a dependency between **any two tasks in the workspace** — cross-list and cross-space
both return 201 (verified in P18 §2/§8). The picker only ever loads the current list's tasks, and the
source comments it as a deferred enhancement.

- **Impact:** the most valuable dependencies in this product — "Marketing's launch banner blocks
  Engineering's release" — cannot be created in the UI at all.
- **Evidence:** `subtasks-deps-part2.txt` (§2) · component source
- **Status:** **FIXED in F25** (2026-08-06). The picker SEARCHES the workspace instead of
  listing the current list — workspace-wide, visibility-filtered server-side (RBAC P18) and
  relevance-ranked since F20. The cross-department dependency this issue names ("Marketing's launch
  banner blocks Engineering's release") is creatable in the UI at last.
  **Verified:** `fixing/evidence/F25/f25-probe.txt` — a task in another SPACE is findable through
  the picker's source and the cross-space edge is accepted.
  ⚠️ *Worth knowing:* the first cut passed `types: ["tasks"]` — the valid `SearchType` is
  SINGULAR and the service silently drops unknown tokens, so the picker would have searched nothing.
  The probe caught it because it asserted a real search RESULT, not the code shape.
- **Notes:** Worth deciding *with* ISS-053: if cross-space edges stay allowed, they need a visibility
  rule; if they are restricted to a space, this picker limit becomes nearly correct on its own.

---

### ISS-056 · [P19] MEDIUM · The Agenda card invents a time of day — every row reads "6:00 AM"

- **Severity:** MEDIUM
- **Type:** BUG (display)
- **Phase:** P19 — My Work, Home KPIs & Agenda
- **Area:** `client/src/pages/home/AgendaCard.tsx:9-13, 30-36, 138`

The card renders a timeline: a monospace time column, a bullet, then the task name. The time comes
from

```tsx
const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
...
.map((t) => ({ time: t.dueDate!, ... }))
```

but `due_date` is a **DATE** column and reaches the client as `"2026-07-30"`. `new Date("2026-07-30")`
is parsed as UTC midnight, so `toLocaleTimeString` renders the viewer's offset from midnight UTC:

```
due_date 2026-07-30  -> "6:00 AM"     (viewer in Asia/Dhaka)
due_date 2026-08-01  -> "6:00 AM"
due_date 2026-12-25  -> "6:00 AM"
                     -> "12:00 AM"    (viewer whose browser is UTC)
                     -> "8:00 PM"     (viewer in New York — and the day before)
```

- **Expected:** either no time column (the system has no time-of-day on tasks at all), or a real one.
- **Actual:** every agenda row for every user on every day shows the same fabricated time. The
  `.sort()` by that time above it is a no-op for the same reason, so the "schedule" is in arbitrary
  order.
- **Impact:** the Home page's agenda looks like a calendar and is not one. A user reading "6:00 AM"
  next to five different tasks has been given information that does not exist in the database.
- **Evidence:** `testing/evidence/PHASE-19/agenda-mywork-fixtures.txt` (§1 — `due_date` on the wire
  is `2026-07-30`) · the three-timezone render above
- **Status:** **FIXED in F24** (2026-08-06). The invented time is gone. `due_date` is a
  DATE column, so `new Date("2026-07-30")` parsed as UTC midnight and `toLocaleTimeString`
  rendered the VIEWER'S OFFSET from it — "6:00 AM" in Dhaka, "12:00 AM" in UTC, "8:00 PM the
  previous day" in New York — and the sort by that value was a no-op because every row carried the
  same instant. `tasks` has no time-of-day column anywhere, so the column now carries the task's
  PRIORITY and the list sorts by it (urgent first, then name) — a sort that actually orders the day.
  **Verified:** `fixing/evidence/F24/f24-probe.txt` (every wire `due_date` is DATE-only; the
  client no longer calls `toLocaleTimeString`).
- **Notes:** `tasks` has no time-of-day column anywhere — `due_date` and `start_date` are both DATE.
  So this cannot be fixed by "returning the time"; the column has to go, or dates need a time part.

---

### ISS-057 · [P19] MEDIUM · Every KPI card carries two fabricated signals around a correct number

- **Severity:** MEDIUM
- **Type:** BUG (misleading data)
- **Phase:** P19
- **Area:** `HomeService.buildKpi` (`server/src/services/HomeService.ts:34-44`) ·
  `HomeRepo` day-bucket · `client/src/pages/home/KpiCard.tsx:41-45` ·
  `client/src/components/ui/Trend.tsx`

**The six values themselves are correct** — all six tiles were recomputed by hand in SQL for four
different accounts and matched exactly (PHASE-19.md §1). The problem is everything around them.

**(a) The trend badge is hardcoded.** `buildKpi` returns `trend: 0, trendDirection: "flat",
isPositive: false` with the comment *"V1 computes no trend (mock parity)"*. `KpiCard` passes those
straight to `Trend`, which renders a minus icon and `value.toFixed(1)%`. So all six cards permanently
display **"— 0.0%"**, which reads as a measured "no change since last period".

**(b) The sparkline does not plot the metric.** It buckets the *currently matching* task set by
`DATE(created_at)` over the trailing 7 days, so it is a creation-date histogram, not a time series of
the KPI. Its sum is therefore unrelated to the number above it:

```
tile            value   sparkline                sum
myTasks         1       [0,0,0,0,0,0,0]          0
overdue         1       [0,0,0,0,0,0,0]          0
openTeamTasks   31      [0,0,0,0,1,3,0]          4
```

A tile reading **31** draws a line that is flat at zero for five of seven days. Any task created
before the window is invisible to the line but counted in the number.

- **Expected:** a trend badge reflects change, and a sparkline plots the value it sits under.
- **Actual:** neither does, on all six tiles, for every user.
- **Impact:** the KPI row is the first thing on the Home page. Two of the three visual elements on
  each card are placeholders that look like real measurements.
- **Evidence:** `testing/evidence/PHASE-19/home-kpis-agenda-mywork.txt` (§1, §8) ·
  `agenda-mywork-fixtures.txt` (§3 — with 6 fixtures created today: value 6, sparkline sum 5)
- **Status:** **FIXED in F24** (2026-08-06). Both fabricated signals REMOVED, server and
  client: the wire `HomeKpi` is now `label` + `value` + `valueDisplay` and nothing else. The
  hardcoded trend badge ("— 0.0%" on every card, from `0/flat/false`) and the sparkline (a
  `DATE(created_at)` histogram, which is why "Open Team Tasks 31" sat above a line summing to 4)
  are gone rather than left to mislead — a real trend needs task STATUS HISTORY, which is not
  stored, so it stays unbuilt instead of faked. The per-tile accent colour now tints the NUMBER, so
  each caller's intent (danger for Overdue/SLA, success for the team total) survives carrying no
  invented data.
  **Verified — and the six values re-proven:** `fixing/evidence/F24/f24-probe.txt` recomputes
  myTasks/dueToday/overdue/awaitingReview in independent SQL for TWO accounts (owner + a dept head)
  and matches the wire on all eight comparisons, so the refactor did not disturb the numbers this
  issue says are correct.
- **Notes:** The source comments are honest about both (*"mock parity"*, *"a true point-in-time
  series would need task status history — deferred to V2"*). The decision to record is whether V1
  should **show** them: dropping the badge and the sparkline is a small change and leaves six correct
  numbers.

---

### ISS-058 · [P19] MEDIUM · "Today" is whatever the API server's OS clock says — `workspaces.timezone` is read by nothing

- **Severity:** MEDIUM
- **Type:** BUG (a setting that does nothing) + config fragility
- **Phase:** P19
- **Area:** `HomeService` `ymd(new Date())` (`:29-35, 57-62`) · `TaskWriteService.myWork:1010-1030` ·
  `workspaces.timezone`, `users.timezone`

Every date boundary in the product — the `dueToday` and `overdue` KPIs, the agenda's default date,
and all five My Work buckets — comes from `new Date()` evaluated in the **API process's OS
timezone**.

`workspaces.timezone` is stored (`Asia/Dhaka`), is editable through `PATCH /workspace`
(`WorkspaceController:141`), is validated against `Intl.DateTimeFormat`, and is returned on the wire.
`users.timezone` likewise, per user. **Neither is read by any scheduling or bucketing code** — a grep
for readers finds only the controllers that set them and the serializers that return them.

- **Expected:** changing the workspace timezone changes what "due today" means.
- **Actual:** it changes a string in a table. The only thing that decides is `TZ` on the server
  process.

**The production coupling this creates.** Correct dates in production depend on two values in two
different files agreeing, with nothing checking that they do:

| where | value | why it matters |
|---|---|---|
| `deploy/pm2/ecosystem.config.js` | `TZ: "Asia/Dhaka"` | decides `new Date()` |
| `server/.env` | `DB_TIMEZONE=+06:00` | decides how mysql2 materialises a DATE |

**Both are currently set correctly** — pm2 sets `TZ` with an explicit comment saying why, and the
cron jobs fire through the API's own HTTP endpoint so they inherit it. This is *not* a live
production defect. What was measured is the failure mode if the pairing is ever broken — start the
API any other way (`node dist/server.js`, a systemd unit, a container) and `TZ` defaults to UTC while
`DB_TIMEZONE` stays `+06:00`:

```
process TZ = UTC, DB_TIMEZONE = +06:00
  stored due_date 2026-07-07 -> JS Date 2026-07-06T18:00Z -> toWireDate() says 2026-07-06  OFF BY ONE DAY
  stored due_date 2026-07-22 -> JS Date 2026-07-21T18:00Z -> toWireDate() says 2026-07-21  OFF BY ONE DAY
```

`toWireDate` (`serializers/taskSerializer.ts:83-90`) uses `getFullYear/getMonth/getDate` on that
Date. Its own comment states the assumption — *"mysql2 materialises a DATE as a Date at local
midnight"* — which is true only while the process TZ equals the connection timezone. Every task's
`due_date` and `start_date` on the wire, every My Work bucket, and `onCallSerializer`'s
`week_start`/`week_end` shift a day, silently, with no error anywhere.

- **Impact today:** the timezone setting in the workspace UI is inert.
- **Impact if the coupling breaks:** every date in the product is one day early, in a way nothing
  detects.
- **Evidence:** `testing/evidence/PHASE-19/home-kpis-agenda-mywork.txt` (§6) · the two-config
  simulation run under `TZ=UTC` · `deploy/pm2/ecosystem.config.js` · `deploy/cron/run-job.sh`

**CORRECTION (F1, 2026-08-03) — the second half of this issue's evidence does not hold.**
The primary claim is unchanged and still true: **`workspaces.timezone` is read by nothing**, and
"today" comes from the API process's OS clock. That part stands.

What does **not** hold is the follow-on claim that a broken `TZ`/`DB_TIMEZONE` pairing shifts DATE
columns by a day. That was measured with a **raw mysql2 connection**, not through the product's
Drizzle path. At the driver level the P19 measurement is correct:

```
driver timezone=undefined -> DATE arrives as Date 2026-07-07T00:00Z -> renders 2026-07-07  OK
driver timezone=+06:00    -> DATE arrives as Date 2026-07-06T18:00Z -> renders 2026-07-06  SHIFTED
```

But Drizzle's `date()` **defaults to `mode: "string"`**, so every DATE column reaches the serializer
as a plain string and the date-component branch in `toWireDate` never runs. Verified on all six DATE
columns (`tasks.due_date`, `tasks.start_date`, `on_call_shifts.week_start`/`week_end`,
`sprints.start_date`, `department_reports.week_start`) under the worst configuration
(`TZ=UTC` + `DB_TIMEZONE=+06:00`): **all arrive as strings, all round-trip byte-identically.**

Consequence for the fix: **there is no DATE bug to repair.** `dateStrings: true` is unnecessary, and
the date-component branch in `taskSerializer.ts:83-90` / `onCallSerializer.ts:27-33` is dead code.
- **Evidence for the correction:** `fixing/results/F01.md` §4 · `fixing/evidence/F01/before-prod-notz.txt`
- **Status:** **FIXED in F5** (2026-08-04) — `workspaces.timezone` now decides “today” for the
  dueToday/overdue KPIs, the agenda default and all five My Work buckets (`todayInZone` via Intl,
  Dhaka fallback; `WorkspaceRepo` injected at all five DI sites). Proven deterministically with
  Pacific/Kiritimati (+14) vs Pacific/Midway (−11): the SAME task flips bucket and leaves the agenda
  when only the timezone changes — `fixing/evidence/F05/f5-timezone.txt`, exit 0. The production-
  coupling half is closed by a boot guard: NODE_ENV=prod refuses to start unless
  `DB_TIMEZONE=+00:00` (`boot-guard.txt`). **Still decorative: `users.timezone`** — per-user
  calendars are a product decision (F28 batch) and out of this fix's scope. Company-calendar
  artifacts (dept-review weeks, on-call roster) stay on Dhaka BY DESIGN.
- **Status (superseded — the authoritative line is FIXED-in-F5 above):** the text below is the
  ORIGINAL pre-fix analysis, kept for provenance. F5 closed the class differently (the boot guard +
  `WorkspaceRepo` at all five DI sites); `users.timezone` per-user calendars are a documented
  deliberate non-feature, not an open defect. **F34 ledger: ISS-058 is FIXED; 0 issues silently open.**
- **Original notes:** Two cheap defences, either of which closes the whole class: set
  `dateStrings: true` on the pool (the line already exists in `db/client.ts:63`, commented out), so
  DATE columns never become JS Dates; and/or assert at boot that the process TZ matches
  `DB_TIMEZONE` and refuse to start otherwise. Distinct from ISS-001 — that one is about TIMESTAMP
  columns and Drizzle; this is about DATE columns and the process clock.

---

### ISS-059 · [P19] MEDIUM · "Awaiting My Review" counts GitHub PRs — the review queue this company actually uses is invisible

- **Severity:** MEDIUM
- **Type:** BUG (wrong metric)
- **Phase:** P19
- **Area:** `HomeRepo.awaitingReviewSeries` (`server/src/repositories/HomeRepo.ts:104-121`)

The tile is labelled **"Awaiting My Review"**. It counts tasks where `reviewer_id` is the caller and
`pr_status = 'open'`. `pr_status` is the engineering pull-request field, and in the live database
**every one of the 51 tasks has `pr_status = NULL`** — so the tile is 0 for every user, permanently.

Meanwhile the review workflow this product actually shipped — the department-head review, where a
space head approves or flags a completed task — has real pending work:

```
task_reviews rows:      approved 7, flagged 2
task_reviews.status:    enum('approved','flagged')   <- no "pending" state; a row exists only
                                                        once the head has acted
completed tasks with review_status IS NULL:  11      <- the real queue, and what a head would
                                                        expect this tile to count
```

- **Expected:** a department head opening Home sees how many completed tasks are waiting on them.
- **Actual:** they see 0, while 11 tasks wait.
- **Impact:** five of the six spaces are non-engineering departments that will never set a
  `pr_status`. For them the tile is dead space that reads as "nothing needs you".
- **Evidence:** `testing/evidence/PHASE-19/home-kpis-agenda-mywork.txt` (§7)
- **Status:** **FIXED in F24** (2026-08-06). The tile counts the review queue THIS COMPANY
  uses: a COMPLETED task, not yet reviewed (`review_status IS NULL` — the enum has no pending
  state, a row exists only once the head has acted), in a space the caller HEADS. The per-task
  `reviewer_id` arm is kept, so an explicitly named reviewer still sees their own queue.
  **Verified:** `fixing/evidence/F24/f24-probe.txt` — `pr_status='open'` is still 0 rows
  workspace-wide (the old metric, dead for everyone forever), the real queue is not empty, a
  department head's tile is now non-zero, and the value matches its own independent SQL.
- **Notes:** The metric is computable from data that already exists — completed, unarchived tasks
  with `review_status IS NULL` in a space the caller heads (`spaces.head_user_id`). Whether the tile
  should count PRs *as well* is a product decision; counting only PRs is the defect.

---

### ISS-060 · [P20] HIGH · The workspace audit trail is readable by every account and scoped to nothing — a guest can read role changes and deactivations

- **Severity:** HIGH
- **Type:** SECURITY (information disclosure)
- **Phase:** P20 — Task activity
- **Area:** `server/src/routes/workspaceActivity.ts` — `GET /activity` and `GET /activity/recent`
  carry `authenticate` and a validator, and **nothing else**: no `requirePermission`, no space filter
- **Accounts:** `arif@` (member), `marketing.only@` (space-scoped), `guest@`

**People-management history — every account sees the identical set:**

```
GET /activity?entity_type=user&limit=50
  owner          -> 200   42 rows
  member (arif)  -> 200   42 rows
  space-scoped   -> 200   42 rows
  guest          -> 200   42 rows
  all four identical: {role_changed:12, invited:10, profile_updated:10,
                       deactivated:5, reactivated:4, password_reset_requested:1}

what the GUEST reads, verbatim:
  {"action":"deactivated","actor":"owner@company.local",
   "entity":"u-76AuOtG-wzFTpMxhix2_qA","context":{"from":"active"}}
```

So a guest can reconstruct: who was promoted or demoted and when, who was deactivated and by whom,
who has been invited, and who requested a password reset. Each row hydrates the **actor** to a full
User object including their email.

**Space scoping is absent too:**

```
marketing.only@ (sees only the Marketing space)
GET /activity?entity_type=space&limit=50  -> 47 rows, 45 of them about spaces they cannot open
GET /activity/recent                      -> lists/spaces from Politics by name
```

- **Expected:** an audit feed is admin-or-owner material, and the parts of it that are not should at
  least respect the space visibility every other read path enforces.
- **Actual:** any authenticated account, including the most restricted role in the product, reads the
  whole workspace's audit history — up to 200 rows per request, cursor-paginated through all 276.
- **Impact:** the "department only" role and the guest role both exist to limit what a person sees.
  This endpoint hands both of them the company's HR and access-control timeline.
- **Evidence:** `testing/evidence/PHASE-20/activity-part2.txt` (§5) ·
  `task-and-workspace-activity.txt` (§7)
- **Status:** **FIXED in F9** (2026-08-04) — the data half (the gate half was F7's `activity.view`).
  `WorkspaceActivityRepo.auditVisibility()`: `space`/`list` rows follow the caller's space
  visibility; `user`/`role`/`workspace`/catalog rows are owner·admin-only. A guest's
  `?entity_type=user` went 42 rows → **0**; their whole feed is now space/list only; a
  space-narrowed user sees only their department's rows; owners keep everything.
  Proof: `fixing/evidence/F09/f9-leak-probe.txt` §ISS-060.
- **Notes:** `activity.view` is in the 18 permissions ISS-024 proved unenforced, so the *gate* half is
  already logged — this is filed separately for the **data**: what is behind the missing gate is the
  audit trail, and the space-scoping half is a second, independent omission (the same one ISS-053
  found on dependency hydration). `ip_address` is stored on `workspace_activity` but correctly **not**
  serialized — verified absent from the wire.

---

### ISS-061 · [P20] MEDIUM · The task Activity section speaks the mock's vocabulary — 11 of 13 real action codes render as raw snake_case

- **Severity:** MEDIUM
- **Type:** BUG (stale integration)
- **Phase:** P20
- **Area:** `client/src/components/task/TaskActivitySection.tsx:18-41, 63-77`

The component maps action codes to English through a `switch`. That switch was written against the
mock API and never updated when the real backend landed.

| the server actually emits | the switch has a case? | what the drawer shows |
|---|---|---|
| `task_created` | no | "task created" |
| `task_updated` | no | "task updated" |
| `status_changed` | **yes** | "moved status" |
| `assignee_added` / `assignee_removed` | no | "assignee added" / "assignee removed" |
| `tag_added` / `tag_removed` | no | "tag added" / "tag removed" |
| `comment_posted` | **yes** | "commented" |
| `dependency_added` | no | "dependency added" |
| `task_archived` / `task_unarchived` | no | "task archived" / "task unarchived" |
| `checklist_item_toggled` / `checklist_item_updated` | no | "checklist item toggled" / "checklist item updated" |

Two of thirteen hit a case. Going the other way, **seven of the nine cases are dead** — `created`,
`assigned`, `completed`, `priority_changed`, `branch_created`, `pr_opened`, `pr_merged` are codes
this server never writes.

The same staleness costs real information: the only context the component reads is
`entry.context?.taskName`, which task activity never contains. The server *does* send
`{"fields":["priority","due_date"]}` on `task_updated` and `{"from":…,"to":…}` on `status_changed` —
both are discarded, so every edit reads "Owner User task updated" with no indication of what changed.

- **Expected:** "Owner User changed priority and due date", "Owner User added Arif".
- **Actual:** "Owner User task updated", "Owner User assignee added".
- **Evidence:** `testing/evidence/PHASE-20/task-and-workspace-activity.txt` (§1 — the full action
  vocabulary with contexts) · `checklist-activity.txt`
- **Status:** **FIXED in F21** (2026-08-06). The mock-era switch (7 of 9 cases were codes
  the server never emits) is replaced by a 27-entry map verified against every `task_activity`
  writer in server/src — **the probe re-derives the emitted vocabulary from source and fails if any
  code lacks a rendering**, so the next drift is caught mechanically. Context rendering now shows
  the changed field names / checklist name / review status instead of only a `taskName` key task
  activity never contains. Client tsc + vitest 44/44 green.
- **Notes:** `RecentActivityCard` has the same stale switch but survives it: the workspace vocabulary
  (`created`, `deleted`, `updated`, `archived`, `role_changed`, …) already reads as English through
  the `replace(/_/g," ")` fallback. Only the task-level one is affected. Also worth folding in while
  there: `taskActivityApi.byTask` fetches one page and the section renders no "load more", so a task
  with more than the server's default **50** rows silently shows only the newest 50.

---

### ISS-062 · [P20] MEDIUM · Checklists can be created and deleted without leaving a trace in the activity trail

- **Severity:** MEDIUM
- **Type:** BUG (audit gap)
- **Phase:** P20
- **Area:** `server/src/services/ChecklistsService.ts` — `checklist_item_toggled` and
  `checklist_item_updated` are the only two activity writes in the file

Measured on one task, one operation at a time:

| operation | HTTP | activity rows |
|---|---|---|
| create a checklist | 201 | **none** |
| add an item | 201 | **none** |
| toggle an item to done | 200 | +1 `checklist_item_toggled` |
| toggle it back | 200 | +1 `checklist_item_toggled` |
| rename an item | 200 | +1 `checklist_item_updated` |
| **delete an item** | 204 | **none** |
| **delete the whole checklist** | 204 | **none** |

- **Expected:** an audit trail records creation and deletion at least as reliably as it records a
  checkbox being ticked.
- **Actual:** the two operations that *destroy* content are the ones that write nothing. A checklist
  of ten items can be deleted and the task's Activity section is unchanged — while ticking one box
  leaves a permanent row.
- **Impact:** on a shared task, "who deleted the acceptance criteria?" is unanswerable.
- **Evidence:** `testing/evidence/PHASE-20/checklist-activity.txt`
- **Status:** **FIXED in F21** (2026-08-06). `checklist_created`, `checklist_deleted`,
  `checklist_item_added`, `checklist_item_deleted` activity rows — the DELETE rows carry the
  NAME/TEXT, because the row itself is gone and the trace is the only place it survives. "Who
  deleted the acceptance criteria?" is answerable. Four service inputs gained `actorId` (those
  paths never carried the actor because they never recorded anything). **Verified:**
  `fixing/evidence/F21/f21-probe.txt`.
- **Notes:** The context payloads on the two writes that *do* exist are good —
  `{item_id, checklist_id, is_completed}` — so the pattern to copy is already in the file. Watchers
  also write no activity, which is defensible (a watcher is personal state, the same reasoning P17
  applied to `updated_at`); checklists are shared task content, which is why they are filed and
  watchers are not.

---

### ISS-063 · [P21] HIGH · The 15-minute comment edit window is really 6 h 15 m, and an edited comment is not marked as edited

- **Severity:** HIGH
- **Type:** BUG (integrity control) — a consequence of ISS-001, filed separately as a distinct defect
- **Phase:** P21 — Comments
- **Area:** `server/src/services/CommentsService.ts:24, 171` ·
  `client/src/components/task/CommentsSection.tsx` (no `editedAt` render)

`CommentsService` guards edits with

```ts
const EDIT_WINDOW_MS = 15 * 60 * 1000;
if (Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MS) throw …
```

`comment.createdAt` arrives through Drizzle, which parses the stored `TIMESTAMP` as UTC while the
MySQL session is `+06:00` (ISS-001). The Date it produces is therefore **six hours in the future**,
so the subtraction under-reports the comment's age by exactly six hours.

**Measured by backdating `created_at` and re-trying the edit:**

```
created_at -10 min   -> 200   (intended: allowed)
created_at -20 min   -> 200   *** intended: 403 ***
created_at -60 min   -> 200   ***
created_at -360 min  -> 200   ***
created_at -370 min  -> 200   ***
created_at -374 min  -> 200   ***   <- last accepted
created_at -375 min  -> 403 comment.edit_window_expired
created_at -380 min  -> 403
```

The boundary is **374–375 minutes = 6 h 15 m** — the six-hour skew plus the intended fifteen minutes.
The window is **25× wider than specified**.

**And nothing shows an edit happened.** The API does set `edited_at` and returns it on the wire, but
a grep for `editedAt` across the whole client finds it only in two type declarations — no component
renders it. `CommentsSection` displays author, body and timestamp only.

- **Expected:** a comment is frozen 15 minutes after posting, and any edit inside that window is
  visibly marked.
- **Actual:** for six and a quarter hours a comment can be rewritten to say anything, and no reader
  can tell.
- **Impact:** this is the accountability surface of the product. A commitment made in the morning
  ("I'll ship it today") can be quietly rewritten the same afternoon. The 15-minute window exists
  precisely to prevent that, and it is not in force.
- **Evidence:** `testing/evidence/PHASE-21/comments.txt` (§2) ·
  `task-refs-and-edit-window.txt` (the 370–380 minute sweep)
- **Status:** **FIXED — both halves.** The *window* half in **F3** (2026-08-03): editable at 14 min,
  refused at 16 min — the real 15 minutes (it was a symptom of ISS-001; proof `fixing/evidence/F03/`).
  The *marker* half in **F5** (2026-08-04): `CommentsSection` renders “(edited)” with the full
  instant in the hover title, guarded `editedAt && !deletedAt` so tombstones stay bare. Proven on the
  wire (`fixing/evidence/F05/f5-edited-wire.txt`) and in a real browser — exactly one marker, on the
  edited comment only (`edited-marker.png`; permanent spec `client/e2e/f5-edited-marker.pw.ts`).
- **Notes:** Fixing ISS-001 fixes the window. Independently, this one closes on its own by comparing
  in SQL (`created_at < UTC/NOW() - INTERVAL 15 MINUTE`) instead of in JS. The missing "(edited)"
  marker is a separate, one-line client fix and should not wait for either.

---

### ISS-064 · [P21] MEDIUM · Commenting on someone's task notifies nobody — the `comment` notification type is never produced

- **Severity:** MEDIUM
- **Type:** GAP-shaped BUG (a wired-up type with no producer)
- **Phase:** P21
- **Area:** `server/src/services/CommentsService.create` — the only `notifications.createMany` call
  in the file is for `mentioned`

```
task: 1 assignee (arif), 1 watcher (priya), comment author = owner
POST /tasks/:id/comments  {body: "a plain comment, no mentions"}
  -> 201
  -> notifications produced: 0
```

`"comment"` is a declared value of the `notificationTypes` enum, the demo seed creates rows of that
type (`db/seed-demo.ts:532`), the inbox UI can display it — and **no code anywhere produces one**. A
grep for `type: "comment"` across `server/src` returns nothing.

- **Expected:** the people attached to a task (assignees, watchers) learn that it was commented on.
- **Actual:** the only way to reach anyone is to `@mention` them by name. Reply to someone's comment
  and even they are not told.
- **Impact:** on a task-management system for ~100 people, discussion is invisible unless the writer
  remembers to tag each reader. The watcher feature — which the product maintains on every assign
  (P17) — has no delivery path for the one event watchers exist for.
- **Evidence:** `testing/evidence/PHASE-21/comments.txt` (§6)
- **Status:** **FIXED in F19** (2026-08-06). A plain comment now notifies the people ATTACHED
  to the task — assignees + watchers, minus the author, minus anyone already notified as
  `mentioned` (one event, one notification). **Verified live with delta counts**
  (`fixing/evidence/F19/f19-probe.txt`): assignee + watcher each +1 `comment`, the author +0; a
  mentioned watcher gets `mentioned` only, never both. Preferences suppress it too (D7).
- **Notes:** Mentions themselves work well and are correct: matched by first name **and** by email
  local-part, case-insensitive, deduped, multiple per comment, and the author is **never**
  self-notified (verified with `@owner` written by the owner). An email address in the body does not
  trigger a false mention. The machinery is right; only the plain-comment fan-out is missing.

---

### ISS-065 · [P21] MEDIUM · `comments_count` only ever goes up — the trigger fires on hard delete, the API soft-deletes

- **Severity:** MEDIUM
- **Type:** DATA
- **Phase:** P21
- **Area:** `trg_comments_after_delete` (`database/schema.sql`) vs
  `CommentsService.delete` → `comments.softDelete`

```sql
trg_comments_after_insert  AFTER INSERT ON comments  -> comments_count + 1
trg_comments_after_delete  AFTER DELETE ON comments  -> comments_count - 1
```

`DELETE /comments/:id` never issues a SQL `DELETE`; it stamps `deleted_at`. So the decrementing
trigger can only fire if someone removes a row by hand.

```
2 comments + 1 reply     -> comments_count = 3   (correct)
delete one comment (204) -> comments_count = 3   live comments in DB: 2
GET /tasks/:id           -> comments_count: 3
GET /tasks/:id/comments  -> 2 top-level
```

- **Expected:** the badge on the card matches the number of comments a reader will find.
- **Actual:** it counts every comment ever written, including deleted ones, and drifts further apart
  the more a task is used.
- **Impact:** `comments_count` is rendered on every board card. It is the counter-part of ISS-046
  (subtask counters) with the opposite failure: that one never moves, this one never comes back down.
- **Evidence:** `testing/evidence/PHASE-21/comments.txt` (§3, §8)
- **Status:** **FIXED in F15** (2026-08-05). New `trg_comments_after_update`, shaped
  exactly like `trg_attachments_after_update` (the one that was always right): a comment counts
  while `deleted_at IS NULL`, so the counter moves on the crossing in EITHER direction and
  ignores an ordinary edit. The existing INSERT/DELETE triggers stay. Backfilled in the same
  script. **Schema (X4):** `database/upgrades/006_counters.sql` + `database/schema.sql`; no
  Drizzle edit needed (no column changed).
  **Verified:** `fixing/evidence/F15/f15-probe.txt` — 3 comments -> 3; delete one -> **2** (was
  stuck at 3) and the badge equals what a reader actually sees; an edit does not move it;
  restoring the deleted comment brings it back to 3. Every value compared against a live COUNT,
  not just an expected number.
- **Notes:** The insert side is correct and includes replies. The tombstone behaviour it interacts
  with is otherwise good: a deleted comment keeps its row, its body is preserved in the database but
  masked to `[deleted]` on the wire, its replies survive underneath it, and replying to a tombstone
  is refused with `comment.parent_not_found`.

---

### ISS-066 · [P21] MEDIUM · `#TASK-ID` references only resolve `custom_id`, but the UI shows tasks as `T-<number>`

- **Severity:** MEDIUM
- **Type:** BUG (two halves of one feature disagree)
- **Phase:** P21
- **Area:** `CommentsService.resolveTaskRefs` → `findByIdOrCustomIdInWorkspace` ·
  `client/src/components/task/TaskDetailDrawer.tsx:252` and 4 other display sites

The server resolves a `#REF` against the task's internal id or its `custom_id`. The client renders a
task's key as `task.customId ?? \`T-${task.taskNumber}\`` — so for any task without a `custom_id`,
the identifier a user reads on screen is `T-8`, and that is what they will type.

```
target task given custom_id = "BB-4242":
  "see #BB-4242"  -> +1 comment_referenced on the target   works
  "see #bb-4242"  -> +1                                    case-insensitive
  "see #BB-9999"  -> +0                                    unknown ref, no error
  "see #T-8"      -> +0   *** the form the UI displays resolves to nothing ***

tasks in this database with custom_id = NULL: 49 of 53
```

- **Expected:** typing the reference shown in the UI links the two tasks.
- **Actual:** it produces a styled pill (`MentionRenderer` renders any `#X-1` token as one) that
  points nowhere, and the referenced task's activity feed records nothing.
- **Impact:** cross-referencing works only for the handful of tasks someone has manually given a
  `custom_id`. For every other task the feature looks like it worked and did not.
- **Evidence:** `testing/evidence/PHASE-21/task-refs-and-edit-window.txt`
- **Status:** **FIXED in F25** (2026-08-06). `#T-<n>` resolves now, scoped precisely:
  `task_number` is unique PER LIST, not per workspace (thirteen tasks in this workspace are
  "T-1"), so the reference resolves inside the HOST TASK'S LIST — where the number is unique by
  construction and where the reference almost always means a sibling on the same board. A
  `T-<n>` from another list stays unresolved rather than guessing between thirteen candidates.
  `#CUSTOM-ID` is tried first and is unchanged. **Verified:**
  `fixing/evidence/F25/f25-probe.txt` — a same-list `#T-<n>` produces the
  `comment_referenced` row, a foreign-list one does not, and `#CUSTOM-ID` still works.
- **Notes:** The resolution logic itself is sound — case-insensitive, deduped, a self-reference is
  correctly skipped, an unknown ref is ignored rather than erroring. It just is not fed the
  identifier the product displays. Either resolve `T-<task_number>` server-side, or stop showing that
  form. Related to ISS-061: both are the client and the server disagreeing about a vocabulary.

---

### ISS-067 · [P22] MEDIUM · `PATCH /checklist-items/:id` answers 200 to fields it silently ignores

- **Severity:** MEDIUM
- **Type:** BUG (API contract)
- **Phase:** P22 — Checklists
- **Area:** `server/src/controllers/ChecklistsController.updateItem` /
  `validators/checklists.ts` — the update validator declares `text`, `assignee_id` and `position`
  and the handler picks only those, but nothing rejects the rest

```
PATCH /checklist-items/:id
  {"is_completed": true}                 -> 200   row unchanged: is_completed = 0
  {"due_date": "2026-09-01"}             -> 200   ignored (no such column)
  {"completed_by": "u-x"}                -> 200   ignored
  {"checklist_id": "ch-other"}           -> 200   ignored (correctly protected)
  {"is_completed": true, "bogus": 1}     -> 200   ignored
  {"position": 99}                       -> 200   applied
```

Every one of those answers 200 with a serialized item, so a caller cannot tell an applied write from
a discarded one.

- **Expected:** either apply the field, or refuse it — the behaviour `PATCH /tasks/:id` already has,
  where an unknown or protected key is a 422 (verified in P15 §2).
- **Actual:** five of six probes were accepted and discarded.
- **Impact:** `is_completed` is the field most likely to be sent by a new client, an integration, or
  the AI assistant — it is the obvious way to tick a box, it returns success, and nothing happens.
  The real path is `POST /checklist-items/:id/toggle`.
- **Evidence:** `testing/evidence/PHASE-22/item-state-and-nesting.txt`
- **Status:** **FIXED in F23** (2026-08-06). `PATCH /checklist-items/:id` is a CLOSED
  set (`text`, `assignee_id`, `position`): `is_completed` → 422 pointing at
  `POST /checklist-items/:id/toggle` (it was the field most likely to be sent by a new client or
  the AI assistant — accepted, ignored, reported as success), any other unknown field → 422 naming
  the accepted set, and the DB row proves nothing is silently set. A legitimate PATCH still works.
  **Verified:** `fixing/evidence/F23/f23-probe.txt`.
- **Notes:** **The shipped client is not affected** — `checklistsApi.updateItem` is typed
  `{text?, assigneeId?, position?}` and the checkbox correctly calls `toggleItem`. This is a contract
  defect waiting for the second consumer. The toggle path itself is exemplary: it sets
  `is_completed`, `completed_at` and `completed_by` together, and clears all three on un-toggle.

---

### ISS-068 · [P22] MEDIUM · Bulk item add has no upper bound — 5 000 items in one request

- **Severity:** MEDIUM
- **Type:** BUG (missing bound / abuse surface)
- **Phase:** P22
- **Area:** `bulkAddItemsValidator` (`server/src/validators/checklists.ts`) — `texts` is
  `isArray({min: 1})` with **no `max`**

```
POST /checklists/:id/items/bulk  {"texts": [ …500 strings… ]}   -> 201
POST /checklists/:id/items/bulk  {"texts": [ …5000 strings… ]}  -> 201
  -> 5 011 items on a single checklist, in one transaction
```

For comparison, the equivalent task endpoint is bounded: `bulkTasksValidator` uses
`isArray({min: 1, max: 200})` and the message even says so ("ids must be an array of 1–200 task ids").

- **Expected:** the same kind of cap as every other bulk endpoint in the codebase.
- **Actual:** unbounded. One request writes as many rows as the payload carries, and the resulting
  checklist is loaded in full by `GET /tasks/:id/checklists` (items are embedded, not paginated), so
  every subsequent read of that task pays for it.
- **Impact:** any authenticated account — including a guest, since `checklist.manage` is unenforced
  (ISS-024) — can make a task permanently slow to open.
- **Evidence:** `testing/evidence/PHASE-22/checklists.txt` (§4) · `item-state-and-nesting.txt`
- **UPDATE (P27):** the same unbounded surface exists through templates — `POST /templates` accepted a
  structure carrying **2 000 checklist items** (201), and applying it would materialise all of them in
  one transaction. Bound both entry points together.
- **Status:** **FIXED in F29** (2026-08-06). Both entry points capped at 200 together: `bulkAddItemsValidator` (copying `bulkTasksValidator`) and templates `structure.checklistItems`.
- **Notes:** Validation of the *contents* is correct — an empty array, a non-array, a missing key and
  one empty string among valid ones are all 422, and the batch is atomic (nothing is written when one
  entry is invalid). Only the size is unchecked.

---

### ISS-069 · [P22] LOW · Checklist items nest to any depth on the server; the client renders one flat level and cannot create a sub-item

- **Severity:** LOW
- **Type:** BUG (two halves disagree)
- **Phase:** P22
- **Area:** `ChecklistsService.assertParentInChecklist` (validates *which* checklist, not depth) ·
  `client/src/components/task/ChecklistsSection.tsx` (no `parentItemId` anywhere)

```
item -> sub-item -> sub-sub-item -> … accepted to 8 levels, no limit reached
GET /tasks/:id/checklists  -> items arrive as a FLAT array carrying parent_item_id;
                              no nested children array is built
client                     -> renders the flat array as siblings; never reads parent_item_id;
                              offers no "add sub-item" control
```

Tasks, by contrast, cap nesting at 2 with a DB check constraint and a `task.nesting_too_deep` error.

- **Impact:** small today, because nothing in the UI can create a sub-item. It matters the moment
  something else does — the template apply path, an import, or the assistant — since those items
  would render as an undifferentiated flat list with their hierarchy invisible.
- **Evidence:** `testing/evidence/PHASE-22/item-state-and-nesting.txt`
- **Status:** **FIXED in F25** (2026-08-06). The client builds the TREE from the flat
  array's `parent_item_id` (order preserved — the server sorts by `position`), indents each
  level with a cap so a deep tree stays readable, and every item has an **add sub-item** control;
  the api wrapper forwards `parent_item_id`, which the server has always accepted.
  **Verified:** `fixing/evidence/F25/f25-probe.txt`.
- **Notes:** The parent validation that *does* exist is correct: a parent in another checklist and an
  unknown parent are both 422 `checklist_item.invalid_parent`, and deleting a parent item cascades to
  its children.

---

### ISS-070 · [P22] GAP · Checklist items have no due date

- **Severity:** GAP
- **Type:** MISSING CAPABILITY — decision needed
- **Phase:** P22
- **Area:** `checklist_items` — columns are `id, checklist_id, parent_item_id, text, is_completed,
  completed_at, completed_by, assignee_id, position, created_at`

An item can be **assigned to a person** (and that is validated properly — an unknown id and an
`invited`-status user are both 422 `checklist_item.invalid_assignee`), but it cannot be given a date.
There is no column, no validator field, and no UI control.

Sending one is accepted and dropped:

```
PATCH /checklist-items/:id {"due_date":"2026-09-01"}  -> 200, nothing stored
```

- **Why it is a decision, not a bug:** nothing in the shipped product references a per-item date. The
  test plan expected one because assigning an item to a person without a date leaves "who" answered
  and "by when" unanswerable — which is the coordination question this whole system exists to answer.
- **Impact if left:** a department head can assign the third item of a checklist to someone with no
  way to say when it is needed, and it will never appear in that person's My Work, Agenda, or
  overdue KPI (all of which read `tasks.due_date`).
- **Evidence:** `testing/evidence/PHASE-22/item-state-and-nesting.txt` · the schema dump above
- **Status:** **FIXED in F28** (2026-08-06, D12.3). The assignee got its UI (ChecklistsSection picker, active members only); the DATE half REFUSED — a second deadline system nothing reads; a subtask is "who, by when".
- **Notes:** The 200-with-no-effect part is ISS-067; this entry is only about the missing capability.

---

### ISS-071 · [P23] MEDIUM · A long filename crashes the proxied upload with a raw 500 — the presign path validates the same field correctly

- **Severity:** MEDIUM
- **Type:** BUG (unhandled error on user input)
- **Phase:** P23 — Attachments
- **Area:** `server/src/controllers/AttachmentsController.upload:76-86` — `X-Filename` is decoded and
  passed straight to the insert with no length check; `attachments.name` is `varchar(255)`

```
POST /tasks/:id/attachments   X-Filename: <300 chars>.png     -> 500 internal
POST /tasks/:id/attachments   X-Filename: <244 chars>.png     -> 201
POST /uploads/sign            {"filename": "<300 chars>.png"} -> 422 validation.failed
```

The presign validator already has the rule — `filename … isLength({max: 255})`, *"filename is too
long (max 255 chars)"*. The proxied path, which is the one the shipped client actually uses, has no
equivalent, so MySQL raises *Data too long for column 'name'* and it surfaces as an unhandled 500.

- **Expected:** 422, the same as the sign path.
- **Actual:** 500 `internal`, with a stack trace in the server log and no useful message to the user.
- **Impact:** reachable by any member with a long filename — camera, scanner and
  "Save page as…" names routinely exceed 255 characters. The upload fails with an unexplained server
  error.
- **Evidence:** `testing/evidence/PHASE-23/attachments.txt` (§2) ·
  `presign-and-download.txt` (the sign path's 422 for the identical input)
- **Status:** **FIXED in F18** (2026-08-06). The proxied upload path (the one the shipped
  client uses) now applies the presign path's 255-char rule to `X-Filename`, counted AFTER
  URI-decoding (which is what is stored) — 422 naming the header, instead of MySQL's "Data too long"
  as a raw 500. **Verified:** 300 chars -> 422; 244 chars -> 201 unchanged
  (`fixing/evidence/F18/f18-probe.txt`).
- **Notes:** Same class as the gap-scan M5 fix already in that function (a malformed `%` in
  `X-Filename` used to 500 and is now caught) — the decode was hardened, the length was not. Path
  traversal in the filename is **not** a vulnerability here: `storage_key` is generated server-side as
  `workspaces/<ws>/attachments/<att-id>.<ext>` and never derives from the filename, so
  `../../../etc/passwd.png` is stored purely as a display label.

---

### ISS-072 · [P24] MEDIUM · Seven of the twelve notification types have no producer — `SCAN-M3` named two of them

- **Severity:** MEDIUM
- **Type:** GAP-shaped BUG (declared surface with no implementation)
- **Phase:** P24 — Notifications
- **Area:** the `notifications.type` ENUM (12 values) vs the **six** insert sites in `server/src`

Every `notifications.createMany` call in the codebase was located and read. There are exactly six,
producing exactly **five** distinct types:

| type | producer | |
|---|---|---|
| `assigned` | `TaskMembershipService:173`, `TaskWriteService:555` | ✔ |
| `mentioned` | `CommentsService:126` | ✔ |
| `form_submitted` | `FormsService:777` | ✔ |
| `task_reviewed` | `ReviewsService:297` | ✔ |
| `report_ready` | `ReportsService:184` | ✔ |
| `comment` | — | **none** (ISS-064) |
| `status_change` | — | **none** |
| `due_soon` | — | none (`SCAN-M3`) |
| `overdue` | — | none (`SCAN-M3`) |
| `automation_failed` | — | **none** |
| `pr_review` | — | **none** |
| `incident_alert` | — | **none** |

All twelve appear in `GET /notifications/preferences` and in the settings UI, so a user can carefully
configure delivery for seven events that can never happen.

- **Expected:** `SCAN-M3` describes two unproducible types.
- **Actual:** seven. The three beyond `comment`, `due_soon` and `overdue` are new to this phase:
  `status_change` (the most-expected one after assignment — moving a task to Done tells nobody),
  `pr_review` and `incident_alert` (the Engineering-space features), and `automation_failed`.
- **Verified by execution, not just by grep:** a task was assigned, `@mentioned`, plainly commented
  on, and moved to Done in one run. The assignee received exactly two notifications — `assigned` and
  `mentioned`. The status change produced nothing.
- **Evidence:** `testing/evidence/PHASE-24/notifications.txt` (§1)
- **Status:** **FIXED in F19** (2026-08-06), per decisions D6–D8 (`fixing/DECISIONS.md`).
  **Build 2, remove 5:** `comment` + `status_change` have REAL producers now; `due_soon`,
  `overdue`, `automation_failed`, `pr_review`, `incident_alert` left the enum (12 → 7, both
  type columns, `upgrades/009` — rows of removed types deleted first, idempotent 9/9 twice).
  **Preferences finally govern delivery:** enforcement lives at the ONE chokepoint every producer
  flows through (`NotificationsRepo.createMany` drops recipients whose pref for that type is
  off), proven live: toggle `comment` off → nothing arrives; on → it flows.
  **The email channel is GONE (D8):** `email_enabled` dropped from the column, repo, controller,
  serializer, validator (a body carrying it gets a 422 that says why) and the client's typed api —
  MailService sends exactly two transactional mails and a per-type channel is a feature, not a fix.
  **All seven surviving types produced live** in `fixing/evidence/F19/f19-probe.txt` (23/23),
  including `report_ready` via the real weekly job. Also closes SCAN-M1's "preferences govern
  nothing" half; SCAN-M2's "no email is ever sent" is now the DOCUMENTED contract instead of a
  silent lie.
- **Notes:** Supersedes the *count* in `SCAN-M3`, not the finding. Worth deciding as one piece of
  work with ISS-064: the notification system has five working producers and a settings screen that
  advertises twelve.

---

### ISS-073 · [P24] MEDIUM · Hard-deleting a task leaves its notifications in every recipient's inbox, pointing at nothing

- **Severity:** MEDIUM
- **Type:** DATA (orphan rows)
- **Phase:** P24
- **Area:** `notifications.entity_id` is polymorphic — the only foreign keys on the table are
  `user_id` and `actor_id` (confirmed against `information_schema`)

```
assign a task to arif           -> notification row created
DELETE /tasks/:id?hard=true     -> 204
notification rows for that task -> 1, still there
arif's feed                     -> still lists "You were assigned to TEST-p24-orphan"
```

The row survives with a live `entity_id` pointing at a task that no longer exists. Opening it from
the inbox navigates to a 404.

- **Expected:** the notification goes with the entity, the way `task_activity`, `comments`,
  `checklists` and `attachments` all do (every one of those cascades — verified in P16 and P22).
- **Actual:** notifications are the one child table with no FK, so nothing cleans them up. There is
  no janitor job for them either (the six jobs are snooze-wake, session-cleanup, attachment-janitor,
  r2-purge, form-submission-expiry, department-report).
- **Impact:** the inbox accumulates dead entries permanently. This was found the hard way — **13
  orphaned rows** had already built up in the dev database from earlier test phases' fixtures before
  anyone looked (P21 §8).
- **Evidence:** `testing/evidence/PHASE-24/notifications.txt` (§9) · `testing/evidence/PHASE-37/integrity.txt` (§4)
- **REPRODUCED (P37):** the full 24-query orphan sweep across the schema came back clean on **23 of 24**
  relationships. The single failure was this one — a task hard-deleted during P37's own cascade test
  left its `assigned` notification behind. Every other child table cascades correctly; `notifications`
  is the only one that does not.
- **Status:** **FIXED in F16** (2026-08-06). `NotificationsRepo.deleteByEntity("task",
  subtree)` now runs INSIDE the hard-delete transaction — the whole subtree, because the FK cascade
  takes descendants too and their notifications have no FK to follow either. `entity_id` stays
  polymorphic (an FK remains impossible); the delete is app-side, exactly where the issue's
  "per-entity-type cascade" option points. `upgrades/007_orphans_and_cascades.sql` additionally
  sweeps any orphans that pre-date the fix (idempotent).
  **Verified:** `fixing/evidence/F16/f16-probe.txt` — parent + child each notified, hard-delete the
  parent -> notifications for BOTH gone; and P37's full 24-query orphan sweep re-run comes back
  **24 of 24 clean** (P37 scored 23 of 24 — this was the one).
- **Notes:** Soft-deleting a task is fine — the task still exists, so the link still works. Only the
  hard delete strands them, which is admin-only but is also exactly what happens when someone cleans
  up. A cascade needs either a real FK per entity type or a sweep in the janitor job.

---

### ISS-074 · [P25] MEDIUM · Search never looks at a task's description — but it does search comments

- **Severity:** MEDIUM
- **Type:** BUG (incomplete implementation)
- **Phase:** P25 — Search
- **Area:** `server/src/repositories/SearchRepo.ts:87` —
  `or(like(tasks.name, pattern), eq(tasks.customId, q))`

```
task A: name "TEST-p25 ZQXJV needle"                       -> found
task B: name "TEST-p25 plainname",
        description "ZQXJV hidden in the description"      -> NOT found
comment on task A: "…with ZQXJV inside"                    -> found
```

The task predicate covers `name` and an exact `custom_id`. `description` is not in it, although the
column is selected and returned in the result payload.

- **Expected:** the body of a task is findable — it is where the actual content of the work lives.
- **Actual:** only the title is. A three-line task title is searchable; a 500-word brief underneath it
  is not, while a one-line comment on the same task is.
- **Impact:** for the ops teams this system was built for, the description is where the order number,
  the customer name and the SKU get written. None of it is reachable from search or from `⌘K`.
- **Evidence:** `testing/evidence/PHASE-25/search.txt` (§1)
- **Status:** **FIXED in F20** (2026-08-06). `tasks.description` joined the search
  predicate (comments were already searched — the gap was an inconsistency, not policy).
  **Verified:** the P25-shaped description-only fixture is found; `SKU-8841` buried in a
  description resolves. `fixing/evidence/F20/f20-probe.txt`.
- **Notes:** `lists.description` is likewise excluded (the list predicate is name-only), while
  `comments.body` **is** searched — so the pattern is not a deliberate "titles only" policy, it is a
  gap. Related to ISS-075: both would be addressed by the same rewrite of the task predicate.

---

### ISS-075 · [P25] MEDIUM · Search results are ordered oldest-first, not by relevance

- **Severity:** MEDIUM
- **Type:** BUG (UX / wrong ordering)
- **Phase:** P25
- **Area:** `SearchRepo` — every entity query ends `.orderBy(asc(tasks.internalId))` (and the
  equivalent for lists / spaces / users / comments)

There is no scoring anywhere: the search is `LIKE '%q%'` (confirmed — the database has **zero**
FULLTEXT indexes and no `MATCH … AGAINST` exists in the codebase), and results come back in
insertion order.

```
q=TEST-p25 -> 6 tasks, returned in exactly internal_id ASC order
```

So an exact title match created last year ranks above a task named exactly the query created today,
and there is no way for a prefix match to outrank a mid-word one.

- **Expected:** the closest match first — at minimum exact title, then prefix, then substring.
- **Actual:** the oldest row that happens to contain the substring.
- **Impact:** with 51 tasks it is barely noticeable. At the few-thousand-task scale this workspace
  will reach in a year, `limit` (default 20, max 50) will be filled entirely by the oldest matches
  and the task the user is looking for will usually not be on the page at all.
- **Evidence:** `testing/evidence/PHASE-25/search.txt` (§6)
- **Status:** **FIXED in F20** (2026-08-06), per D9 (better LIKE, no FULLTEXT). Tasks:
  exact `custom_id` → exact name → name prefix → name substring (a name match outranks a
  description-only match) → newest first. Users: prefix-first + alphabetical. Lists/spaces/comments
  had already moved to name/recency order. **Verified:** the exact-name match is FIRST, name@2 >
  description@3, `ORD-1042` floats to the top; latency p50 32 ms over 10 requests (the old figure
  was 125 ms — no regression from the ORDER BY). `fixing/evidence/F20/f20-probe.txt`.
- **Notes:** Two cheap improvements short of real FULLTEXT: order by `name = q` desc, then
  `name LIKE 'q%'` desc, then recency; and raise exact `custom_id` hits to the top (that lookup
  already exists and works case-insensitively).

---

### ISS-076 · [P25] LOW · `%` and `_` typed into search are treated as wildcards, and one character is enough to scan every table

- **Severity:** LOW
- **Type:** BUG (unescaped metacharacters) + a performance note
- **Phase:** P25
- **Area:** `SearchRepo` builds `pattern = '%' + q + '%'` without escaping LIKE metacharacters ·
  `validators/search.ts` sets no minimum length on `q`

```
q="%"                     -> 3 tasks           (a lone wildcard matches rows)
q="_"                     -> 0
q="100%"                  -> 0                 (the trailing % becomes a wildcard)
q="TEST_p25 ZQXJV needle" -> 0                 (_ silently means "any character")
q="Z"                     -> 6 tasks           (one character, LIKE '%Z%' across 5 tables)
```

- **Impact:** small but real — "50%", "100%", and any `snake_case` identifier a developer pastes in
  behave differently from what was typed. Nothing is exploitable: every query is parameterised, and
  seven injection-shaped inputs (`' OR 1=1 --`, `"; DROP TABLE tasks; --`, `a' UNION SELECT …`) all
  returned a clean empty result with the `tasks` table intact.
- **The performance half:** `q` has no minimum length, so a single keystroke issues five
  `LIKE '%x%'` scans — none of which can use an index. Worth measuring under load in **P40**.
- **Evidence:** `testing/evidence/PHASE-25/search.txt` (§2, §3, §5)
- **Status:** **FIXED in F20** (2026-08-06). `escapeLike` already existed (it arrived
  with RBAC P18); the missing halves were the validator minimum — `q` is now 2–200 chars, so one
  keystroke no longer runs five un-indexable scans — and the ordering (ISS-075). **Verified:**
  `"100%"` matches the literal task, `snake_case_name` matches literally, a lone `%` and a
  single char are 422, two chars still work. `fixing/evidence/F20/f20-probe.txt`.
- **Notes:** `?types=bogus` is also swallowed silently (200 with all-zero counts rather than a 422) —
  same class of quiet-wrong-answer, folded in here rather than filed separately.

---

### ISS-077 · [P26] MEDIUM · The API generates a `public_slug` that its own validator rejects

- **Severity:** MEDIUM
- **Type:** BUG (contract self-contradiction)
- **Phase:** P26 — Forms
- **Area:** `FormsService:298` — `` `${slugify(input.title)}-${randomToken(6)}` `` ·
  `validators/forms.ts:19` — `const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`

`slugify()` correctly lowercases the title, and then a **mixed-case** random token is appended:

```
POST /forms {title: "TEST-p26b Intake"}
  -> 201  public_slug: "test-p26b-intake-CHr0adgY"
PATCH /forms/:id {public_slug: "test-p26b-intake-CHr0adgY"}   (its own value, unchanged)
  -> 422 validation.failed
```

The slug is valid as *data* — the form works, the public page resolves — but it can never be written
back. `SLUG_RE` allows lowercase only.

- **Expected:** an object read from the API can be written back unchanged.
- **Actual:** any client that does read → modify one field → send the whole object gets a 422 on a
  field it never touched. Renaming a form through such a client is impossible.
- **Evidence:** `testing/evidence/PHASE-26/forms-part2.txt` (§1)
- **Status:** **FIXED in F18** (2026-08-06). The issue's own one-character fix:
  `randomToken(6).toLowerCase()` in `FormsService`. Generated slugs now match the API's own
  `SLUG_RE`, and a form can be written back unchanged. **Verified:** generated slug matches the
  regex; PATCH with its own slug -> 200 (was 422). `fixing/evidence/F18/f18-probe.txt`.
- **Notes:** Everything else about slugs is correct: two forms with the same title get distinct slugs,
  an explicitly reused slug is a clean **409 `form.slug_taken`**, and uppercase / spaces / a trailing
  hyphen in an explicit slug are all 422. The fix is one character — lowercase the random token — or
  widen `SLUG_RE` to accept it.

---

### ISS-078 · [P26] MEDIUM · Field reorder accepts a partial list and duplicate positions, leaving two fields at position 0

- **Severity:** MEDIUM
- **Type:** BUG (data integrity)
- **Phase:** P26
- **Area:** `PATCH /forms/:id/fields/reorder` — the validator checks each `{id, position}` item, and
  the service checks each id belongs to the form, but nothing checks the set is complete or the
  positions are distinct

```
fields: name:0, description:1, priority:2

full reorder, reversed         -> 200   priority:0, description:1, name:2      correct
send ONE item {name, pos 0}    -> 200   name:0, priority:0, description:1      *** two fields at 0 ***
send ALL items, all position 0 -> 200   every field at position 0
a field id from another form   -> 422 form_field.not_in_form                   correct
```

- **Expected:** either every field is repositioned as a set, or the request is refused.
- **Actual:** a partial or duplicate-valued payload is accepted and the form's field order becomes
  ambiguous — `ORDER BY position` then returns those fields in arbitrary order, so the public form
  can render its questions in a different sequence on different requests.
- **Impact:** the public form is the workspace's intake surface. Question order matters to whoever
  fills it in, and there is no way to notice the corruption from the API — the reorder said 200.
- **Evidence:** `testing/evidence/PHASE-26/forms-part2.txt` (§2)
- **Status:** **FIXED in F18** (2026-08-06). Same rule as ISS-037, on the form-field
  reorder: complete set + distinct positions, else 422 — so `ORDER BY position` can never again be
  ambiguous and the PUBLIC form's question order is stable across requests. **Verified:** one item
  of three -> 422 (was 200 with two fields at position 0); duplicate positions -> 422; a full
  reversed reorder -> 200 with positions verified DISTINCT in the DB.
  `fixing/evidence/F18/f18-probe.txt`.
- **Notes:** The ownership check is right and the happy path works. What is missing is a
  completeness + uniqueness check on the submitted set.

---

### ISS-079 · [P26] MEDIUM · `?dry_run` only recognises the exact string `true` — every other value silently runs the destructive job for real

- **Severity:** MEDIUM
- **Type:** BUG (a safety control that silently disengages)
- **Phase:** P26
- **Area:** `server/src/controllers/JobsController.ts:16` —
  `const dryRun = req.query.dry_run === "true";`

```
POST /jobs/form-submission-expiry?dry_run=true
  -> {"ok":true,"dry_run":true,"processed":1,"wouldDelete":1}    rows unchanged   correct
POST /jobs/form-submission-expiry?dry_run=1
  -> {"ok":true,"dry_run":false,"processed":1,"deleted":1}       *** the row is gone ***
```

`?dry_run=1`, `?dry_run=yes`, `?dry_run=TRUE` and a bare `?dry_run` all evaluate to **false** and
execute the job.

- **Expected:** a safety flag either engages or is rejected. Anything else on an endpoint whose
  purpose is deletion is a footgun.
- **Actual:** the flag silently means "no" unless spelled exactly.
- **Impact:** three of the six jobs delete data (`form-submission-expiry` deletes PII rows,
  `r2-purge` deletes objects from storage, `session-cleanup` deletes sessions). An operator
  verifying a job by hand — which the runbook explicitly encourages — who types `?dry_run=1` destroys
  data instead of previewing it.
- **Not currently exploited:** `deploy/cron/run-job.sh:30` sends `?dry_run=true` and
  `API_DESIGN.md:1275` documents `?dry_run=true`, so the shipped path is correct. **This was found by
  the tester typing `?dry_run=1`, and it deleted a real submission row.**
- **Evidence:** `testing/evidence/PHASE-26/forms-part3.txt` (§5 — both forms, side by side)
- **Status:** **FIXED in F14** (2026-08-05). `JobsController` now parses `?dry_run`
  the way a person means it, and DELIBERATELY ASYMMETRICALLY, because a safety control must never
  disengage silently: `true/1/yes/y/on` and a **bare** `?dry_run` all mean dry run;
  `false/0/no/n/off` and absent mean a real run; anything else is a **422**, not a guess.
  The handler gained a `next` parameter to deliver that 422 — Express 4 does not catch an async
  throw, so leaving it to bubble would have replaced this silent failure with a crash.
  **Verified:** a 10-row table in `fixing/evidence/F14/f14-probe.txt` — every truthy spelling
  now reports `dry_run:true`, and `?dry_run=maybe` is 422 with a message naming the field.
  Gate: jobs 32/32.
- **Notes:** The response body is honest (`"dry_run": false`), which is the one thing that makes the
  mistake noticeable afterwards. Reject an unparseable value with a 422 instead, or accept the usual
  truthy set.

---

### ISS-080 · [P26] LOW · `forms.submission_count` never comes back down when the retention job deletes rows

- **Severity:** LOW
- **Type:** DATA
- **Phase:** P26
- **Area:** the `submission_count` trigger on `form_submissions` INSERT vs
  `jobs/formSubmissionExpiry.ts`, which deletes rows directly

```
6 submissions -> submission_count 6          correct
the retention job deletes 1 -> rows 5, submission_count 6   *** drifted ***
```

- **Impact:** small — the number is informational. But it drifts permanently upward, and after 90
  days of real intake every form's count is wrong by however many submissions have aged out.
- **Evidence:** `testing/evidence/PHASE-26/forms-part3.txt` (§5)
- **Status:** **FIXED in F15** (2026-08-05). New
  `trg_form_submissions_after_delete` decrements `forms.submission_count`; backfilled in
  `database/upgrades/006_counters.sql` (+ `schema.sql`, rule X4).
  **Verified against the REAL retention job**, not a hand DELETE: age a submission past retention,
  `POST /jobs/form-submission-expiry`, and the count follows the rows 3 -> 2
  (`fixing/evidence/F15/f15-probe.txt`).
- **Notes:** Third instance of the same pattern: `comments_count` (ISS-065) counts inserts and misses
  soft deletes, `subtasks_count` (ISS-046) is never maintained at all, and this one misses job
  deletions. `attachments_count` is the one that gets it right — an AFTER UPDATE trigger that moves
  in both directions (P23 §5) — and is the model to copy.

---

### ISS-081 · [P30] HIGH · Every SLA deadline is stored 6 hours short, so an S0 bug is already breached when it is filed — and the breach report is a further 6 hours late

- **Severity:** HIGH
- **Type:** DATA / BUG — the compound consequence of ISS-001 on the SLA feature
- **Phase:** P30 — SLA
- **Area:** `TaskWriteService.computeSlaDueAt:55-75` (writes a JS `Date` through Drizzle) ·
  `SlaRepo.ts:95` (`TIMESTAMPDIFF(MINUTE, sla_due_at, UTC_TIMESTAMP())`) ·
  `database/schema.sql` `v_breached_sla` (uses `NOW()`)

This is `SCAN-H2` measured to the minute, and it turns out to be **two** errors that compound rather
than the one the scan described.

**(a) The deadline is written six hours early.** `computeSlaDueAt` intends S0 = +2 h, S1 = +24 h,
S2 = +7 days. Drizzle serialises the `Date` as UTC while the MySQL session is `+06:00`, so every
value lands 360 minutes short:

```
severity   stored      intended    shortfall
S0         -240 min    +120 min    360 min   *** ALREADY BREACHED AT CREATION ***
S1        +1080 min   +1440 min    360 min
S2        +9720 min  +10080 min    360 min
```

An **S0 is the highest severity the product has** — a production outage. Its deadline is written
four hours in the past, so it is breached before anyone opens it.

**(b) The breach report is six hours behind that.** `GET /sla/breached` measures against
`UTC_TIMESTAMP()`, which is 6 h behind the frame the deadlines were written in. Swept minute by
minute against one task:

```
1h late   -> not listed
3h late   -> not listed
5h late   -> not listed
6h late   -> not listed
6.5h late -> LISTED, minutes_breached =   30   (truth 390 — under-reported by 360)
7h late   -> LISTED, minutes_breached =   60   (truth 420 — under-reported by 360)
12h late  -> LISTED, minutes_breached =  360   (truth 720 — under-reported by 360)
24h late  -> LISTED, minutes_breached = 1080   (truth 1440 — under-reported by 360)
```

`minutes_breached` is wrong by exactly 360 every time.

**(c) The two SLA surfaces disagree with each other.** `v_breached_sla` uses `NOW()` and listed the
same task at **every** step from 1 hour late, while the endpoint listed nothing until 6.5 hours. For
a six-hour window, the view and the API give opposite answers about the same task.

- **Expected:** an S0 filed at 09:00 is breached at 11:00 and appears in the breach report at 11:00
  with `minutes_breached` counting up from 0.
- **Actual:** it is marked breached at 09:00 (four hours before its real deadline) in the view, does
  not appear in the API report until 15:00, and then under-reports how late it is by six hours.
- **Impact:** SLA is the engineering team's escalation mechanism. Right now it fires on the wrong
  tasks, at the wrong time, with the wrong number, and two parts of the system disagree about which
  tasks are affected.
- **Evidence:** `testing/evidence/PHASE-30/sla.txt` (§1, §2) · `breach-sweep.txt` (the full sweep and
  the stored-vs-intended table)
- **Status:** **FIXED in F3** (2026-08-03), **re-verified in F4** (2026-08-04) — the full P30 sweep
  replayed on the fixed clock: all severities land at intent (S0 +120), all ten breach offsets exact
  with endpoint==view, an override round-trips byte-exactly, in BOTH TZ frames
  (`fixing/evidence/F04/f4-sla-sweep.txt` + `-utc.txt`, 47/47, exit 0). This also closes SCAN-H2
  (the detection half). Original F3 proof — all three parts. The SLA deadline is stored at
  +120 min for an S0 and a 60-min-late task reports `minutes_breached=60`; `/sla/breached` and
  `v_breached_sla` now agree. Root cause was ISS-001, not the SLA code. Proof:
  `fixing/evidence/F03/issue-verification.txt`, `fixing/results/F03.md`.
- **Notes:** Filed separately from ISS-001 for the same reason ISS-052 and ISS-063 were: this is a
  distinct, independently visible defect with its own repro and its own fix. Fixing ISS-001 fixes
  part (a) and part (c). Part (b) closes on its own by swapping `UTC_TIMESTAMP()` for `NOW()` in
  `SlaRepo.ts:95`, which also makes the endpoint and the view agree. Supersedes the *scope* of
  `SCAN-H2`, which described only part (b).

---

### ISS-082 · [P30] LOW · There is no SLA surface in the product beyond a badge — `GET /sla/breached` has no caller

- **Severity:** LOW
- **Type:** GAP-shaped (dead API surface) — confirms `SCAN-L4`
- **Phase:** P30
- **Area:** `client/src` — the only SLA references are `components/task/SLABadge.tsx` and the dead
  `lib/mock-api.ts`

`SLABadge` **is** mounted (`TaskDetailDrawer.tsx:33,419`), so a task's own deadline is visible on its
drawer. But `GET /sla/breached` — the endpoint that answers "what is currently blowing its SLA?" —
has **zero callers**. There is no SLA page, no breach list, and nothing on Home (the `slaBreaches`
KPI is computed separately from `tasks.sla_due_at`, not from this endpoint).

- **Impact:** the escalation feature exists only as a per-task label. Nobody can see the queue it was
  built to produce without calling the API by hand.
- **Evidence:** `testing/evidence/PHASE-30/sla.txt` (§8)
- **Status:** **FIXED in F28** (2026-08-06, D12.4). The `/sla` queue page exists (sidebar + Home KPI link there); sequenced after the F3/F4 clock fix exactly as this issue asked.
- **Notes:** Worth sequencing **after** ISS-081 — building a UI on top of a report that is six hours
  wrong would make the error more visible, not less. Confirms `SCAN-L4`; recorded here with the extra
  detail that the badge half does ship.

---

### ISS-083 · [P38] HIGH · The password policy is length-only — "password", "12345678" and "aaaaaaaa" are all accepted

- **Severity:** HIGH
- **Type:** SECURITY (authentication strength)
- **Phase:** P38 — Security & abuse
- **Area:** `server/src/validators/auth.ts:81-83` — the entire rule for `new_password` is
  `isLength({ min: 8, max: 200 })`. There is no `matches`, no complexity check, no denylist.

Every one of these was **accepted** by `POST /auth/change-password` (204):

| new password | why it should be refused |
|---|---|
| `alllowercase` | 12 letters, no digit, no uppercase, no symbol |
| `1234567890` | ten sequential digits |
| `PASSWORD` | a dictionary word |
| `aaaaaaaa` | one character repeated |
| `password` | **the single most common password in the world** |

Only `short` (5 characters) was refused, and only for length.

- **Expected:** for a system holding a company's HR reviews, salary-adjacent task descriptions and
  encrypted customer PII, a password rule beyond "eight of anything".
- **Actual:** any eight characters.
- **Impact:** ~100 staff accounts, all currently seeded with the same password, on a system reachable
  from the public internet at `tasks.beautybooth.com.bd`. The login limiter (5/min) slows online
  guessing but does nothing about a user simply choosing `password`.
- **Evidence:** `testing/evidence/PHASE-38/verify-ambiguous.txt` (§5)
- **Status:** **FIXED in F12** (2026-08-05). One shared policy module,
  `validators/passwordPolicy.ts`, now used by all three password-setting endpoints (reset,
  change, accept-invitation) — they previously carried three copies of the one length rule.
  Refuses, in order: length 8-200 (counted in CODE POINTS), one repeated character, a straight
  run off the alphabet/keyboard, a common-password DENYLIST matched on a normalised form
  (lowercased, and again with trailing digits/punctuation stripped, so `Password1!` and
  `password123` are caught with `password`), and finally at least 3 of {lower, upper, digit,
  other}. All five of this issue's accepted examples are refused, each with an actionable reason.
  **Two deliberate exemptions from the CLASS rule**, both because NIST SP 800-63B says composition
  rules mostly produce `Password1!`: a 16+ character passphrase, and **any non-ASCII password**.
  The second was a REAL DEFECT in the first cut, caught by this repo's own test — the class check
  was ASCII-only, so `পাসওয়ার্ড🔥1` was refused while `Abcd123!` passed, which in a
  Bangladeshi company quietly pushes people off their own script onto weaker ASCII.
  **Minimum stayed 8** (raising it would break ~24 fixtures for no gain the rules above do not
  already deliver); bcrypt cost 10 and the no-trim rule are untouched, as this issue asks.
  **Verified:** a 24-row decision table (`fixing/evidence/F12/policy-cases.txt`) covering the five,
  seven more of the same class, and twelve that must NOT be refused including every existing
  fixture and the seeded `Owner@12345` — 24/24 correct; plus end-to-end on all three endpoints
  (`f12-probe.txt`). Gate: auth 339/339, users 282/282.
  **This issue's tester note was respected** — the P38 probe changed the OWNER's real password;
  the F12 probe creates and deletes its own throwaway accounts.
  **D5 (existing users) decided by default: NEW PASSWORDS ONLY, no forced reset** — D1 established
  production is not live, so the ~100 accounts this decision was written about do not exist; see
  `fixing/DECISIONS.md`. Reversible.
- **Notes:** Two things that **are** right and should not be changed: the hash is **bcrypt cost 10**
  (`$2b$10$…`), and login timing shows no oracle — a wrong password on a known email averaged 68.3 ms
  against 72.9 ms for an email that does not exist, i.e. the unknown-email path does the same work.
  **Tester note:** running this probe changed the owner's password to `alllowercase`; it was detected
  immediately and restored to `Owner@12345`, and both affected accounts were verified to log in again.

---

### ISS-084 · [P38] MEDIUM · Forms are readable across spaces — a department-scoped user can read every form in the workspace

- **Severity:** MEDIUM
- **Type:** SECURITY (missing space scope on a read path)
- **Phase:** P38
- **Area:** `FormsService` / `FormsRepo` — the form read paths resolve by workspace only; no
  `spaceScopeFilter`, unlike `SearchRepo` (P25 §5) and the sprint task list (P28 §6)

A form was created in the **Politics** space and read as `marketing.only@`, who cannot see that space
at all:

```
GET /forms/:id       -> 200  "TEST-p38c POLITICS confidential intake", list_id exposed
GET /forms           -> 200  2 rows — BOTH forms in the workspace, including the Politics one
GET /lists/:id/forms -> 404 list.not_found          <- the per-list route IS scoped
PATCH /forms/:id     -> 403 auth.forbidden          <- writes are gated
guest GET /forms/:id -> 200
```

So the per-list listing is correctly scoped and every write is refused, but the **collection** and
**by-id** reads are not.

- **Expected:** the same space filter the other read paths apply.
- **Actual:** a form's title, description, `list_id`, branding, settings, submission count and its
  full field list are readable by anyone in the workspace.
- **Impact:** a form's *title* and *fields* describe what a department collects — "Complaint intake",
  "Refund request", the exact questions asked. `GET /forms/:id/submissions` is separately gated and
  fails on this database (ISS-025), so the submitted **data** is not exposed by this path; the form's
  shape is.
- **Evidence:** `testing/evidence/PHASE-38/forms-idor.txt`
- **Status:** **FIXED in F9** (2026-08-04) — `FormsRepo.findByIdInWorkspace` + `listByWorkspace`
  now carry `listScopeFilter(forms.listId)`: the cross-space form is absent from the collection and
  404 by id for a narrowed caller; owner/admin and the per-list + public-slug paths unchanged.
  Proof: `fixing/evidence/F09/f9-leak-probe.txt` §ISS-084.
- **Notes:** Third member of the same family — ISS-053 (dependency hydration) and ISS-060 (the audit
  feed) are the other two. All three are read paths that skip the space filter the codebase already
  implements elsewhere. Worth fixing as one piece of work.

---

### ISS-085 · [P38] MEDIUM · A request from a disallowed Origin returns 500 instead of a clean CORS rejection

- **Severity:** MEDIUM
- **Type:** BUG (error classification)
- **Phase:** P38
- **Area:** `server/src/app.ts:84-91` — the CORS `origin` callback ends with
  `cb(new Error("Origin … not allowed by CORS"))`

Passing an `Error` to the callback makes the `cors` middleware **throw**, which reaches the global
error handler and renders a 500:

```
Origin: https://evil.example.com   -> 500 {"error":{"code":"internal", …}}   ACAO: null
Origin: null                        -> 500                                    ACAO: null
OPTIONS preflight from evil         -> 500
Origin: http://localhost:5173       -> 200   ACAO: http://localhost:5173
Origin: http://localhost:3000       -> 200   ACAO: http://localhost:3000
OPTIONS preflight from :5173        -> 204   ACAO set
```

- **Expected:** an unlisted origin gets a normal response **without** the
  `Access-Control-Allow-Origin` header — the browser then blocks it. That is what `cb(null, false)`
  does.
- **Actual:** a 500 `internal` for every cross-origin request from an unlisted origin.
- **Impact:** not a security hole — no `ACAO` header is emitted either way, so a hostile page still
  cannot read the response. The cost is operational: every such request is logged as an internal
  server error, so genuine 500s are buried, and any alerting on 5xx fires on ordinary web noise.
  It also breaks `Origin: null`, which browsers send legitimately from sandboxed iframes and
  `file://` pages.
- **Evidence:** `testing/evidence/PHASE-38/security.txt` (§7) · `verify-ambiguous.txt` (§4)
- **Status:** **FIXED in F13** (2026-08-05). `app.ts` — `cb(new Error(...))` became
  `cb(null, false)`. A disallowed origin now gets a normal response with **no**
  `Access-Control-Allow-Origin` header (the browser then blocks the read, which is the intended
  outcome) instead of a 500. The policy itself was already correct and is unchanged.
  **Verified:** `fixing/evidence/F13/f13-probe.txt` — four disallowed origins and an evil
  preflight, none a 500, none carrying ACAO; the two allowed origins still get ACAO reflected and
  a legitimate preflight still returns 204. Same fix closes ISS-009.
- **Notes:** The allow-list itself is sensible — configured origins plus a LAN regex for
  `localhost` / `127.0.0.1` / RFC-1918 ranges, so LAN testing works without editing config.

---

### ISS-086 · [P38] LOW · The API ships no CSP or HSTS and still advertises `X-Powered-By: Express`

- **Severity:** LOW
- **Type:** SECURITY (hardening) — confirms and sharpens `SCAN-M7`
- **Phase:** P38
- **Area:** the API's response headers

Measured on a normal authenticated 200:

| header | value |
|---|---|
| `x-content-type-options` | `nosniff` ✔ |
| `x-frame-options` | `DENY` ✔ |
| `referrer-policy` | `no-referrer` ✔ |
| `strict-transport-security` | **absent** |
| `content-security-policy` | **absent** |
| `cross-origin-opener-policy` | absent |
| `x-dns-prefetch-control` | absent |
| **`x-powered-by`** | **`Express`** |

- **Impact:** modest for a JSON API — CSP matters most on the SPA origin, and HSTS is normally
  terminated at nginx/Cloudflare in this deployment. `X-Powered-By` is free fingerprinting that
  `app.disable("x-powered-by")` removes in one line.
- **Evidence:** `testing/evidence/PHASE-38/security.txt` (§7)
- **Status:** **FIXED in F13** (2026-08-05). `app.disable("x-powered-by")`, and
  `securityHeaders` gained a CSP plus three more headers. The CSP for a JSON API is
  `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` — this
  origin serves no HTML, scripts or styles, so nothing is allowed to load and an XSS landing in a
  JSON error string has nothing to reach. Also `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-site`, `X-DNS-Prefetch-Control: off`. HSTS unchanged
  (prod-only — advertising it from plain-HTTP localhost poisons the dev browser's HSTS cache).
  **The SPA origin needs its own, much looser CSP** — separate nginx-served origin, not this
  middleware's job, as this issue itself notes. **Verified:**
  `fixing/evidence/F13/f13-probe.txt` (the full header table). Also closes SCAN-M7.
- **Notes:** The **SPA origin's** headers were not measured here — that needs the built client behind
  its real nginx vhost, so it is carried to **P41**. `SCAN-M7` covers the same ground; this entry
  records the measured values.

---

### ISS-087 · [P40] HIGH · Concurrent load exhausts the DB pool queue and returns 500 — at 50 simultaneous requests, 37 of 50 failed

- **Severity:** HIGH
- **Type:** RELIABILITY
- **Phase:** P40 — Performance & scale
- **Area:** `server/src/db/client.ts:56-57` (`connectionLimit` / `queueLimit`) · `server/.env:18-19`
  (`DB_POOL_MAX=20`, `DB_POOL_QUEUE_LIMIT=50`) · the global error handler, which renders the
  resulting driver error as a generic 500

**Measured against a 5 000-task workspace, single API instance:**

```
 5 concurrent GET /lists/:id/tasks?limit=50  ->  5 ok,  0 failed
10 concurrent                                -> 10 ok,  0 failed
15 concurrent                                -> 15 ok,  0 failed
20 concurrent                                -> 20 ok,  0 failed
30 concurrent                                -> 27 ok,  3 FAILED
50 concurrent                                -> 13 ok, 37 FAILED
the same 50 run SEQUENTIALLY                 -> 50 ok,  0 failed
```

Every failure is an HTTP **500** with the generic body
`{"error":{"code":"internal","message":"Internal server error","request_id":"…"}}`. The server log
gives the real cause:

```
[error] Unhandled error Queue limit reached. {"name":"Error"}
[error] request {"method":"GET","path":"/api/v1/lists/…/tasks?limit=50","status":500,"durationMs":135.89}
```

**Why 30 and not 70.** The pool allows 20 connections with a 50-deep wait queue. But a *request* is
not a *query*: `GET /lists/:id/tasks` issues **8** queries, several of them concurrently (hydrating
assignees, watchers, tags and custom-field values in parallel). So ~30 in-flight requests saturate
70 slots, and mysql2 throws `Queue limit reached` on the next acquire.

- **Expected:** under a burst, requests queue and slow down, or are shed with a **503 + `Retry-After`**.
- **Actual:** they fail with a 500 that is indistinguishable from a genuine server fault, both to the
  user and to any monitoring.
- **Impact on this deployment specifically:** pm2 runs **one** instance in fork mode by deliberate
  design (`ecosystem.config.js` — in-process rate-limit counters, metrics registry and SSE registry).
  There is no second process to absorb a burst. With ~100 staff, a normal 9 a.m. pattern — everyone
  opening Home, which itself fires several requests — reaches this range easily. The box also hosts
  five other production apps, so raising the pool is not free.
**CORROBORATED BY THE REPO'S OWN TEST SUITE (P42).** The full jest sweep found exactly one failing
test in 30 modules, and it is this defect:



So this is not an artefact of a synthetic load probe — the project already has a test asserting that
50 parallel reads all return 200, and that test is red. It fails on configuration
(, ), not on data, so it fails on any machine.

- **Evidence:** `testing/evidence/PHASE-40/concurrency.txt` (the ramp and the status distribution) ·
  `perf.txt` (§5) · the server log line above
- **Status:** **FIXED in F11** (2026-08-04). Two changes, both in the issue's own list of cheapest-
  first mitigations: (1) `DB_POOL_QUEUE_LIMIT: 50 -> 0` — an unlimited wait queue turns a burst into
  LATENCY instead of failure (`.env.example` already shipped 0; only the deployed `.env` had 50, so
  this was a configuration defect). (2) pool exhaustion now renders **503 `service.unavailable` +
  `Retry-After: 2`**, logged at warn — never a generic 500 — so clients back off and monitoring
  stops counting capacity pressure as server faults. `DB_POOL_MAX` deliberately UNCHANGED at 20
  (max_connections 151, shared box — raising it just moves the wall).
  **Measured, same fixture and endpoint:** 30 concurrent 24-failed -> **0**; 50 concurrent 30-failed
  -> **0** (p50 797 ms, the queue doing its job); the sequential control stayed clean.
  The 503 path was proven separately against a deliberately tiny pool (2 conns / 1 queue slot):
  40 x 503 with `Retry-After`, zero 500s.
  **The repo's own red test is green:** `users` 278/279 -> **279/279**, `tasks` 358/359 ->
  **359/359** — no known failing server test remains.
  **Not done (measured, not needed):** reducing the hydration fan-out — serialising the four
  batched reads would cut peak acquires 4->1 but add three round-trips to EVERY request, and the
  queue already absorbs the peak. Recorded in `fixing/results/F11.md` §2 if a future load profile
  changes the answer.
  Evidence: `fixing/evidence/F11/ramp-before.txt` / `ramp-after.txt` / `shed-503.txt` / `gate.txt`.
- **Notes:** Three independent mitigations, cheapest first. (1) `.env.example` already ships
  `DB_POOL_QUEUE_LIMIT=0` (unlimited queue) — the deployed `.env` sets `50`, and 0 would turn this
  failure into latency instead. (2) Map the driver's `Queue limit reached` to a **503** with
  `Retry-After` so clients back off and monitoring is not polluted. (3) Reduce per-request query
  fan-out on the hot list endpoint. Note that raising `DB_POOL_MAX` alone just moves the wall —
  MySQL's `max_connections` is 151 on this box and is shared with five other apps.

---

### ISS-088 · [P40] LOW · Four hot queries sort in memory instead of using an index, and two fall back to a wide scan

- **Severity:** LOW
- **Type:** PERFORMANCE (scaling headroom, not a present defect)
- **Phase:** P40
- **Area:** the indexes behind list-tasks, task comments, task activity and workspace activity

`EXPLAIN` at 5 000 tasks / 20 000 comments / 50 000 activity rows:

| query | type | key used | rows | Extra |
|---|---|---|---|---|
| list tasks | ref | `uq_tasks_list_number` | 125 | **Using filesort** |
| task comments | ref | `idx_comments_task_time` | 4 | **Using filesort** |
| task activity | ref | `idx_task_activity_task_time` | 10 | **Using filesort** |
| workspace activity | ref | `idx_workspace_activity_workspace_time` | 1 | **Using filesort** |
| my open tasks | ref | `idx_task_assignees_user` | 125 | Using index ✔ |
| search tasks (LIKE) | ref | `uq_tasks_custom_id` | **2226** | Using where |
| overdue count | ref | `uq_tasks_custom_id` | **2226** | Using where |

The four filesorts happen because the code paginates by **`internal_id`** while the available indexes
end in a **time** column — so MySQL finds the rows by index and then sorts them separately. The two
2 226-row scans are the `LIKE '%…%'` search predicate (ISS-076) and the overdue count, neither of
which can use an index as written.

- **Impact today: none measurable.** Nothing exceeded 300 ms; the slowest endpoint was
  `/search?q=Perf` at **125 ms** and everything else sat between 2.6 ms and 25 ms. Cursor pagination
  is genuinely flat — walking 13 pages of a 125-task list went 14.7 ms → 13.7 ms.
- **Why it is worth recording:** the filesorts scale with the result set, so they are the first thing
  that will bend when a list holds thousands of tasks rather than 125.
- **Evidence:** `testing/evidence/PHASE-40/perf.txt` (§1, §2, §4)
- **Status:** **FIXED in F30** (2026-08-06). Four covering-order indexes (upgrades/013) matching each query ACTUAL ORDER BY; EXPLAIN on the same perf fixture: zero filesorts, all four on their new index; latency table re-run — nothing slower, list reads ~40% faster.
- **Notes:** Adding `(task_id, internal_id)` / `(workspace_id, internal_id)` indexes to match the
  actual `ORDER BY` would remove all four filesorts. Also recorded here: **no N+1 anywhere** — the
  heaviest endpoint issued 13 queries (`/search`), the list endpoint 8, and a single task read 6.

---

### ISS-089 · [P41] MEDIUM · The API listens on all interfaces, so if port 5501 is reachable from outside nginx, the login limiter can be defeated with one header

- **Severity:** MEDIUM (conditional on the firewall — see below)
- **Type:** SECURITY (defence in depth)
- **Phase:** P41 — Production parity
- **Area:** `server/src/server.ts:48` — `app.listen(PORT, …)` with **no host argument**, so Node binds
  `::` / `0.0.0.0` · `app.ts:50` — `app.set("trust proxy", 1)` ·
  `middlewares/rateLimit.ts:59` — the login limiter keys on `req.ip`

**Measured against the API directly (no nginx in front), NODE_ENV=prod, limiters on:**

```
6 bad logins from one client   -> attempt 6 returns 429 auth.rate_limited, Retry-After 60   correct
the same, with X-Forwarded-For: 1.2.3.4      -> 401, not 429   *** a fresh bucket ***
              x-forwarded-for (lower-case)   -> 401            *** bypassed ***
              X-Forwarded-For: 1.2.3.4, 5.6.7.8 -> 401         *** bypassed ***
              X-Real-IP: 9.9.9.9              -> 429           still limited
              CF-Connecting-IP: 8.8.8.8       -> 429           still limited
```

With `trust proxy = 1`, Express takes `req.ip` from the **last** `X-Forwarded-For` entry. A client
talking straight to the API is the only hop, so it controls that value completely and can mint an
unlimited number of rate-limit buckets by rotating one header — turning a 5-attempts-per-minute login
gate into an unlimited one.

**Through nginx this does not happen.** The vhost sets
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, which **appends** the true remote
address, so the last entry — the one Express reads — is the real client (or, behind Cloudflare, the
address restored by `cloudflare-realip.conf`). The proxied path is correct.

- **So the whole issue reduces to one deployment question:** is TCP 5501 reachable from the internet
  on `209.38.65.61`? The process binds every interface, and nothing in `deploy/` configures a
  firewall. If the droplet has no `ufw`/cloud-firewall rule, then the API is directly reachable and
  **both** this bypass and the `/metrics` endpoint (§6 below) are live.
- **Expected:** the API binds `127.0.0.1` (nginx proxies to `127.0.0.1:5501` anyway, so nothing
  breaks), or the firewall denies 5501 from outside.
- **Evidence:** `testing/evidence/PHASE-41/prod-parity.txt` (§1) · `server.ts:48` · `app.ts:50`
- **Status:** **FIXED in F13** (2026-08-05). Production now binds **127.0.0.1** only
  (`server.ts`); nginx already proxies to `127.0.0.1:5501`, so nothing legitimate changes.
  Dev keeps the wildcard ON PURPOSE — the CORS policy deliberately reflects private-LAN origins so
  a phone on the same Wi-Fi can use the app, which is pointless if the port is unreachable.
  **Verified by BOOTING both**, not by reading source (`fixing/evidence/F13/bind-proof.txt`):
  dev listens on `::`, prod on `127.0.0.1` ("Listening on 127.0.0.1:5722 (loopback only)").
  **STILL OPEN, for the operator:** this issue asks to first confirm whether TCP 5501 is
  firewalled on 209.38.65.61, because that decides whether this was ever EXPLOITABLE. That check
  needs the production box (a `ufw status`, or an external `nc`) and has not been run. The fix
  is right either way; the severity of what came before is not yet established.
- **Notes:** One-line fix with no downside: `app.listen(PORT, "127.0.0.1", …)`. The limiter itself is
  well built — `standardHeaders: true` (it emits `RateLimit-Limit: 5` and `Retry-After: 60`), a
  proper `429 auth.rate_limited` code, and the general limiter deliberately keys on the Bearer `sub`
  rather than the IP so an office NAT does not share one bucket (gap-scan M1).

---

### ISS-090 · [P41] LOW · Nine variables `Config` reads are absent from `.env`, and six of those are absent from `.env.example` too

- **Severity:** LOW
- **Type:** CONFIG hygiene
- **Phase:** P41
- **Area:** `server/src/config/index.ts` destructures **39** environment variables

| absent from `.env` (9) | also absent from `.env.example` |
|---|---|
| `DB_SOCKET_PATH` | no — documented |
| `DB_TIMEZONE` | no — documented |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | **yes** |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | **yes** |
| `OPENAI_MAX_OUTPUT_TOKENS` | **yes** (has a code default of 800) |

Present but empty: `API_URL`, `CORS_ALLOWED_ORIGINS`.

Two distinct problems:

1. **`SMTP_*` / `EMAIL_*` are dead config.** The mailer actually reads the `MAIL_*` names
   (`MAIL_HOST=live.smtp.mailtrap.io` is set and working). These six are read by `Config` and set by
   nobody — a second, unused mail configuration that will mislead whoever next edits the mail setup.
2. **`DB_SOCKET_PATH` and `DB_TIMEZONE` are the two variables production cannot go live without** —
   MySQL 8.4 on the target box needs the socket path (TCP + `caching_sha2_password` fails), and
   `DB_TIMEZONE=+06:00` is half of the pair that keeps dates correct (ISS-058). Both are correctly
   documented in `.env.example` and correctly empty for local dev, but nothing *verifies* them at
   boot.

- **Evidence:** `testing/evidence/PHASE-41/prod-parity.txt` (§4, §5)
- **Status:** **FIXED in F14** (2026-08-05), with one CORRECTION to this issue's premise.
  The six `SMTP_*`/`EMAIL_*` keys are **not** "a second, unused mail configuration" —
  `config/index.ts:120-125` reads them as the FALLBACK tier (`MAIL_HOST ?? SMTP_HOST`,
  `MAIL_FROM_ADDRESS ?? EMAIL_FROM`, …). Deleting them would remove a working fallback for
  anyone migrating from those names, so they are now DOCUMENTED in `.env.example` as exactly
  that, commented out — as is `OPENAI_MAX_OUTPUT_TOKENS` (code default 800). The genuinely dead
  keys (`SECRET_KEY`, `REDIS_URL`, `CLOUDFLARE_TOKEN_VALUE`, `COOKIE_SECRET`) were
  deleted instead.
  **Verified against the general property, not the nine names:** the probe asserts that EVERY
  variable `Config` destructures appears in `.env.example` — which caught one this issue never
  listed, `R2_SIGNED_URL_TTL`. **68/68 documented** (`fixing/evidence/F14/f14-probe.txt`).
- **Notes:** A boot-time assertion for the prod-only pair would also close the ISS-058 coupling in the
  same change: if `NODE_ENV=prod`, require `DB_TIMEZONE` and check it matches the process `TZ`.

---

### ISS-091 · [P41] LOW · `/health` is not reachable through nginx, so nothing outside the box can check whether the app is up

- **Severity:** LOW
- **Type:** OPERATIONS
- **Phase:** P41
- **Area:** `deploy/nginx/tasks.beautybooth.com.bd.conf`

The vhost defines exactly four locations: `= /api/v1/assistant/chat`, `/api/v1/`, `/assets/`,
`= /index.html`, and the SPA catch-all `/`. `/health`, `/health/ready`, `/health/version` and
`/metrics` are mounted at the **app root**, not under `/api/v1`, so none of them is proxied.

```
GET https://tasks.beautybooth.com.bd/health   -> falls into `location /` -> try_files -> index.html
```

- **The good half:** `/metrics` is therefore **not** exposed to the internet, which is what the test
  plan wanted to confirm. It is protected by accident (no location block) rather than by design (a
  `deny all`), but the effect is right — *provided* port 5501 itself is firewalled (ISS-089).
- **The bad half:** an external uptime monitor (Cloudflare, UptimeRobot, a load balancer) has no
  health endpoint to call. It can only fetch `/`, which returns the SPA shell **even when the API is
  completely down** — so an API outage looks healthy from outside.
- **Evidence:** `testing/evidence/PHASE-41/prod-parity.txt` (§6)
- **Status:** **FIXED in F13** (2026-08-05).
  `deploy/nginx/tasks.beautybooth.com.bd.conf` gained `location = /health` (proxied, exact
  match, `access_log off`) so an external uptime check gets a real answer instead of index.html
  with a 200 — a monitor watching that URL would have reported "up" for a dead API.
  `/health/ready` and `/health/version` stay unproxied deliberately (`ready` reveals DB
  reachability, `version` the running build). `location /metrics { deny all; }` makes that
  protection INTENTIONAL — it was already unreachable, but only because it fell through to the SPA
  catch-all, and the next person to add a location could have removed it without noticing. The
  stale comment in the catch-all claiming it protected those paths was corrected in the same edit.
  **NOT YET RUN: `nginx -t`** — nginx is not installed on the Windows dev box. Validate on the
  deploy box before reload.
- **Notes:** `location = /health { proxy_pass http://127.0.0.1:5501; }` plus an explicit
  `location /metrics { deny all; }` makes both behaviours intentional instead of incidental.

---

### ISS-092 · [F3] LOW · The demo seed backdates `completed_at` to last week but lets `created_at` default to now, so 12 tasks are "completed before they were created"

- **Severity:** LOW
- **Type:** DATA (fixture quality — not product behaviour)
- **Phase:** found during **F3** (fixing phase), filed under rule X1 rather than fixed
- **Area:** `server/src/db/seed-demo.ts:375` — `completedAt: done ? LAST_WEEK_INSTANT : null`, while
  `created_at` is left to the MySQL `CURRENT_TIMESTAMP` default

```
name                                created_at           completed_at         diff
Weekly newsletter — skincare tips   2026-08-03 06:42:05  2026-07-29 22:00:00  -104h
Pack & label 30 prepaid orders      2026-08-03 06:42:05  2026-07-29 22:00:00  -104h
…12 rows total
```

The intent is clearly good — backdating makes the demo look like a workspace with history rather than
one created five seconds ago. The oversight is that only *some* of the timestamps are backdated:
`completedAt` is set explicitly to `LAST_WEEK_INSTANT` while `createdAt` is not passed at all, so
MySQL stamps it with `NOW()`.

- **Expected:** a task's `completed_at` is never earlier than its `created_at`.
- **Actual:** 12 of 46 seeded tasks are impossible.
- **Impact:** none on the product — this is fixture data only. It matters because it is a **trap for
  testing**: any test or report that assumes `completed_at >= created_at` will fail on seed data and
  look like a product bug. It also made the F3 clock verification harder to read, since the same
  symptom (a timestamp earlier than creation) is what ISS-052 produced for real.
- **NOT caused by the clock fix:** the count was **12 before F3 and 12 after**. Verified on both
  frames.
- **Evidence:** `fixing/evidence/F03/` · `seed-demo.ts:375` vs `:412`
- **Status:** **FIXED in F30 close-out** (2026-08-07). Done tasks now seed created_at two days before their backdated completed_at; demo DB re-seeded, 0 impossible rows (was 12), X8 baseline counts identical.
- **Notes:** One-line fix when someone is next in that file — pass `createdAt: LAST_WEEK_INSTANT` on
  the same rows, or drop the `completedAt` backdate. Best done alongside **F15**, which touches the
  seed's counter behaviour anyway.

---

### ISS-093 · [F3] MEDIUM · A test in the `users` module has been failing since at least 2026-07-30 and nobody noticed, because the sweep that found it was never read back

- **Severity:** MEDIUM
- **Type:** PROCESS / TEST
- **Phase:** F3 — found while establishing the clock fix's regression gate
- **Area:** **`server/tests/users/list.test.ts`** — 1 of 8 suites, 1 of 279 tests. The failure is at
  suite level around `list.test.ts:137-140` (the first `Happy path` case,
  *"returns 200 with the spec list envelope"*), so jest reports every test in the file.

The F3 regression gate re-ran the full server jest sweep and the `users` module reported
`1 failed, 278 passed, 279 total`. The PHASE-42 baseline of 2026-07-30 records **the identical
numbers**, so this is **not** a regression from the clock fix:

```
2026-07-30 (PHASE-42):  users  Test Suites: 1 failed, 7 passed, 8 total | Tests: 1 failed, 278 passed, 279 total
2026-08-03 (F3):        users  Test Suites: 1 failed, 7 passed, 8 total | Tests: 1 failed, 278 passed, 279 total
```

- **Expected:** a red test is triaged — either fixed, or filed with a reason.
- **Actual:** it sat red for at least four days with no issue against it.
- **Impact:** low on its own, but it degrades the regression gate every later phase depends on. A
  suite with one permanently-red test trains the reader to accept red, and the next *real*
  regression in that module hides behind the same line.
- **Why it was missed:** PHASE-42 is marked **PARTIAL** — its sweep ran ~90 minutes into the
  background and outlived the session, so the output file was written but never read back. The
  failure was captured on disk the whole time.
- **Evidence:** `testing/evidence/PHASE-42/jest-sweep.txt:3` · `fixing/evidence/F03/jest-sweep.txt`
- **Status:** **CLOSED as a DUPLICATE of ISS-087** (corrected in F10, 2026-08-04).
  **My F3 identification was wrong.** I read the suite name off a run I had KILLED mid-flight, where
  jest lists every test in the file, and reported the first `Happy path` case as the failure. Running
  the module to completion in F10 names the real one: the **50-parallel-read concurrency test**, which
  500s from connection-pool queue exhaustion — i.e. **ISS-087**, already filed, already owned by F11.
  It is the exact twin of the `tasks` module's surviving failure (`list-by-list.test.ts:1115`).
  There is no separate untriaged bug.
- **What still stands (and is why this entry is kept, not deleted):** the PROCESS finding. A red test
  sat unexamined for days because PHASE-42's sweep outlived its session and its output was never read
  back — and then it was mis-attributed for two more phases because a killed run was treated as
  evidence. **F32 must diff module-by-module against a recorded baseline and fail loudly**, and a
  killed run is not a result.
- **Notes:** Two things to do, and the second matters more than the first. (1) Identify and fix the
  test. (2) **F32 must not repeat PHASE-42's mistake** — a sweep whose output nobody reads is not a
  gate. F32 should diff module-by-module against a recorded baseline and fail loudly on any
  difference, rather than ending with the sweep still running.

---

### ISS-094 · [F26] MEDIUM · The seeded **Guest** role holds two engineering write grants, workspace-wide

- **Severity:** MEDIUM
- **Type:** SECURITY (over-broad seeded grant)
- **Phase:** filed during F26 (fixing phase, per rule X1 — found, not fixed)
- **Area:** the seeded `Guest` role in `role_permissions`

Measured while building F26's Engineering-nav gate:

```
guest@beautybooth.com.bd — role "Guest" (19 permissions), of which:
    postmortem.manage      scope = all
    sprint.assign_tasks    scope = all
```

A guest is the product's most-restricted persona — the demo account exists to model an external
collaborator. These two grants let one **write** to the engineering workflow: file/update the
postmortem on a resolved incident, and add or remove tasks from a sprint. Since F7 those keys are
REAL route gates (`requirePermission("postmortem.manage")` on
`POST /eng/incidents/:id/postmortem`, `requirePermission("sprint.assign_tasks")` on
`POST /sprints/:id/tasks`), so this is reachable, not theoretical.

- **Expected:** a guest holds read-shaped grants plus, at most, commenting. Engineering writes are
  not a guest capability.
- **Actual:** both grants are held at `scope = all` — every sprint, every incident in the workspace.
- **Why it survived this long:** the seeded roles were built to reproduce PRE-RBAC behaviour exactly
  (RBAC P0–P11), and before F7 neither key gated anything, so an over-broad grant had no effect. F7
  made all 56 toggles real; this one became reachable the same day and nobody re-read the guest row.
- **Impact on F26:** it is why the Engineering nav gate cannot be grant-only. F26 gates on
  *(any engineering grant) AND role !== "guest"*, which is correct today and stays correct after
  this issue is fixed. Remove the `AND` once the grants are right.
- **Status:** **FIXED in F28** (2026-08-06, D12.1). Guest 19 grants → 7 read-and-comment (`upgrades/011`); the revocation also forced the named bug-intake principal (`bug.report` opened no door) and surfaced ISS-095.
- **Notes:** Fixing it is a **grant-matrix decision, not a code change** — it belongs with the F28
  decision batch (which already owns "RBAC posture"). Check the other seeded roles in the same pass:
  this was found by looking at four keys, not by an audit.

---

### ISS-095 · [F28] MEDIUM · A guest can re-tag any task in the workspace — the tag routes carry no permission gate

- **Severity:** MEDIUM
- **Type:** SECURITY (missing route gate — same species as ISS-094, one layer down)
- **Phase:** filed during F28 (fixing phase, per rule X1 — found, not fixed)
- **Area:** `POST /tasks/:id/tags` + `DELETE /tasks/:id/tags/:tagId` (`server/src/routes/tasks.ts`)

Found by D12.1's own regression gate. After the Guest role was cut to read-and-comment, the
`membership` module's role loops were expected to fail wherever a guest could still write — and the
failures mapped exactly onto the revoked keys (`task.assign` on the assignee routes) **except** for
tags: `tags.add` and `tags.remove` still passed with a guest asserting **204**. The routes are the
reason:

```
POST   /tasks/:id/tags          authenticate only — no requirePermission
DELETE /tasks/:id/tags/:tagId   authenticate only — no requirePermission
```

ISS-094 was an over-broad **grant**; this is a missing **gate** — no key guards the surface at all,
so no grant matrix can close it. A guest can add or strip tags on every task in the workspace,
which rewrites saved filters, board groupings and report slices, writes `tag_added`/`tag_removed`
activity rows, and bumps the task ETag (forcing everyone's optimistic-concurrency retries).

The neighbouring **watcher** routes looked like the same hole and are NOT one: they are
`/watchers/self` — a personal subscribe/unsubscribe, deliberately reachable to anyone who can read
the task. That is correct for a read persona and needs no change.

- **Expected:** tagging rides a write gate — `task.edit` under the D3.1 compose rule is the natural
  fit (a tag is task metadata; the seeded matrix then gives every internal role the verb and denies
  the guest with **zero grant changes**), or an explicit new key if tagging is meant to be separable
  from editing.
- **Actual:** `authenticate` is the only gate; every authenticated persona holds the surface.
- **Why it survived F7:** F7 put `requirePermission` on the 95 routes that had a matching catalog
  key. Tags-on-a-task never had a key, so the sweep had nothing to attach and the routes kept their
  pre-RBAC shape.
- **Status:** **FIXED in F34** (2026-08-08). Both tag routes gated on `task.edit` (the issue's own prescription — every internal role holds it, the guest does not, zero grant changes), plus the F8-pattern service-depth scope check (`assertTagScope` mirroring `assertAssignScope`). The two membership role-loops flipped to internal-204 / guest-403 exactly as this issue asked. membership 102/102.
- **Notes:** belongs to the RBAC write-scope backlog (P12–P15 own-scope / P20–P22 remaining repos)
  or the F31–F34 sweep — NOT fixed inside F28, whose scope was the seven D12 decisions. When it is
  fixed, flip the two `membership` role loops (`tags.add`, `tags.remove`) the same way F28 flipped
  the assignee ones; they currently pin the hole as intended behaviour.

---

### ISS-096 · [F31] LOW · The Sidebar advertises a ⌘K shortcut that nothing implements

- **Severity:** LOW
- **Type:** UI (an advertised affordance that does nothing — the Block F family)
- **Phase:** filed during F31 (fixing phase, per rule X1 — found, not fixed)
- **Area:** `client/src/components/shared/Sidebar.tsx:299` (`<KbdHint k="⌘K" />` on the Search
  nav item) · no matching handler anywhere

Found while authoring F31's deferred-interaction pass: the ⌘K test was written to assert the
behaviour the UI advertises, and source inspection shows there is nothing to assert against —
`grep`ing the whole client for a global keydown listener or any `metaKey`/`ctrlKey` + `k`
combination finds only local editor handlers (comments ⌘-Enter, inline renames, checklist inputs).
No component installs a document/window keydown listener for `k`.

- **Expected:** pressing Ctrl/⌘-K anywhere in the authed shell focuses search (that is what the
  badge on the Search nav item promises), or the badge does not exist.
- **Actual:** the key combination does nothing; the hint is decoration.
- **Impact:** cosmetic-plus: a user who tries the advertised shortcut learns to distrust the UI —
  the exact currency Block F (F24–F27) spent four phases restoring.
- **Evidence:** `client/e2e/f31-deferred.pw.ts` — the "⌘K opens search" test is annotated
  `test.fail` with this issue number and stays that way until either the binding or the badge goes.
- **Status:** **FIXED in F34** (2026-08-08). Ctrl/⌘-K is bound in `AppShell` (every authed page) and navigates to `/search`; typing surfaces (input/textarea/contenteditable — tiptap owns Ctrl-K for links) are exempt. Proven by un-annotating the F31 e2e test, which now passes.
- **Notes:** two honest fixes, either acceptable: bind it (a ~15-line `useEffect` in the authed
  layout navigating to `/search`, mind inputs/textareas/contenteditable focus) or delete the
  `KbdHint`. Binding is the better product answer; deleting is the cheaper honest one. Belongs to
  the F31–F34 bookkeeping — DEFERRED at F34 with this note if not picked up.
---

### ISS-097 · [F31] LOW · 6 px of horizontal overflow on the authed shell at 390 px (mobile)

- **Severity:** LOW
- **Type:** UI (responsive)
- **Phase:** filed during F31 (deferred-interaction pass, rule X1)
- **Area:** the authed shell at phone width — Home, 390×844 viewport

F31's breakpoint sweep (1920/1366/1024/768/390) found exactly one failure: at 390 px the
scrolling element is 6 px wider than the viewport, so the whole app pans sideways by a finger-
width. 768 px and everything above are clean, so this is a phone-only edge — most plausibly one
fixed-width element or a padding sum in the shell.

- **Expected:** no horizontal scroll at any supported breakpoint.
- **Actual:** scrollWidth − clientWidth = 6 at 390 px.
- **Evidence:** client/e2e/f31-deferred.pw.ts responsive sweep (the 390 case is annotated
  test.fail with this number) · test-results screenshot from run 1.
- **Status:** **FIXED in F34** (2026-08-08). Root cause was NOT the topbar: the expanded 248px sidebar left a 390px viewport a 142px content column that could not fit any topbar. The sidebar now auto-collapses ≤640px (one-way; the user can re-expand), the search label ellipsizes instead of propping the row open, and the on-call chip hides ≤480px. Measured: overflow 6px → **0px**; the un-annotated breakpoint test passes.
- **Notes:** F34 burn-down candidate — find the overflowing element with a one-off
  document.querySelectorAll width walk at 390 px.

---

### ISS-098 · [F31] MEDIUM · List page: icon-only controls with NO accessible name (axe: 2 critical rules)

- **Severity:** MEDIUM (a11y correctness; keyboard/screen-reader users)
- **Type:** ACCESSIBILITY
- **Phase:** filed during F31 (axe pass, rule X1)
- **Area:** the list page (ListView/toolbar/rows)

The F31 axe pass (@axe-core/playwright) on three pages:

```
login: serious 1, moderate 2   (color-contrast, landmark-one-main, region)
home:  serious 1, moderate 1   (color-contrast, heading-order)
list:  serious 2, CRITICAL 2   (aria-command-name, button-name, color-contrast, label)
```

The two criticals are the same defect twice: icon-only buttons/menuitems on the list surface
carry no accessible name, so a screen reader announces "button" with no hint of what it does.
- **Expected:** every interactive control has an accessible name (aria-label on icon-only
  buttons); no critical axe violations on core pages.
- **Actual:** aria-command-name + button-name critical on the list page; color-contrast serious
  on all three pages; a form control without a label on the list page.
- **Evidence:** client/e2e/f31-deferred.pw.ts axe tests (the list case is annotated test.fail
  with this number); per-page rule ids in fixing/evidence/F31/pw-run1.txt.
- **Status:** **FIXED in F34** (2026-08-08) — the criticals. Named every nameless control the axe dump identified once the rows were actually rendered (the run-to-run flicker was render timing): the per-row … menu, the dnd-kit drag handle, the row checkbox, the assignee trigger, the group/column/swimlane collapse toggles, and the ListPage header ellipsis. axe(list) now: **zero critical, zero label, zero aria-command-name** — only the color-contrast serious rows remain, recorded in the notes above as the follow-up sweep this issue always scoped them to. Proven by un-annotating the F31 axe test, which now passes.
- **Notes:** F34 burn-down candidate: aria-labels on the icon-only controls kill both criticals;
  contrast + landmarks are a follow-up sweep. The serious/moderate rows are recorded here so the
  next a11y pass starts from data, not a rescan.

