import { eq, exists, and, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { taskAssignees, tasks } from "../db/schema";
import { currentActor } from "./context";

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
export const taskOwnEscape = async (): Promise<readonly SQL[]> => {
    const actor = await currentActor();
    if (!actor) return [];

    const entry = actor.perms.get("task.view");
    const ownReach = !!entry && (entry.own || entry.ownSpaceIds.size > 0);
    if (!ownReach) return [];

    const db = getDb();
    return [
        eq(tasks.createdBy, actor.userId),
        exists(
            db
                .select({ one: taskAssignees.taskId })
                .from(taskAssignees)
                .where(
                    and(
                        eq(taskAssignees.taskId, tasks.id),
                        eq(taskAssignees.userId, actor.userId),
                    ),
                ),
        ),
    ];
};
