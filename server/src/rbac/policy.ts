import logger from "../config/logger";
import { getDb } from "../db/client";
import { ListsRepo } from "../repositories/ListsRepo";
import { SpaceVisibilityGrantsRepo } from "../repositories/SpaceVisibilityGrantsRepo";
import { UserRolesRepo } from "../repositories/UserRolesRepo";
import { PolicyService } from "../services/PolicyService";

/**
 * THE process-wide `PolicyService`.
 *
 * There must be exactly one: its actor cache is keyed by `(workspace, user)`
 * plus `permissions_version`, and that cache is what makes an authorization
 * check cost a single indexed query instead of a join on every request. A
 * per-router instance would each hold their own cold cache.
 *
 * Lazily constructed so importing a router never runs `getDb()` before
 * `server.ts` has called `initDb()`.
 */
let instance: PolicyService | null = null;

export const getPolicy = (): PolicyService => {
    if (!instance) {
        const db = getDb();
        instance = new PolicyService(
            new UserRolesRepo(db),
            new ListsRepo(db),
            // Team-access P4: team → team sight, folded into `space.view`.
            new SpaceVisibilityGrantsRepo(db),
            logger,
        );
    }
    return instance;
};

/** Drop the singleton (tests that swap the database handle). */
export const resetPolicy = (): void => {
    instance = null;
};
