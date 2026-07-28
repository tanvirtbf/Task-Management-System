import { asc, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { permissions } from "../db/schema";
import { PERMISSIONS } from "../rbac/catalog";
import type { DbExecutor } from "./types";

/**
 * Data access for `permissions` — the permission CATALOG.
 *
 * These rows are REFERENCE DATA owned by `src/rbac/catalog.ts`, not user
 * content: the app is the source of truth and the table is a queryable mirror
 * (so the admin UI can join/filter, and so `role_permissions` can FK to it).
 *
 * Rows are never deleted here. The FK from `role_permissions` is RESTRICT
 * precisely so a key somebody has already granted cannot silently vanish when
 * it is removed from the catalog — that has to be a deliberate migration.
 */
export interface PermissionRecord {
    permissionKey: string;
    groupKey: string;
    label: string;
    description: string;
    /** CSV, e.g. "all,space,own". */
    scopes: string;
    isDangerous: boolean;
    position: number;
}

export class PermissionsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Upsert every catalog entry. Idempotent and cheap (56 rows), so it is safe
     * to run on every boot — labels/descriptions/scopes refresh from code while
     * grants are untouched. Returns the number of catalog entries written.
     */
    async syncCatalog(exec: DbExecutor = this.db): Promise<number> {
        if (PERMISSIONS.length === 0) return 0;
        await exec
            .insert(permissions)
            .values(
                PERMISSIONS.map((p, i) => ({
                    permissionKey: p.key,
                    groupKey: p.group,
                    label: p.label,
                    description: p.description,
                    scopes: p.scopes.join(","),
                    isDangerous: p.dangerous ?? false,
                    position: i,
                })),
            )
            .onDuplicateKeyUpdate({
                set: {
                    groupKey: sql`VALUES(group_key)`,
                    label: sql`VALUES(label)`,
                    description: sql`VALUES(description)`,
                    scopes: sql`VALUES(scopes)`,
                    isDangerous: sql`VALUES(is_dangerous)`,
                    position: sql`VALUES(position)`,
                },
            });
        return PERMISSIONS.length;
    }

    /** The whole catalog in display order (group, then position). */
    async listAll(exec: DbExecutor = this.db): Promise<PermissionRecord[]> {
        return exec
            .select({
                permissionKey: permissions.permissionKey,
                groupKey: permissions.groupKey,
                label: permissions.label,
                description: permissions.description,
                scopes: permissions.scopes,
                isDangerous: permissions.isDangerous,
                position: permissions.position,
            })
            .from(permissions)
            .orderBy(asc(permissions.groupKey), asc(permissions.position));
    }

    /** Every catalog key, for validating a grant payload. */
    async listKeys(exec: DbExecutor = this.db): Promise<string[]> {
        const rows = await exec
            .select({ k: permissions.permissionKey })
            .from(permissions);
        return rows.map((r) => r.k);
    }
}
