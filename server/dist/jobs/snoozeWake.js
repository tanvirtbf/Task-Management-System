"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snoozeWake = void 0;
const client_1 = require("../db/client");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
/**
 * §28 #6 snooze-wake (every 5 min): flip snoozed notifications back to unread
 * once their snooze has elapsed (`snoozed_until <= NOW()`), clearing
 * `snoozed_until`. A single conditional UPDATE — inherently idempotent: a
 * second run in the same window flips 0 rows, so a snoozed notification is
 * never re-delivered twice (the §28 no-double-deliver contract). `dry_run`
 * counts the due rows without flipping them.
 */
const snoozeWake = async ({ dryRun, }) => {
    const repo = new NotificationsRepo_1.NotificationsRepo((0, client_1.getDb)());
    if (dryRun) {
        const wouldWake = await repo.countSnoozedDue();
        return { processed: wouldWake, wouldWake };
    }
    const woken = await repo.wakeSnoozed();
    return { processed: woken, woken };
};
exports.snoozeWake = snoozeWake;
