import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * THE SESSION CLOCK — that `DB_TIMEZONE` actually reaches the database.
 *
 * F3 pinned this project's storage clock to UTC by setting two things that must
 * agree: the mysql2 driver's `timezone` option (how it formats JS Dates) and the
 * MySQL SESSION `time_zone` (how the server interprets them). The second half is
 * applied by a `pool.on("connection")` handler in `src/db/client.ts`, once per
 * physical connection.
 *
 * Nothing tested that handler, and it is the single most dangerous piece of code
 * in the file to leave untested — for a reason that has nothing to do with how
 * hard it is to write and everything to do with the environment:
 *
 *   `.env.test` does not set DB_TIMEZONE.
 *
 * So `dbTimezone` is undefined under jest, the handler is never registered, and
 * the entire suite — every one of the 35 module configs — runs a code path that
 * dev and production do not, and skips a code path that dev and production
 * always take. P1 found out the expensive way: a change to that handler made
 * `npm run db:seed` print one line of mysql2 complaint, seed nothing, and exit
 * 0, while every test stayed green.
 *
 * This suite closes that hole by building a pool the way dev builds one — with
 * DB_TIMEZONE set — and then asking the server what time zone it is actually in.
 *
 * Two offsets are checked on purpose. `+00:00` is the canonical value, but on a
 * server whose default is already UTC it would pass even if the statement never
 * ran. `+05:30` is a value nothing in this system would produce by accident, so
 * seeing it back is proof the SET really executed.
 */

interface TzRow extends RowDataPacket {
    tz: string;
}

/**
 * Build a pool through a FRESH copy of the db client with `DB_TIMEZONE` set.
 *
 * The module registry has to be reset first: `src/db/client.ts` reads
 * `Config.DB_TIMEZONE` once, at import time, into a module-level constant, and
 * memoises the pool. Re-importing is the only way to exercise the branch.
 */
const poolWithTimezone = async (
    offset: string,
): Promise<{ pool: Pool; close: () => Promise<void> }> => {
    jest.resetModules();

    const { Config } = await import("../../src/config");
    Config.DB_NAME = "tms_schema_test";
    Config.DB_TIMEZONE = offset;

    const client = await import("../../src/db/client");
    await client.initDb();
    return { pool: client.getPool(), close: () => client.closeDb() };
};

const sessionTz = async (pool: Pool): Promise<string> => {
    const [rows] = await pool.query<TzRow[]>(
        "SELECT @@session.time_zone AS tz",
    );
    return rows[0].tz;
};

describe("DB session clock", () => {
    const originalTz = process.env.DB_TIMEZONE;

    afterEach(() => {
        if (originalTz === undefined) delete process.env.DB_TIMEZONE;
        else process.env.DB_TIMEZONE = originalTz;
    });

    it("puts the canonical UTC offset on a pooled connection", async () => {
        const { pool, close } = await poolWithTimezone("+00:00");
        try {
            expect(await sessionTz(pool)).toBe("+00:00");
        } finally {
            await close();
        }
    });

    it("applies the configured offset, not the server default", async () => {
        // If the handler silently failed, this would come back as the server's
        // own default (SYSTEM, or +06:00 on a Dhaka box) — never +05:30.
        const { pool, close } = await poolWithTimezone("+05:30");
        try {
            expect(await sessionTz(pool)).toBe("+05:30");
        } finally {
            await close();
        }
    });

    it("applies it to EVERY connection in the pool, not just the first", async () => {
        // The handler fires once per physical connection. Holding several open
        // at the same time forces the pool to create more than one, so a
        // handler that works only for the probe connection is caught here.
        const { pool, close } = await poolWithTimezone("+05:30");
        try {
            const held = await Promise.all([
                pool.getConnection(),
                pool.getConnection(),
                pool.getConnection(),
            ]);
            const zones = await Promise.all(
                held.map(async (c) => {
                    const [rows] = await c.query<TzRow[]>(
                        "SELECT @@session.time_zone AS tz",
                    );
                    return rows[0].tz;
                }),
            );
            held.forEach((c) => c.release());
            expect(zones).toEqual(["+05:30", "+05:30", "+05:30"]);
        } finally {
            await close();
        }
    });

    it("refuses a named zone, which MySQL usually cannot resolve", async () => {
        // `Asia/Dhaka` only works when the tz tables have been loaded, which on
        // a default install they have not — it would fail at runtime, per
        // connection, silently. The guard rejects it at startup instead.
        await expect(poolWithTimezone("Asia/Dhaka")).rejects.toThrow(
            /fixed offset/i,
        );
    });
});
