import bcrypt from "bcrypt";
import { initDb, closeDb } from "./client";
import { taskTypes, users, workspaces } from "./schema";
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

        // Seed a starter set of task types. A workspace needs at least one,
        // because creating a task requires a task_type_id (a freshly-created
        // list has no default). Without this, no task could be created via the
        // UI on a fresh database.
        await db.insert(taskTypes).values([
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Task",
                icon: "CheckSquare",
                color: "#6B7280",
                position: 0,
            },
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Bug",
                icon: "Bug",
                color: "#EF4444",
                isDevType: true,
                position: 1,
            },
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Feature",
                icon: "Sparkles",
                color: "#8B5CF6",
                isDevType: true,
                position: 2,
            },
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Campaign",
                icon: "Megaphone",
                color: "#F59E0B",
                position: 3,
            },
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Order",
                icon: "ShoppingBag",
                color: "#10B981",
                position: 4,
            },
            {
                id: fakeId("tt"),
                workspaceId,
                name: "Complaint",
                icon: "MessageCircle",
                color: "#EC4899",
                position: 5,
            },
        ]);
        logger.info("Task types seeded");

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
