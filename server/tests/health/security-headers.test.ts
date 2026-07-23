import { oneOff } from "../test-utils/app";

/**
 * Gap-scan M3 — the hand-rolled `securityHeaders` middleware must stamp every
 * response (success, 404 and error paths alike). HSTS is prod/FORCE_SECURE
 * only, so it must be ABSENT under the test env (advertising HSTS from plain
 * HTTP would poison the local browser cache).
 */

const EXPECTED: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-permitted-cross-domain-policies": "none",
};

describe("security headers (M3)", () => {
    it("stamps every header on a normal response", async () => {
        const http = await oneOff();
        const res = await http.get("/health");
        for (const [k, v] of Object.entries(EXPECTED)) {
            expect(res.headers[k]).toBe(v);
        }
    });

    it("stamps them on 404s and API error responses too", async () => {
        const http = await oneOff();
        const missing = await http.get("/definitely-not-a-route");
        expect(missing.status).toBe(404);
        for (const [k, v] of Object.entries(EXPECTED)) {
            expect(missing.headers[k]).toBe(v);
        }

        const unauthed = await http.get("/api/v1/tasks/some-id");
        expect(unauthed.status).toBe(401);
        expect(unauthed.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("does NOT advertise HSTS outside prod/FORCE_SECURE", async () => {
        const http = await oneOff();
        const res = await http.get("/health");
        expect(res.headers["strict-transport-security"]).toBeUndefined();
    });
});
