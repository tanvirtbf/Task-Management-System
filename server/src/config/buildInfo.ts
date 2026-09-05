import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
export const readGitSha = (repoRoot: string): string | null => {
    try {
        const gitDir = path.join(repoRoot, ".git");
        const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
        if (SHA.test(head)) return head.toLowerCase();

        const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
        if (!ref) return null;

        const loose = path.join(gitDir, ref);
        if (existsSync(loose)) {
            const sha = readFileSync(loose, "utf8").trim();
            return SHA.test(sha) ? sha.toLowerCase() : null;
        }

        const packed = path.join(gitDir, "packed-refs");
        if (existsSync(packed)) {
            for (const line of readFileSync(packed, "utf8").split("\n")) {
                const [sha, name] = line.trim().split(/\s+/);
                if (name === ref && sha && SHA.test(sha)) {
                    return sha.toLowerCase();
                }
            }
        }
        return null;
    } catch {
        return null;
    }
};

// `src/config` → `../../..` is the repo root, and so is `dist/config` →
// `../../..`, so the compiled build resolves to the same place as the source.
const CHECKOUT_SHA = readGitSha(path.join(__dirname, "..", "..", ".."));

/** What `/health/version` reports. Env first, then the checkout, then honesty. */
export const gitSha = (): string =>
    process.env.GIT_SHA?.trim() || CHECKOUT_SHA || "unknown";
