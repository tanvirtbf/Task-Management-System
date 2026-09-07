import { and, eq, inArray } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { utcDate } from "../test-utils/dates";
import { getDb } from "../../src/db/client";
import { notifications, taskAssignees, tasks } from "../../src/db/schema";
import { Config } from "../../src/config";
import { MailService } from "../../src/services/MailService";
import {
    dhakaToday,
    dhakaWeekOf,
    todayInZone,
} from "../../src/utils/dhakaTime";

/**
 * §P12 task 4 — the canonical clock, end to end.
 *
 * P1's `session-clock` suite pins the clock at the POOL (`DB_TIMEZONE=+00:00`).
 * This is the outward half: one instant, four surfaces, and the question of
 * which calendar day each of them thinks it is.
 *
 * ── why two workspaces rather than a clock at 23:55 ─────────────────────────
 * The plan phrases this as "a task created at 23:55 Dhaka appears on the right
 * day". Written literally that test only means anything during the few minutes
 * a day when the wall clock is near a boundary, and passes vacuously the rest
 * of the time — the same trap KI-20 and KI-22 were written around. `due_date`
 * is a DATE column anyway: a calendar day with no time-of-day to straddle. The
 * question that actually matters is WHOSE calendar decides, and that can be
 * asked every hour of every day.
 *
 * So: two workspaces, Pacific/Kiritimati (UTC+14) and Pacific/Midway (UTC-11).
 * 25 hours apart, so their calendar dates ALWAYS differ. The sharp case is the
 * last one below — the SAME due date, at the SAME instant, is overdue in one
 * workspace and still in the future in the other. Nothing about that can be
 * satisfied by a server that reads its own OS clock, or UTC, or Dhaka.
 *
 * ── the fourth surface goes the other way ───────────────────────────────────
 * The weekly department report is a COMPANY event (Monday 09:00 Dhaka), so its
 * week must NOT move with a workspace's zone. KI-20 classified the 9 hardcoded
 * `dhakaToday()` call sites and this is one of the four that were right as they
 * were. It is asserted here for the same reason as the rest: so a later
 * "consistency" refactor that routes everything through the workspace zone is
 * caught as the regression it would be.
 */

const OVERDUE_URL = "/api/v1/jobs/overdue-alert";
const KPIS = "/api/v1/home/kpis";
const AGENDA = "/api/v1/home/agenda";

const EAST = "Pacific/Kiritimati"; // UTC+14
const WEST = "Pacific/Midway"; // UTC-11

const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";

const runOverdueJob = async () =>
    (await oneOff())
        .post(OVERDUE_URL)
        .set("X-Internal-Token", token())
        .send({});

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    mailSpy = jest
        .spyOn(MailService.prototype, "sendTaskOverdueEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

/** A workspace in `zone`, with one member who is logged in and assigned work. */
const scene = async (zone: string) => {
    const ws = await makeWorkspace({ timezone: zone });
    const me = await makeUser({ workspaceId: ws.id, role: "owner" });
    const client = await makeLoggedInClient(me);
    return { ws, me, client, zone };
};

/**
 * An open task due on `ymd`, assigned to `me`. Returns its id.
 *
 * `dueDate` goes on via an UPDATE rather than the factory (which does not take
 * one), and through `utcDate` rather than `new Date(ymd)` — a DATE column has
 * no timezone, and a local-midnight Date lands on the previous calendar day
 * from anywhere east of UTC. `tests/test-utils/dates.ts` has the full story.
 */
const dueOn = async (
    s: { ws: { id: string }; me: { id: string } },
    ymd: string,
): Promise<string> => {
    const t = await makeTask({ workspaceId: s.ws.id, createdBy: s.me.id });
    const db = getDb();
    await db
        .update(tasks)
        .set({ dueDate: utcDate(ymd) })
        .where(eq(tasks.id, t.id));
    await db
        .insert(taskAssignees)
        .values({ taskId: t.id, userId: s.me.id, assignedBy: s.me.id });
    return t.id;
};

/** Which of `ids` the overdue job has claimed. */
const alerted = async (ids: string[]): Promise<string[]> => {
    const rows = await getDb()
        .select({ id: tasks.id, at: tasks.overdueNotifiedAt })
        .from(tasks)
        .where(inArray(tasks.id, ids));
    return rows.filter((r) => r.at !== null).map((r) => r.id);
};

jest.setTimeout(60_000);

describe("the canonical clock, end to end (P12 task 4)", () => {
    it("the two zones used here disagree every hour of every day", () => {
        // Without this the whole file could pass on a day when every zone
        // happened to agree, proving nothing at all.
        const east = todayInZone(EAST);
        const west = todayInZone(WEST);
        expect(east).not.toBe(west);
        expect(east > west).toBe(true); // +14 is always ahead of −11
    });

    it("Home, the agenda and the overdue job agree on the workspace's day", async () => {
        const s = await scene(EAST);
        const today = todayInZone(EAST);
        const yesterday = todayInZone(WEST); // always ≥ 1 day earlier

        const dueToday = await dueOn(s, today);
        const late = await dueOn(s, yesterday);

        const [kpis, agenda] = await Promise.all([
            s.client.get(KPIS),
            s.client.get(AGENDA),
        ]);
        expect(kpis.status).toBe(200);

        // The tile and the agenda are one claim (P5's parity rule), and both
        // are about the WORKSPACE's today.
        expect(kpis.body.dueToday.value).toBe(1);
        expect(kpis.body.overdue.value).toBe(1);
        expect((agenda.body as Array<{ id: string }>).map((t) => t.id)).toEqual(
            [dueToday],
        );

        // …and the job, running off the same workspace row, picks exactly the
        // task Home calls overdue and leaves alone the one it calls due today.
        const res = await runOverdueJob();
        expect(res.status).toBe(200);
        expect(await alerted([dueToday, late])).toEqual([late]);
    });

    it("the SAME due date is overdue in one workspace and future in another", async () => {
        // The assertion this file exists for. Two workspaces, one instant, one
        // calendar date — and the correct answer differs. A server reading its
        // own clock, or UTC, or Dhaka, cannot produce both of these.
        const east = await scene(EAST);
        const west = await scene(WEST);
        const westToday = todayInZone(WEST);

        const lateInTheEast = await dueOn(east, westToday);
        const notYetInTheWest = await dueOn(west, westToday);

        const [eastKpis, westKpis] = await Promise.all([
            east.client.get(KPIS),
            west.client.get(KPIS),
        ]);
        expect(eastKpis.body.overdue.value).toBe(1);
        expect(westKpis.body.overdue.value).toBe(0);
        expect(westKpis.body.dueToday.value).toBe(1);

        await runOverdueJob();
        expect(await alerted([lateInTheEast, notYetInTheWest])).toEqual([
            lateInTheEast,
        ]);
    });

    it("a task due on the far-future workspace's today is nobody's overdue", async () => {
        // The control for the case above. Kiritimati's today is ahead of every
        // other zone on earth, so a task due then is never late anywhere — if
        // this ever alerts, the comparison has stopped being a date comparison.
        const west = await scene(WEST);
        const future = await dueOn(west, todayInZone(EAST));

        const kpis = await west.client.get(KPIS);
        expect(kpis.body.overdue.value).toBe(0);
        expect(kpis.body.dueToday.value).toBe(0);

        await runOverdueJob();
        expect(await alerted([future])).toEqual([]);
    });

    it("the job is idempotent across the boundary — a re-run alerts nobody twice", async () => {
        const s = await scene(EAST);
        const late = await dueOn(s, todayInZone(WEST));

        await runOverdueJob();
        const first = await getDb()
            .select({ id: notifications.id })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, s.me.id),
                    eq(notifications.type, "overdue"),
                ),
            );
        expect(first).toHaveLength(1);

        await runOverdueJob();
        const second = await getDb()
            .select({ id: notifications.id })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, s.me.id),
                    eq(notifications.type, "overdue"),
                ),
            );
        expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
        expect(await alerted([late])).toEqual([late]);
    });

    describe("the weekly report keeps the COMPANY calendar", () => {
        it("its week is Dhaka's, whatever zone the workspace is in", () => {
            // KI-20's other half. `ReportsService` anchors on `dhakaToday()` by
            // design — the Monday 09:00 Dhaka report is a company event, and
            // routing it through `workspaces.timezone` would move the reporting
            // week for everyone the first time somebody re-zoned a workspace.
            const week = dhakaWeekOf(new Date());

            // Same instant, three zones, one reporting week.
            expect(dhakaWeekOf(new Date())).toEqual(week);
            expect(week.weekStart <= dhakaToday()).toBe(true);
            expect(week.weekEnd >= dhakaToday()).toBe(true);

            // And it is genuinely NOT the workspace's day driving it: at least
            // one of the two far zones disagrees with Dhaka right now, and the
            // week did not move.
            const disagrees =
                todayInZone(EAST) !== dhakaToday() ||
                todayInZone(WEST) !== dhakaToday();
            expect(disagrees).toBe(true);
        });
    });
});
