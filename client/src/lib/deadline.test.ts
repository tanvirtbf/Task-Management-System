import { describe, expect, it } from "vitest";
import { deadlineInstant, describeDeadline } from "./deadline";

/**
 * P4 of DEADLINE_TIME_PLAN_2026-09-08 — the countdown's maths.
 *
 * ── the test this file exists for ───────────────────────────────────────────
 * The client turns `(due_date, due_time, workspace zone)` into an INSTANT so it
 * can say "17h left". The server never builds that instant: it compares
 * calendar-day to calendar-day and clock to clock, deliberately, so `due_date`
 * stays usable by its index. Two different shapes computing the same rule is
 * exactly how a screen ends up saying "3h left" about a task the server has
 * already filed under Overdue.
 *
 * So the first block below RE-IMPLEMENTS the server's rule — the actual string
 * comparison from `server/src/utils/deadline.ts` — and asserts the two answer
 * the same thing across a matrix of dates, times, clocks and zones. If the
 * server's rule ever changes, this goes red, which is the point.
 */

/**
 * `deadlinePassed` from the server, transcribed. Kept as a literal copy rather
 * than imported: the client cannot import server code, and a paraphrase would
 * defeat the comparison.
 */
const serverSaysLate = (
    dueDate: string | null,
    dueTime: string | null,
    now: { today: string; clock: string },
): boolean => {
    if (!dueDate) return false;
    const day = dueDate.slice(0, 10);
    if (day < now.today) return true;
    if (day > now.today) return false;
    return dueTime != null && dueTime.slice(0, 5) <= now.clock.slice(0, 5);
};

/** The workspace's `today` and `clock` at a real instant, as the server reads them. */
const zoneNow = (at: Date, timeZone: string) => ({
    today: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(at),
    clock: new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(at),
});

/**
 * Four zones, chosen the way P12 chose its clock fixtures: two extremes that
 * never share a calendar day, the business default, and one with DST — which
 * Dhaka does not have and therefore would never exercise.
 */
const ZONES = [
    "Asia/Dhaka",
    "America/New_York",
    "Pacific/Kiritimati",
    "Pacific/Midway",
];

describe("the client's instant agrees with the server's string compare", () => {
    const DATES = ["2026-03-19", "2026-03-20", "2026-03-21"];
    const TIMES: (string | null)[] = [null, "00:00", "09:00", "17:00", "23:59"];
    /** Sampled through a whole day so every boundary is crossed in every zone. */
    const CLOCK_SAMPLES = [0, 3, 6, 9, 12, 15, 18, 21, 23];

    it("gives the same late/not-late answer in every zone, all day", () => {
        const disagreements: string[] = [];
        for (const timeZone of ZONES) {
            for (const hour of CLOCK_SAMPLES) {
                const at = new Date(Date.UTC(2026, 2, 20, hour, 30));
                const now = zoneNow(at, timeZone);
                for (const dueDate of DATES) {
                    for (const dueTime of TIMES) {
                        const instant = deadlineInstant(
                            dueDate,
                            dueTime,
                            timeZone,
                        );
                        const client = instant!.getTime() <= at.getTime();
                        const server = serverSaysLate(dueDate, dueTime, now);
                        if (client !== server) {
                            disagreements.push(
                                `${timeZone} @${at.toISOString()} due=${dueDate} ${dueTime ?? "(none)"}: client=${client} server=${server}`,
                            );
                        }
                    }
                }
            }
        }
        expect({ disagreements }).toEqual({ disagreements: [] });
    });

    it("the matrix actually exercised BOTH answers (vacuity guard)", () => {
        // Agreement is trivially satisfiable if every case is "not late".
        const at = new Date(Date.UTC(2026, 2, 20, 12, 0));
        const answers = new Set(
            DATES.flatMap((d) =>
                TIMES.map(
                    (t) =>
                        deadlineInstant(d, t, "Asia/Dhaka")!.getTime() <=
                        at.getTime(),
                ),
            ),
        );
        expect([...answers].sort()).toEqual([false, true]);
    });
});

describe("a time-less deadline runs to the END of its day", () => {
    it("is the first instant of the next day, not midnight of its own", () => {
        // The single assumption the whole migration rests on. Midnight-of-its-
        // own-day here would turn every existing task overdue at once.
        const instant = deadlineInstant("2026-03-20", null, "Asia/Dhaka");
        // Dhaka is UTC+6, so 2026-03-21 00:00 there is 2026-03-20 18:00Z.
        expect(instant?.toISOString()).toBe("2026-03-20T18:00:00.000Z");
    });

    it("rolls a month end correctly", () => {
        const instant = deadlineInstant("2026-04-30", null, "Asia/Dhaka");
        expect(instant?.toISOString()).toBe("2026-04-30T18:00:00.000Z");
    });

    it("rolls a year end correctly", () => {
        const instant = deadlineInstant("2026-12-31", null, "Asia/Dhaka");
        expect(instant?.toISOString()).toBe("2026-12-31T18:00:00.000Z");
    });

    it("a timed deadline is that day at that time, in the workspace zone", () => {
        expect(
            deadlineInstant("2026-03-20", "17:00", "Asia/Dhaka")?.toISOString(),
        ).toBe("2026-03-20T11:00:00.000Z");
        // Same wall clock, different office: five hours apart on that date.
        expect(
            deadlineInstant(
                "2026-03-20",
                "17:00",
                "America/New_York",
            )?.toISOString(),
        ).toBe("2026-03-20T21:00:00.000Z");
    });

    it("accepts the HH:MM:SS a TIME column hands back", () => {
        expect(
            deadlineInstant("2026-03-20", "17:00:00", "Asia/Dhaka")?.getTime(),
        ).toBe(
            deadlineInstant("2026-03-20", "17:00", "Asia/Dhaka")?.getTime(),
        );
    });

    it("no due date is no deadline", () => {
        expect(deadlineInstant(null, "17:00", "Asia/Dhaka")).toBeNull();
        expect(deadlineInstant(undefined, null, "Asia/Dhaka")).toBeNull();
    });

    it("an unusable zone falls back rather than throwing", () => {
        // A badge must never be the thing that crashes a task list.
        expect(
            deadlineInstant("2026-03-20", "17:00", "Not/AZone")?.toISOString(),
        ).toBe("2026-03-20T11:00:00.000Z");
    });
});

describe("what the badge says", () => {
    const TZ = "Asia/Dhaka";
    /** 2026-03-20 09:00 Dhaka. */
    const NOW = Date.parse("2026-03-20T03:00:00.000Z");

    const say = (
        dueDate: string | null,
        dueTime: string | null,
        completedAt: string | null = null,
        now = NOW,
    ) =>
        describeDeadline({ dueDate, dueTime, completedAt, timeZone: TZ, now });

    it("counts down in the shapes the user asked for", () => {
        expect([
            say("2026-03-21", "02:00").text, // 17 hours away
            say("2026-03-22", "22:00").text, // 2 days 13 hours away
            say("2026-03-20", "17:00").text, // 8 hours away
            say("2026-03-20", "09:30").text, // 30 minutes away
        ]).toEqual(["17h left", "2d 13h left", "8h left", "30m left"]);
    });

    it("reports lateness the same way once the deadline is behind", () => {
        expect([
            say("2026-03-20", "04:00").text, // 5 hours ago
            say("2026-03-19", "09:00").text, // a day ago
        ]).toEqual(["5h late", "1d late"]);
    });

    it("a finished task states a FACT, and stops counting", () => {
        // "5 hours late kore done hoise" — the user's own words.
        const late = say(
            "2026-03-20",
            "09:00",
            "2026-03-20T08:00:00.000Z", // 14:00 Dhaka, five hours after
        );
        expect({ state: late.state, text: late.text }).toEqual({
            state: "done_late",
            text: "done 5h late",
        });

        // And it does not move when the clock does — the past is settled.
        const muchLater = say(
            "2026-03-20",
            "09:00",
            "2026-03-20T08:00:00.000Z",
            NOW + 30 * 24 * 60 * 60 * 1000,
        );
        expect(muchLater.text).toBe("done 5h late");
    });

    it("finishing on time says so", () => {
        const done = say(
            "2026-03-20",
            "17:00",
            "2026-03-20T05:00:00.000Z", // 11:00 Dhaka, six hours early
        );
        expect({ state: done.state, text: done.text }).toEqual({
            state: "done_on_time",
            text: "done on time",
        });
    });

    it("finishing EXACTLY on the deadline instant counts as late", () => {
        // Same boundary the server uses: the instant is when it becomes late,
        // so `<=` there means `<` here. Stated because it is the one case a
        // reader will assume went the other way.
        const done = say(
            "2026-03-20",
            "17:00",
            "2026-03-20T11:00:00.000Z", // exactly 17:00 Dhaka
        );
        expect(done.state).toBe("done_late");
    });

    it("colours the last day differently from the rest", () => {
        expect([
            say("2026-03-25", "09:00").state, // days out
            say("2026-03-21", "02:00").state, // 17 hours out
            say("2026-03-20", "04:00").state, // behind
        ]).toEqual(["upcoming", "soon", "late"]);
    });

    it("says nothing at all about a task with no due date", () => {
        const none = say(null, null);
        expect({ state: none.state, text: none.text }).toEqual({
            state: "none",
            text: "",
        });
    });

    it("never says '0m' — under a minute still reads as a minute", () => {
        const nearly = say("2026-03-20", "09:00", null, NOW - 30_000);
        expect(nearly.text).toBe("1m left");
    });

    it("reads the same in every zone for the same instant pair", () => {
        // The gap between two instants has no timezone. What the zone decides
        // is which instant the deadline IS — and that is the previous block.
        const texts = ZONES.map(
            (timeZone) =>
                describeDeadline({
                    dueDate: "2026-03-21",
                    dueTime: "12:00",
                    completedAt: null,
                    timeZone,
                    // Exactly 17 hours before that zone's 2026-03-21 12:00.
                    now:
                        deadlineInstant("2026-03-21", "12:00", timeZone)!.getTime() -
                        17 * 60 * 60 * 1000,
                }).text,
        );
        expect(texts).toEqual([
            "17h left",
            "17h left",
            "17h left",
            "17h left",
        ]);
    });
});
