import { drizzle, LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client/web";
import { Config } from "../config";
import * as schema from "./schema";

/**
 * Turso (libSQL over HTTP) client — replaces the mysql2 pool. The `/web`
 * build is fetch-only, so it runs on Cloudflare Workers AND in Node
 * (astro dev / scripts) alike.
 *
 * `MySql2Database` is re-exported as a type ALIAS of LibSQLDatabase so the
 * ~35 services/repos typed against the old name compile unchanged (their
 * import specifier is rewritten to point here).
 */
export type MySql2Database<
    TSchema extends Record<string, unknown> = Record<string, never>,
> = LibSQLDatabase<TSchema>;

export type AppDb = LibSQLDatabase<typeof schema>;

let client: Client | undefined;
let db: AppDb | undefined;

export const initDb = async (): Promise<AppDb> => {
    if (db) return db;

    const url = Config.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");

    client = createClient({
        // The web client speaks Hrana-over-HTTP; libsql:// is accepted and
        // upgraded to https internally.
        url,
        authToken: Config.TURSO_AUTH_TOKEN,
    });

    db = drizzle(client, { schema });
    return db;
};

export const getDb = (): AppDb => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};

/** Legacy mysql2 pool accessor — only referenced by a fully-guarded metrics
 *  gauge; throwing here just makes that gauge report nothing. */
export const getPool = (): never => {
    throw new Error("No connection pool on libSQL");
};

export const closeDb = async (): Promise<void> => {
    client?.close();
    client = undefined;
    db = undefined;
};
