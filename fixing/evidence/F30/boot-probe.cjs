// F30 (ISS-005) — boot-time measurement, spawn → first 200 from /health.
//   node fixing/evidence/F30/boot-probe.cjs tsx|dist|watch-reload
const { spawn } = require("child_process");
const SERVER = "E:/Task Management System/server";
const PORT = 5714;
const mode = process.argv[2] || "tsx";

const CMDS = {
    tsx: ["npx", ["tsx", "src/server.ts"]],
    dist: ["node", ["dist/server.js"]],
};

(async () => {
    const [cmd, args] = CMDS[mode];
    const t0 = Date.now();
    const child = spawn(cmd, args, {
        cwd: SERVER, shell: true,
        env: { ...process.env, NODE_ENV: "dev", PORT: String(PORT), DISABLE_RATE_LIMIT: "1" },
        stdio: "ignore",
    });
    let up = -1;
    for (let i = 0; i < 300; i += 1) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/health`);
            if (r.ok) { up = Date.now() - t0; break; }
        } catch { /* not yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    console.log(mode + " boot -> listening: " + (up < 0 ? "NEVER (30s cap)" : (up / 1000).toFixed(1) + " s"));
    // Windows: kill the whole tree (shell:true wraps the real process).
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
    setTimeout(() => process.exit(up < 0 ? 1 : 0), 1500);
})();
