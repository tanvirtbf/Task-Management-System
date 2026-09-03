import { oneOff } from "../test-utils/app";
import { Config } from "../../src/config";
import { configuredOrigins, lanOriginsAllowed } from "../../src/config/cors";

/**
 * WHO IS ALLOWED TO READ THIS API FROM A BROWSER.
 *
 * There was no test for this at all. `app.ts` carries a comment saying "P2
 * verified all 10 origin cases"; that verification was somebody running curl
 * once, and it left nothing behind. The policy has been unguarded ever since —
 * and it is a policy with `credentials: true`, which means whatever it reflects
 * can read this API **as the signed-in user**.
 *
 * KI-16 is the specific problem: alongside the configured allowlist, the origin
 * check reflects ANY loopback or RFC-1918 origin on any port, in every
 * environment including production. On a ~100-person office network that means
 * a page served from any machine on the LAN — a colleague's dev server, a
 * printer's web UI, anything somebody plugs in — can make credentialed requests
 * to the production API and read the replies. The allowance exists for a real
 * reason (reaching the dev server from a phone on the same Wi-Fi) but that
 * reason does not exist in production.
 *
 * So: LAN origins are now allowed only outside production. `CORS_ALLOW_LAN`
 * decides it at REQUEST time so this file can exercise the production branch —
 * flipping `NODE_ENV` would swap `MailService` onto a REAL SMTP transport and
 * mail actual people (§A rule 4), which is exactly the trap P2 documented.
 */

jest.setTimeout(30_000);

/** CORS is decided before auth, so any route works; /health needs no token. */
const ORIGIN_PROBE = "/health";

const withOrigin = async (origin: string) =>
    (await oneOff()).get(ORIGIN_PROBE).set("Origin", origin);

/** The header the browser reads. Absent ⇒ the browser blocks the response. */
const allowOriginOf = (res: { headers: Record<string, string> }) =>
    res.headers["access-control-allow-origin"];

const LAN_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://192.168.1.50:5173",
    "http://10.0.0.7:8080",
    "http://172.16.4.9:5173",
];

const FOREIGN_ORIGINS = [
    "https://evil.example",
    "http://tasks.beautybooth.com.bd.evil.example", // suffix trick
    "https://tasks.beautybooth.com.bd.attacker.io",
    "http://192.168.1.50.evil.example", // looks private, is not
    "http://11.0.0.1:5173", // 11.x is PUBLIC space, not RFC-1918
    "http://172.32.0.1:5173", // just outside 172.16–172.31
];

describe("CORS origin policy", () => {
    const priorAllowLan = process.env.CORS_ALLOW_LAN;

    afterEach(() => {
        if (priorAllowLan === undefined) delete process.env.CORS_ALLOW_LAN;
        else process.env.CORS_ALLOW_LAN = priorAllowLan;
    });

    it("guards the guard: the suite is not running as production", () => {
        // If this ever fails, the rest of the file is testing something else —
        // and MailService would be holding a live SMTP transport.
        expect(Config.NODE_ENV).toBe("test");
        expect(Config.IS_PROD).toBe(false);
    });

    describe("outside production (the dev convenience)", () => {
        beforeEach(() => {
            process.env.CORS_ALLOW_LAN = "1";
        });

        it.each(LAN_ORIGINS)("reflects %s", async (origin) => {
            const res = await withOrigin(origin);
            expect({ origin, allow: allowOriginOf(res) }).toEqual({
                origin,
                allow: origin,
            });
        });
    });

    describe("in production", () => {
        beforeEach(() => {
            process.env.CORS_ALLOW_LAN = "0";
        });

        /**
         * The LAN origins MINUS anything the environment names explicitly.
         *
         * `FRONTEND_URL` is `http://localhost:5173` here, and an explicitly
         * configured origin is allowed in every environment by design — the
         * first run of this file failed on exactly that and the test was wrong,
         * not the policy. Computing the list keeps the distinction honest
         * instead of hard-coding around it.
         */
        const notConfigured = LAN_ORIGINS.filter(
            (o) => !configuredOrigins().includes(o),
        );

        it("the LAN list still has something to prove after removing configured origins", () => {
            expect(notConfigured.length).toBeGreaterThan(0);
        });

        it.each(notConfigured)(
            "does NOT reflect %s — this is KI-16",
            async (origin) => {
                const res = await withOrigin(origin);
                // No header at all: the browser blocks the read. Note the
                // REQUEST still succeeds — CORS protects the response, it is
                // not an authorisation check.
                expect({ origin, allow: allowOriginOf(res) }).toEqual({
                    origin,
                    allow: undefined,
                });
                expect(res.status).toBe(200);
            },
        );

        it("still reflects an explicitly configured origin", async () => {
            const configured = Config.FRONTEND_URL;
            if (!configured) {
                // Nothing configured in this environment — the allowlist half
                // of the policy cannot be exercised, and saying so is better
                // than passing silently.
                expect(configured).toBeFalsy();
                return;
            }
            const res = await withOrigin(configured);
            expect(allowOriginOf(res)).toBe(configured);
        });
    });

    describe("never, in any environment", () => {
        it.each(FOREIGN_ORIGINS)("refuses %s", async (origin) => {
            // Checked with the LAN allowance ON, so a pass cannot be an
            // accident of the environment.
            process.env.CORS_ALLOW_LAN = "1";
            const res = await withOrigin(origin);
            expect({ origin, allow: allowOriginOf(res) }).toEqual({
                origin,
                allow: undefined,
            });
        });

        it("a rejected origin is answered, not 500'd (F13/ISS-085)", async () => {
            process.env.CORS_ALLOW_LAN = "1";
            const res = await withOrigin("https://evil.example");
            // The cors middleware used to THROW on a rejection, which reached
            // the global handler as an unknown error: every blocked origin
            // produced a 500 and an "Unhandled error" log line.
            expect(res.status).toBe(200);
        });
    });

    describe("no Origin header", () => {
        it("is allowed — curl, server-to-server, and same-origin GETs", async () => {
            const res = await (await oneOff()).get(ORIGIN_PROBE);
            expect(res.status).toBe(200);
        });
    });

    describe("the switch itself", () => {
        it("defaults to the environment when CORS_ALLOW_LAN is unset", () => {
            delete process.env.CORS_ALLOW_LAN;
            // Not production here, so LAN origins are allowed by default —
            // which is the dev convenience the allowance exists for.
            expect(lanOriginsAllowed()).toBe(true);
        });

        it("an explicit value wins over the environment, both ways", () => {
            process.env.CORS_ALLOW_LAN = "0";
            expect(lanOriginsAllowed()).toBe(false);
            process.env.CORS_ALLOW_LAN = "1";
            expect(lanOriginsAllowed()).toBe(true);
        });
    });
});
