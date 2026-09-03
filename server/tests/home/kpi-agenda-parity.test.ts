import { eq } from "drizzle-orm";
import {
    makeList,
    makeLoggedInClient,
    makeStatus,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { dhakaDayOffset, wireYmd } from "../test-utils/dates";
import { getDb } from "../../src/db/client";
import { taskAssignees, tasks } from "../../src/db/schema";

/**
 * The `dueToday` KPI and `GET /home/agenda` are the same sentence twice.
 *
 * The tile says "you have N things due today"; the agenda lists them. They are
 * computed by two different repo methods, from two different queries, and
 * nothing has ever compared them — each is tested against what its own test
 * expected, which is exactly the shape that lets a tile say 3 over a list of 2.
 *
 * So this file never asserts a number. It asserts they AGREE, across the rows
 * that separate the two definitions — done, archived, unassigned, someone
 * else's, due tomorrow — and that they agree about which day "today" is when
 * the workspace does not live in UTC.
 */

jest.setTimeout(30_000);

const KPIS = "/api/v1/home/kpis";
const AGENDA = "/api/v1/home/agenda";

type StatusGroup = "not_started" | "active" | "done" | "closed";

const scene = async (timezone?: string) => {
    const ws = await makeWorkspace(timezone ? { timezone } : {});
    const me = await makeUser({ workspaceId: ws.id, role: "member" });
    const other = await makeUser({ workspaceId: ws.id, role: "member" });
    const client = await makeLoggedInClient(me);
    const list = await makeList({ workspaceId: ws.id, createdBy: me.id });
    return { ws, me, other, client, list };
};
type Scene = Awaited<ReturnType<typeof scene>>;

const seedTask = async (
    s: Scene,
    opts: {
        dueDate?: Date | null;
        statusGroup?: StatusGroup;
        archived?: boolean;
        assignTo?: string | null;
        completedAt?: Date | null;
    } = {},
): Promise<string> => {
    const status = await makeStatus({
        scopeId: s.list.id,
        statusGroup: opts.statusGroup ?? "active",
    });
    const t = await makeTask({
        workspaceId: s.ws.id,
        listId: s.list.id,
        createdBy: s.me.id,
        statusId: status.id,
        archivedAt: opts.archived ? new Date() : null,
    });
    await getDb()
        .update(tasks)
        .set({
            dueDate: opts.dueDate === undefined ? null : opts.dueDate,
            completedAt: opts.completedAt ?? null,
        })
        .where(eq(tasks.id, t.id));
    if (opts.assignTo) {
        await getDb()
            .insert(taskAssignees)
            .values({ taskId: t.id, userId: opts.assignTo });
    }
    return t.id;
};

/** The two surfaces, read back together. */
const bothSurfaces = async (s: Scene) => {
    const [kpis, agenda] = await Promise.all([
        s.client.get(KPIS),
        s.client.get(AGENDA),
    ]);
    expect(kpis.status).toBe(200);
    expect(agenda.status).toBe(200);
    return {
        tile: kpis.body.dueToday.value as number,
        listed: (agenda.body as Array<{ id: string }>).map((t) => t.id),
    };
};

const expectAgreement = async (s: Scene, about: string) => {
    const { tile, listed } = await bothSurfaces(s);
    expect({ about, tile, agenda: listed.length }).toEqual({
        about,
        tile: listed.length,
        agenda: listed.length,
    });
    return { tile, listed };
};

describe("the dueToday tile and the agenda are one claim", () => {
    it("agree on nothing at all", async () => {
        const s = await scene();
        const { tile } = await expectAgreement(s, "empty workspace");
        expect(tile).toBe(0);
    });

    it("agree on a plain open task assigned to me and due today", async () => {
        const s = await scene();
        const id = await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.me.id,
        });

        const { listed } = await expectAgreement(s, "one open task due today");
        expect(listed).toEqual([id]);
    });

    it("agree that a DONE task due today is not due today", async () => {
        const s = await scene();
        await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.me.id,
            statusGroup: "done",
            completedAt: new Date(),
        });

        const { tile } = await expectAgreement(s, "done task due today");
        expect(tile).toBe(0);
    });

    it("agree that an ARCHIVED task due today is not due today", async () => {
        const s = await scene();
        await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.me.id,
            archived: true,
        });

        const { tile } = await expectAgreement(s, "archived task due today");
        expect(tile).toBe(0);
    });

    it("agree about a task due today assigned to SOMEBODY ELSE", async () => {
        const s = await scene();
        await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.other.id,
        });

        // Whatever the rule is, both surfaces have to apply the same one.
        const { tile } = await expectAgreement(s, "someone else's task");
        expect(tile).toBe(0);
    });

    it("agree about a task due today that I created and nobody is assigned", async () => {
        const s = await scene();
        await seedTask(s, { dueDate: dhakaDayOffset(0), assignTo: null });

        await expectAgreement(s, "unassigned task I created");
    });

    it("agree that tomorrow is not today, and yesterday is not either", async () => {
        const s = await scene();
        await seedTask(s, { dueDate: dhakaDayOffset(1), assignTo: s.me.id });
        await seedTask(s, { dueDate: dhakaDayOffset(-1), assignTo: s.me.id });

        const { tile } = await expectAgreement(s, "adjacent days");
        expect(tile).toBe(0);
    });

    it("agree once the mix is realistic", async () => {
        const s = await scene();
        const due = [
            await seedTask(s, { dueDate: dhakaDayOffset(0), assignTo: s.me.id }),
            await seedTask(s, {
                dueDate: dhakaDayOffset(0),
                assignTo: s.me.id,
                statusGroup: "not_started",
            }),
        ];
        await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.me.id,
            statusGroup: "done",
            completedAt: new Date(),
        });
        await seedTask(s, {
            dueDate: dhakaDayOffset(0),
            assignTo: s.me.id,
            archived: true,
        });
        await seedTask(s, { dueDate: dhakaDayOffset(0), assignTo: s.other.id });
        await seedTask(s, { dueDate: dhakaDayOffset(2), assignTo: s.me.id });
        await seedTask(s, { dueDate: null, assignTo: s.me.id });

        const { tile, listed } = await expectAgreement(s, "the realistic mix");
        expect(tile).toBe(2);
        expect(listed.sort()).toEqual([...due].sort());
    });

    describe("and about which day 'today' is", () => {
        it("both read the WORKSPACE's timezone, not the server's", async () => {
            // Pacific/Kiritimati is UTC+14 — the furthest ahead there is, so
            // its calendar day differs from both UTC and Dhaka for part of
            // every day. If one surface asked the OS and the other asked the
            // workspace, this is where they would part company.
            const s = await scene("Pacific/Kiritimati");
            await seedTask(s, {
                dueDate: dhakaDayOffset(0),
                assignTo: s.me.id,
            });
            await seedTask(s, {
                dueDate: dhakaDayOffset(1),
                assignTo: s.me.id,
            });

            await expectAgreement(s, "a workspace 8 hours ahead of Dhaka");
        });

        it("an explicit ?date= moves the agenda, and the tile still means today", async () => {
            const s = await scene();
            const tomorrow = dhakaDayOffset(1);
            const id = await seedTask(s, {
                dueDate: tomorrow,
                assignTo: s.me.id,
            });

            const [kpis, agenda] = await Promise.all([
                s.client.get(KPIS),
                s.client.get(`${AGENDA}?date=${wireYmd(tomorrow)}`),
            ]);

            // The tile is always about today; the agenda was asked about
            // tomorrow. They are allowed to differ HERE — that is the one case
            // where disagreement is correct, and pinning it stops a future
            // "fix" from making the tile follow the query string.
            expect(kpis.body.dueToday.value).toBe(0);
            expect((agenda.body as Array<{ id: string }>).map((t) => t.id)).toEqual([id]);
        });
    });
});
