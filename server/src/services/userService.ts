import { eq, isNull, and } from "drizzle-orm";
import { db, users } from "../db";

export class UserService {
    async findByEmail(email: string) {
        const [row] = await db
            .select()
            .from(users)
            .where(and(eq(users.email, email), isNull(users.deleted_at)))
            .limit(1);
        return row ?? null;
    }

    async findById(id: number) {
        const [row] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, id), isNull(users.deleted_at)))
            .limit(1);
        return row ?? null;
    }

    async create(data: {
        email: string;
        password_hash: string;
        first_name: string;
        last_name?: string;
        role?: "admin" | "member";
    }) {
        const result = await db.insert(users).values({
            email: data.email,
            password_hash: data.password_hash,
            first_name: data.first_name,
            last_name: data.last_name ?? null,
            role: data.role ?? "member",
        });

        const insertId = (result as unknown as { insertId: number }[])[0]?.insertId
            ?? (result as unknown as { insertId: number }).insertId;
        return this.findById(insertId as number);
    }

    async updateLastLogin(id: number) {
        await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, id));
    }
}
