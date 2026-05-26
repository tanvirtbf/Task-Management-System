import { eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { tenants } from "../db/schema";
import { ITenant } from "../types";

export class TenantService {
    constructor(private db: MySql2Database<typeof schema>) {}

    async create(tenantData: ITenant) {
        const result = await this.db.insert(tenants).values(tenantData);
        const insertId = (result as unknown as { insertId: number }[])[0]
            ?.insertId;
        const [tenant] = await this.db
            .select()
            .from(tenants)
            .where(eq(tenants.id, insertId))
            .limit(1);
        return tenant;
    }

    async update(id: number, tenantData: ITenant) {
        await this.db
            .update(tenants)
            .set(tenantData)
            .where(eq(tenants.id, id));
        return await this.getById(id);
    }

    async getAll() {
        return await this.db.select().from(tenants);
    }

    async getById(tenantId: number) {
        const [tenant] = await this.db
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        return tenant ?? null;
    }

    async deleteById(tenantId: number) {
        return await this.db.delete(tenants).where(eq(tenants.id, tenantId));
    }
}
