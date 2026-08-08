# PHASE 34 — Real-time, offline & session behaviour

**Status:** PARTIAL — session behaviour verified; real-time and offline not covered — §5
**Methods:** UI (Chrome) · CODE
**Issues filed:** none new — **confirmed `SCAN-M4`**
**Data left behind:** none.

---

## 1. `SCAN-M4` — SSE is unreachable from the browser, confirmed at source

`GET /stream/inbox` sits behind `authenticate`, which accepts a `Bearer` header or an `accessToken`
cookie. The SPA holds its access token **in memory only** (`stores/auth.ts` persists just `user`),
and the server sets only `bb_refresh` as a cookie. `EventSource` can send neither, so the browser
cannot open the stream — and `NotificationBell.tsx:17` says exactly that and polls instead:

```ts
refetchInterval: 60_000,
```

`Sidebar.tsx:52` polls on the same interval. Both were observed live: the Inbox badge rendered a
count of **12** and the sidebar carried the same number, from the poll rather than a stream.

The server still runs `sseHub`, `SseController` and a `closeAllSseStreams()` shutdown path for zero
browser clients. The scan's finding stands unchanged.

## 2. Token lifecycle — verified

**Silent refresh works.** `localStorage.clear()` followed by a reload left the user signed in: the
in-memory access token was gone, and the app re-minted one from the httpOnly `bb_refresh` cookie
without any visible interruption or lost navigation state.

**`RequireGuest` interacts with it correctly.** With a live session, `/login` redirects to `/` — so
a user who bookmarks the login page lands on Home rather than a form. (This behaviour initially
looked like "logging in as a second user silently keeps the first user", which it is not; see
PHASE-36 §3.)

The refresh client itself (`http/client.ts` R5) de-dupes concurrent refreshes and carries an
`_retry` guard so a failed refresh cannot loop — read, not provoked.

## 3. React Query cache invalidation — read at source

`lib/queryClient.ts` sets `retry: false`, `refetchOnWindowFocus: false`, `staleTime: 30s`, and a
`MutationCache.onError` net that toasts any mutation without its own handler (the gap-scan M9 fix).
Mutations invalidate explicitly — e.g. `SubtasksSection` busts both `["subtasks", taskId]` and
`["task", taskId]`, `DependenciesSection` busts `["deps", taskId]`.

Three cards on Home share one `["my-work", user.id]` key, so the page issues two requests, not four
(P19 §7). Verified by reading; not measured under mutation in a browser.

## 4. What was observed of live behaviour

The Home page's KPI numbers animate from 0 through a `CountUp` component. A screenshot taken four
seconds after login caught them mid-animation (My Open Tasks 0, Open Team Tasks 4) and they settled
to the API's true values (1 and 31). Worth recording because it is a trap for any future automated
UI assertion on this page — assert after the animation, or the numbers are simply wrong.

## 5. Deferred (rule R10)

| item | why |
|---|---|
| the 60 s bell poll actually refreshing after a change | needs a two-client setup and a wall-clock wait |
| two browsers, same user — propagation and latency | needs two independent browser contexts |
| two users editing one task simultaneously | the **API** side is done: P37 §5 proved last-write-wins on concurrent PATCH, no duplicate assignee rows, idempotent archives, and P15 §3 proved `If-Match` returns `409 task.conflict` on a stale ETag. Only the *UI's* reaction is unverified |
| offline indicator, going offline mid-request, recovery | needs network throttling/offline emulation |
| cache invalidation measured per mutation | needs the scripted harness |
| token expiry mid-session → silent refresh with no lost work | needs a 15-minute wait or a shortened TTL |
| session revoked server-side → the UI signs out cleanly | needs a revoke while a browser is live |

## 6. Coverage vs the plan

3 of the 8 checklist lines are covered (SSE unreachability, silent refresh, and the cache
configuration), with the concurrency line covered on the API side by P37 and P15. Five are deferred.

Like P35 and P36, this phase needs the scripted multi-context harness rather than more single-browser
screenshots. The three of them should be run together.

**Evidence:** in-session observation; `SCAN-M4` source citations above.
