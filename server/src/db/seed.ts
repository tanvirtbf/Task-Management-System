import bcrypt from "bcrypt";
import { initDb, closeDb } from "./client";
import { users, workspaces } from "./schema";
import logger from "../config/logger";
import { fakeId } from "../utils";

const seed = async () => {
    try {
        const db = await initDb();
        logger.info("Seeding database...");

        // Seed default workspace
        const workspaceId = fakeId("ws");
        await db.insert(workspaces).values({
            id: workspaceId,
            name: "BeautyBooth",
            timezone: "Asia/Dhaka",
            defaultLocale: "en-US",
        });
        logger.info("Workspace created", { id: workspaceId });

        // Seed owner user
        const passwordHash = await bcrypt.hash("Owner@12345", 10);
        const ownerId = fakeId("u");
        await db.insert(users).values({
            id: ownerId,
            workspaceId,
            firstName: "Owner",
            lastName: "User",
            email: "owner@company.local",
            passwordHash,
            role: "owner",
            status: "active",
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
