import app from "./app";
import { Config } from "./config";
import logger from "./config/logger";

const startServer = async () => {
    const PORT = Number(Config.PORT);
    try {
        app.listen(PORT, () => logger.info(`Listening on port ${PORT}`));
    } catch (err: unknown) {
        if (err instanceof Error) {
            logger.error(err.message);
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    }
};

void startServer();
