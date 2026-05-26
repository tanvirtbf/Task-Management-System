import bcrypt from "bcrypt";
import { initDb, closeDb } from "./client";
import { users } from "./schema";
import { Roles } from "../constants";
import logger from "../config/logger";

const seed = async () => {
    try {
        const db = await initDb();
        logger.info("Seeding database...");

        // Owner user (single founder per SRS)
        const password = await bcrypt.hash("Owner@12345", 10);
        await db.insert(users).values({
            firstName: "Owner",
            lastName: "User",
            email: "owner@company.local",
            password,
            role: Roles.OWNER,
        });

        logger.info(
            "Seed completed. Default owner: owner@company.local / Owner@12345",
        );
        await closeDb();
        process.exit(0);
    } catch (err: unknown) {
        if (err instanceof Error) {
            logger.error("Seed failed", { error: err.message });
        }
        process.exit(1);
    }
};

void seed();
