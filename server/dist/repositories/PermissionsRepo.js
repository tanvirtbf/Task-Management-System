"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const catalog_1 = require("../rbac/catalog");
class PermissionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Upsert every catalog entry. Idempotent and cheap (56 rows), so it is safe
     * to run on every boot — labels/descriptions/scopes refresh from code while
     * grants are untouched. Returns the number of catalog entries written.
     */
    async syncCatalog(exec = this.db) {
        if (catalog_1.PERMISSIONS.length === 0)
            return 0;
        await exec
            .insert(schema_1.permissions)
            .values(catalog_1.PERMISSIONS.map((p, i) => ({
            permissionKey: p.key,
            groupKey: p.group,
            label: p.label,
            description: p.description,
            scopes: p.scopes.join(","),
            isDangerous: p.dangerous ?? false,
            position: i,
        })))
            .onDuplicateKeyUpdate({
            set: {
                groupKey: (0, drizzle_orm_1.sql) `VALUES(group_key)`,
                label: (0, drizzle_orm_1.sql) `VALUES(label)`,
                description: (0, drizzle_orm_1.sql) `VALUES(description)`,
                scopes: (0, drizzle_orm_1.sql) `VALUES(scopes)`,
                isDangerous: (0, drizzle_orm_1.sql) `VALUES(is_dangerous)`,
                position: (0, drizzle_orm_1.sql) `VALUES(position)`,
            },
        });
        return catalog_1.PERMISSIONS.length;
    }
    /** The whole catalog in display order (group, then position). */
    async listAll(exec = this.db) {
        return exec
            .select({
            permissionKey: schema_1.permissions.permissionKey,
            groupKey: schema_1.permissions.groupKey,
            label: schema_1.permissions.label,
            description: schema_1.permissions.description,
            scopes: schema_1.permissions.scopes,
            isDangerous: schema_1.permissions.isDangerous,
            position: schema_1.permissions.position,
        })
            .from(schema_1.permissions)
            .orderBy((0, drizzle_orm_1.asc)(schema_1.permissions.groupKey), (0, drizzle_orm_1.asc)(schema_1.permissions.position));
    }
    /** Every catalog key, for validating a grant payload. */
    async listKeys(exec = this.db) {
        const rows = await exec
            .select({ k: schema_1.permissions.permissionKey })
            .from(schema_1.permissions);
        return rows.map((r) => r.k);
    }
}
exports.PermissionsRepo = PermissionsRepo;
