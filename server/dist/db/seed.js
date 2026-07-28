"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const client_1 = require("./client");
const schema_1 = require("./schema");
const logger_1 = __importDefault(require("../config/logger"));
const utils_1 = require("../utils");
const config_1 = require("../config");
const bootstrap_1 = require("../rbac/bootstrap");
/**
 * Owner credentials. Dev keeps the documented defaults so LOCAL_RUN_GUIDE.md and
 * the demo dataset stay valid. Production MUST supply its own: this file lives in
 * the repository, so the fallback password is a PUBLISHED credential — seeding a
 * public deployment with it would hand anyone who reads the source an owner login.
 */
const DEFAULT_OWNER_PASSWORD = "Owner@12345";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@company.local";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? DEFAULT_OWNER_PASSWORD;
const seed = async () => {
    if (config_1.Config.IS_PROD && OWNER_PASSWORD === DEFAULT_OWNER_PASSWORD) {
        logger_1.default.error("REFUSING to seed: SEED_OWNER_PASSWORD is unset (or still the default). " +
            "That password is published in this repository's source, so seeding " +
            "production with it creates an owner account anyone can log into. " +
            "Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD, then re-run.");
        process.exit(1);
    }
    try {
        const db = await (0, client_1.initDb)();
        logger_1.default.info("Seeding database...");
        // Seed default workspace
        const workspaceId = (0, utils_1.fakeId)("ws");
        await db.insert(schema_1.workspaces).values({
            id: workspaceId,
            name: "BeautyBooth",
            timezone: "Asia/Dhaka",
            defaultLocale: "en-US",
        });
        logger_1.default.info("Workspace created", { id: workspaceId });
        // Seed owner user
        const passwordHash = await bcrypt_1.default.hash(OWNER_PASSWORD, 10);
        const ownerId = (0, utils_1.fakeId)("u");
        await db.insert(schema_1.users).values({
            id: ownerId,
            workspaceId,
            firstName: "Owner",
            lastName: "User",
            email: OWNER_EMAIL,
            passwordHash,
            role: "owner",
            status: "active",
        });
        // Seed a starter set of task types. A workspace needs at least one,
        // because creating a task requires a task_type_id (a freshly-created
        // list has no default). Without this, no task could be created via the
        // UI on a fresh database.
        const bugTypeId = (0, utils_1.fakeId)("tt");
        const incidentTypeId = (0, utils_1.fakeId)("tt");
        await db.insert(schema_1.taskTypes).values([
            {
                id: (0, utils_1.fakeId)("tt"),
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
                id: (0, utils_1.fakeId)("tt"),
                workspaceId,
                name: "Feature",
                icon: "Sparkles",
                color: "#8B5CF6",
                isDevType: true,
                position: 2,
            },
            {
                id: (0, utils_1.fakeId)("tt"),
                workspaceId,
                name: "Campaign",
                icon: "Megaphone",
                color: "#F59E0B",
                position: 3,
            },
            {
                id: (0, utils_1.fakeId)("tt"),
                workspaceId,
                name: "Order",
                icon: "ShoppingBag",
                color: "#10B981",
                position: 4,
            },
            {
                id: (0, utils_1.fakeId)("tt"),
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
        logger_1.default.info("Task types seeded");
        // Gap-scan M18: `POST /eng/report-bug` resolves the "Bug Triage" list
        // BY NAME — without it (and statuses to land tasks on) the endpoint
        // 409s `eng.not_configured` on every fresh install. Seed a minimal
        // Engineering space around it.
        const spaceId = (0, utils_1.fakeId)("sp");
        await db.insert(schema_1.spaces).values({
            id: spaceId,
            workspaceId,
            name: "Engineering",
            icon: "Code2",
            color: "#4F46E5",
            position: 0,
            createdBy: ownerId,
        });
        const bugTriageId = (0, utils_1.fakeId)("l");
        await db.insert(schema_1.lists).values({
            id: bugTriageId,
            spaceId,
            name: "Bug Triage",
            icon: "Bug",
            color: "#EF4444",
            position: 0,
            defaultTaskTypeId: bugTypeId,
            createdBy: ownerId,
        });
        await db.insert(schema_1.statuses).values([
            {
                id: (0, utils_1.fakeId)("st"),
                scopeId: bugTriageId,
                name: "Open",
                statusGroup: "not_started",
                color: "#94A3B8",
                position: 0,
            },
            {
                id: (0, utils_1.fakeId)("st"),
                scopeId: bugTriageId,
                name: "In Progress",
                statusGroup: "active",
                color: "#3B82F6",
                position: 1,
            },
            {
                id: (0, utils_1.fakeId)("st"),
                scopeId: bugTriageId,
                name: "Done",
                statusGroup: "done",
                color: "#10B981",
                position: 2,
            },
        ]);
        logger_1.default.info("Engineering space + Bug Triage list seeded");
        // Dynamic RBAC: sync the permission catalog, create the four system
        // roles and give every seeded user their workspace-wide assignment.
        // The seeded grants reproduce the pre-RBAC behaviour exactly, so a
        // fresh install behaves identically until an admin tightens it.
        const rbac = await (0, bootstrap_1.bootstrapRbac)(db, workspaceId);
        logger_1.default.info("RBAC bootstrapped", rbac);
        // Never log the password itself — it would land in logs/combined.log.
        logger_1.default.info(`Seed completed. Owner: ${OWNER_EMAIL} (password from ${process.env.SEED_OWNER_PASSWORD ? "SEED_OWNER_PASSWORD" : "the dev default"})`);
        await (0, client_1.closeDb)();
        process.exit(0);
    }
    catch (err) {
        if (err instanceof Error) {
            logger_1.default.error("Seed failed", { error: err.message });
        }
        process.exit(1);
    }
};
void seed();
