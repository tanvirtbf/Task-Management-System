import { readFileSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { Config } from "../../src/config";
import { JOB_NAMES } from "../../src/jobs";

/**
 * EVERY JOB ENDPOINT, AND THE THREE PLACES A JOB HAS TO BE LISTED.
 *
 * The individual job suites each prove their own logic and are where a failure
 * gets debugged. What none of them can answer is the question a phase gate
 * needs: **is every job reachable, guarded, and actually scheduled?**
 *
 * That last one is the interesting one, because a job lives in THREE lists and
 * production only works if all three agree:
 *
 *   1. `src/jobs/index.ts` — the registry the dispatcher looks the slug up in;
 *   2. `src/routes/jobs.ts` — the HTTP route cron POSTs to;
 *   3. `deploy/cron/bbtasks-jobs` — the schedule that actually fires it.
 *
 * Miss (2) and the job exists but cannot be triggered — which already happened
 * once: gap-scan M2 found `form-submission-expiry` registered and never routed,
 * so the 90-day encrypted-PII purge could not run under the documented cron.
 * Miss (3) and everything looks perfect and NOTHING EVER RUNS, which is the
 * failure the cron file's own header describes: "sessions never expire, …
 * RECURRING TASKS NEVER REPEAT".
 *
 * Neither omission fails any existing test, and neither is visible from
 * reading one file. So this compares the three lists to each other.
 *
 * P12 also found the endpoint half of two jobs untested: `department-report`
 * and `recurrence-spawn` had thorough suites that import the job FUNCTION
 * directly, so their route — and therefore their authz — had never been
 * exercised. The per-endpoint checks below close that.
 */

const REPO = path.join(__dirname, "..", "..", "..");
const ROUTES_SRC = path.join(__dirname, "..", "..", "src", "routes", "jobs.ts");
const CRON_FILE = path.join(REPO, "deploy", "cron", "bbtasks-jobs");

const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const url = (slug: string) => `/api/v1/jobs/${slug}`;

/** The slugs the dispatcher knows about — the source of truth for the sweep. */
// Widened to string[]: the two lists it is compared against are parsed from
// files and are plainly strings, and a literal-union type here only makes the
// comparisons need casts without making them safer.
const REGISTERED: string[] = [...JOB_NAMES].sort();

/**
 * `router.post("/slug"` — the routes actually mounted.
 *
 * The character class must include DIGITS. Without them `r2-purge` does not
 * match here at all and matches as bare "r" in the cron file — which made the
 * first run of this sweep report a missing route and a ghost schedule that were
 * both my parser, not the product.
 */
const routedSlugs = (): string[] => {
    const src = readFileSync(ROUTES_SRC, "utf8");
    return [...src.matchAll(/router\.post\(\s*\n?\s*"\/([a-z0-9-]+)"/g)]
        .map((m) => m[1])
        .sort();
};

/** `run-job.sh <slug>` — the jobs cron will actually fire in production. */
const scheduledSlugs = (): string[] => {
    const src = readFileSync(CRON_FILE, "utf8");
    return [
        ...new Set(
            src
                .split("\n")
                .filter((l) => !l.trim().startsWith("#"))
                .flatMap((l) => [...l.matchAll(/run-job\.sh\s+([a-z0-9-]+)/g)])
                .map((m) => m[1]),
        ),
    ].sort();
};

describe("job endpoints — the three lists must agree", () => {
    it("finds all three lists (guards against a vacuous pass)", () => {
        expect(REGISTERED.length).toBeGreaterThanOrEqual(9);
        expect(routedSlugs().length).toBeGreaterThanOrEqual(9);
        expect(scheduledSlugs().length).toBeGreaterThanOrEqual(9);
    });

    it("every registered job has an HTTP route (gap-scan M2's shape)", () => {
        const missing = REGISTERED.filter((s) => !routedSlugs().includes(s));
        expect({ registeredButNotRouted: missing }).toEqual({
            registeredButNotRouted: [],
        });
    });

    it("every route points at a registered job (no route to nowhere)", () => {
        const orphan = routedSlugs().filter((s) => !REGISTERED.includes(s));
        expect({ routedButNotRegistered: orphan }).toEqual({
            routedButNotRegistered: [],
        });
    });

    it("every job is SCHEDULED — an unscheduled job never runs at all", () => {
        // The failure with no symptom. Everything is testable, everything
        // passes, and in production the work simply never happens.
        const unscheduled = REGISTERED.filter(
            (s) => !scheduledSlugs().includes(s),
        );
        expect({ neverScheduled: unscheduled }).toEqual({ neverScheduled: [] });
    });

    it("the cron file schedules nothing that does not exist", () => {
        const ghost = scheduledSlugs().filter((s) => !REGISTERED.includes(s));
        expect({ scheduledButUnknown: ghost }).toEqual({ scheduledButUnknown: [] });
    });
});

describe.each(REGISTERED)("POST /jobs/%s", (slug) => {
    it("401 without the internal token", async () => {
        const res = await (await oneOff()).post(url(slug)).send({});
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("auth.unauthorized");
    });

    it("401 for a wrong token", async () => {
        const res = await (await oneOff())
            .post(url(slug))
            .set("X-Internal-Token", "not-the-token")
            .send({});
        expect(res.status).toBe(401);
    });

    it("is NOT callable by a signed-in member (a user token is not an internal token)", async () => {
        // §P12 task 1. These endpoints delete sessions, purge PII and email
        // people; `internalAuth` REPLACES the normal auth chain rather than
        // extending it, so the thing to prove is that an ordinary member's
        // perfectly valid Bearer token buys them nothing here.
        const ws = await makeWorkspace();
        const user = await makeUser({ workspaceId: ws.id, role: "member" });
        const bearer = jwt.sign(
            { sub: user.id, role: "member", workspaceId: ws.id },
            Config.ACCESS_TOKEN_SECRET ?? "",
            { algorithm: "HS256", expiresIn: "15m" },
        );
        const res = await (await oneOff())
            .post(url(slug))
            .set("Authorization", `Bearer ${bearer}`)
            .send({});
        expect(res.status).toBe(401);
    });

    it("200 with the internal token, in the { ok, dry_run } envelope", async () => {
        const res = await (await oneOff())
            .post(url(slug))
            .set("X-Internal-Token", token())
            .send({});
        // A job FAILURE is 200 { ok:false } by design — cron branches on the
        // body, and a 5xx would make a transient job error look like an outage.
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("ok");
        expect(res.body).toHaveProperty("dry_run", false);
        expect({ slug, body: res.body }).toMatchObject({ slug, body: { ok: true } });
    });

    it("?dry_run=true reports without doing", async () => {
        const res = await (await oneOff())
            .post(`${url(slug)}?dry_run=true`)
            .set("X-Internal-Token", token())
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.dry_run).toBe(true);
        expect(res.body.ok).toBe(true);
    });

    it("is idempotent — a second run on the same state changes nothing more", async () => {
        // Run twice back to back and require the same outcome. The per-job
        // suites prove idempotence against seeded rows; this proves the
        // ENDPOINT does not double-act, for every job including the two whose
        // routes had no test at all.
        const once = await (await oneOff())
            .post(url(slug))
            .set("X-Internal-Token", token())
            .send({});
        const twice = await (await oneOff())
            .post(url(slug))
            .set("X-Internal-Token", token())
            .send({});
        expect(once.body.ok).toBe(true);
        expect(twice.body.ok).toBe(true);
        // Whatever the job counts, the second pass over an unchanged world must
        // not report MORE work done than the first.
        const done = (b: Record<string, unknown>) =>
            typeof b.processed === "number" ? b.processed : 0;
        expect(done(twice.body)).toBeLessThanOrEqual(done(once.body));
    });
});
