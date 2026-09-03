import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeStatus,
    makeTaskType,
    makeUser,
} from "../test-utils/factories";
import { makeForm, makeFormField, setListDefaultTaskType } from "./helpers";
import { Config } from "../../src/config";
import { _internal } from "../../src/middlewares/rateLimit";

/**
 * `publicFormLimiter`, actually running.
 *
 * The two public form routes are this system's ONLY unauthenticated surface,
 * and each submission creates a real task in a real workspace and notifies a
 * real team. The 30/min/IP bucket is the whole of the abuse control, and it had
 * never executed inside a test — the same shape P2 found across the auth
 * limiters, where a limiter on the wrong route or with the wrong ceiling would
 * have looked identical to every passing test.
 *
 * Opt in with `ENABLE_RATE_LIMIT=1` and leave `NODE_ENV` alone: `MailService`
 * picks a REAL SMTP transport whenever `NODE_ENV !== "test"` and this project's
 * dev mailer delivers to real people (§A rule 4).
 *
 * Bucket hygiene: `express-rate-limit` keeps counters in a MemoryStore for the
 * life of the module and the per-test DB reset does not touch them, so each
 * test claims its own client IP through `X-Forwarded-For`.
 */

jest.setTimeout(120_000);

/** The documented ceiling on the public form routes. */
const PUBLIC_LIMIT = 30;

let ipSeq = 0;
/** TEST-NET-3 is reserved for documentation — these can never be a real host. */
const nextIp = (): string => `203.0.113.${100 + (++ipSeq % 150)}`;

const seedPublicForm = async () => {
    const u = await makeUser({ role: "admin" });
    const list = await makeList({ workspaceId: u.workspaceId, createdBy: u.id });
    const tt = await makeTaskType({ workspaceId: u.workspaceId });
    await setListDefaultTaskType(list.id, tt.id);
    await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
    const form = await makeForm({
        listId: list.id,
        createdBy: u.id,
        title: "Public intake",
        isPublic: true,
    });
    await makeFormField({
        formId: form.id,
        fieldKind: "task_attr",
        fieldKey: "name",
        label: "Your name",
        isRequired: true,
    });
    return { u, formId: form.id, slug: form.publicSlug };
};

const viewAs = async (slug: string, ip: string) =>
    (await oneOff())
        .get(`/api/v1/public/forms/${slug}`)
        .set("X-Forwarded-For", ip);

const submitAs = async (slug: string, ip: string) =>
    (await oneOff())
        .post(`/api/v1/public/forms/${slug}/submit`)
        .set("X-Forwarded-For", ip)
        .send({ data: { name: "Rahim" } });

describe("the public form routes are rate limited per IP", () => {
    const priorEnable = process.env.ENABLE_RATE_LIMIT;
    const priorDisable = process.env.DISABLE_RATE_LIMIT;

    beforeAll(async () => {
        // Guard the guard: if this switch ever started swapping the mail
        // transport too, this file would become a live-delivery risk.
        expect(Config.NODE_ENV).toBe("test");
        process.env.ENABLE_RATE_LIMIT = "1";
        delete process.env.DISABLE_RATE_LIMIT;
        expect(_internal.limitersBypassed()).toBe(false);
        // Warm the app outside /api/v1 so no bucket slot is spent on it.
        await (await oneOff()).get("/health");
    }, 120_000);

    afterAll(() => {
        if (priorEnable === undefined) delete process.env.ENABLE_RATE_LIMIT;
        else process.env.ENABLE_RATE_LIMIT = priorEnable;
        if (priorDisable === undefined) delete process.env.DISABLE_RATE_LIMIT;
        else process.env.DISABLE_RATE_LIMIT = priorDisable;
        // Everything after this file must see the suite-wide bypass again.
        expect(_internal.limitersBypassed()).toBe(true);
        expect(Config.NODE_ENV).toBe("test");
    });

    it("allows 30 requests from one IP and refuses the 31st", async () => {
        const f = await seedPublicForm();
        const ip = nextIp();

        for (let i = 0; i < PUBLIC_LIMIT; i++) {
            const res = await viewAs(f.slug, ip);
            expect({ i, status: res.status }).toEqual({ i, status: 200 });
        }

        const over = await viewAs(f.slug, ip);
        expect(over.status).toBe(429);
        expect(over.body.error.code).toBe("rate.exceeded");
    });

    it("counts the VIEW and the SUBMIT against the same bucket", async () => {
        const f = await seedPublicForm();
        const ip = nextIp();

        // Half the budget on views…
        for (let i = 0; i < PUBLIC_LIMIT / 2; i++) {
            expect((await viewAs(f.slug, ip)).status).toBe(200);
        }
        // …then the rest on submits. One shared limiter instance is mounted on
        // both routes, so alternating cannot buy 60 requests instead of 30.
        for (let i = 0; i < PUBLIC_LIMIT / 2; i++) {
            expect((await submitAs(f.slug, ip)).status).toBe(201);
        }

        expect((await submitAs(f.slug, ip)).status).toBe(429);
        expect((await viewAs(f.slug, ip)).status).toBe(429);
    });

    it("is keyed per IP — one abuser does not lock everybody else out", async () => {
        const f = await seedPublicForm();
        const abuser = nextIp();
        const bystander = nextIp();

        for (let i = 0; i < PUBLIC_LIMIT; i++) {
            await viewAs(f.slug, abuser);
        }
        expect((await viewAs(f.slug, abuser)).status).toBe(429);

        // A customer on a different connection is unaffected.
        expect((await viewAs(f.slug, bystander)).status).toBe(200);
        expect((await submitAs(f.slug, bystander)).status).toBe(201);
    });

    it("refuses BEFORE the handler runs — a 429 creates no task", async () => {
        const f = await seedPublicForm();
        const ip = nextIp();
        for (let i = 0; i < PUBLIC_LIMIT; i++) {
            await viewAs(f.slug, ip);
        }

        const blocked = await submitAs(f.slug, ip);

        expect(blocked.status).toBe(429);
        // The point of the limit is that the expensive path never happens: no
        // intake task, no notification, no submission row.
        expect(blocked.body.submission_id).toBeUndefined();
        expect(blocked.body.task_id).toBeUndefined();
    });
});
