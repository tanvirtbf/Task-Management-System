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
const config_1 = require("./config");
const client_1 = require("./db/client");
const logger_1 = __importDefault(require("./config/logger"));
const encryption_1 = require("./utils/encryption");
const sseHub_1 = require("./services/sseHub");
const PermissionsRepo_1 = require("./repositories/PermissionsRepo");
const startServer = async () => {
    const PORT = config_1.Config.PORT;
    try {
        // 0. Config sanity (gap-scan C4): a malformed key is a hard NO-BOOT
        // (encrypted reads would silently break); an absent key only degrades
        // form intake, which fails clean per-request — warn loudly.
        if (config_1.Config.ENCRYPTION_KEY && !(0, encryption_1.encryptionReady)()) {
            throw new Error("ENCRYPTION_KEY is set but malformed — need 64 hex chars (256-bit)");
        }
        if (!config_1.Config.ENCRYPTION_KEY) {
            logger_1.default.warn("ENCRYPTION_KEY missing — public form submissions will return 503 until it is set");
        }
        // 0b. F14 (ISS-003): the auth secrets are a HARD no-boot.
        //
        // `ACCESS_TOKEN_SECRET` was already effectively boot-validated —
        // express-jwt refuses to construct without one and the process exits 1.
        // `REFRESH_TOKEN_SECRET` was not: the server booted, `/health` AND
        // `/health/ready` both answered 200 ready, and then every single login
        // returned 500 `auth.token_config_missing`. A load balancer or uptime
        // monitor saw a perfectly healthy instance nobody could sign in to,
        // which is the worst possible failure shape — silent, and invisible to
        // exactly the thing watching for trouble. Fail closed instead, in the
        // same place and the same way the ENCRYPTION_KEY check does.
        for (const [name, value] of [
            ["ACCESS_TOKEN_SECRET", config_1.Config.ACCESS_TOKEN_SECRET],
            ["REFRESH_TOKEN_SECRET", config_1.Config.REFRESH_TOKEN_SECRET],
        ]) {
            if (!value || !value.trim()) {
                throw new Error(`${name} is missing — refusing to boot. Without it the server would report READY and fail every login.`);
            }
        }
        // 1. Initialize database connection pool
        const db = await (0, client_1.initDb)();
        logger_1.default.info("Database connected successfully.");
        // 1b. Sync the RBAC permission CATALOG from code into the DB. The
        // catalog is reference data owned by `src/rbac/catalog.ts`; this keeps
        // the queryable mirror current so the admin UI and grant validation see
        // newly shipped permissions. Deliberately NON-FATAL: a failure here
        // leaves the previously synced catalog in place, which is far better
        // than refusing to boot. Rows are only ever upserted, never deleted.
        try {
            const synced = await new PermissionsRepo_1.PermissionsRepo(db).syncCatalog();
            logger_1.default.info("Permission catalog synced", { permissions: synced });
        }
        catch (err) {
            logger_1.default.error("Permission catalog sync failed — continuing", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // 2. Import app AFTER DB is ready (routes call getDb() at module load time)
        const { default: app } = await Promise.resolve().then(() => __importStar(require("./app")));
        // 3. Start listening.
        //
        // F13 (ISS-089): bind LOOPBACK ONLY in production. With no host
        // argument Node binds 0.0.0.0/::, so if TCP 5501 is reachable from
        // outside the box a client can talk to the API directly — and then it
        // is the only hop, so with `trust proxy = 1` it controls the last
        // `X-Forwarded-For` entry and mints a fresh rate-limit bucket per
        // request (P41 measured exactly that: 6 bad logins → 429, the same 6
        // with a forged XFF → 401 every time). nginx already proxies to
        // 127.0.0.1:5501, so nothing legitimate changes.
        //
        // Dev keeps the wildcard bind on purpose: the CORS policy deliberately
        // allows private-LAN origins so a phone on the same Wi-Fi can use the
        // app, and that is pointless if the port itself is unreachable.
        const server = config_1.Config.IS_PROD
            ? app.listen(Number(PORT), "127.0.0.1", () => logger_1.default.info(`Listening on 127.0.0.1:${PORT} (loopback only)`))
            : app.listen(PORT, () => logger_1.default.info(`Listening on port ${PORT}`));
        // Graceful shutdown
        const shutdown = async (signal) => {
            logger_1.default.info(`Received ${signal}, shutting down gracefully...`);
            // End long-lived SSE streams first — they never finish on their own,
            // so `server.close()` would otherwise hang waiting for them.
            (0, sseHub_1.closeAllSseStreams)();
            server.close(async () => {
                await (0, client_1.closeDb)();
                process.exit(0);
            });
        };
        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
    }
    catch (err) {
        if (err instanceof Error) {
            logger_1.default.error(err.message);
            setTimeout(() => process.exit(1), 1000);
        }
    }
};
void startServer();
