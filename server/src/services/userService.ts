import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import createHttpError from "http-errors";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { users } from "../db/schema";
import { LimitedUserData, UserData } from "../types";

export class UserService {
    constructor(private db: MySql2Database<typeof schema>) {}

    async create({
        firstName,
        lastName,
        email,
        password,
        role,
        tenantId,
    }: UserData) {
        const existing = await this.db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (existing.length > 0) {
            throw createHttpError(400, "Email is already exists!");
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        try {
            const inserted = await this.db.insert(users).values({
                firstName,
                lastName,
                email,
                password: hashedPassword,
                role,
                tenantId: tenantId ?? null,
            });

            // mysql2 returns insertId on result
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const insertId = (inserted as unknown as { insertId: number }[])[0]
                ?.insertId;

            const [user] = await this.db
                .select()
                .from(users)
                .where(eq(users.id, insertId))
                .limit(1);

            return user;
        } catch {
            throw createHttpError(
                500,
                "Failed to store the data in the database",
            );
        }
    }

    async findByEmailWithPassword(email: string) {
        const [user] = await this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                password: users.password,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        return user ?? null;
    }

    async findById(id: number) {
        const [user] = await this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                tenantId: users.tenantId,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return user ?? null;
    }

    async update(
        userId: number,
        { firstName, lastName, role }: LimitedUserData,
    ) {
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

    async getAll() {
        return await this.db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                role: users.role,
                tenantId: users.tenantId,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users);
    }

    async deleteById(userId: number) {
        return await this.db.delete(users).where(eq(users.id, userId));
    }
}
