# §27 — Server-Sent Events (real-time inbox)

> Source: [API_DESIGN.md §27](../API_DESIGN.md#29-sse-realtime)

**1 endpoint.** Long-lived SSE stream so the bell badge and inbox update without polling.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/stream/inbox` | SSE stream of notifications for the current user | 🔐 | XL | ☐ |

## Dependencies

- §19 Notifications — every notification insert must publish to the matching SSE connections.
- Implementation needs an in-process pub/sub (EventEmitter is fine for V1) keyed by `user_id`. Production swap = Redis pub/sub.

## Notes

- Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Disable response compression for this route.
- Send a `heartbeat` event every 30 seconds so reverse proxies don't kill the connection.
- Support `Last-Event-Id` header for resume — return any missed notifications since that id.
- Authenticate via the access cookie like every other endpoint.
- On disconnect, clean up the subscription (use `req.on("close", cleanup)`).
- Frame format: `event: <name>\ndata: <json>\nid: <internal_id>\n\n`.
