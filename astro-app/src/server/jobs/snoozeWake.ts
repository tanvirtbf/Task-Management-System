import { getDb } from "../db/client";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import type { JobContext, JobOutcome } from "./types";

/**
 * §28 #6 snooze-wake (every 5 min): flip snoozed notifications back to unread
 * once their snooze has elapsed (`snoozed_until <= NOW()`), clearing
 * `snoozed_until`. A single conditional UPDATE — inherently idempotent: a
 * second run in the same window flips 0 rows, so a snoozed notification is
 * never re-delivered twice (the §28 no-double-deliver contract). `dry_run`
 * counts the due rows without flipping them.
 */
export const snoozeWake = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const repo = new NotificationsRepo(getDb());

    if (dryRun) {
        const wouldWake = await repo.countSnoozedDue();
        return { processed: wouldWake, wouldWake };
    }

    const woken = await repo.wakeSnoozed();
    return { processed: woken, woken };
};
