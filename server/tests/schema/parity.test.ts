import fs from "node:fs";
import path from "node:path";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import { getPool } from "../../src/db/client";
import * as schema from "../../src/db/schema";

/**
 * SCHEMA PARITY — the permanent close on a drift class this project has been
 * bitten by twice (TEST PLAN KI-12).
 *
 * There are two descriptions of the same database. `database/schema.sql` (plus
 * the numbered upgrades) is what actually gets applied; `src/db/schema/*.ts` is
 * what Drizzle — and therefore every query and every type — believes. Nothing
 * enforced that they agree. When they did not, the failure was never a helpful
 * one: a column Drizzle knows about but the table lacks turns EVERY read of that
 * table into a 500, and the deploy prompt has a whole section about that exact
 * outage shape for upgrade 025.
 *
 * The rule this suite encodes is the one in `database/upgrades/README.md`: a
 * schema change is three synchronized edits (schema.sql, the Drizzle table, the
 * upgrade script). This test makes the third one impossible to forget, because
 * it introspects `information_schema` for the database the tests just built and
 * compares it against Drizzle's own table config.
 *
 * What it deliberately does NOT do: compare types, nullability or defaults.
 * Drizzle's mysql column builders and MySQL's reported types do not map 1:1
 * (`varchar(64)` vs `char`, `timestamp` precision, generated columns), and a
 * comparison that has to be taught fifty exceptions is a comparison nobody
 * trusts. Presence is where the drift has actually happened, both times.
 */

interface LiveColumn {
    TABLE_NAME: string;
    COLUMN_NAME: string;
    EXTRA: string;
}

/** Drizzle tables, by SQL name → the set of SQL column names it declares. */
const drizzleTables = (): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    for (const value of Object.values(schema)) {
        // Views and relations live in the same barrel; only real tables carry a
        // table config.
        let config;
        try {
            config = getTableConfig(value as MySqlTable);
        } catch {
            continue;
        }
        if (!config?.name) continue;
        out.set(
            config.name,
            new Set(config.columns.map((c) => c.name)),
        );
    }
    return out;
};

interface Live {
    /** Every base table → every column, generated ones included. */
    all: Map<string, Set<string>>;
    /**
     * `table.column` for VIRTUAL/STORED GENERATED columns.
     *
     * Drizzle deliberately does not map these and should not: MySQL computes
     * them, so they cannot be inserted or updated, and reading one tells you
     * nothing the base columns do not. This schema uses three, all for the same
     * trick — a value that is NULL unless a row is "interesting", carrying a
     * unique index that then enforces "only one pending request per task"
     * (`pending_flag`) or treats a NULL scope as a real value (`scope_key`).
     * Demanding they be mapped would be demanding something wrong, so the
     * unmapped-column check skips them by name-and-reason rather than by a
     * blanket allowance.
     */
    generated: Set<string>;
}

const liveSchema = async (): Promise<Live> => {
    const conn = await getPool().getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT TABLE_NAME, COLUMN_NAME, EXTRA
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN (
                    SELECT TABLE_NAME FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                )`,
        );
        const all = new Map<string, Set<string>>();
        const generated = new Set<string>();
        for (const r of rows as LiveColumn[]) {
            if (!all.has(r.TABLE_NAME)) all.set(r.TABLE_NAME, new Set());
            all.get(r.TABLE_NAME)!.add(r.COLUMN_NAME);
            if ((r.EXTRA ?? "").includes("GENERATED")) {
                generated.add(`${r.TABLE_NAME}.${r.COLUMN_NAME}`);
            }
        }
        return { all, generated };
    } finally {
        conn.release();
    }
};

describe("schema parity — Drizzle vs the database that was actually built", () => {
    let live: Live;
    let drz: Map<string, Set<string>>;

    beforeAll(async () => {
        live = await liveSchema();
        drz = drizzleTables();
    });

    it("finds both descriptions (guards against an empty comparison passing)", () => {
        // An introspection that returns nothing would make every assertion below
        // vacuously true — the classic way a parity test rots into decoration.
        expect(live.all.size).toBeGreaterThan(40);
        expect(drz.size).toBeGreaterThan(40);
        // and the generated-column carve-out below is not silently empty
        expect(live.generated.size).toBeGreaterThan(0);
    });

    it("declares no table the database does not have", () => {
        // This is the dangerous direction: Drizzle selects every column of a
        // table it knows, so a table (or column) it believes in but the database
        // lacks is a 500 on every read, not a quiet mismatch.
        const missing = [...drz.keys()].filter((t) => !live.all.has(t)).sort();
        expect({ inDrizzleButNotInTheDatabase: missing }).toEqual({
            inDrizzleButNotInTheDatabase: [],
        });
    });

    it("declares every column the database has for the tables it maps", () => {
        const drift: string[] = [];
        for (const [table, cols] of drz) {
            const liveCols = live.all.get(table);
            if (!liveCols) continue; // covered by the test above
            for (const c of cols) {
                if (!liveCols.has(c)) drift.push(`${table}.${c}`);
            }
        }
        expect({ inDrizzleButNotInTheTable: drift.sort() }).toEqual({
            inDrizzleButNotInTheTable: [],
        });
    });

    it("maps every table the database has (an unmapped table is a blind spot)", () => {
        // The safe direction, but worth naming: a table nothing in Drizzle maps
        // is a table no query, migration test or type covers. Reported rather
        // than tolerated so a new table cannot arrive unnoticed.
        const unmapped = [...live.all.keys()].filter((t) => !drz.has(t)).sort();
        expect({ inTheDatabaseButNotMapped: unmapped }).toEqual({
            inTheDatabaseButNotMapped: [],
        });
    });

    it("applies every trigger the canonical schema declares", async () => {
        /**
         * Triggers are the part of this schema that no TypeScript type would
         * ever notice going missing — they enforce things like "a dependency
         * cannot point at its own task" and keep comment/attachment counters
         * true, entirely inside MySQL.
         *
         * Compared against `database/schema.sql`, which is what `db:setup`
         * applies, NOT against `src/db/migrations/_post.sql`. That file belongs
         * to the retired drizzle-kit chain (frozen at 0005, `db:migrate` is a
         * documented trap) and declares only SEVEN of the nine —
         * `trg_comments_after_update` and `trg_form_submissions_after_delete`
         * are missing from it. Testing against the retired file would have
         * pinned the wrong number and made the drift permanent.
         */
        const sql = fs.readFileSync(
            path.resolve(__dirname, "../../../database/schema.sql"),
            "utf8",
        );
        const declared = new Set(
            [...sql.matchAll(/CREATE\s+TRIGGER\s+`?(\w+)`?/gi)].map((m) => m[1]),
        );
        expect(declared.size).toBeGreaterThan(0);

        const conn = await getPool().getConnection();
        let applied: Set<string>;
        try {
            const [rows] = await conn.query(
                `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
                  WHERE TRIGGER_SCHEMA = DATABASE()`,
            );
            applied = new Set(
                (rows as { TRIGGER_NAME: string }[]).map((r) => r.TRIGGER_NAME),
            );
        } finally {
            conn.release();
        }

        expect({
            declaredButNotApplied: [...declared].filter((t) => !applied.has(t)).sort(),
            appliedButNotDeclared: [...applied].filter((t) => !declared.has(t)).sort(),
        }).toEqual({ declaredButNotApplied: [], appliedButNotDeclared: [] });
    });

    it("maps every column of every table it maps (silently-ignored columns)", () => {
        const unmapped: string[] = [];
        for (const [table, liveCols] of live.all) {
            const cols = drz.get(table);
            if (!cols) continue; // covered above
            for (const c of liveCols) {
                const key = `${table}.${c}`;
                // Generated columns are MySQL's to compute; see `Live`.
                if (live.generated.has(key)) continue;
                if (!cols.has(c)) unmapped.push(key);
            }
        }
        expect({ inTheTableButNotInDrizzle: unmapped.sort() }).toEqual({
            inTheTableButNotInDrizzle: [],
        });
    });
});
