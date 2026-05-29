# API Development Prompts

A four-phase workflow for building APIs perfectly, one endpoint at a time.

---

## When to use each prompt

| Prompt | Use frequency | When to use |
|---|---|---|
| **Prompt 1 — System Scan** | **Once**, at the very start of API development work | Run this before starting work on the very first endpoint. It builds a shared mental model of the codebase that all later work depends on. Do NOT re-run for each endpoint. |
| **Prompt 2 — Per-API Planning** | **Once per endpoint** | After Prompt 1 (or after a previous endpoint is finished), run this when starting a new endpoint. Claude will ask which endpoint, then produce a step-by-step implementation plan. |
| **Prompt 3 — Per-API Implementation** | **Once per endpoint** | Run after Prompt 2's plan is accepted. Claude will ask which endpoint (same one), then write the code. |
| **Prompt 4 — Per-API Testing** | **Once per endpoint** | Run after Prompt 3 ships clean code. Claude will ask which endpoint, then write + run tests exhaustively and fix every issue found until zero remain. |

Each of Prompts 2, 3, and 4 starts by asking you which endpoint to work on. You provide one endpoint (HTTP method + path) per cycle. Then Claude scopes its scan to only what's relevant for that endpoint — keeping work tight even when the codebase is large.

---

## Phase 0 — Project Initialization (use ONCE)

Copy the prompt below verbatim and paste it as your first message of the session. Claude will produce a structured project map and save key findings to memory so every future endpoint can reuse the context.

> **Why this matters:** without a clean baseline scan, Claude will keep re-discovering the same architectural facts at the start of every endpoint, wasting tokens and risking inconsistency. Doing it once, well, is much cheaper.

### PROMPT 1 — System Scan

```text
You are about to begin a long, multi-endpoint API development engagement for this
project. Before any code is written, build a complete, accurate mental model of
what exists today. I will run this exact prompt only ONCE at the start. Future
prompts will assume the findings here are already established.

Do not write or modify any application code in this turn. Read-only work.

═══════════════════════════════════════════════════════════════════════════════
PART A — DISCOVERY
═══════════════════════════════════════════════════════════════════════════════

1. Discover all project documents. Look for, at minimum:
   - README, CONTRIBUTING, architecture/design docs
   - Requirements/spec files (any *.md describing what the system should do)
   - API contract / endpoint catalog (any *.md or OpenAPI/Swagger file)
   - Database schema files (raw SQL, migration directories, ORM schema)
   - Environment templates (.env.example or equivalent)
   - Package manifests (package.json, go.mod, pyproject.toml, Cargo.toml — whatever applies)
   - Linter / formatter / typecheck configs
   - Test configs (jest/vitest/pytest/etc.)
   - Build / deploy configs (Dockerfile, CI workflows, Vercel/Render config)
   List the documents you found and a one-line purpose for each.

2. Identify the technology stack from the manifests and configs:
   - Backend runtime + framework
   - Database engine + ORM/query builder
   - Authentication mechanism (cookies/JWT/session)
   - Validation library
   - Logging library
   - Test framework
   - Frontend stack (if present) — only enough detail to know how it calls the API

3. Identify the repository layout:
   - Where is backend source? Where is frontend? Are they separate packages?
   - Where do routes, controllers/handlers, services, middlewares, validators,
     repositories, and DB schema live? Note the exact directories.
   - Where do tests live? What naming convention?
   - Where do migrations live?

═══════════════════════════════════════════════════════════════════════════════
PART B — SPECIFICATION
═══════════════════════════════════════════════════════════════════════════════

4. Read the API contract/spec document end-to-end. Produce:
   - Total endpoint count
   - Section/grouping structure
   - Conventions documented (auth header, pagination shape, error envelope,
     idempotency, rate limits, status code policy, soft-delete semantics, etc.)
   - Any reusable type definitions

5. Read the database schema (raw SQL source of truth, not just the ORM mirror).
   For each table list: purpose in one line, primary key type, key indexes,
   foreign keys to other tables, and any triggers/views that depend on it.
   Note any tables present in the ORM but NOT in the raw schema, or vice versa.

6. Read the ORM/query-builder schema. Confirm it mirrors the raw schema. Flag
   any column-level drift (different type, missing column, missing constraint).

═══════════════════════════════════════════════════════════════════════════════
PART C — CURRENT IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

7. Inventory what's already implemented on the backend:
   - List every route currently wired up (HTTP method + path).
   - For each, identify the controller/handler and service it delegates to.
   - Note which routes have validators, which have permission middleware,
     which have tests.

8. Inventory the supporting infrastructure that any new endpoint can reuse:
   - DB client / connection / pool setup
   - Auth middleware(s)
   - Role / permission helpers
   - Validation primitives
   - Error response builders / global error handler
   - Logger
   - ID/UUID generators
   - Hashing / token utilities
   - Pagination helpers
   - Test fixtures, factories, in-memory DB setup
   Quote the imports the rest of the codebase uses so future endpoints follow
   the same patterns.

9. Inventory the frontend's expected API surface, if a frontend exists. Look
   at how the frontend calls the backend (axios/fetch wrappers, query keys,
   mock-API shape). The response shape it expects is part of the contract.

═══════════════════════════════════════════════════════════════════════════════
PART D — GAP ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

10. Cross-check three sources of truth: the spec document, the database schema,
    the implemented routes. List:
    - Endpoints in the spec but NOT yet implemented (these are the work queue).
    - Endpoints implemented but NOT in the spec (drift to investigate).
    - Tables referenced by the spec but missing from the schema, or vice versa.
    - Enum values that differ between spec, schema, and any types file.

11. Note any cross-layer inconsistencies that might trip up new work:
    - Naming conventions (snake_case vs camelCase between layers)
    - ID type (integer vs string/UUID)
    - Timestamp format (ISO string vs epoch)
    - Date handling / timezone assumptions

═══════════════════════════════════════════════════════════════════════════════
PART E — OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Produce a final report in this exact structure:

1. **Stack** (one paragraph)
2. **Repository layout** (table of directory → purpose)
3. **Spec summary** (where the contract lives, total endpoints, conventions)
4. **Database summary** (total tables, key relationships, anything unusual)
5. **Implemented endpoints** (table of method + path + handler file)
6. **Pending endpoints** (the queue we will work through)
7. **Reusable infrastructure** (table of utility → import path)
8. **Cross-layer drift / risks** (bulleted list)
9. **Conventions to follow** (bulleted list — naming, error shape, auth, etc.)

After printing the report, save a CONDENSED version of items 1, 2, 3, 7, and 9
to long-term memory under a name like `project_api_baseline` so it can be
recalled by future sessions. Do not save the pending-endpoints list to memory —
that changes as work progresses.

Quality bar: a fresh teammate reading your report should be able to start work
on any endpoint in the queue without re-scanning the codebase.

If anything in the codebase contradicts itself (e.g., spec says one thing,
schema says another, frontend expects a third), surface it in Part D — do not
silently pick one. I want to know.
```

---

## Phase 1 — Per-API Planning (use FOR EACH endpoint)

Copy the prompt below and paste it when starting a new endpoint. Claude will ask which endpoint, then produce a tight implementation plan you must accept before code is written.

> **Why this matters:** thinking before coding catches misunderstandings of the spec, missing edge cases, and wrong patterns *before* they are committed. The plan is also the contract that Prompt 3 must follow.

### PROMPT 2 — Per-API Planning

```text
We are about to add or complete one API endpoint. Before any implementation,
build a precise, exhaustive plan. Do not write application code in this turn.

═══════════════════════════════════════════════════════════════════════════════
STEP 0 — ENDPOINT INTAKE
═══════════════════════════════════════════════════════════════════════════════

First, ask me: "Which endpoint should we plan? Please give the HTTP method and
path exactly as it appears in the API spec (for example: POST /api/v1/tasks)."

Wait for my reply. Do not guess and do not start work until you have it.

═══════════════════════════════════════════════════════════════════════════════
STEP 1 — SCOPED CONTEXT REFRESH
═══════════════════════════════════════════════════════════════════════════════

Once I give you the endpoint:

1. Locate the spec entry for this endpoint in the API contract document. Quote
   the request shape, response shape, status codes, query params, and any
   notes verbatim. If anything is ambiguous, list the ambiguity.

2. Re-read the parts of the codebase relevant to this endpoint ONLY:
   - The exact table(s) it reads/writes, in both the raw schema and the ORM.
   - Adjacent endpoints in the same resource family — copy their patterns.
   - Validator and middleware modules used by similar endpoints.
   - The frontend caller(s) of this endpoint (if a frontend exists) — confirm
     it expects what the spec promises.

3. Recall the baseline established by Prompt 1 (conventions, reusable utilities)
   from long-term memory. If the codebase has grown since then, briefly note
   any new infrastructure relevant to this endpoint.

═══════════════════════════════════════════════════════════════════════════════
STEP 2 — DEEP ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

4. Trace the full request → response flow you will implement:
   - Which middleware runs (CORS, auth, role check, rate limit, validator)?
   - Which handler receives the validated request?
   - Which service method does the work?
   - Which repository / DB calls happen, in what order?
   - Which response shape is returned for each status code?

5. Enumerate every error case the endpoint must handle. For each, write the
   exact (status code, error code) pair and trigger condition:
   - Authentication missing / expired
   - Authorization (per role)
   - Validation per field (each rule independently)
   - Resource not found
   - Conflict (duplicate, optimistic-lock mismatch)
   - Cross-tenant access attempt (workspace isolation)
   - Stale / archived resource
   - Foreign-key violations
   - Rate / payload limits

6. Enumerate the edge cases that can silently produce wrong data:
   - Null / undefined / empty string in optional fields
   - Boundary values (zero, negative, max length, max number)
   - Concurrent writes on the same resource (race conditions)
   - Idempotency: what if the client retries with the same Idempotency-Key?
   - Pagination off-by-one, empty result set, cursor stability across writes
   - Time-zone / DST drift on date inputs
   - Unicode (emoji, RTL, combining marks) in text inputs
   - Soft-deleted records being treated as still present
   - Trigger / counter columns getting out of sync

7. Identify security concerns specific to this endpoint:
   - SQL/NoSQL injection vectors (any string passed into a query)
   - Mass-assignment (untrusted fields being written to the DB)
   - Privilege escalation (a Member elevating themselves to Admin)
   - Insecure direct object references (IDs from other workspaces)
   - Sensitive data leaking into logs or responses

8. Identify performance concerns:
   - Which index supports the main query? Confirm it exists.
   - Any N+1 patterns? How will they be avoided?
   - Transaction scope — what must be atomic, what must not block.

═══════════════════════════════════════════════════════════════════════════════
STEP 3 — WORK BREAKDOWN
═══════════════════════════════════════════════════════════════════════════════

9. List every file you will create or modify, in dependency order. For each,
   one line of intent. Examples:
   - "Create: src/services/X.ts — domain logic + DB writes for this endpoint"
   - "Modify: src/controllers/Y.ts — add handler method, wire to router"
   - "Create: src/validators/Z.ts — Zod/Joi/express-validator schema"
   - "Modify: src/routes/W.ts — register the new route with middleware chain"

10. Specify the test plan — list every test case (one bullet per test, written
    as "GIVEN ... WHEN ... THEN ..."), grouped by category:
    - Happy path
    - Validation
    - Auth / permissions
    - Not-found / conflict / archived
    - Tenant isolation
    - Idempotency / concurrency
    - Boundary / edge values
    - Performance (if applicable — e.g., 1000-row pagination)

═══════════════════════════════════════════════════════════════════════════════
STEP 4 — OPEN QUESTIONS
═══════════════════════════════════════════════════════════════════════════════

11. If anything in the spec is ambiguous, contradicts another layer, or seems
    risky, list it as an explicit open question with the options and your
    recommendation. Do not invent an answer to ship the plan.

═══════════════════════════════════════════════════════════════════════════════
STEP 5 — OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Print the plan in this structure:

1. **Endpoint** — method + path + one-sentence purpose
2. **Spec excerpt** — quoted from the contract doc
3. **Request → response flow** — numbered list of middleware → handler → service → DB
4. **Error matrix** — table of (status, error code, trigger)
5. **Edge cases handled** — bulleted list
6. **Security checks** — bulleted list
7. **Performance plan** — bulleted list
8. **Files to touch** — ordered list with intent
9. **Test plan** — categorised list of GIVEN/WHEN/THEN cases
10. **Open questions** — numbered list with recommendation; mark "NONE" if there are none

End with: "Reply 'go' to implement this plan in Prompt 3, or tell me what to
adjust." Do not start implementation in this turn.

Quality bar: the plan should be complete enough that Prompt 3 could be executed
by any teammate (or a fresh Claude session) and produce an identical result.
```

---

## Phase 2 — Per-API Implementation (use FOR EACH endpoint)

Copy the prompt below after the plan from Prompt 2 has been accepted. Claude will ask for the endpoint (same one as the plan), then implement strictly to the plan.

> **Why this matters:** separating planning from implementation forces Claude to commit to a design before typing. It also makes deviations visible — if the implementation drifts from the plan, you catch it.

### PROMPT 3 — Per-API Implementation

```text
We are now implementing the endpoint we just planned. Build it cleanly,
exactly to the plan, following the project's existing conventions.

═══════════════════════════════════════════════════════════════════════════════
STEP 0 — ENDPOINT INTAKE
═══════════════════════════════════════════════════════════════════════════════

First, ask me: "Which endpoint are we implementing now? Please confirm the
HTTP method and path so we are working from the right plan."

Wait for my reply. If a plan from Prompt 2 exists in this conversation,
re-read it. If not, ask whether I want you to produce one first (do not
write code without a plan).

═══════════════════════════════════════════════════════════════════════════════
STEP 1 — CONVENTION CHECK
═══════════════════════════════════════════════════════════════════════════════

Before writing any code:

1. Open two or three of the closest existing endpoints in the same resource
   family (or the same module). Confirm:
   - File / class / function naming pattern
   - How handlers receive params, validate, delegate, respond
   - How services use the DB client and handle transactions
   - How errors are thrown and rendered
   - How responses are shaped (envelope vs raw, casing, date format)
   - How auth/role checks are wired
   - How tests are organised
   New code must look like the rest of the codebase, not like a stylistic island.

2. If the plan calls for a utility that doesn't yet exist (e.g., a pagination
   helper, an ID generator), check whether the codebase already has one under
   a different name before creating a new one.

═══════════════════════════════════════════════════════════════════════════════
STEP 2 — IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

3. Implement the files in the order from the plan. For each file:
   - Touch only what the plan requires. Do not refactor unrelated code.
   - Reuse existing utilities, validators, middlewares. Do not duplicate them.
   - Add types/interfaces only when needed by this endpoint.
   - Handle every error case from the plan's error matrix.
   - Apply all security checks from the plan.
   - Use a database transaction wherever the plan requires atomicity.
   - Log at the same verbosity as adjacent endpoints — no more, no less.
   - Do NOT print secrets, raw request bodies with credentials, or PII into logs.

4. Write the implementation deterministically:
   - No `Math.random()` unless the spec requires it; use the codebase's ID
     generator instead.
   - No silent fallbacks ("if it fails, just return empty"). The plan defined
     status codes for every failure mode — emit them.
   - No `any` / `unknown` casts to dodge typing — fix the type, don't bypass it.

5. If you discover during implementation that the plan is wrong (e.g., spec
   ambiguity surfaced, or the required column doesn't exist), STOP. Surface
   the issue and propose a corrected plan. Do not silently improvise.

═══════════════════════════════════════════════════════════════════════════════
STEP 3 — STATIC VERIFICATION
═══════════════════════════════════════════════════════════════════════════════

6. Run the project's typecheck (e.g., `tsc --noEmit`, `mypy`, `go vet`). Fix
   every new error you introduced. Do not "fix" pre-existing errors unrelated
   to this endpoint — note them, leave them.

7. Run the project's linter on the files you touched. Fix every issue.

8. Run the project's build (e.g., `npm run build`, `go build ./...`). Confirm
   it succeeds cleanly.

9. Confirm you did not modify:
   - Unrelated controllers, services, or routes
   - The database schema (unless the plan explicitly required a migration)
   - The frontend (unless I asked for it)
   - Test snapshots for unrelated endpoints

═══════════════════════════════════════════════════════════════════════════════
STEP 4 — OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Print a short delivery report:

1. **Files created / modified** — list with brief diff summary
2. **Reused infrastructure** — which existing utilities/middlewares you wired in
3. **Plan deviations** — anything you had to change from Prompt 2's plan, with reason
4. **Verification** — what typecheck/lint/build commands you ran and their result
5. **Next** — single sentence: "Ready for Prompt 4 (testing)."

Do not commit, push, or run the server yet. Stop here and wait for the testing
phase.

Quality bar: another developer reading the diff should not be able to tell
whether you or one of the existing project authors wrote it.
```

---

## Phase 3 — Per-API Testing (use FOR EACH endpoint)

Copy the prompt below after Prompt 3 ships clean code. Claude will ask for the endpoint, write exhaustive tests, run them, fix every failure, and loop until zero issues remain.

> **Why this matters:** an API is "done" only when it survives every test you can throw at it. This phase is intentionally adversarial — Claude tries to break its own implementation, and only stops when it can't.

### PROMPT 4 — Per-API Testing (until zero issues)

```text
The endpoint has been implemented. Now test it to destruction. Loop:
write tests → run them → for every failure, fix the code → re-run.
Stop only when 100% of tests pass AND you have actively tried (and failed)
to find new issues. No "good enough." No silent skips.

═══════════════════════════════════════════════════════════════════════════════
STEP 0 — ENDPOINT INTAKE
═══════════════════════════════════════════════════════════════════════════════

First, ask me: "Which endpoint should we test? Please confirm the HTTP method
and path so we test the right one."

Wait for my reply.

═══════════════════════════════════════════════════════════════════════════════
STEP 1 — TEST STRATEGY
═══════════════════════════════════════════════════════════════════════════════

1. Identify the project's test framework, runner, and conventions by reading:
   - Test config files (jest/vitest/pytest/etc.)
   - 2-3 existing test files closest to the endpoint
   - Fixture / factory / setup files
   - How the test DB is provisioned and torn down
   Follow the same patterns. Do NOT introduce a different framework or style.

2. From the plan in Prompt 2 (or from re-reading the spec if no plan is
   handy), enumerate every test case. For this endpoint, the test set MUST
   include — at minimum — cases in every category below. Skip a category only
   if it is truly N/A for this endpoint (and say why):

   a. **Happy path**: the canonical successful request and its exact response.
   b. **Validation**: one failing test per field rule. Missing required, wrong
      type, too long, too short, bad format, out-of-range, unknown extra fields
      (if strict), wrong enum value.
   c. **Authentication**: missing token, expired token, malformed token, valid
      token for a deactivated user.
   d. **Authorization**: each role tier (owner, admin, member, guest, or
      whatever the project uses) — both allowed and forbidden cases.
   e. **Resource lifecycle**: not found, archived/soft-deleted, restored.
   f. **Conflict**: duplicate keys, optimistic-lock (ETag/`If-Match`) mismatch.
   g. **Tenant / workspace isolation**: a user from one workspace cannot read
      or write a resource in another. Test both read and write.
   h. **Idempotency**: identical `Idempotency-Key` returns the same response
      and does not double-write (skip if the spec does not require idempotency
      for this method).
   i. **Concurrency**: two parallel writes on the same resource — both
      succeed correctly, or one wins with a defined error.
   j. **Pagination** (for list endpoints): first page, middle page, last
      page, empty result, page beyond end, cursor stable across an insert
      mid-pagination.
   k. **Boundary values**: empty string, max-length string, numeric zero,
      negative, max int, unicode (emoji, RTL, combining marks).
   l. **Side effects**: did the trigger/counter columns update? Was an
      activity row written? Was a notification dispatched? Test the
      observable effects, not just the response body.
   m. **Cleanup / rollback**: if the request fails mid-transaction, did
      partial state get persisted? It must not.

3. Print this test catalogue before writing any code. I want to see it.

═══════════════════════════════════════════════════════════════════════════════
STEP 2 — TEST IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

4. Write the tests. Rules:
   - One assertion per logical behaviour (don't pile five expectations into one test).
   - Use the project's existing fixtures and factories. Do not invent ad-hoc
     test data inline if a factory exists.
   - Tests must be deterministic and independent — running them in any order
     must produce the same result.
   - Use the real database (or the project's test DB), not a hand-rolled mock,
     unless the existing tests are mock-based.
   - Reset state between tests the same way existing tests do.

5. Add an HTTP-level smoke test for the endpoint: run the actual server (or
   the project's supertest equivalent), hit the endpoint with a real HTTP
   request, assert status + body + headers. Type-system tests are not enough.

═══════════════════════════════════════════════════════════════════════════════
STEP 3 — RUN, OBSERVE, FIX, LOOP
═══════════════════════════════════════════════════════════════════════════════

6. Run the new tests. For each failure:
   a. Print the failing case + the actual vs expected.
   b. Investigate the root cause. Read the code path that produced the wrong
      result. Do not patch the test to make it pass.
   c. Fix the code (controller / service / validator / migration — whichever
      layer is wrong).
   d. Re-run the full test set, not just the one that failed (regressions
      matter).
   e. Repeat until all tests pass.

7. After all written tests pass, run a directed exploratory pass:
   - Try inputs you did not write a case for and might surprise the endpoint:
     extremely long strings, deeply nested JSON, duplicated query params,
     mixed-case enum values, integer overflow on numeric IDs, trailing
     whitespace, unexpected `Content-Type` headers.
   - Stress: hit the endpoint with 50 parallel requests in a single test.
     Did the DB stay consistent? Did the connection pool survive?
   For every issue found in this exploratory pass, add a permanent test for
   it before fixing the code. Then re-run the whole set.

8. Run the project's full test suite (not just your new tests). Confirm you
   did not break anything that was previously passing. If something now fails
   that this endpoint touched, fix it; if something fails that is unrelated,
   document it and do not "fix" it inside this endpoint's work.

═══════════════════════════════════════════════════════════════════════════════
STEP 4 — FINAL AUDIT
═══════════════════════════════════════════════════════════════════════════════

9. Re-read the spec for this endpoint one more time. For each promised
   behaviour, point to the test that proves it. If any promised behaviour
   has no corresponding test, write it and re-run.

10. Search for footguns one last time:
    - Are there any `console.log`/`fmt.Println`/`print` statements left in
      the code? Remove unless the project's style allows them.
    - Are there any `TODO`/`FIXME` comments you added? Resolve or convert to
      tracked issues.
    - Did the implementation introduce any new dependency? Justify it.
    - Did any secrets, tokens, or credentials get printed by a passing test?
      Sanitise.

═══════════════════════════════════════════════════════════════════════════════
STEP 5 — OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Print a final report:

1. **Endpoint** — method + path
2. **Tests written** — count, broken down by category
3. **Issues found and fixed during testing** — numbered list, each with one
   line on the symptom and one on the fix
4. **Coverage of spec promises** — table of (spec promise → test that
   verifies it)
5. **Exploratory findings** — what additional probes you ran beyond the
   planned cases
6. **Final test run** — command, total tests, pass/fail count, duration
7. **Sign-off** — "Zero open issues" or, if not zero, an explicit list of
   what remains and why. (Default: zero.)

Quality bar: I should be able to ship this endpoint to production right now
and have no reason to expect a bug report. If you are not sure that is true,
keep testing.

═══════════════════════════════════════════════════════════════════════════════
NON-NEGOTIABLES
═══════════════════════════════════════════════════════════════════════════════

- Do not skip a category to "save time."
- Do not weaken a test to make it pass. Fix the code.
- Do not mark "Zero open issues" unless every test in the catalogue
  passes AND the exploratory pass yielded nothing.
- Do not commit, push, or deploy anything. That is my job after sign-off.
```

---

## Tips for getting the most out of these prompts

- **Prompt 1 once, ever.** Treat it like a one-time onboarding. If the codebase changes drastically (new framework, major schema overhaul), re-run it; otherwise rely on memory.
- **Don't skip Prompt 2.** It's tempting to jump from "build this endpoint" to "write the code." The plan is what makes the implementation correct on the first try.
- **Use Prompt 4 even on "trivial" endpoints.** The 30 minutes you spend testing a 20-line handler will save 3 hours debugging in production.
- **One endpoint at a time.** Resist the urge to batch ("plan five endpoints, then implement five"). Each cycle catches issues the next would have inherited.
- **Keep the dialogue.** If Prompt 2's plan looks wrong, say so before running Prompt 3. If Prompt 4 finds an issue you think should be out-of-scope, say so before it patches around it.
