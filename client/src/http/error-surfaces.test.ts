import { describe, it, expect } from "vitest";

/**
 * P10 — the CLASS of bug, not the five instances.
 *
 * `getApiErrorMessage` was always correct. What was wrong was five call sites
 * that did not use it:
 *
 *     onError: (err) => message.error(
 *         err instanceof Error ? err.message : "Failed to save profile",
 *     )
 *
 * That line reads like care and is the opposite. For an AxiosError —
 * i.e. every failure this application actually produces — `err.message` is
 * "Request failed with status code 422", so the ternary's fallback string is
 * dead code and the person is shown a status code. On the password form, where
 * the 422's `details[]` is the only thing that says WHICH rule failed, they
 * were told no and not told why.
 *
 * A test naming the five files would go stale the moment somebody writes a
 * sixth. This scans the source instead, which is the only version of the
 * assertion that keeps working.
 *
 * `import.meta.glob` rather than `node:fs`: the client's `tsconfig.app.json`
 * pins `types` to vitest/jest-dom/vite-client, so a `node:` import does not
 * type-check here even though it would run — the same trap P8's service-worker
 * test hit. Vite's own glob needs no node types and no path arithmetic.
 */

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const FILES = Object.entries(SOURCES).filter(
    ([path]) => !/\.test\.tsx?$/.test(path),
);

/**
 * `err.message` reached for inside an error handler. Matches the ternary in any
 * whitespace arrangement, which is how the four survivors differed from each
 * other.
 */
const RAW_AXIOS = /instanceof\s+Error\s*\?\s*\s*\w+\.message/;

/** A hand-rolled read of the `{error:{…}}` envelope. */
const HAND_ROLLED = /data\?*\s*\.\s*error\?*\s*\.\s*message/;

/**
 * The two files that may reach for `err.message`, each for a stated reason.
 * NAMED rather than pattern-excluded, so a third one has to be argued for
 * rather than absorbed.
 */
const ALLOWED = new Map([
    [
        "/client.ts",
        "the canonical implementation — this IS getApiErrorMessage's own last-resort fallback",
    ],
    [
        "stores/chat.ts",
        "the assistant stream is fetch-based, not axios: `http/assistant.ts` throws a " +
            "hand-written Bangla sentence chosen per status (503 busy, 403 no permission, " +
            "429 too fast), so err.message there is the intended text, not a status code",
    ],
]);
const isAllowed = (path: string) =>
    [...ALLOWED.keys()].some((suffix) => path.endsWith(suffix));

describe("no UI surface renders axios's own error string", () => {
    it("finds the source tree (guards against a vacuous pass)", () => {
        // Without this, a bad glob would make the scans below pass by examining
        // nothing at all — the failure mode of every scan-shaped test.
        expect(FILES.length).toBeGreaterThan(50);
        expect(FILES.some(([p]) => p.endsWith("/client.ts"))).toBe(true);
    });

    it("the two named exceptions still exist (an allowlist entry for a deleted file hides nothing)", () => {
        for (const suffix of ALLOWED.keys()) {
            expect(
                FILES.some(([p]) => p.endsWith(suffix)),
                `allowlist names ${suffix}, which no longer exists — drop the entry`,
            ).toBe(true);
        }
    });

    it("no file falls back to `err.message` for an API failure", () => {
        const offenders = FILES.filter(
            ([p, src]) => RAW_AXIOS.test(src) && !isAllowed(p),
        ).map(([p]) => p);

        expect(
            offenders,
            "Use getApiErrorMessage(err) — it reads the {error:{code,message,details}} " +
                "envelope and, on a 422, the per-field reasons. `err.message` on an " +
                'AxiosError is "Request failed with status code NNN".\n' +
                offenders.join("\n"),
        ).toEqual([]);
    });

    it("nobody re-implements the envelope reader by hand either", () => {
        // The sixth site was a private `errorText` in RolesSettings that read
        // `response.data.error.message` itself and silently dropped details[],
        // so its 422s said "One or more fields failed validation" and stopped.
        // A hand-rolled copy is the same defect with a longer fuse.
        const offenders = FILES.filter(([p]) => !isAllowed(p))
            .filter(([, src]) => HAND_ROLLED.test(src))
            .map(([p]) => p);

        expect(
            offenders,
            "Read the error envelope through getApiError/getApiErrorMessage in " +
                "http/client.ts — a private copy drifts, and the first thing it " +
                "drops is details[].\n" +
                offenders.join("\n"),
        ).toEqual([]);
    });
});
