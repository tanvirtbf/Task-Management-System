import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * F30 (ISS-006): vendor chunking. The build shipped a 1,450 kB main chunk
 * (448 kB gzip) and a 551 kB task drawer — everything vendored rode in the
 * entry. Splitting react / the editor / maplibre / icons means the editor
 * (tiptap + prosemirror) loads only when the drawer does, and the stable
 * vendor chunks cache independently of weekly app deploys.
 *
 * ⚠️ antd is DELIBERATELY not bucketed. It was tried and measured: forcing
 * antd + rc-* into one manualChunk produced a 1,178 kB chunk that was a
 * STATIC dep of the entry — which eager-loaded the previously-lazy Table
 * (164 kB) and the drawer's antd pieces, growing first-load gzip from
 * ~448 kB to ~578 kB. Rollup's own per-usage splitting (shell antd in the
 * entry, Table lazy, drawer antd in the drawer chunk) is strictly better on
 * both metrics, so the entry stays above vite's 500 kB heuristic and the
 * warning limit below is raised with this paragraph as the justification.
 * Evidence: fixing/evidence/F30/build-antd-bucket.txt vs build-final.txt.
 *
 * Buckets are matched on the PACKAGE NAME, not substrings — "react-markdown"
 * must not land in the react bucket.
 */
const VENDOR_BUCKETS: Array<[string, (pkg: string) => boolean]> = [
    ["map", (p) => p === "maplibre-gl"],
    ["editor", (p) => p.startsWith("@tiptap/") || p.startsWith("prosemirror")],
    ["icons", (p) => p === "lucide-react"],
    [
        "react",
        (p) =>
            p === "react" ||
            p === "react-dom" ||
            p === "scheduler" ||
            p === "react-router" ||
            p === "react-router-dom" ||
            p === "@remix-run/router",
    ],
];

const pkgOf = (id: string): string | null => {
    const m = id.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
    return m ? m[1].replace(/\\/g, "/") : null;
};

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Bind 0.0.0.0 so other devices on the same Wi-Fi can reach the dev
        // server at http://<your-lan-ip>:5173 (not just localhost).
        host: true,
    },
    build: {
        // See the antd paragraph above — deliberate, measured, not ignored.
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    const pkg = pkgOf(id);
                    if (!pkg) return undefined;
                    for (const [name, match] of VENDOR_BUCKETS) {
                        if (match(pkg)) return name;
                    }
                    return undefined; // the long tail: let Rollup decide
                },
            },
        },
    },
    test: {
        environment: "happy-dom",
        setupFiles: "./setupTest.ts",
        globals: true,
    },
});
