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
        // 3. Start listening
        const server = app.listen(PORT, () => logger_1.default.info(`Listening on port ${PORT}`));
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
