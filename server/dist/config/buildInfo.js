"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitSha = exports.readGitSha = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/**
 * WHICH BUILD IS THIS?
 *
 * KI-26: `GET /health/version` answered `git_sha: "unknown"` on every box,
 * because the only source was a `GIT_SHA` environment variable that nothing in
 * the deploy ever set. A version endpoint that cannot name the version is
 * furniture — during the 2026-09-03 deploy the only way to tell whether the
 * running process matched the commit was to compare bundle filenames by eye.
 *
 * So: read the checkout. The production box IS a git checkout (deploys are
 * `git pull` + `pm2 restart`; `dist` ships tracked), so `.git/HEAD` is the
 * cheapest honest answer available. `GIT_SHA` still wins when set, for the
 * container case where the source tree is not shipped.
 *
 * No subprocess. Spawning `git rev-parse` at module load would add a process
 * spawn to every boot and fail differently depending on whether git is on the
 * PATH of whatever user pm2 runs as. Three small files answer it.
 */
const SHA = /^[0-9a-f]{40}$/i;
/**
 * The commit a checkout is on, or `null` if this is not one.
 *
 * Handles the three shapes `.git/HEAD` actually takes:
 *   - a detached HEAD, where the file is the sha itself;
 *   - `ref: refs/heads/main` with a loose ref file;
 *   - the same, after `git gc` has packed the ref away into `packed-refs`.
 * A worktree (`gitdir: …`) is deliberately not followed — deploys do not use
 * one, and guessing would be worse than saying "unknown".
 */
const readGitSha = (repoRoot) => {
    try {
        const gitDir = node_path_1.default.join(repoRoot, ".git");
        const head = (0, node_fs_1.readFileSync)(node_path_1.default.join(gitDir, "HEAD"), "utf8").trim();
        if (SHA.test(head))
            return head.toLowerCase();
        const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
        if (!ref)
            return null;
        const loose = node_path_1.default.join(gitDir, ref);
        if ((0, node_fs_1.existsSync)(loose)) {
            const sha = (0, node_fs_1.readFileSync)(loose, "utf8").trim();
            return SHA.test(sha) ? sha.toLowerCase() : null;
        }
        const packed = node_path_1.default.join(gitDir, "packed-refs");
        if ((0, node_fs_1.existsSync)(packed)) {
            for (const line of (0, node_fs_1.readFileSync)(packed, "utf8").split("\n")) {
                const [sha, name] = line.trim().split(/\s+/);
                if (name === ref && sha && SHA.test(sha)) {
                    return sha.toLowerCase();
                }
            }
        }
        return null;
    }
    catch {
        return null;
    }
};
exports.readGitSha = readGitSha;
// `src/config` → `../../..` is the repo root, and so is `dist/config` →
// `../../..`, so the compiled build resolves to the same place as the source.
const CHECKOUT_SHA = (0, exports.readGitSha)(node_path_1.default.join(__dirname, "..", "..", ".."));
/** What `/health/version` reports. Env first, then the checkout, then honesty. */
const gitSha = () => process.env.GIT_SHA?.trim() || CHECKOUT_SHA || "unknown";
exports.gitSha = gitSha;
