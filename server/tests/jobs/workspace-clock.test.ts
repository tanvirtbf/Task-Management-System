import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { workspaces } from "../../src/db/schema";
import {
    dhakaToday,
    todayInZone,
    zoneDateOf,
} from "../../src/utils/dhakaTime";
import { buildMessages } from "../../src/assistant/buildMessages";
import { makeWorkspace } from "../test-utils/factories";

/**
 * KI-20 — "today" belongs to the workspace, except where it deliberately
 * belongs to the company.
 *
 * The ledger carried this as *"`dhakaToday()` hardcoded at 11 sites, latent
 * while single-workspace"*. Classified, the 9 production call sites split in
 * two, and the split is the finding:
 *
 *   COMPANY calendar, correct as they were (4)
 *     · `OnCallRepo` ×2 and `EngineeringRepo` — the on-call roster
 *     · `ReportsService` — the Monday 09:00 Dhaka HR report
 *   `utils/dhakaTime.ts` says so in its own header: the fixed-offset helpers
 *   "stay for the COMPANY calendar (dept-review weeks, the on-call roster),
 *   which is Dhaka by design and must not move when a workspace re-zones
 *   itself." Routing those through a workspace zone would be a REGRESSION.
 *
 *   WORKSPACE calendar, and wrong (3)
 *     · `ReviewsService.reviewSummary` and the review queue — they bucket work
 *       as overdue / due-today for a space inside a workspace
 *     · the assistant's prompt date line — the only anchor the model has for
 *       "kal", "next week", "last 7 days"
 *
 * The `overdue-alert` and `recurrence-spawn` jobs already resolve "today" per
 * workspace under the same F5 rule, so the fix follows an established
 * precedent rather than inventing one.
 *
 * ── why these assertions and not a clock-boundary drill ─────────────────────
 * The obvious test — "create a task at 23:55 Dhaka and check the bucket" — is
 * only meaningful during a couple of hours a day and passes vacuously the rest
 * of the time. So the invariant is asserted directly: the DATE HANDED TO THE
 * QUERY is the workspace's, and the zones actually disagree.
 */

describe("KI-20 — the two calendars, and which is which", () => {
    /**
     * Kiritimati is UTC+14 and Midway UTC-11: 25 hours apart, so their calendar
     * dates ALWAYS differ. Without this the tests below could pass on a day when
     * every zone happens to agree, proving nothing.
     */
    it("the zones used here genuinely disagree, every hour of every day", () => {
        const east = todayInZone("Pacific/Kiritimati");
        const west = todayInZone("Pacific/Midway");
        expect(east).not.toBe(west);
    });

    it("todayInZone tracks the zone; dhakaToday never moves", () => {
        // A fixed instant, so this is arithmetic rather than a race with the
        // wall clock: 2026-03-01T20:00Z is already the 2nd in Dhaka (+6) and
        // still the 1st in New York (-5).
        const instant = new Date("2026-03-01T20:00:00Z");
        expect(zoneDateOf(instant, "Asia/Dhaka")).toBe("2026-03-02");
        expect(zoneDateOf(instant, "America/New_York")).toBe("2026-03-01");
        expect(zoneDateOf(instant, "Pacific/Kiritimati")).toBe("2026-03-02");
    });

    describe("the assistant's date line is the WORKSPACE's day", () => {
        const dateLine = (msgs: { role: string; content: string }[]) =>
            msgs[0].content.split("\n")[0];

        it("defaults to the company calendar when no day is supplied", () => {
            // The degraded path: if the workspace read fails, the bot still has
            // a date rather than none.
            const line = dateLine(buildMessages([], "hi"));
            expect(line).toBe(`Today is ${dhakaToday()} (Asia/Dhaka).`);
        });

        it("uses the workspace's day and NAMES its zone", () => {
            const day = {
                date: todayInZone("America/New_York"),
                zone: "America/New_York",
            };
            const line = dateLine(buildMessages([], "hi", undefined, day));
            expect(line).toBe(`Today is ${day.date} (America/New_York).`);
            // The label and the value travel together — a line that says Dhaka
            // while carrying New York's date is worse than either alone.
            expect(line).toContain(day.date);
        });

        it("a far-east and a far-west workspace get DIFFERENT date lines", () => {
            // The latency made visible: same code, same instant, two workspaces.
            const east = dateLine(
                buildMessages([], "hi", undefined, {
                    date: todayInZone("Pacific/Kiritimati"),
                    zone: "Pacific/Kiritimati",
                }),
            );
            const west = dateLine(
                buildMessages([], "hi", undefined, {
                    date: todayInZone("Pacific/Midway"),
                    zone: "Pacific/Midway",
                }),
            );
            expect(east).not.toBe(west);
        });
    });

    describe("a workspace can actually hold a non-Dhaka zone", () => {
        it("stores and reads back an IANA zone, and it drives todayInZone", async () => {
            // If `workspaces.timezone` could not hold this, every fix above
            // would be theatre.
            const ws = await makeWorkspace();
            await getDb()
                .update(workspaces)
                .set({ timezone: "Pacific/Kiritimati" })
                .where(eq(workspaces.id, ws.id));

            const [row] = await getDb()
                .select({ tz: workspaces.timezone })
                .from(workspaces)
                .where(eq(workspaces.id, ws.id));

            expect(row.tz).toBe("Pacific/Kiritimati");
            expect(todayInZone(row.tz)).toBe(todayInZone("Pacific/Kiritimati"));
        });

        it("the seeded default is the company zone", async () => {
            const ws = await makeWorkspace();
            const [row] = await getDb()
                .select({ tz: workspaces.timezone })
                .from(workspaces)
                .where(eq(workspaces.id, ws.id));
            expect(row.tz).toBe("Asia/Dhaka");
        });
    });

    describe("the company calendar stays the company's", () => {
        it("dhakaToday ignores any workspace zone, by design", () => {
            // The on-call roster and the Monday HR report are Dhaka events. A
            // future refactor that "helpfully" routes these through a workspace
            // zone would move the roster for everyone — this says don't.
            const before = dhakaToday();
            expect(todayInZone("Asia/Dhaka")).toBe(before);
            expect(dhakaToday()).toBe(before);
        });
    });
});
