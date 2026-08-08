# PHASE 21 — Comments

**Status:** PARTIAL (UI verified by source read only — live browser checks deferred, §9)
**Methods:** API · DB · CODE
**Issues filed:** ISS-063 (HIGH) · ISS-064, ISS-065, ISS-066 (MEDIUM)
**Data left behind:** none. Tasks 51, lists 14, comments 8 (baseline).
**Baseline correction:** notifications went 77 → **65**. 13 rows were deleted, *all* of them already
dangling — see §8. 65 is the new baseline.

---

## 1. Threading — PASS

| probe | result |
|---|---|
| top-level comment | 201 |
| reply to it | 201 |
| reply **to a reply** | 422 `comment.reply_to_reply` |
| parent = unknown id | 422 `comment.parent_not_found` |
| parent = a comment on a **different task** | 422 `comment.parent_not_found` |
| `GET /tasks/:id/comments` | 200, bare array, replies nested under their parent |

One level of nesting, enforced on both the depth and the ownership of the parent.

## 2. The edit window — the phase's main finding, ISS-063

`PATCH` by a non-author → 403 `comment.not_author`. Correct.

The 15-minute window is not 15 minutes. Backdating `created_at` and re-trying pins the boundary at
**374–375 minutes**:

```
-10 min -> 200      -360 min -> 200      -374 min -> 200   <- last accepted
-20 min -> 200      -370 min -> 200      -375 min -> 403 comment.edit_window_expired
```

6 h 15 m = the six-hour ISS-001 skew + the intended fifteen minutes. And the client renders no
"(edited)" marker anywhere — `editedAt` appears in two type declarations and no component. → **ISS-063**.

## 3. Delete — PASS on every rule

```
a third party  -> 403 comment.forbidden_delete
the author     -> 204
again          -> 404 comment.not_found          (idempotent, no existence oracle)
an admin       -> 204
```

The tombstone is well built: the row survives, the body is **preserved in the database** but masked
to `[deleted]` on the wire, replies stay visible underneath a deleted parent, and replying to a
tombstone is refused. The one defect is the counter it leaves behind → **ISS-065**.

## 4. Mentions — PASS, and better than the plan expected

| body | notified |
|---|---|
| `@arif hello` | arif |
| `@Arif hello` | arif (case-insensitive) |
| `@arif and @priya` | both |
| `@nobody hello` | nobody, no error |
| `@owner hello` written **by the owner** | **nobody — never self-notified** |
| `email me at arif@beautybooth.com.bd` | nobody — an email in the body is not a false mention |

Resolution works by first name **and** by email local-part, deduped per comment.

## 5. Task references — ISS-066

They work, but only against `custom_id`:

```
#BB-4242 (a real custom_id)  -> +1 comment_referenced on the target
#bb-4242                     -> +1  (case-insensitive)
#BB-9999 (nobody's)          -> +0, no error
#T-8     (what the UI shows) -> +0
a task referencing ITSELF    -> +0  (correctly skipped)
```

49 of 53 tasks have `custom_id = NULL`, and `TaskDetailDrawer:252` shows those as `T-<task_number>` —
the exact string that does not resolve.

## 6. Notifications for a plain comment — ISS-064

A task with an assignee and a watcher, commented on by a third person: **0 notifications**. The
`comment` type exists in the enum, the seed uses it, and nothing produces it.

## 7. Body handling — PASS

| input | result |
|---|---|
| empty / whitespace-only | 422 `validation.failed` |
| 5 000 chars | 201, stored verbatim |
| 50 000 chars | 422 (cap is 10 000, `validators/comments.ts:11`) |
| `<script>alert(1)</script>` | 201, stored **verbatim** |
| `<img src=x onerror=…>` | 201, stored verbatim |
| newlines | preserved |

Storing markup verbatim is safe **here**: comment bodies render through `MentionRenderer`, which
builds React elements, and a repo-wide grep finds `dangerouslySetInnerHTML` in only three places,
none of them the comment path. (Two of those three are in `SearchPage.tsx` — carried to **P25**.)

## 8. `comments_count`, and a teardown rule for later phases

The counter is correct on insert (replies included) and never decreases on delete → **ISS-065**.

Separately: `notifications.entity_id` is **polymorphic with no foreign key** — the only FKs on the
table are `user_id` and `actor_id`. Hard-deleting a task therefore strands its notifications
permanently. 13 such orphans had accumulated from P17's and this phase's fixtures; all 13 were
removed and 0 dangling rows remain. No seed data was touched (57 seed-era rows intact). **Fixture
teardown must now also delete notifications by `entity_id`** — the same class of trap as
`statuses.scope_id` in P10. Whether the *product* should clean them up is a real question, tested in
**P24**.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| comment box, threading render, delete affordance, mention autocomplete | API-only phase; the source was read but not driven in a browser | **P35** |
| mention rendering mismatch: `MentionRenderer` matches only `firstName` or `id`, while the server also matches the email local-part — a mention resolved by local-part renders as "Unknown user" | needs a fixture user whose local-part ≠ first name | **P35** |

## 10. Coverage vs the plan

All 9 checklist lines executed. The comment engine's structure is sound — one-level threading with a
properly validated parent, a real tombstone that preserves history without exposing it, correct
mention resolution that never self-notifies, and clean 404 collapsing that never reveals whether an
id exists. The four findings are: a time control defeated by the ISS-001 clock, a notification type
with no producer, a counter that only climbs, and a reference syntax the UI never shows.

**Evidence directory:** `testing/evidence/PHASE-21/` — 2 files.
