import { sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { dhakaToday, addDaysYmd } from "../../src/utils/dhakaTime";
import { makeOnCallShift, makeUser, makeWorkspace } from "../test-utils/factories";

/**
 * KI-22 — the two clock-dependent VIEWS, pinned.
 *
 * The ledger said `v_breached_sla` and `v_current_on_call` "still carry
 * `NOW()`-shaped assumptions". Measured against both the schema file AND the
 * live database, they do not: `upgrades/005_clock_views.sql` (the F3 clock fix,
 * 2026-08-03) already re-derived them, and the running definitions are
 * `utc_timestamp()` and `cast(utc_timestamp() + interval 6 hour as date)`.
 * Nothing to fix — the entry was stale.
 *
 * What was missing is the part that keeps it fixed. A view is invisible to the
 * type checker, absent from the ORM, and edited by hand in a migration; the F3
 * write-up records that the live DB and `schema.sql` had DRIFTED to two
 * different wrong answers (`CURDATE()` and `UTC_DATE()`) before anyone noticed.
 * So these assertions are the guard, not the fix.
 *
 * ── why the assertions are shaped this way ──────────────────────────────────
 * The tempting test — "insert a shift at 23:55 Dhaka and check the roster" —
 * is only meaningful during the six hours a day when Dhaka and UTC disagree,
 * and passes vacuously the rest of the time. Both checks below hold every hour:
 * one compares the DATABASE's idea of today to the APPLICATION's, and the other
 * pins the exact day boundary the roster turns on.
 */

const db = () => getDb();

/** Read the running definition of a view, lower-cased and whitespace-squashed. */
const viewSql = async (name: string): Promise<string> => {
    const rows = (await db().execute(
        sql`SELECT VIEW_DEFINITION AS d FROM information_schema.VIEWS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${name}`,
    )) as unknown as Array<Array<{ d: string }>>;
    const row = (Array.isArray(rows[0]) ? rows[0][0] : undefined) as
        | { d: string }
        | undefined;
    return (row?.d ?? "").toLowerCase().replace(/\s+/g, " ");
};

describe("KI-22 — the clock views are on the canonical clock", () => {
    it("both views exist in this database (guards against a vacuous pass)", async () => {
        expect((await viewSql("v_breached_sla")).length).toBeGreaterThan(50);
        expect((await viewSql("v_current_on_call")).length).toBeGreaterThan(50);
    });

    it("v_breached_sla compares against UTC_TIMESTAMP, never NOW()/CURDATE()", async () => {
        const def = await viewSql("v_breached_sla");
        expect(def).toContain("utc_timestamp()");
        // `now()` is the session clock. Under `DB_TIMEZONE=+00:00` it happens to
        // equal UTC today — and would stop doing so the moment somebody
        // "helpfully" set a session timezone, silently reporting tasks as
        // breached six hours early.
        expect(def).not.toMatch(/\bnow\(\)/);
        expect(def).not.toMatch(/\bcurdate\(\)/);
        expect(def).not.toMatch(/\bcurrent_timestamp\b/);
    });

    it("v_current_on_call uses the DHAKA day, not the session's or UTC's", async () => {
        const def = await viewSql("v_current_on_call");
        // The roster's week_start/week_end are Dhaka business days, so the
        // comparison has to be a Dhaka calendar day. `CURDATE()` was what the
        // live DB had and `UTC_DATE()` what schema.sql had — both roll the
        // roster over six hours late, so Monday 00:00–06:00 Dhaka still reports
        // last week's engineer.
        expect(def).toMatch(/utc_timestamp\(\)\s*\+\s*interval 6 hour/);
        expect(def).not.toMatch(/\bcurdate\(\)/);
        expect(def).not.toMatch(/\butc_date\(\)/);
    });

    it("the DATABASE and the APPLICATION agree on what day it is in Dhaka", async () => {
        // The end-to-end version of the F3 fix, and true every hour: the exact
        // expression the view uses must equal the helper every repo binds.
        const rows = (await db().execute(
            sql`SELECT CAST(UTC_TIMESTAMP() + INTERVAL 6 HOUR AS DATE) AS d`,
        )) as unknown as Array<Array<{ d: unknown }>>;
        const raw = (Array.isArray(rows[0]) ? rows[0][0] : undefined) as
            | { d: unknown }
            | undefined;
        const dbDay =
            raw?.d instanceof Date
                ? raw.d.toISOString().slice(0, 10)
                : String(raw?.d ?? "").slice(0, 10);
        expect(dbDay).toBe(dhakaToday());
    });

    describe("the roster turns over on the Dhaka day boundary", () => {
        it("a shift covering exactly today (Dhaka) IS current", async () => {
            const ws = await makeWorkspace();
            const eng = await makeUser({ workspaceId: ws.id });
            const today = dhakaToday();
            await makeOnCallShift({
                workspaceId: ws.id,
                engineerId: eng.id,
                weekStart: new Date(`${today}T00:00:00Z`),
            });

            const rows = (await db().execute(
                sql`SELECT COUNT(*) AS n FROM v_current_on_call
                    WHERE workspace_id = ${ws.id}`,
            )) as unknown as Array<Array<{ n: number }>>;
            const n = Number(
                (Array.isArray(rows[0]) ? rows[0][0] : { n: 0 }).n,
            );
            expect(n).toBe(1);
        });

        it("a shift that ended YESTERDAY (Dhaka) is not current", async () => {
            // The other side of the boundary. A view reading the UTC day would
            // keep this one live for six hours after Dhaka midnight.
            const ws = await makeWorkspace();
            const eng = await makeUser({ workspaceId: ws.id });
            const start = addDaysYmd(dhakaToday(), -8);
            await makeOnCallShift({
                workspaceId: ws.id,
                engineerId: eng.id,
                weekStart: new Date(`${start}T00:00:00Z`), // +6 days ⇒ ended yesterday
            });

            const rows = (await db().execute(
                sql`SELECT COUNT(*) AS n FROM v_current_on_call
                    WHERE workspace_id = ${ws.id}`,
            )) as unknown as Array<Array<{ n: number }>>;
            const n = Number(
                (Array.isArray(rows[0]) ? rows[0][0] : { n: 0 }).n,
            );
            expect(n).toBe(0);
        });
    });
});
