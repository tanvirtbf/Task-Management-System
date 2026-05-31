import { oneOff } from "../test-utils/app";

/**
 * Tests for §30 Health & diagnostics — `GET /health` (liveness, already inline),
 * `GET /health/ready` (readiness DB ping), `GET /health/version`, and
 * `GET /metrics` (Prometheus). All are UNAUTHENTICATED and live at the APP root
 * (no `/api/v1` prefix, outside the `apiLimiter`).
 */

describe("GET /health (liveness)", () => {
    it("returns 200 { status: 'ok', uptime } with no auth", async () => {
        const http = await oneOff();
        const res = await http.get("/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(typeof res.body.uptime).toBe("number");
    });

    it("is application/json", async () => {
        const http = await oneOff();
        const res = await http.get("/health");
        expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
});

describe("GET /health/ready (readiness)", () => {
    it("returns 200 { status: 'ready', checks: { database: 'ok' } } when the DB is up", async () => {
        const http = await oneOff();
        const res = await http.get("/health/ready");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: "ready",
            checks: { database: "ok" },
        });
    });

    it("requires no authentication", async () => {
        const http = await oneOff();
        const res = await http.get("/health/ready");
        expect(res.status).not.toBe(401);
    });

    // NOTE: the 503 / database:'down' path is not exercised here — it would
    // require tearing down the shared pool mid-suite (breaking every other test).
    // The timeout-bounded `pingDb` logic is covered by reading; the down-path is
    // a candidate for a dedicated unit test with a stubbed pool.
});

describe("GET /health/version", () => {
    it("returns version, git_sha, uptime_seconds and node", async () => {
        const http = await oneOff();
        const res = await http.get("/health/version");
        expect(res.status).toBe(200);
        expect(typeof res.body.version).toBe("string");
        expect(typeof res.body.git_sha).toBe("string");
        expect(typeof res.body.uptime_seconds).toBe("number");
        expect(res.body.node).toMatch(/^v\d+/);
    });

    it("reflects GIT_SHA when set, 'unknown' otherwise", async () => {
        const prev = process.env.GIT_SHA;
        try {
            process.env.GIT_SHA = "deadbeef123";
            let res = await (await oneOff()).get("/health/version");
            expect(res.body.git_sha).toBe("deadbeef123");

            delete process.env.GIT_SHA;
            res = await (await oneOff()).get("/health/version");
            expect(res.body.git_sha).toBe("unknown");
        } finally {
            if (prev === undefined) delete process.env.GIT_SHA;
            else process.env.GIT_SHA = prev;
        }
    });

    it("requires no authentication", async () => {
        const http = await oneOff();
        const res = await http.get("/health/version");
        expect(res.status).toBe(200);
    });
});

describe("GET /metrics (Prometheus)", () => {
    it("returns 200 as text/plain v0.0.4", async () => {
        const http = await oneOff();
        const res = await http.get("/metrics");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/plain/);
        expect(res.headers["content-type"]).toMatch(/version=0\.0\.4/);
    });

    it("exposes the expected metric families (HELP/TYPE)", async () => {
        const http = await oneOff();
        const res = await http.get("/metrics");
        const body = res.text;
        for (const name of [
            "http_requests_total",
            "http_request_duration_seconds",
            "background_job_runs_total",
            "sse_connections_open",
            "process_uptime_seconds",
        ]) {
            expect(body).toContain(`# TYPE ${name}`);
        }
    });

    it("records http_requests_total + duration buckets after a request", async () => {
        // Make a request that the metricsMiddleware will count on 'finish'…
        await (await oneOff()).get("/health");
        // …then scrape: the prior /health request must appear as a series.
        const res = await (await oneOff()).get("/metrics");
        expect(res.text).toMatch(/http_requests_total\{method="GET"[^}]*\}/);
        expect(res.text).toContain('route="/health"');
        expect(res.text).toMatch(/http_request_duration_seconds_bucket\{[^}]*le="\+Inf"\}/);
    });

    it("requires no authentication and is not under /api/v1", async () => {
        const http = await oneOff();
        const res = await http.get("/metrics");
        expect(res.status).toBe(200);
        // Sanity: the same path under /api/v1 is NOT where metrics live.
        const v1 = await (await oneOff()).get("/api/v1/metrics");
        expect(v1.status).toBe(404);
    });
});
