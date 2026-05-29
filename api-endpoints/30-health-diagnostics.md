# §30 — Health & diagnostics

> Source: [API_DESIGN.md §30](../API_DESIGN.md#33-health)

**4 endpoints.** Unauthenticated probes for kubernetes, load balancers, and monitoring. Reachable only from inside the cluster (or a reverse-proxy ACL) — the global `apiLimiter` does NOT apply.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/health` | Liveness probe — process is up | 🔓 | S | ✅ (already in app.ts) |
| 2 | GET | `/health/ready` | Readiness probe — DB + Redis reachable | 🔓 | S | ☐ |
| 3 | GET | `/health/version` | Build SHA + version + uptime | 🔓 | S | ☐ |
| 4 | GET | `/metrics` | Prometheus scrape endpoint | 🔓 | M | ☐ |

## Dependencies

- DB client (`getPool().getConnection()` ping for #2).
- Redis client if/when added (#2 should ping it too).
- For #4: a metrics counter library (e.g., `prom-client`) that the rest of the app feeds into.

## Notes

- **#1** is already implemented in `server/src/app.ts` (`app.get("/health", …)`). Treat as done.
- **#2** must run as a single timeout-bounded check (≤ 500ms) — otherwise an unhealthy DB will hold the readiness check open and k8s won't roll the pod.
- **#3** reads `process.env.GIT_SHA` (set at build time) and `package.json` version. Don't expose anything sensitive.
- **#4 Prometheus metrics** at minimum: `http_requests_total{method,route,status}`, `http_request_duration_seconds_bucket`, `mysql_pool_connections_in_use`, `sse_connections_open`, `background_job_runs_total{job,status}`.
- These endpoints must NOT count toward rate limits (move them outside the `apiLimiter` chain or scope the limiter to `/api/v1/*` only — already correct in current app.ts).
