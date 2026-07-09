/**
 * Seed the Turso database — port of the original `server/src/db/seed.ts`
 * (bcrypt → the Workers-compatible CredentialService hash). Run with:
 *
 *   npm run db:seed        (after `npm run db:push`)
 *
 * Idempotent: skips if the owner account already exists.
 */
import { config } from "dotenv";
config({ path: ".dev.vars" });

const seed = async () => {
    const { initDb, closeDb } = await import("../src/server/db/client");
    const { eq } = await import("drizzle-orm");
    const { taskTypes, users, workspaces } = await import(
        "../src/server/db/schema"
    );
    const { fakeId } = await import("../src/server/utils");
    const { CredentialService } = await import(
        "../src/server/services/CredentialService"
    );

    const db = await initDb();
    console.log("Seeding database...");

    const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "owner@company.local"))
        .limit(1);
    if (existing.length > 0) {
        console.log("Owner already exists — nothing to do.");
        await closeDb();
        return;
    }

    // Seed default workspace
    const workspaceId = fakeId("ws");
    await db.insert(workspaces).values({
        id: workspaceId,
        name: "BeautyBooth",
        timezone: "Asia/Dhaka",
        defaultLocale: "en-US",
    });
    console.log("Workspace created:", workspaceId);

    // Seed owner user
    const credentialService = new CredentialService();
    const passwordHash = await credentialService.hashPassword("Owner@12345");
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
    console.log("Owner created:", ownerId);

    // Starter task types — a workspace needs at least one (task creation
    // requires a task_type_id).
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
    console.log("Task types seeded");

    console.log("Seed completed. Default owner: owner@company.local / Owner@12345");
    await closeDb();
};

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Seed failed:", err);
        process.exit(1);
    });
