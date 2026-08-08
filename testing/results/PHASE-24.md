# PHASE 24 — Notifications

**Status:** PARTIAL (UI deferred — §9)
**Methods:** API · DB · CODE · **background job triggered for real**
**Issues filed:** ISS-072, ISS-073 (2 MEDIUM)
**Confirmed by execution, not re-filed:** `SCAN-M1` (preferences do nothing) · `SCAN-M2` (no emails)
**Data left behind:** none — notifications 65 (baseline), prefs 0, tasks 51, lists 14.

---

## 1. What can actually be produced — ISS-072

Every notification insert site in `server/src` was located: six calls, five distinct types. Driving
a task through assign → `@mention` → plain comment → move to Done produced exactly two
notifications (`assigned`, `mentioned`). **Seven of the twelve declared types have no producer** —
`SCAN-M3` named two of them.

## 2. Feed, counts and read state — PASS

```
GET /notifications        -> {data, pagination}, correct cursor paging, no overlap,
                             walked every page: count matches the table exactly
GET /notifications/unread-count -> {unread_count: n}
POST /:id/read            -> 200, count drops, idempotent
POST /:id/unread          -> 200, count rises
POST /mark-all-read       -> 200, count 0, DB agrees
?limit=0                  -> 422
?cursor=garbage           -> 400 pagination.invalid_cursor
```

**On filters:** the server declares only `cursor` and `limit`. `?is_read=` and `?type=` are not
parameters — they are silently ignored, which is why they appeared to "return everything" on first
run. That is consistent rather than broken: `InboxPage.tsx:119-126` filters all / unread / mentions /
assigned **client-side** on the fetched page. The only caveat is scale — the filter applies to the
loaded page, so a user with hundreds of notifications sees "mentions" from the newest page only.
Recorded, not filed.

## 3. Ownership — PASS, exactly right

```
arif marks the OWNER's notification read    -> 403 notification.not_owner
arif deletes the OWNER's notification       -> 403 notification.not_owner
arif snoozes the OWNER's notification       -> 403 notification.not_owner
an unknown id                               -> 404 notification.not_found
```

A 403 for someone else's row and a 404 for a non-existent one — the distinction is deliberate and
correct here, since the id space is already private to the user.

## 4. Snooze — PASS. Two wrong hypotheses were tested and discarded

This section took three passes and is worth recording as a caution.

The stored `snoozed_until` **is** six hours behind what the caller asked for — a real ISS-001 effect,
visible in the raw table. Two conclusions were drawn from that and both were wrong:

1. *"Snoozing hides nothing"* — wrong. Snooze is not implemented by hiding. `NotificationsService.snooze`
   sets `snoozed_until` **and** `is_read = true`, so the item leaves the **badge** and stays in the
   list. Verified: the unread count dropped from 2 to 1 on snooze.
2. *"The wake job undoes a 1-hour snooze immediately"* — wrong. Triggering `POST /jobs/snooze-wake`
   for real, right after a +1 h snooze, woke **0** rows, and snoozes of 3/5/6/7/8 hours all survived
   a job run. `NotificationsRepo.wakeSnoozed` passes `now` as a **bound parameter** rather than SQL
   `NOW()`, so it takes the same mysql2 conversion as the stored value and the skew cancels. The
   repo comment says so explicitly.

There is also no "cannot un-snooze" problem: `snoozed_until: null` is a 422 by design, but
`POST /:id/unread` sets `is_read = false, snoozed_until = null` — that is the un-snooze.

**Net: the snooze feature is correct.** Only the absolute value in the column is skewed, which
matters if anything ever displays it.

## 5. Soft delete — PASS

```
DELETE /notifications/:id -> 204, row kept with deleted_at
in the feed?              -> no
unread count              -> 4 -> 3
delete again              -> 404
mark a deleted one read   -> 404
```

Hidden from the feed **and** the count, as the plan required.

## 6. Preferences — PASS on the API, and `SCAN-M1` proven

The body is a **map**, `{type: {in_app_enabled, email_enabled}}` — not the array shape tried first.
With the right shape the endpoint is strict and correct:

| probe | result |
|---|---|
| `GET` | 200, all 12 types, defaults `{true, true}` |
| `PUT {assigned: {…false, …false}}` | 200, row stored, `GET` reflects it |
| unknown type | 422 |
| empty object | 422 |
| one flag missing | 422 |
| an extra key inside a type | 422 |
| a non-object value / an array body | 422 |
| all 12 types at once | 200, 12 rows |

Then, with **all twelve types disabled for arif**:

```
assign a task to arif   -> +1 notification   *** delivered ***
@mention arif           -> +1 notification   *** delivered ***
email_sent_at           -> NULL
```

`SCAN-M1` and `SCAN-M2` are now confirmed by execution rather than static analysis. Not re-filed.

## 7. Orphans — ISS-073

Hard-deleting a task leaves its notifications behind with a live `entity_id` pointing at nothing, and
they keep appearing in the recipient's inbox. `notifications` is the one child table with no FK to
its entity.

## 8. `due_soon` / `overdue`

Confirmed unproducible, as `SCAN-M3` states — no due-date scanner exists among the six jobs. Folded
into ISS-072 rather than filed again.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| bell badge, inbox list, filter tabs, snooze control, empty state | API-only phase | **P35** |
| the 60 s poll actually refreshing the badge in a browser | needs the browser; `NotificationBell.tsx:17` sets `refetchInterval: 60_000` as the plan expected | **P34** |
| SSE (`SCAN-M4`) — the stream the poll replaced | its own surface | **P34** |

## 10. Coverage vs the plan

All 9 checklist lines executed. Three probes were malformed and re-run rather than reported: the
preferences body shape, and the two snooze hypotheses above. The correction on snooze is the
important one — the first two readings both looked like solid findings, and the feature is in fact
correct.

What is left is a real shape: the **delivery mechanics are well built** — ownership, read state,
counts, cursor paging, soft delete, snooze-plus-wake-job, and a strict preferences validator — sitting
under a **producer layer that fires for five of twelve events** and a **preferences screen that
governs none of them**.

**Evidence directory:** `testing/evidence/PHASE-24/` — 3 files.
