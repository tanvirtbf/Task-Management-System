import { Config } from "./config";
import { initDb, closeDb } from "./db/client";
import logger from "./config/logger";
import { encryptionReady } from "./utils/encryption";
import { closeAllSseStreams } from "./services/sseHub";

const startServer = async () => {
    const PORT = Config.PORT;
    try {
        // 0. Config sanity (gap-scan C4): a malformed key is a hard NO-BOOT
        // (encrypted reads would silently break); an absent key only degrades
        // form intake, which fails clean per-request — warn loudly.
        if (Config.ENCRYPTION_KEY && !encryptionReady()) {
            throw new Error(
                "ENCRYPTION_KEY is set but malformed — need 64 hex chars (256-bit)",
            );
        }
        if (!Config.ENCRYPTION_KEY) {
            logger.warn(
                "ENCRYPTION_KEY missing — public form submissions will return 503 until it is set",
            );
        }

        // 1. Initialize database connection pool
        await initDb();
        logger.info("Database connected successfully.");

        // 2. Import app AFTER DB is ready (routes call getDb() at module load time)
        const { default: app } = await import("./app");

        // 3. Start listening
        const server = app.listen(PORT, () =>
            logger.info(`Listening on port ${PORT}`),
        );

        // Graceful shutdown
        const shutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            // End long-lived SSE streams first — they never finish on their own,
            // so `server.close()` would otherwise hang waiting for them.
            closeAllSseStreams();
            server.close(async () => {
                await closeDb();
                process.exit(0);
            });
        };
        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
    } catch (err: unknown) {
        if (err instanceof Error) {
            logger.error(err.message);
            setTimeout(() => process.exit(1), 1000);
        }
    }
};

void startServer();
