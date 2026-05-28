import { eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { workspaces } from "../db/schema";
import { IWorkspace } from "../types";
import { fakeId } from "../utils";

export class WorkspaceService {
    constructor(private db: MySql2Database<typeof schema>) {}

    async create(data: IWorkspace) {
        const id = fakeId("ws");
        await this.db.insert(workspaces).values({
            id,
            name: data.name,
            logoUrl: data.logoUrl ?? null,
            timezone: data.timezone ?? "Asia/Dhaka",
            defaultLocale: data.defaultLocale ?? "en-US",
        });
        return this.getById(id);
    }

    async update(id: string, data: Partial<IWorkspace>) {
        const patch: Record<string, unknown> = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.logoUrl !== undefined) patch.logoUrl = data.logoUrl;
        if (data.timezone !== undefined) patch.timezone = data.timezone;
        if (data.defaultLocale !== undefined)
            patch.defaultLocale = data.defaultLocale;

        if (Object.keys(patch).length > 0) {
            await this.db
                .update(workspaces)
                .set(patch)
                .where(eq(workspaces.id, id));
        }
        return this.getById(id);
    }

    async getAll() {
        return await this.db.select().from(workspaces);
    }

    async getById(workspaceId: string) {
        const [workspace] = await this.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);
        return workspace ?? null;
    }

    async deleteById(workspaceId: string) {
        return await this.db
            .delete(workspaces)
            .where(eq(workspaces.id, workspaceId));
    }
}
