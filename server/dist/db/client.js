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
exports.closeDb = exports.getPool = exports.getDb = exports.initDb = void 0;
const mysql2_1 = require("drizzle-orm/mysql2");
const promise_1 = __importDefault(require("mysql2/promise"));
const config_1 = require("../config");
const schema = __importStar(require("./schema"));
let pool;
let db;
const initDb = async () => {
    if (db)
        return db;
    pool = promise_1.default.createPool({
        host: config_1.Config.DB_HOST,
        port: Number(config_1.Config.DB_PORT) || 3306,
        user: config_1.Config.DB_USERNAME,
        password: config_1.Config.DB_PASSWORD,
        database: config_1.Config.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // dateStrings: true,
    });
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
