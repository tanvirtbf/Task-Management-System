# PHASE 25 — Search

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB · CODE
**Issues filed:** ISS-074, ISS-075 (MEDIUM) · ISS-076 (LOW)
**Confirmed, not re-filed:** `SCAN-L6` (the `&`-in-query highlight edge)
**Data left behind:** none — tasks 51, lists 14, statuses 70, comments 8, notifications 65.
Cleanup needed a two-step delete: `DELETE FROM comments WHERE task_id IN (SELECT … FROM tasks)`
fails with `ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG` because `trg_comments_after_delete` updates
`tasks` while the subquery is reading it. Collect the ids first, then delete by literal list.

---

## 1. It is not full-text search

The plan expected FULLTEXT ngram behaviour. There is none:

- the database has **zero** FULLTEXT indexes (checked against `information_schema.STATISTICS`);
- `MATCH … AGAINST` appears nowhere in `server/src`;
- every predicate is `LIKE '%q%'`, plus one exact `custom_id` equality.

Everything below is therefore measured against what the code does, not against the plan's assumption.

## 2. Coverage — five entity types, one notable omission

```
GET /search?q=… -> {tasks, lists, spaces, users, comments, total}
```

| target | found? |
|---|---|
| task **name** | yes |
| task `custom_id` (exact, case-insensitive) | yes |
| **task description** | **no** → ISS-074 |
| list name | yes |
| space name | yes |
| user (by name / email) | yes |
| **comment body** | yes |

A word in a comment is findable; the same word in the task's own description is not.

## 3. Input handling — PASS

| input | result |
|---|---|
| empty / whitespace-only / no `q` at all | 200, all counts 0 |
| 1, 2, 3 characters | 200 (no minimum length) |
| 200 chars | 200 |
| 201 chars | 422 `validation.failed` |
| `limit=0` / `limit=abc` | 422 |
| `limit=1` / `limit=1000` | 200, clamped |
| `?types=task` / `task,list` | filters correctly |
| `?types=bogus` | 200, all zero — swallowed silently |

**Script and character handling is genuinely good.** Bangla-script names are found by Bangla-script
queries, a mixed Latin + Bangla name is found by a mixed query, an emoji is matched, and `R&D`,
`(50%)` and `c/o` all match the punctuation-heavy fixture. (Fixture names are stored in their real
scripts; this report prints them as escapes deliberately — the terminal here cannot render them.)

**Injection-shaped input is safe.** `' OR 1=1 --`, `"; DROP TABLE tasks; --`,
`a' UNION SELECT 1,2,3 --`, `<script>…`, `${7*7}`, `../../etc/passwd` and a lone backslash all
returned clean empty results, and `tasks` was intact afterwards. Every query is parameterised.

The one real edge is that LIKE metacharacters are not escaped — `%` acts as a wildcard, `_` matches
any character → ISS-076.

## 4. Ordering — ISS-075

`ORDER BY internal_id ASC` on every entity. Verified: the six matching fixtures came back in exactly
insertion order. There is no scoring of any kind, so the oldest substring match outranks an exact
title match.

## 5. Scoping — PASS, and this is the part that matters most

```
marketing.only@  q=ZQXJV -> 1 task, their own space only
                            nothing from Politics, spaces: []
guest            q=ZQXJV -> 4 tasks (guests can see the whole workspace by design)
no token                 -> 401
```

`SearchRepo` applies `listScopeFilter` to tasks and comments and `spaceScopeFilter` to lists and
spaces (lines 91, 133, 165, 240). The space-scoped user is correctly confined — **unlike** the
dependency-hydration path in P18 (ISS-053), which is the same visibility question answered
differently. Search gets it right.

**Guest redaction is applied**: `SearchService:164-170` passes `redactGuest` into
`customFieldValuesByTask`, the same one redaction the product implements. Search does not bypass it.

## 6. `SCAN-L6` — confirmed, and it is cosmetic, not a vulnerability

The client highlighter (`SearchPage.tsx:521-529`) escapes the text first and then wraps matches, so a
query containing `&` matches the `&` inside `&amp;` and splits the entity:

```
stored "Q&A and R&D"  query "&"
  html  "Q<mark>&</mark>amp;A and R<mark>&</mark>amp;D"
  shown "Q&amp;A and R&amp;D"        <- mangled
stored "TEST R&D budget"  query "R&D"
  html  "TEST R&amp;D budget"
  shown correct, but 0 highlights    <- the term is present and not marked
```

**No injection is possible**: only the matched slice of already-escaped text is re-inserted, so a
stored `<script>` renders as visible text with the word "script" highlighted. Verified across seven
cases. Cosmetic, already logged as `SCAN-L6`, not re-filed.

## 7. `custom_id` lookup — PASS

`ZZTOP-77` and `zztop-77` both find the task. Exact-match, case-insensitive.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| the `⌘K` palette and the search page itself | API-only phase | **P36** |
| `LIKE '%q%'` across five tables on a 1-character query, with no index usable | needs a real dataset | **P40** |

## 9. Coverage vs the plan

All 7 checklist lines executed; the FULLTEXT line is answered by "there is no FULLTEXT" rather than
by measurement.

The search module's **authorization is its strongest part** — correct space scoping on all four
entity types plus guest redaction, which is more than several other read paths manage. Its weakness
is that it is a substring scan with no ranking and a blind spot over the field that holds most of the
text in the system.

**Evidence directory:** `testing/evidence/PHASE-25/` — 2 files.
