import bcrypt from "bcrypt";
import { initDb, closeDb } from "./client";
import {
    lists,
    spaces,
    statuses,
    taskTypes,
    users,
    workspaces,
} from "./schema";
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
        const bugTypeId = fakeId("tt");
        const incidentTypeId = fakeId("tt");
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
                id: bugTypeId,
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
            // Gap-scan M18: `report-bug` 409s and the whole incident/
            // postmortem flow is dead without an "Incident" type.
            {
                id: incidentTypeId,
                workspaceId,
                name: "Incident",
                icon: "Siren",
                color: "#DC2626",
                isDevType: true,
                position: 6,
            },
        ]);
        logger.info("Task types seeded");

        // Gap-scan M18: `POST /eng/report-bug` resolves the "Bug Triage" list
        // BY NAME — without it (and statuses to land tasks on) the endpoint
        // 409s `eng.not_configured` on every fresh install. Seed a minimal
        // Engineering space around it.
        const spaceId = fakeId("sp");
        await db.insert(spaces).values({
            id: spaceId,
            workspaceId,
            name: "Engineering",
            icon: "Code2",
            color: "#4F46E5",
            position: 0,
            createdBy: ownerId,
        });
        const bugTriageId = fakeId("l");
        await db.insert(lists).values({
            id: bugTriageId,
            spaceId,
            name: "Bug Triage",
            icon: "Bug",
            color: "#EF4444",
            position: 0,
            defaultTaskTypeId: bugTypeId,
            createdBy: ownerId,
        });
        await db.insert(statuses).values([
            {
                id: fakeId("st"),
                scopeId: bugTriageId,
                name: "Open",
                statusGroup: "not_started",
                color: "#94A3B8",
                position: 0,
            },
            {
                id: fakeId("st"),
                scopeId: bugTriageId,
                name: "In Progress",
                statusGroup: "active",
                color: "#3B82F6",
                position: 1,
            },
            {
                id: fakeId("st"),
                scopeId: bugTriageId,
                name: "Done",
                statusGroup: "done",
                color: "#10B981",
                position: 2,
            },
        ]);
        logger.info("Engineering space + Bug Triage list seeded");

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
