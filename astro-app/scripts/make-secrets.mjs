/**
 * Build secrets.json for `wrangler secret bulk secrets.json` from .dev.vars.
 * NODE_ENV / LOG_LEVEL are excluded (they are plain vars in wrangler.jsonc),
 * and FRONTEND_URL can be overridden for production:
 *
 *   node scripts/make-secrets.mjs https://beautybooth-tasks.xxx.workers.dev
 */
import { readFileSync, writeFileSync } from "node:fs";

const EXCLUDE = new Set(["NODE_ENV", "LOG_LEVEL"]);
const prodUrl = process.argv[2];

const out = {};
for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || EXCLUDE.has(m[1])) continue;
    out[m[1]] = m[2];
}
if (prodUrl) {
    out.FRONTEND_URL = prodUrl;
    out.API_URL = prodUrl;
}
writeFileSync("secrets.json", JSON.stringify(out, null, 2));
console.log(
    `secrets.json written (${Object.keys(out).length} keys)${prodUrl ? ` — FRONTEND_URL=${prodUrl}` : ""}`,
);
