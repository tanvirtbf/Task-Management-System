import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import createHttpError from "http-errors";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import { LimitedUserData, UserData } from "../types";
import { fakeId } from "../utils";

export class UserService {
    constructor(private db: MySql2Database<typeof schema>) {}

    async create({
        firstName,
        lastName,
        email,
        password,
        role,
        workspaceId,
    }: UserData) {
        if (!workspaceId) {
            throw createHttpError(
                400,
                "workspaceId is required to create a user",
            );
        }

        const existing = await this.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (existing.length > 0) {
            throw createHttpError(409, "Email already exists");
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const id = fakeId("u");

        try {
            await this.db.insert(users).values({
                id,
                workspaceId,
                firstName,
                lastName,
                email,
                passwordHash,
                role,
                status: "active",
            });

            return this.findById(id);
        } catch {
            throw createHttpError(
                500,
                "Failed to store the user in the database",
            );
        }
    }

    async findByEmailWithPassword(email: string) {
        const [user] = await this.db
            .select({
                id: users.id,
                workspaceId: users.workspaceId,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                status: users.status,
                passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        return user ?? null;
    }

    async findById(id: string) {
        const [user] = await this.db
            .select({
                id: users.id,
                workspaceId: users.workspaceId,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                status: users.status,
                avatarUrl: users.avatarUrl,
                timezone: users.timezone,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return user ?? null;
    }

    async update(userId: string, { firstName, lastName, role }: LimitedUserData) {
        try {
            await this.db
                .update(users)
                .set({ firstName, lastName, role })
                .where(eq(users.id, userId));
            return await this.findById(userId);
        } catch {
            throw createHttpError(
                500,
                "Failed to update the user in the database",
            );
        }
    }

    async listByWorkspace(workspaceId: string) {
        return await this.db
            .select({
                id: users.id,
                workspaceId: users.workspaceId,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                status: users.status,
                avatarUrl: users.avatarUrl,
                lastLoginAt: users.lastLoginAt,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.workspaceId, workspaceId));
    }

    async deleteById(userId: string) {
        return await this.db.delete(users).where(eq(users.id, userId));
    }

    async touchLastLogin(userId: string) {
        await this.db
            .update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, userId));
    }
}
