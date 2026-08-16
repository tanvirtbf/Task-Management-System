import logger from "../config/logger";
import { getDb } from "../db/client";
import { runWithPrincipal } from "../rbac/context";
import { systemPrincipal } from "../rbac/principals";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { StatusesRepo } from "../repositories/StatusesRepo";
import { TagsRepo } from "../repositories/TagsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { TaskMembershipRepo } from "../repositories/TaskMembershipRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskTypesRepo } from "../repositories/TaskTypesRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { WorkspaceRepo } from "../repositories/WorkspaceRepo";
import { TasksService } from "../services/TasksService";
import { TaskWriteService } from "../services/TaskWriteService";
import { clockInZone, todayInZone } from "../utils/dhakaTime";
import type { JobContext, JobOutcome } from "./types";

/**
 * §28 recurrence-spawn (every 15 min) — the half of recurrence that never
 * existed.
 *
 * `recurrence_pattern` / `_days` / `_ends_at` have been stored since V1 with
 * NOTHING reading them: the picker saved a setting and no task was ever
 * created. The knowledge base said so honestly ("make the next one yourself").
 * upgrades/024 adds the missing time-of-day, the idempotency claim, and this.
 *
 * ── WHAT IT CREATES (the operator's spec, 2026-08-16) ────────────────────────
 * A NEW, CLEAN task in the same list, named for the day:
 *
 *     "Daily stock check"  ──►  "Daily stock check — 17 Aug 2026"
 *
 * Nothing else travels: no assignee, no start/due date, no tags, no priority,
 * no description, no checklist. Yesterday's owner and yesterday's deadline are
 * yesterday's business; today's occurrence is fresh work waiting to be picked
 * up. It also carries NO recurrence of its own — only the template repeats, so
 * a copy can never start spawning copies.
 *
 * ── WHY IT GOES THROUGH TaskWriteService.create ──────────────────────────────
 * Hand-rolling the INSERT would have to re-implement task-number allocation,
 * the list's default status, the workspace's task type and the `task_created`
 * audit row — four chances to drift from what the New-task button does. The
 * job runs it under the SYSTEM principal (`rbac/principals.ts` §1), which is
 * the same mechanism every other job uses to write without a human's grants.
 * Attribution stays honest: `created_by` is the person who set the recurrence
 * up, not a robot account that does not exist.
 *
 * ── EXACTLY ONCE PER DAY ─────────────────────────────────────────────────────
 * The tick is every 15 minutes so a 09:00 recurrence fires at 09:00 and not at
 * midnight. `tasks.recurrence_last_spawned_on` is claimed with a conditional
 * UPDATE BEFORE the task is created, so a re-run, an overlapping cron and a
 * manual `npm run job recurrence-spawn` all produce one task — the first one
 * to win the UPDATE spawns, the rest see zero affected rows and skip. If the
 * create then fails, the claim is handed back explicitly (see the loop) so the
 * next tick retries instead of the day being lost.
 */

/** Per-workspace per-run cap — bounds one tick's write burst. */
const SPAWN_BATCH_LIMIT = 200;

/** `recurrence_days` SET members, indexed by JS `getUTCDay()`. */
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-08-17` → `17 Aug 2026` — how the office reads a date. */
export const occurrenceSuffix = (ymd: string): string => {
    const [y, m, d] = ymd.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** tasks.name is VARCHAR(500); keep the DATE and trim the name if we must. */
const TASK_NAME_MAX = 500;
export const occurrenceName = (templateName: string, ymd: string): string => {
    const suffix = ` — ${occurrenceSuffix(ymd)}`;
    const room = TASK_NAME_MAX - suffix.length;
    const base =
        templateName.length > room
            ? `${templateName.slice(0, room - 1)}…`
            : templateName;
    return `${base}${suffix}`;
};

export const recurrenceSpawn = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const db = getDb();
    const workspaces = new WorkspaceRepo(db);
    const tasksRepo = new TasksRepo(db);
    const listsRepo = new ListsRepo(db);

    const taskWrite = new TaskWriteService(
        db,
        listsRepo,
        new StatusesRepo(db),
        new TaskTypesRepo(db),
        tasksRepo,
        new TaskMembershipRepo(db),
        new UsersRepo(db),
        new TagsRepo(db),
        new TaskActivityRepo(db),
        new NotificationsRepo(db),
        new AttachmentsRepo(db),
        workspaces,
        new WorkspaceActivityRepo(db),
        new TasksService(listsRepo, tasksRepo),
        logger,
    );

    let processed = 0;
    let spawned = 0;
    let skipped = 0;
    let failed = 0;
    let truncated = 0;

    for (const ws of await workspaces.listAll()) {
        const today = todayInZone(ws.timezone);
        const nowHHMM = clockInZone(ws.timezone);
        // The weekday of the workspace's OWN calendar day. Parsing the ymd as
        // UTC midnight is exact: it is a calendar day, not an instant.
        const weekday =
            WEEKDAY_KEYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

        const due = await tasksRepo.findRecurringDue({
            workspaceId: ws.id,
            todayYmd: today,
            nowHHMM,
            weekday,
            limit: SPAWN_BATCH_LIMIT,
        });
        processed += due.length;
        if (due.length === SPAWN_BATCH_LIMIT) truncated += 1;
        if (due.length === 0 || dryRun) continue;

        for (const template of due) {
            try {
                await runWithPrincipal(systemPrincipal(ws.id), async () => {
                    // CLAIM FIRST, on its own. It cannot share a transaction
                    // with the create below — `TaskWriteService.create` opens
                    // one itself, and wrapping it would put the insert on a
                    // second pooled connection while this one holds the
                    // template's row lock: two connections, no atomicity, and
                    // a rollback here could unwind the claim of a task that
                    // had already been committed there. So the claim stands
                    // alone as the gate, and the create's failure path puts it
                    // back explicitly.
                    const claimed = await tasksRepo.claimRecurrenceSpawn(
                        template.id,
                        today,
                    );
                    if (!claimed) {
                        skipped += 1;
                        return;
                    }

                    let created;
                    try {
                        created = await taskWrite.create({
                            workspaceId: ws.id,
                            actorId: template.createdBy,
                            role: "member",
                            primaryListId: template.primaryListId,
                            name: occurrenceName(template.name, today),
                            taskTypeId: template.taskTypeId,
                            // Everything else is deliberately absent — see the
                            // header. A clean task, not a clone.
                        });
                    } catch (err) {
                        // Nothing was created: hand the day back so the next
                        // tick tries again instead of silently skipping today.
                        await tasksRepo.releaseRecurrenceSpawn(
                            template.id,
                            today,
                            template.recurrenceLastSpawnedOn,
                        );
                        throw err;
                    }

                    // From here the task EXISTS, so the day is genuinely spent
                    // — a failure to stamp the back-link must not release the
                    // claim (that would spawn a second copy at the next tick).
                    // The link is provenance, not correctness.
                    spawned += 1;
                    try {
                        await tasksRepo.setRecurringSource(
                            created.id,
                            template.id,
                        );
                    } catch (err) {
                        logger.warn("job.recurrence-spawn.link_failed", {
                            taskId: created.id,
                            templateId: template.id,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                });
            } catch (err) {
                // One bad template (a deleted list, a workspace with no task
                // types) must not stop the rest of the office's day.
                failed += 1;
                logger.error("job.recurrence-spawn.task_failed", {
                    workspaceId: ws.id,
                    templateId: template.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

    return { processed, spawned, skipped, failed, truncated };
};
