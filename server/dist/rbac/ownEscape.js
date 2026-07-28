"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskOwnEscape = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const client_1 = require("../db/client");
const schema_1 = require("../db/schema");
const context_1 = require("./context");
/**
 * THE `own` ESCAPE HATCH (RBAC_DYNAMIC_PLAN.md P17, catalog `task.view`).
 *
 * A person scoped to Marketing still has to see the bug they filed into
 * Engineering, and the task Engineering assigned to them. Without this, "your
 * spaces" would quietly mean "only your spaces", and cross-department work —
 * which is most of what a 100-person company does — would vanish from the
 * reporter's own screen.
 *
 * These predicates are OR-ed with the space filter (never AND-ed — see
 * `scopePredicate`'s `alsoAllow`), so they only ever ADD rows.
 *
 * Returns `[]` when:
 *   · there is no authenticated caller (jobs, seeds, tests — already
 *     unrestricted, so the extra clause would be noise), or
 *   · the caller holds no `own`-scoped reach on `task.view`, in which case
 *     adding it would GRANT something the roles do not.
 * That second condition is the important one: the escape hatch is itself a
 * permission, not a freebie.
 */
const taskOwnEscape = async () => {
    const actor = await (0, context_1.currentActor)();
    if (!actor)
        return [];
    const entry = actor.perms.get("task.view");
    const ownReach = !!entry && (entry.own || entry.ownSpaceIds.size > 0);
    if (!ownReach)
        return [];
    const db = (0, client_1.getDb)();
    return [
        (0, drizzle_orm_1.eq)(schema_1.tasks.createdBy, actor.userId),
        (0, drizzle_orm_1.exists)(db
            .select({ one: schema_1.taskAssignees.taskId })
            .from(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, actor.userId)))),
    ];
};
exports.taskOwnEscape = taskOwnEscape;
