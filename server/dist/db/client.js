"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeDb = exports.getPool = exports.getDb = exports.initDb = exports.dbEndpoint = void 0;
const mysql2_1 = require("drizzle-orm/mysql2");
const promise_1 = __importDefault(require("mysql2/promise"));
const config_1 = require("../config");
const schema = __importStar(require("./schema"));
let pool;
let db;
/**
 * Fixed offset like `+06:00`, or undefined. Named zones (`Asia/Dhaka`) are
 * rejected on purpose: MySQL only resolves those when the tz tables have been
 * loaded, which they usually have not been, and Bangladesh has no DST — so an
 * offset is both safer and exactly equivalent here.
 */
const dbTimezone = (() => {
    const raw = config_1.Config.DB_TIMEZONE?.trim();
    // F5 boot guard (ISS-058's production-coupling half): production runs the
    // canonical clock or it does not run. F3 pinned storage to UTC because
    // Drizzle's timestamp mapper hardcodes +0000 — any other session value
    // reintroduces a silent 6 h drift on every TIMESTAMP, visible only as data
    // that is quietly wrong. The process TZ is deliberately NOT checked: F3
    // decoupled it (pm2 keeps TZ=Asia/Dhaka while the session is UTC), so the
    // guard is on the value that matters, not on an agreement between files.
    if (config_1.Config.IS_PROD && raw !== "+00:00") {
        throw new Error(`Refusing to start: NODE_ENV=${config_1.Config.NODE_ENV} requires DB_TIMEZONE=+00:00 ` +
            `(the canonical clock — got ${raw ? `"${raw}"` : "unset"}). ` +
            "See fixing/results/F03.md and server/.env.example.");
    }
    if (!raw)
        return undefined;
    if (!/^[+-]\d{2}:\d{2}$/.test(raw)) {
        throw new Error(`DB_TIMEZONE must be a fixed offset like "+06:00" (got "${raw}")`);
    }
    return raw;
})();
/**
 * Where to reach MySQL. `DB_SOCKET_PATH` wins when set.
 *
 * This is not just a performance preference. On MySQL **8.4** the
 * `mysql_native_password` plugin ships DISABLED, and accounts default to
 * `caching_sha2_password`. Over plain TCP that scheme needs an RSA key exchange
 * (or TLS) to complete a first-time authentication; mysql2 does not negotiate
 * it, falls back to asking for `mysql_native_password`, and the server answers
 * `ER_PLUGIN_IS_NOT_LOADED`. A unix socket is treated as an already-secure
 * channel, so the same credentials authenticate cleanly. Verified against a
 * live 8.4.7 server: all five TCP variants failed, the socket succeeded.
 */
const dbEndpoint = () => {
    const socketPath = config_1.Config.DB_SOCKET_PATH?.trim();
    return socketPath
        ? { socketPath }
        : { host: config_1.Config.DB_HOST, port: Number(config_1.Config.DB_PORT) || 3306 };
};
exports.dbEndpoint = dbEndpoint;
const initDb = async () => {
    if (db)
        return db;
    pool = promise_1.default.createPool({
        ...(0, exports.dbEndpoint)(),
        user: config_1.Config.DB_USERNAME,
        password: config_1.Config.DB_PASSWORD,
        database: config_1.Config.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(config_1.Config.DB_POOL_MAX) || 10,
        queueLimit: Number(config_1.Config.DB_POOL_QUEUE_LIMIT) || 0,
        // Controls how the DRIVER formats/parses JS Dates. It must agree with
        // the MySQL SESSION time_zone set below, or every timestamp is written
        // at the wrong instant — silently, and only visible as data that is a
        // few hours off. The two are set together for exactly that reason.
        ...(dbTimezone ? { timezone: dbTimezone } : {}),
        // dateStrings: true,
    });
    if (dbTimezone) {
        // The other half of the pair. Per-connection because the MySQL server is
        // shared with unrelated applications — changing the global time_zone
        // would move THEIR timestamps too.
        pool.on("connection", (c) => {
            c.query("SET time_zone = ?", [dbTimezone]);
        });
    }
    // Probe connection
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    db = (0, mysql2_1.drizzle)(pool, { schema, mode: "default" });
    return db;
};
exports.initDb = initDb;
const getDb = () => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};
exports.getDb = getDb;
const getPool = () => {
    if (!pool) {
        throw new Error("Pool not initialized. Call initDb() first.");
    }
    return pool;
};
exports.getPool = getPool;
const closeDb = async () => {
    if (pool) {
        await pool.end();
    }
};
exports.closeDb = closeDb;
