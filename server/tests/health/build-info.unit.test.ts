import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGitSha } from "../../src/config/buildInfo";

/**
 * KI-26 — `/health/version` reported `git_sha: "unknown"` on every box, because
 * the only source was a `GIT_SHA` variable nothing in the deploy ever set. The
 * fix reads the checkout, which is what a deploy of this product actually is
 * (`git pull` + `pm2 restart`, with `dist` tracked).
 *
 * `.git/HEAD` takes three shapes in the wild and the resolver has to handle all
 * three, so each gets a fixture here rather than a hope. Pure unit tests: they
 * build a `.git` directory in a temp folder and never touch this repository.
 */

const withGitDir = (
    build: (gitDir: string) => void,
): { root: string; cleanup: () => void } => {
    const root = mkdtempSync(path.join(tmpdir(), "bb-gitsha-"));
    const gitDir = path.join(root, ".git");
    mkdirSync(gitDir, { recursive: true });
    build(gitDir);
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

const SHA = "b090667a1c2d3e4f5061728394a5b6c7d8e9f012";

describe("readGitSha", () => {
    it("reads a loose ref — the ordinary checkout", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\n");
            mkdirSync(path.join(git, "refs", "heads"), { recursive: true });
            writeFileSync(path.join(git, "refs", "heads", "main"), SHA + "\n");
        });
        try {
            expect(readGitSha(root)).toBe(SHA);
        } finally {
            cleanup();
        }
    });

    it("reads a PACKED ref — what `git gc` leaves behind on a long-lived box", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\n");
            writeFileSync(
                path.join(git, "packed-refs"),
                [
                    "# pack-refs with: peeled fully-peeled sorted",
                    "1111111111111111111111111111111111111111 refs/heads/other",
                    `${SHA} refs/heads/main`,
                    "2222222222222222222222222222222222222222 refs/tags/v1",
                ].join("\n"),
            );
        });
        try {
            expect(readGitSha(root)).toBe(SHA);
        } finally {
            cleanup();
        }
    });

    it("reads a DETACHED head, where the file is the sha itself", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), SHA.toUpperCase() + "\n");
        });
        try {
            expect(readGitSha(root)).toBe(SHA); // normalised to lower case
        } finally {
            cleanup();
        }
    });

    it("returns null rather than guessing when there is no checkout", () => {
        const root = mkdtempSync(path.join(tmpdir(), "bb-nogit-"));
        try {
            expect(readGitSha(root)).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("returns null for a ref it cannot resolve — never a partial answer", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/gone\n");
        });
        try {
            expect(readGitSha(root)).toBeNull();
        } finally {
            cleanup();
        }
    });

    it("returns null for a HEAD that is not a sha and not a ref (corrupt)", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), "not a git head at all\n");
        });
        try {
            expect(readGitSha(root)).toBeNull();
        } finally {
            cleanup();
        }
    });

    it("returns null for a ref file holding something that is not a sha", () => {
        const { root, cleanup } = withGitDir((git) => {
            writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\n");
            mkdirSync(path.join(git, "refs", "heads"), { recursive: true });
            writeFileSync(path.join(git, "refs", "heads", "main"), "garbage\n");
        });
        try {
            expect(readGitSha(root)).toBeNull();
        } finally {
            cleanup();
        }
    });
});
