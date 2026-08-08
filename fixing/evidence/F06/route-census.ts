/**
 * F6 — the route census: every HTTP registration in every router, with the
 * gate it carries today.
 *
 * Loads the REAL catalog (import, not regex) and statically slices each
 * routes file into per-registration blocks — a registration's middleware text
 * runs from its `router.<method>(` up to the next registration — then records
 * which of {requirePermission(key), canAccess([...]), authenticate, nothing}
 * that block carries. Mount prefixes come from app.ts so paths are absolute.
 *
 * Output: JSON to stdout (the map document is generated from it), so the
 * census is re-runnable instead of hand-transcribed.
 */
import fs from "node:fs";
import path from "node:path";
import { PERMISSIONS } from "../../../server/src/rbac/catalog";

const ROUTES = "E:/Task Management System/server/src/routes";
const APP = "E:/Task Management System/server/src/app.ts";

// ── mount prefixes from app.ts ───────────────────────────────────────────────
const appSrc = fs.readFileSync(APP, "utf8");
const mounts = new Map<string, string>(); // router import name -> prefix ("" = v1 root)
const importRe = /import\s+(\w+)\s+from\s+"\.\/routes\/(\w+)"/g;
const fileOfImport = new Map<string, string>();
for (let m; (m = importRe.exec(appSrc)); ) fileOfImport.set(m[1], m[2]);
const useRe = /v1\.use\(\s*(?:"([^"]*)"\s*,\s*)?(\w+)\s*\)/g;
for (let m; (m = useRe.exec(appSrc)); ) {
    const [, prefix, name] = m;
    if (fileOfImport.has(name)) mounts.set(fileOfImport.get(name)!, prefix ?? "");
}
// root-level mounts (health etc.)
const rootUseRe = /app\.use\(\s*(?:"([^"]*)"\s*,\s*)?(\w+)\s*\)/g;
for (let m; (m = rootUseRe.exec(appSrc)); ) {
    const [, prefix, name] = m;
    if (fileOfImport.has(name) && !mounts.has(fileOfImport.get(name)!))
        mounts.set(fileOfImport.get(name)!, (prefix ?? "") + " (app root)");
}

// ── per-file census ──────────────────────────────────────────────────────────
interface Route {
    file: string;
    method: string;
    path: string;
    gate: string;          // requirePermission key | "canAccess(...)" | "authenticate-only" | "public"
    extras: string[];      // anything else notable in the chain
}
const routes: Route[] = [];

for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(ROUTES, f), "utf8");
    const base = f.replace(/\.ts$/, "");
    const prefix = mounts.get(base) ?? "(unmounted?)";
    // router-level middleware: router.use(authenticate) etc.
    const routerUse = [...src.matchAll(/router\.use\(([^)]*)\)/g)].map((m) => m[1]);
    const routerAuth = routerUse.some((x) => x.includes("authenticate"));
    const routerPerm = routerUse
        .map((x) => x.match(/requirePermission\(\s*"([^"]+)"/)?.[1])
        .filter(Boolean) as string[];

    // gates bound to consts: const gateName = requirePermission("key")
    const constGates = new Map<string, string>();
    for (const cm of src.matchAll(/const\s+(\w+)\s*=\s*requirePermission\(\s*"([^"]+)"/g))
        constGates.set(cm[1], cm[2]);
    const regRe = /router\.(get|post|patch|put|delete)\(\s*\n?\s*["'`]([^"'`]+)["'`]/g;
    const regs = [...src.matchAll(regRe)];
    regs.forEach((m, i) => {
        const start = m.index!;
        const end = i + 1 < regs.length ? regs[i + 1].index! : src.length;
        const block = src.slice(start, end);
        let perm = block.match(/requirePermission\(\s*"([^"]+)"/)?.[1] ?? routerPerm[0];
        if (!perm)
            for (const [name, key] of constGates)
                if (new RegExp("[^A-Za-z0-9_]" + name + "\\s*,").test(block)) {
                    perm = key;
                    break;
                }
        const can = block.match(/canAccess\(([^)]*)\)/)?.[1];
        const hasAuth = routerAuth || /(?<![A-Za-z])authenticate(?![A-Za-z(])/.test(block.split("\n").slice(0, 12).join("\n"));
        const extras: string[] = [];
        if (block.includes("requireDevType")) extras.push("requireDevType");
        if (block.includes("publicFormLimiter") || base === "publicForms") extras.push("public-surface");
        const gate = perm
            ? `perm:${perm}`
            : can
              ? `canAccess(${can.replace(/\s+/g, "")})`
              : hasAuth
                ? "authenticate-only"
                : "public";
        routes.push({ file: base, method: m[1].toUpperCase(), path: `${prefix}${m[2] === "/" ? "" : m[2]}`, gate, extras });
    });
}

// ── cross-reference against the catalog ──────────────────────────────────────
const catalogKeys = PERMISSIONS.map((p) => p.key);
const gatedKeys = new Set(
    routes.map((r) => r.gate).filter((g) => g.startsWith("perm:")).map((g) => g.slice(5)),
);
const ungatedRoutes = routes.filter((r) => r.gate === "authenticate-only");
const keysWithNoRoute = catalogKeys.filter((k) => !gatedKeys.has(k));

console.log(JSON.stringify({
    counts: {
        catalog: catalogKeys.length,
        routesTotal: routes.length,
        gatedByPermission: routes.filter((r) => r.gate.startsWith("perm:")).length,
        legacyCanAccess: routes.filter((r) => r.gate.startsWith("canAccess")).length,
        authenticateOnly: ungatedRoutes.length,
        public: routes.filter((r) => r.gate === "public").length,
        distinctKeysGated: gatedKeys.size,
        keysWithNoRoute: keysWithNoRoute.length,
    },
    keysWithNoRoute,
    routes,
    catalog: PERMISSIONS.map((p) => ({
        key: p.key, scopes: p.scopes, dangerous: !!p.dangerous,
    })),
}, null, 1));
