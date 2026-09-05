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
    it("returns 200 { status: 'ready', checks: { database, storage, mail } } when the DB is up", async () => {
        const http = await oneOff();
        const res = await http.get("/health/ready");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: "ready",
            // P8: the suite runs on the deterministic no-network transports, so
            // "stub" and "log_only" ARE the correct answers here — and saying so
            // out loud is the whole point of the two new checks (KI-19).
            checks: { database: "ok", storage: "stub", mail: "log_only" },
        });
    });

    it("reports storage/mail as 'unconfigured' when the no-op transports are refused, and stays READY", async () => {
        const prevStorage = process.env.STORAGE_ALLOW_STUB;
        const prevMail = process.env.MAIL_ALLOW_LOG_ONLY;
        process.env.STORAGE_ALLOW_STUB = "0";
        process.env.MAIL_ALLOW_LOG_ONLY = "0";
        try {
            const res = await (await oneOff()).get("/health/ready");
            // Deliberate: neither one takes the whole app out of the load
            // balancer. See the reasoning in `routes/health.ts`.
            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                status: "ready",
                checks: {
                    database: "ok",
                    storage: "unconfigured",
                    mail: "unconfigured",
                },
            });
        } finally {
            if (prevStorage === undefined) delete process.env.STORAGE_ALLOW_STUB;
            else process.env.STORAGE_ALLOW_STUB = prevStorage;
            if (prevMail === undefined) delete process.env.MAIL_ALLOW_LOG_ONLY;
            else process.env.MAIL_ALLOW_LOG_ONLY = prevMail;
        }
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

    it("reflects GIT_SHA when set", async () => {
        const prev = process.env.GIT_SHA;
        try {
            process.env.GIT_SHA = "deadbeef123";
            const res = await (await oneOff()).get("/health/version");
            expect(res.body.git_sha).toBe("deadbeef123");
        } finally {
            if (prev === undefined) delete process.env.GIT_SHA;
            else process.env.GIT_SHA = prev;
        }
    });

    it("KI-26: falls back to the CHECKOUT rather than answering 'unknown'", async () => {
        // The old behaviour was `process.env.GIT_SHA ?? "unknown"`, and nothing
        // in the deploy set that variable — so the endpoint that exists to say
        // which build is running never once said it. The suite runs inside the
        // git checkout, which is exactly the situation on the box.
        const prev = process.env.GIT_SHA;
        delete process.env.GIT_SHA;
        try {
            const res = await (await oneOff()).get("/health/version");
            expect(res.body.git_sha).toMatch(/^[0-9a-f]{40}$/);
        } finally {
            if (prev !== undefined) process.env.GIT_SHA = prev;
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

    /**
     * P8. `/metrics` is UNAUTHENTICATED, so whatever ends up in a label is
     * readable by anyone who can reach the port. (In production nobody can:
     * `deploy/nginx/…conf` denies /metrics on purpose rather than leaving it
     * to fall through the SPA catch-all "by coincidence".) That makes the
     * label normalisation a privacy boundary as well as a cardinality one, so
     * it gets asserted rather than assumed.
     */
    describe("label hygiene", () => {
        it("labels a parameterised route with the PATTERN, never the id in the URL", async () => {
            const secret = "zz-nobody-should-see-this-id";
            await (await oneOff()).get(`/api/v1/tasks/${secret}`);
            const res = await (await oneOff()).get("/metrics");
            expect(res.text).toContain('route="/api/v1/tasks/:id"');
            expect(res.text).not.toContain(secret);
        });

        it("keeps two routers' /:id routes APART on the error path (they used to collapse into one)", async () => {
            // The defect P8 found. `req.baseUrl` is restored when a router hands
            // the request back up the stack, which is what happens on every
            // error path — so a 401 on /api/v1/tasks/:id was labelled bare
            // `/:id`, and so was every other router's. Tasks, spaces, lists,
            // comments and attachments all counted as ONE series, on exactly
            // the requests (the failures) this endpoint exists to explain.
            await (await oneOff()).get("/api/v1/tasks/zz-a"); // 401
            await (await oneOff()).get("/api/v1/spaces/zz-b"); // 401
            const res = await (await oneOff()).get("/metrics");
            expect(res.text).toContain('route="/api/v1/tasks/:id"');
            expect(res.text).toContain('route="/api/v1/spaces/:id"');
            expect(res.text).not.toContain('route="/:id"');
        });

        it("collapses an unmatched path to one series — a 404 URL never becomes a label", async () => {
            const secret = "zz-nobody-should-see-this-path";
            await (await oneOff()).get(`/api/v1/not-a-real-route/${secret}`);
            const res = await (await oneOff()).get("/metrics");
            expect(res.text).toContain('route="(unmatched)"');
            expect(res.text).not.toContain(secret);
        });
    });
});
