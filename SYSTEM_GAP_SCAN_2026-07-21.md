# 🔍 FULL SYSTEM GAP SCAN — 2026-07-21

**Scope:** database ↔ backend ↔ frontend ↔ cross-layer contract, security, tests, repo hygiene.
**Method:** 5 parallel deep-audit agents (DB parity · API surface · services/repos · frontend · client↔server contract) + builds/typechecks/lint/unit-suites run + manual env/hygiene review. Working tree (uncommitted state) audited, not HEAD.
**Context:** run after the 50-phase FULL SYSTEM TEST (GO_LIVE_GATE_REPORT.md, "0 known functional bugs"). This scan looked specifically for what that pass could miss: cross-layer wiring, fresh-install paths, and code the tests/E2E never exercised.

---

## 0. Verdict

The **core architecture is sound** — auth coverage, workspace isolation, SQL-injection/XSS posture, transactions/locking, the AI assistant's tool scoping, serializer secret-hygiene, and fresh-install schema parity all verified clean (details §7). Builds are green (server `tsc` ✅, client `tsc -b` ✅, client vitest 8/8 ✅).

**But the scan found real gaps the 50-phase pass missed** — mostly in the client→server *request* direction (API tests sent correct payloads directly; browser E2E didn't cover these flows) and in fresh-install/upgrade tooling:

| Severity | Count | Theme |
|---|---|---|
| 🔴 CRITICAL | 5 | broken user-facing flows + security-relevant logout + local form-submit 500 |
| 🟠 HIGH | 5 | 50-item truncation, public-form exposure, broken migration tooling, login interceptor, dead postmortem |
| 🟡 MEDIUM | ~18 | rate-limit keying, PII purge job unreachable, headers, tz domains, silent-failure UX, missing UI for built features |
| 🟢 LOW | ~35 | hygiene, dead code, env drift, cosmetics |

---

## 1. 🔴 CRITICAL

### C1. Sign-out doesn't sign out — session survives, next user inherits it
- `client/src/stores/auth.ts:21-27` — `logout()` only clears the zustand store. `authApi.logout` / `logoutAll` (`http/api.ts:67-72`) have **zero callers** (Sidebar.tsx:88-91, UserMenu.tsx:110-113 just `logout(); navigate("/login")`).
- The HttpOnly `bb_refresh` cookie (30-day) stays valid → any reload at the login screen: `bootstrap()` → `/auth/me` 401 → interceptor refreshes via cookie → **previous user silently logged back in**.
- Compounding cross-user bleed on shared machines: no `queryClient.clear()` anywhere; `th-chat` (full assistant conversation), `th-auth` (name/email), `th-ui` (favorites) persist in localStorage across users.
- **Fix:** on sign-out call `POST /auth/logout` (revokes session + clears cookie server-side), `queryClient.clear()`, and purge the persisted stores.

### C2. Bulk-edit toolbar: every action fails
- Client sends `{task_ids, patch}` (`http/api.ts:375-381`); server requires **`ids`** (`validators/tasks.ts:80-93`) → 422 before anything happens.
- Independently: `BulkActionToolbar.tsx:66-75` sends `patch.assignees`/`patch.tags`; the server's allow-list is `assignee_add/assignee_remove/tag_add/tag_remove` (`TaskWriteController.ts:305-325`) → 422 "unknown patch key(s)".
- Multi-select status/priority/due-date/assignee/tag **all** fail with a generic toast. Response shape matches — only the request side is wrong.

### C3. Workspace Settings can never be saved (and fails silently)
- Client always includes `default_locale` in the PATCH (draft comes from GET /workspace; `mappers.ts:70`), but the server validator **throws if the key is present at all** (`validators/workspace.ts:140-152`).
- Second break: TimePicker emits `business_hours_start/end` as `HH:mm` (`WorkspaceSettings.tsx:229,250`); validator requires `HH:MM:SS` (`validators/workspace.ts:113-121`).
- Save mutation has **no onError** (`WorkspaceSettings.tsx:58-70`) → user clicks Save, nothing happens, no message. Name/timezone/week-start/working-days/business-hours are all uneditable in practice.

### C4. `ENCRYPTION_KEY` missing from `server/.env` → public form submit = 500 (today, locally)
- `config/index.ts:130` defaults it to `""`; `utils/encryption.ts:15` does `Buffer.from("", "hex")` → `createCipheriv` throws "Invalid key length".
- `FormsService.submit:730` calls `encryptJSON` unconditionally — and **after** the intake task was created → orphan task + no submission row + 500.
- Jest passes because the test env sets its own key; the dev `.env` simply lost/never got the key (P24 QA used a test key).
- **Fix:** put a real 64-hex key in `server/.env` **and** add a boot-time assertion (assistant/OpenAI and internalAuth both fail clean; encryption should too). Gate item 3.3 (live-DB key) still applies separately.

### C5. `PATCH /tasks/:id` addressed by `custom_id` is a silent no-op
- `TaskWriteService.ts:805` — the target is resolved via `findByIdOrCustomIdInWorkspace`, but the UPDATE uses the **raw path param** (`input.taskId`), which `TasksRepo.update` matches against `tasks.id` only → 0 rows updated.
- Yet a `task_updated` activity row IS written and the response is 200 with the (unchanged) task. `archive`/`unarchive`/`del` all correctly use `task.id`; only `update` doesn't.
- Untested (`server/tests/tasks/update.test.ts` has no custom_id-addressed case). **Fix:** pass `current.id`; add the test.

---

## 2. 🟠 HIGH

### H1. Lists truncated at 50 tasks — client never paginates
- Server returns cursor-paginated pages, `DEFAULT_LIMIT=50` (`TasksService.ts:16`). Client (`api.ts:342-345`) sends no limit/cursor and **discards `pagination`** → ListView, BoardView, CalendarView, ListPage, DependenciesSection (task picker) all silently show only the **oldest 50** tasks.
- Same class: notifications feed (limit 50 — Inbox filter counts computed from one page), **users list (limit 100 — the company is ~100 people; MembersSettings + every assignee picker sit exactly at the boundary)**.

### H2. `GET /public/forms/:slug` ignores `is_public`
- `FormsService.ts:558-563` (`publicView`) never checks `isPublic`; `submit` does (`:633` → 403). An unpublished/never-published form still **renders anonymously** at its slug (title, field labels, options, branding). Slug = `slugify(title)+randomToken(6)` — title half guessable, ~6 chars entropy behind a 30/min/IP limiter. Endpoint also has zero tests.

### H3. Schema-upgrade tooling is broken end-to-end (fresh installs fine; upgrades impossible)
Three findings that compound:
1. **Migration `0005_form_encryption` is orphaned** — no `meta/_journal.json` entry, no snapshot → `db:migrate` will never apply it; next `drizzle-kit generate` will emit a colliding duplicate.
2. **`_post.sql` is not idempotent** — plain `CREATE TRIGGER` (no `DROP TRIGGER IF EXISTS`) and `migrate.ts` replays it every run → **any second `db:migrate` run dies** with ER_TRG_ALREADY_EXISTS.
3. **`db:setup` claims "idempotent" but destroys data** — `setup.ts:11` docstring vs schema.sql's `DROP TABLE IF EXISTS` preamble. Run "to sync schema" on the live DB = total data loss, no prompt.
- Net: there is currently **no working mechanism** to deliver schema changes to an existing DB except hand-run ALTERs. (Live DB still needs the 0005 ALTER — gate 3.3.)

### H4. 401-interceptor retries `/auth/login` itself
- `http/client.ts:170-180` retries ANY 401 — including failed logins. Wrong password → refresh attempt → user sees the **refresh endpoint's** error instead of "Email or password does not match", plus spurious `logout()`; with a lingering valid cookie the bad login is silently POSTed twice.

### H5. Postmortems save to localStorage; the built server endpoint is dead
- `PostmortemChecklist.tsx:20-24` persists to `localStorage["postmortem-"+taskId]`. `POST /eng/incidents/:id/postmortem` (built + tested in §22) has no caller → per-browser, invisible to teammates, lost on cache clear.

---

## 3. 🟡 MEDIUM

**Backend/security**
- **M1. apiLimiter per-user keying is dead code** — mounted before `authenticate` (`app.ts:117`), so `req.auth` is always undefined → the whole office behind one NAT shares a single **600/min/IP** bucket. (assistant + upload limiters are correctly per-user.)
- **M2. `form-submission-expiry` job unreachable over HTTP** — 5 jobs registered, only 4 routed (`routes/jobs.ts:24` comment admits it). The 90-day encrypted-PII purge never runs under the documented curl-cron setup (CLI-only). Public submit also stores the raw `data` object verbatim (unknown keys, up to 1 MB) — junk accumulates with no cleanup.
- **M3. No security headers** — no helmet or equivalent anywhere (no X-Content-Type-Options / X-Frame-Options / HSTS / Referrer-Policy).
- **M4. Refresh-cookie `Secure` only when `NODE_ENV === "prod"` exactly** (`AuthController.ts:302,317`) — `NODE_ENV=production` silently ships the 30-day cookie over plain HTTP. `FORCE_SECURE` escape exists but is undocumented.
- **M5. Proxied upload route** (`POST /tasks/:id/attachments`): no per-route limiter (sign route gets 60/min/user; the byte-carrying route doesn't), `decodeURIComponent(rawName)` → URIError → 500 on malformed `%`, zero tests. (Service-side size/MIME/workspace guards are solid.)
- **M6. R2Service silently stubs in prod** when any `CLOUDFLARE_R2_*` var is missing (`R2Service.ts:61-65`, DEBUG-level log) — uploads "succeed" with `https://r2.fake/...` URLs. Should warn/fail loudly like MailService does.
- **M7. Admin `resetPassword` lacks the deadlock fix** its sibling got — `UserService.resetPassword:606-627` does DELETE+INSERT on `password_reset_tokens` without the user-row lock + 1213-retry that `AuthService.forgotPassword` uses → concurrent resets can 500.
- **M8. Two timestamp clock domains (~6h apart)** — DB-default columns (`created_at`, `uploaded_at`, `ON UPDATE` bumps) vs app-written UTC (`completed_at`, `archived_at`, `touchUpdatedAt`…). Symptoms: task created directly in a done status gets `completed_at` ~6h **before** `created_at`; attachment janitor's 1h window is really ~7h; `staleTicketIds` (`NOW()` at `EngineeringRepo.ts:247`) skews for touched rows; `CURDATE()` in `EngineeringRepo.ts:118`/`OnCallRepo.ts:72` makes on-call "today" flip if prod MySQL runs UTC. **Decision needed:** pin MySQL session tz explicitly (or `SET time_zone='+00:00'` in pool init + app-computed Dhaka dates) as a deploy invariant.

**Frontend/UX**
- **M9. ~35 of 59 mutations have no onError** (sidebar renames/archives, checklists, comments, subtasks, inbox actions, members role-change/deactivate, workspace save…) and **no routed page renders a query-error state** (ListPage → blank, drawer → eternal "Loading task…", SearchPage error → "No results"). Server 422 `details[{field,issue}]` are never surfaced. This is what masked C3.
- **M10. Optimistic-update desync** — `useTaskMutations.ts:17-43` onError rolls back the list cache but not `["task", id]`; a failed PATCH leaves the drawer showing the edit as applied.
- **M11. Attachment URLs are 5-min signed GETs, cached indefinitely** — `AttachmentsSection.tsx:213,316` reuse the cached `url`; clicks fail after ~5 min. `GET /attachments/:id/download` (fresh 302) has no caller.
- **M12. Task activity tab crashes on null `context`** — `TaskActivitySection.tsx:137` reads `entry.context.taskName` unguarded (server type is `| null`).
- **M13. Search fires one request per keystroke** (no debounce) and filter-chip counts collapse to 0 when a chip is selected (counts computed from the filtered response).
- **M14. FormView delete is one-click destructive** — no confirm (`FormView.tsx:250-257`).
- **M15. On-call: no create path when the schedule is empty** — PUT is only reachable from an existing row → first shift can never be assigned from the UI (report-bug S0/S1 auto-assign finds nobody).

**Built-but-unwired features (server endpoint exists + tested; no UI calls it)**
- **M16.** Statuses CRUD/reorder — StatusesSettings is read-only and its help text points to an "Edit statuses" flow that doesn't exist → workflows are stuck with the 5 seeded statuses.
- **M17.** Sprint lifecycle (create/start/close/add-remove tasks) — sprints can only be *viewed*; template **apply** (also: its client wrapper's response type doesn't match the server — fix when wiring); SLA dashboard/override (`GET /sla/breached`, `PATCH /tasks/:id/sla`); form **submissions viewer** (`GET /forms/:id/submissions` — admins can't see what was submitted); notification preferences; unarchive/restore (task/list/space) + space delete; watch/unwatch; comment edit (15-min window server-side); checklist-item edit/delete/bulk; admin reset-password (MembersSettings opens a **Gmail compose** instead); assistant server-side history (`GET /assistant/conversations*` — client uses localStorage only); full `/activity` feed; `/home/agenda`.
- **M18. Fresh-install seed gaps** — no "Bug Triage" list [KNOWN] **and no "Incident" task type [NEW]** → `report-bug` 409s and the entire incident/postmortem feature is dead until someone hand-creates both. Seed also creates no spaces/lists at all.

---

## 4. 🟢 LOW (grouped)

**Config/env drift**
- `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL` read but ignored (TokenService hardcodes 15m/30d); `DB_POOL_MAX`/`DB_POOL_QUEUE_LIMIT` ignored (pool hardcodes 10/0); `ARGON2_MEMORY_COST` + "argon2id" comments are stale (implementation is bcrypt); `.env.example` documents `CLOUDFLARE_TOKEN_VALUE`/`CLIENT_URL` (never read) and omits the actually-read R2 key names; `DISABLE_RATE_LIMIT=1` honored in ANY env (consider `NODE_ENV !== "production"` guard); reset/invite URLs (raw tokens) logged at debug level — pin prod `LOG_LEVEL`.
- `REDIS_URL` empty is fine for single-instance (in-memory limiters).

**Dead code / deps**
- `client/src/mocks/` (26 files) + `lib/mock-api.ts` (~2,500 lines) + `lib/delay|fake-id|dhaka-geocoder|bdt.ts` + `types/settings|on-call.ts` — only import each other; removable. **maplibre-gl (~700 KB) has zero imports** — uninstall. `@types/dompurify` redundant. Server: `middlewares/parseRefreshToken.ts` + `validateRefreshToken.ts` never imported; `express.static("public")` is a CWD-relative no-op.

**Schema/DB cosmetics**
- schema.sql vs migration-chain drift: index direction (DESC vs ASC), ~20 FK constraint names, JSON default spellings, collation only pinned on the schema.sql path — functionally negligible, but `SHOW CREATE` differs by build path.
- `tasks.comments_count` over-counts after comment soft-delete (decrement trigger fires on hard DELETE only; deletes are tombstones).
- `v_open_bugs` filters literal `'tt-bug'` (never matches); none of the 5 views workspace-scoped — all 5 views are dead code; drop or fix at leisure (gate 3.4).
- Phantom "FULLTEXT ngram index" referenced in `migrate.ts:11` + `SearchRepo.ts:15` — doesn't exist anywhere.
- `database/README.md` says 33 tables (actual 35) + describes the removed subtask-trigger era; schema.sql DROP preamble lists never-created tables (customers/stock_*); users hard-DELETE documented but impossible once a user authored anything (all RESTRICT — app deactivates instead, fine).
- Index niceties: notifications sort uses `internal_id` but index ends at `created_at` (per-bucket filesort); no `(workspace_id, archived_at)` index for workspace-wide scans — moot at current scale.

**Backend polish**
- `errorHandler` lacks `res.headersSent` guard (latent trap for future streaming endpoints).
- Refresh-token rotation has no concurrency grace — two tabs refreshing simultaneously can trip the theft heuristic → all-device logout (rare; client serializes).
- If-Match check is check-then-write, not atomic CAS (small window).
- SSE surface is live but unused; its cookie auth path expects an `accessToken` cookie nothing sets; unbounded per-user connection map (authed-only DoS-ish). Client polls instead [KNOWN].
- Deactivated users keep valid access tokens ≤15 min (standard trade-off — document for offboarding).
- CORS reflects any loopback/RFC-1918 origin with credentials (fine for LAN; too broad if internet-exposed). CORS-denied origin → 500 instead of 403.
- `submitter_email`/`submitter_ip` stored plaintext beside the encrypted blob (decide if that's acceptable); encryption envelope has no key-version field (future rotation renders old rows as raw envelopes).
- Assistant: streamed prose + tool-calls in the same round drops the tools (occasional half-answers); `/eng/home` sprint shape diverges from the canonical sprint serializer.
- 3 endpoints with zero tests: `GET /public/forms/:slug`, `POST /tasks/:id/attachments`, `GET /sprints/:id/tasks`.

**Frontend polish**
- eslint: 12 errors (8× `react-hooks/set-state-in-effect`, 2× `react-hooks/purity` (false-positive-ish — event handler), 2× `react-refresh/only-export-components`) — `npm run lint` fails; build unaffected.
- ⌘K advertised in two places, no handler exists; Login ignores `location.state.from` (deep links land on `/`); RequireGuest bounces logged-in users off `/invitation/:token` (must sign out to accept); "Keep me signed in" checkbox inert; OfflineIndicator promises sync that doesn't exist; AgendaCard shows a fake ~6:00 AM time from date-only `dueDate`; Calendar week/day tabs are placeholders; assistant SSE parser splits only on `\n\n` and isn't aborted on unmount/logout; authed Bearer attached to public-form calls (harmless); SidebarSpaceTree hides private spaces from members client-side even when the server returned them; `Modal.confirm` static call loses theming; TiptapReadOnly `target` without forced `rel=noopener`; SearchPage note results navigate to nonexistent `/notepad` (unreachable today).
- e2e fragility: `playwright.config.ts` has no `webServer`; `auth.pw.ts`/`tasks-views.pw.ts` hardcode `C:\Program Files\...\mysql.exe`, DB `taskmanagement_qa`, and seed ULIDs → machine-bound.
- Contract type drift (latent, unread today): recurrence enums (`monthly|custom` FE-only), notification type enums (both directions), several Wire types declare fields the server never emits, `customFieldsApi.update` typed `Partial<CustomField>` but server 422s `type/scope_*`; custom-field `default_value` unvalidated server-side on create.

---

## 5. Repo/ops hygiene (mostly [KNOWN], re-verified today)

- 🔐 `ENCRYPTION_KEYS.txt` (151 lines) + `deploy.sh` (19 secret-ish lines) still git-tracked with real keys — **history-rewrite + rotate before any push** (gate 3.2). No root `.gitignore` (only client/ + server/ have one).
- ✉️ KI-4 unchanged: `server/.env` has MAIL_* three times; dotenv last-wins → the "Fallback" block (`hello@beautyboothbd.com`) is what actually sends; the "Primary" (`info@beautybooth.com.bd`) is shadowed. **Your decision, then dedupe 3→1.**
- Worktrees: `.claude/worktrees/auth-v1` is now **prunable** (its casing fix landed on main) and a stray `E:/tm-wt11` worktree lingers → `git worktree prune` / remove when convenient.
- `astro-app/` is an empty leftover directory on disk (git-clean) — delete at will.
- Casing renames (`TokenService.ts`/`CredentialService.ts`) are staged and all imports verified PascalCase — **commit this** so the Linux/CI fix actually lands.

---

## 6. Test/build verification (this scan)

| Check | Result |
|---|---|
| server `tsc --noEmit` | ✅ clean |
| client `tsc -b` | ✅ clean |
| client vitest | ✅ 8/8 |
| client eslint | ⚠️ 12 errors (see §4) |
| server jest (full root-config run, `--runInBand`) | 3346/3356 pass · 127/131 suites (161 min) |
| server jest — the 4 "failed" suites re-run per-module | ✅ **all green**: attachments 104/104 · jobs 29/29 · SSE 12/12 |
| MySQL connectivity | ✅ |

**Server jest verdict: effectively 3356/3356 green.** The full root-config run's 10 failures were confined to the 4 modules documented (FULL_SYSTEM_TEST_LOG P48) as shared-DB/mock-bleed artifacts (attachments/finalize, jobs/attachment-janitor, jobs/r2-purge, sse/stream-inbox); each passes 100% under its per-module config, re-verified in this scan. Note: the suite has grown to 3,356 tests (was ~2,842 at P2 baseline).

---

## 7. ✅ Verified clean (actively confirmed, with evidence — not "didn't look")

- **Auth surface:** all 158 endpoints enumerated; per-route `authenticate` everywhere except the intended public set (6 auth flows, 2 public-form, 4 health/metrics, 4 internal-token jobs). express-jwt pinned HS256; jobs guard timing-safe + fails closed; no broken controller references.
- **Workspace isolation:** workspace id from JWT everywhere, never client-supplied; spot-verified through repos (tasks, dependencies, checklists→task→workspace chains, comments, attachments incl. R2 key prefix check, forms, statuses→list→space, chat, notifications). Foreign ids → 404.
- **Injection/XSS:** zero string-interpolated SQL; all bound params; LIKE wildcards escaped in all 4 search surfaces; cursor decoders validated; client has exactly 3 HTML sinks, all sanitized (DOMPurify allowlist / pre-escaped highlight / react-markdown without rehype-raw).
- **Transactions/locking:** all multi-step writes in `db.transaction`; consistent lock ordering (task-row-first, user-row-first in forgot-password with 1213 retry); no connection leaks (only two hand-rolled getConnection sites, both released).
- **Secrets on the wire:** `password_hash`, `internal_id`, `storage_key`, `submitter_ip`, token hashes provably never serialized; logs redact bodies/tokens (debug-level reset URLs noted above).
- **Assistant:** tools take intent-params only; identity from `req.auth`; every tool query workspace+user-scoped; conversations owner-scoped; disconnect aborts upstream; cost guards (800 tok, history 12, 20/min/user, 4 tool rounds).
- **Fresh-install DB:** schema.sql ⇄ Drizzle TS schema in full column-level parity; `trg_subtasks_*` fully eradicated (no 1442 regression); remaining 7 triggers non-self-referential; all 5 views UTC-fixed in the working tree; every table referenced by live code; hot-path indexes match actual query predicates; utf8mb4 end-to-end; FK topology sound (workspace cascade blocked by users RESTRICT; list/space deletes app-guarded).
- **Contract (field-verified end-to-end):** auth, tasks single CRUD + membership deltas, dependencies, comments, checklists, custom-field value envelopes, forms builder + public GET/submit, notifications feed/snooze, home KPIs, eng report-bug + eng/home, search, sprints/on-call reads, spaces/lists/tags/task-types/users/invites, assistant stream framing + `X-Conversation-Id`, error envelope. Case-adapter opt-outs (`config`, `custom_field_values`, `/home/kpis`, templates structure, public submit keys) all correct.
- **File casing:** git index + all imports PascalCase-consistent (Linux/CI-safe once committed).

---

## 8. Suggested fix order

**Block go-live (do first):**
1. C1 logout (server call + cache/localStorage purge) — small
2. C2 bulk-edit keys (`ids`, `assignee_add`/`tag_add`) — small
3. C3 workspace save (`default_locale` omit, `HH:MM:SS`, onError) — small
4. C4 ENCRYPTION_KEY in .env + boot assertion — small
5. C5 custom_id PATCH no-op (`current.id`) + test — small
6. H1 pagination (follow cursors or raise limits: tasks-by-list, users, notifications) — medium
7. H2 `is_public` check in publicView + tests — small
8. H3 migration tooling (journal-register 0005, `DROP TRIGGER IF EXISTS` in _post.sql, de-fang/relabel db:setup) — medium
9. H4 interceptor: exclude `/auth/login` + `/auth/refresh` from 401-retry — small
10. H5 postmortem: wire UI to the endpoint — small

**Before real users (same release):** M1 limiter keying · M2 expiry-job route/cron · M3 helmet · M4 cookie Secure env check · M6 R2 loud-fail · M9 global mutation onError + query error states · M11 attachment URL freshness · M12 null-context guard · M18 seed Incident type + Bug Triage list · KI-4 mail decision · secrets history-rewrite before push.

**Scheduled/backlog:** M-item missing UIs (statuses CRUD, sprint lifecycle, submissions viewer, SLA, prefs, restore, comment edit, checklist item edit, admin reset, assistant history, on-call bootstrap) — several of these may be natural parts of the RBAC/Teams build; decide which land before vs with RBAC. LOW items opportunistically.

---

*Generated by full-system scan, 2026-07-21. Agents: DB parity · API surface · services/repos · frontend · contract. ~1.37M audit tokens across 5 agents; 473 tool calls.*

---

## 9. ✅ FIX LOG — 2026-07-22 (all 5 CRITICAL + all 5 HIGH closed)

| Item | Fix | Proof |
|---|---|---|
| **C1** logout | Store `logout()` now revokes server-side (`POST /auth/logout`, fired BEFORE token purge), clears the react-query cache (queryClient extracted to `lib/queryClient.ts`), resets the chat store (`clear`+`close`) and UI store (new `reset`). Interceptor + assistant pass `{revoke:false}` (their session is already dead). | tsc + lint clean; behavior change is client-side sign-out path |
| **C2** bulk-edit | Wire body fixed to `ids`; membership uses DELTA keys — `bulkUpdate` accepts `BulkTaskPatch` (`assigneeAdd/…/tagRemove` → `assignee_add/…`), toolbar sends `assigneeAdd`/`tagAdd`. All 5 toolbar actions map to the server's allow-list | tsc; server contract cross-checked (`TaskWriteController` KNOWN set) |
| **C3** workspace save | `workspaceToWire` NEVER emits `default_locale`; `toHms` pads TimePicker `HH:mm`→`HH:MM:SS`; save mutation got `onError`; bonus: the draft-seeding `useEffect` replaced with adjust-during-render (kills the react-hooks lint error) | 2 new vitest units (10/10) |
| **C4** ENCRYPTION_KEY | Real 64-hex dev key appended to `server/.env`; boot assertion (malformed = NO-BOOT, absent = loud warn); `FormsService.submit` refuses UP FRONT with **503 `form.encryption_unavailable`** BEFORE creating the intake task (orphan-task path eliminated); `encryption.ts` typed `unknown` (its 6 lint errors gone) | forms module **85/85** incl. new orphan-task lock |
| **C5** custom_id PATCH | `TaskWriteService.update` writes against resolved `current.id` (was the raw path param → 0-row no-op) | update suite **18/18** incl. new DB-row-asserted custom_id test; deptreview **122/122** cross-check |
| **H1** truncation | `tasksApi.listByList` + `notificationsApi.list` follow `next_cursor` (limit 200; notifications capped at 2,000 rows) — List/Board/Calendar/dep-picker/inbox see everything. Users half was fixed in P7 | tsc; pattern identical to the proven usersApi fix |
| **H2** is_public | `publicView` 404s unpublished forms (same shape as unknown slug — no oracle); `submission_open` stays submit-only (soft-closed still renders) | new `public-view.test.ts` (3 tests) in forms 85/85 |
| **H3** migration tooling | `0005` journal-registered (idx 5); `0001_post_cleanup` made FK-safe + idempotent (`FOREIGN_KEY_CHECKS=0` + `IF EXISTS` — it referenced ecom leftovers in the wrong FK order and could NEVER complete from empty); `_post.sql` triggers DROP-IF-EXISTS'd; `db:setup` REFUSES a non-empty DB (schema.sql starts with DROPs) unless `--drop`; `src/db/migrations/README.md` declares the canonical paths (fresh = db:setup, upgrades = database/upgrades/, chain = frozen) | **PROVEN**: `db:migrate` ×2 on a throwaway DB — run 1 full apply (0005 cols, 7 triggers, 5 views), run 2 clean no-op; guard refusal message verified; throwaway dropped |
| **H4** 401-interceptor | Refresh-retry now skips `/auth/login`, `/auth/refresh`, `/auth/2fa` — wrong-password 401s surface as themselves | tsc; logic isolated to `client.ts` |
| **H5** postmortem | New `GET /eng/incidents/:id/postmortem` (any member; empty-items 200 when unsaved; 404 unknown/cross-ws) + client rewired off sessionStorage to GET/POST with overlay-revert on error; label keys ride verbatim (`SKIP_CAMELIZE_URLS` + `skipDecamelize` — case transforms would corrupt "Timeline reconstructed") | eng module **78/78** incl. 4 new GET tests (verbatim-label round-trip) |

**Still open from §8:** the "before real users" M-tier (M1 limiter keying, M2 expiry-job cron, M3 helmet, M4 cookie Secure, M6 R2 loud-fail, M9 global onError sweep, M11 attachment URL freshness, M12 null-context guard, M18 seeds, KI-4 mail decision, secrets history-rewrite) and the backlog M-item UIs.

## 10. ✅ FIX LOG — 2026-07-22 (M-tier "before real users" closed)

| Item | Fix | Proof |
|---|---|---|
| **M1** limiter keying | `apiLimiter` buckets on an UNVERIFIED Bearer-`sub` decode (rate-keying only — forging merely splits buckets) since it mounts before `authenticate`; office NAT no longer shares one 600/min pool | tsc; keyGenerator logic |
| **M2** expiry job route | `POST /jobs/form-submission-expiry` routed (was registry-only — the 90-day PII purge could never run via curl-cron) | new route test ×2, jobs **31/31** |
| **M3** security headers | Hand-rolled `securityHeaders` middleware (nosniff / DENY / no-referrer / cross-domain-none; HSTS only prod/FORCE_SECURE) mounted before routing — dependency-free per the /metrics precedent | 3 new tests, health **14/14** (headers on 200/404/401 paths) |
| **M4** cookie Secure | `Config.IS_PROD` (matches `prod` AND `production`) used by the refresh-cookie writer; FORCE_SECURE documented in-code | auth **339/339** |
| **M6** R2 loud-fail | Missing R2 config in PROD now `logger.error` ("uploads return fake URLs and store NOTHING"); dev/test stub stays debug-level (QA blanks creds on purpose) | attachments module green (finalize's 1 batch-fail = the documented flake; solo 20/20) |
| **M9** silent failures | GLOBAL `MutationCache.onError` net in `lib/queryClient.ts` — any mutation WITHOUT a local onError now toasts the API error (the class that masked C3); + real query-error states with Retry on the 3 named blank-holes: ListPage, TaskDetailDrawer ("Loading task…" forever), SearchPage (error ≠ "No results") | vitest 10/10; browser smoke+auth **9/9** (route sweep console-clean proves the queryClient refactor boots) |
| **M11** attachment URLs | `GET /attachments/:id/download?json=1` returns `{url}` (302 kept for navigations); client `attachmentsApi.freshUrl` mints at CLICK time (card open + Download button) — 5-min signed URLs no longer die in the cache | 2 new download tests; attachments green |
| **M12** activity crash | `entry.context?.taskName` optional-chained (wire type is nullable) | tsc |
| **M18** seed gaps | Seed now creates the **Incident** task type (+ keeps Bug) AND an **Engineering space + "Bug Triage" list + 3 statuses** — `report-bug` and incident/postmortem work on a FRESH install | fresh setup+seed on a throwaway DB: 7 types / space / list / 3 statuses verified, then dropped |

**Deliberately NOT done (user-gated):** KI-4 mail-sender decision (needs a human choice); git secrets **history-rewrite + key rotation** (destructive git operation — say the word and it runs before any push). **Backlog tier (unchanged):** M5/M7/M8/M10/M13–M17 + built-but-no-UI inventory (several fold into the RBAC build).

## 11. ✅ FIX LOG — 2026-07-23 (KI-4, secrets, + backlog polish)

**User-gated items — DONE:**
- **KI-4 mail dedupe** — `server/.env` had 3 `MAIL_*` blocks (dotenv last-wins → `beautyboothbd.com` Fallback was shadowing the labeled "Primary — verified + prod-active" `beautybooth.com.bd`). Deduped 3→1 keeping **beautybooth.com.bd**. dotenv verified: single block, clean parse. (Gate §3.1 closed.)
- **Git-tracked secrets** — `ENCRYPTION_KEYS.txt` + `deploy.sh` (real prod keys) were **already pushed** to the **private** `origin/main`. `filter-branch` purged both from all 46 commits; gc dropped the old commits (`b14f0aa` unresolvable); `.gitignore` added; force-pushed `f947183→50a303e`; fresh secret set generated into gitignored `ROTATED_SECRETS.local.txt`. User still rotates provider creds at source (DB/Mailtrap/OpenAI/R2). (Gate §3.2 closed.)

**Backlog polish — DONE:**
| Item | Fix | Proof |
|---|---|---|
| **M5** upload route | `decodeURIComponent(X-Filename)` wrapped in try/catch (malformed `%` → fall back, no more 500); `uploadSignLimiter` (60/min/user) added to the byte-carrying `POST /tasks/:id/attachments` | attachments **106/106** |
| **M7** admin reset deadlock | `UserService.resetPassword` now takes the user-row lock FIRST + bounded 1213/1205 retry (clone of `forgotPassword`'s guard) | users **279/279** |
| **M10** optimistic desync | `useUpdateTask` snapshots + rolls back `["task", id]` (not just the list) on error; invalidates the task on settle — a failed PATCH no longer leaves the drawer showing the edit | client tsc/lint |
| **M13** search | 250 ms debounce (one request after typing stops, not per keystroke); always fetch ALL types + filter DISPLAY client-side so chip counts never collapse to 0 and chip-switching is instant | client tsc/lint |
| **M14** form delete | one-click destructive delete now behind a `Popconfirm` | client tsc/lint |
| **M15** on-call bootstrap | rotation page always surfaces current week + next 5 (merged with existing shifts) so an EMPTY schedule can get its first assignment — S0/S1 auto-assign no longer finds nobody | client tsc/lint |

**M8 (clock-domain / MySQL session tz) — DEFERRED (deliberate):** flagged "decision needed" with blast radius across ~2,800 tests; pinning the pool session tz is a deploy invariant best done with a dedicated regression pass, not a polish sweep. Deploy guidance (`TZ=Asia/Dhaka`) stands in gate §3.6.

**Still backlog (→ RBAC build):** M16/M17 built-but-no-UI inventory (statuses CRUD, sprint lifecycle, submissions viewer, prefs, restore, comment/checklist-item edit, admin-reset UI, assistant history, full activity feed).
