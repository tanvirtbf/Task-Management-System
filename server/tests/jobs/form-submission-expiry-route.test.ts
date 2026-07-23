import { oneOff } from "../test-utils/app";
import { Config } from "../../src/config";

/**
 * Gap-scan M2 — the `form-submission-expiry` job was in the registry but had
 * no HTTP route, so the documented curl-cron could never run the 90-day
 * encrypted-PII purge. This locks the ROUTE wiring (the job's own logic has
 * CLI coverage): token-gated, dry-run supported, ok envelope.
 */

const URL = "/api/v1/jobs/form-submission-expiry";

describe("POST /api/v1/jobs/form-submission-expiry (route wiring, M2)", () => {
    it("401/403 without the internal token", async () => {
        const http = await oneOff();
        const res = await http.post(URL).send({});
        expect([401, 403]).toContain(res.status);
    });

    it("runs under the internal token with ?dry_run=true → 200 { ok: true, dry_run: true }", async () => {
        const http = await oneOff();
        const res = await http
            .post(`${URL}?dry_run=true`)
            .set("X-Internal-Token", Config.INTERNAL_JOB_TOKEN ?? "")
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.dry_run).toBe(true);
    });
});
