// F13 — network posture: the four code-side repros, on the fixed tree.
//
//   ISS-085 / ISS-009  a disallowed Origin returned 500 + an `Unhandled error`
//                      log line, five times for five origins.
//   ISS-086            `X-Powered-By: Express`, no CSP, no COOP.
//   ISS-089            the API bound 0.0.0.0, so a direct client could forge
//                      X-Forwarded-For and mint a fresh rate-limit bucket.
//
// The bind change is prod-only, so it is proven by BOOTING a prod-configured
// instance and checking what it listens on — not by asserting a code string.
// ISS-091 is nginx config; it is verified by `nginx -t` + the config diff, and
// recorded in the results file rather than probed from here.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const ROOT = "http://127.0.0.1:" + (process.env.API_PORT || "5711");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 58) + (detail || "")); };

(async () => {
    console.log("\n  === F13 — network posture ===\n");

    console.log("  --- ISS-085 / ISS-009: a disallowed Origin ---");
    console.log("  " + pad("origin", 34) + pad("status", 8) + "ACAO header");
    for (const origin of ["https://evil.example.com", "null",
                          "http://localhost.evil.com", "http://127.0.0.1.evil.com"]) {
        const r = await fetch(B + "/workspace", { headers: { Origin: origin } });
        const acao = r.headers.get("access-control-allow-origin");
        const clean = r.status !== 500 && !acao;
        if (!clean) bad++;
        console.log("  " + pad(origin, 34) + pad(r.status + (r.status === 500 ? " ***" : ""), 8) +
            (acao ?? "(absent — browser blocks the read)"));
    }
    console.log("  (every one of these was a 500 + an `Unhandled error` log line before F13)");

    const pre = await fetch(B + "/workspace", { method: "OPTIONS",
        headers: { Origin: "https://evil.example.com",
                   "Access-Control-Request-Method": "GET" } });
    check("an evil PREFLIGHT is not a 500 either", pre.status !== 500,
        "got " + pre.status + ", ACAO " + (pre.headers.get("access-control-allow-origin") ?? "absent"));

    console.log("\n  --- the allowed origins must STILL work ---");
    for (const origin of ["http://localhost:5173", "http://localhost:3000"]) {
        const r = await fetch(B + "/workspace", { headers: { Origin: origin } });
        const acao = r.headers.get("access-control-allow-origin");
        check("allowed: " + pad(origin, 24) + "ACAO reflected", acao === origin, acao ?? "ABSENT");
    }
    {
        const r = await fetch(B + "/workspace", { method: "OPTIONS",
            headers: { Origin: "http://localhost:5173",
                       "Access-Control-Request-Method": "GET" } });
        check("a legitimate preflight still succeeds", r.status === 204 || r.status === 200,
            "got " + r.status);
    }

    console.log("\n  --- ISS-086: response headers ---");
    const h = (await fetch(ROOT + "/health")).headers;
    check("x-powered-by is GONE (was `Express`)", !h.get("x-powered-by"),
        h.get("x-powered-by") ?? "absent");
    check("content-security-policy present (was absent)",
        (h.get("content-security-policy") ?? "").includes("default-src 'none'"),
        (h.get("content-security-policy") ?? "ABSENT").slice(0, 52));
    check("frame-ancestors 'none' in the CSP",
        (h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), "");
    check("cross-origin-opener-policy present",
        h.get("cross-origin-opener-policy") === "same-origin",
        h.get("cross-origin-opener-policy") ?? "ABSENT");
    check("x-dns-prefetch-control off", h.get("x-dns-prefetch-control") === "off",
        h.get("x-dns-prefetch-control") ?? "ABSENT");
    for (const [k, want] of [["x-content-type-options", "nosniff"],
                             ["x-frame-options", "DENY"],
                             ["referrer-policy", "no-referrer"]]) {
        check("still there: " + pad(k, 30) + want, h.get(k) === want, h.get(k) ?? "ABSENT");
    }
    check("HSTS still absent in dev (would poison localhost)",
        !h.get("strict-transport-security"), h.get("strict-transport-security") ?? "absent");

    console.log(bad === 0
        ? "\n  PASS — rejections are clean, headers are hardened, allowed origins unchanged.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    process.exit(bad ? 1 : 0);
})();
