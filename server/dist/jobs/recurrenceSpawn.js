"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recurrenceSpawn = exports.occurrenceName = exports.occurrenceSuffix = void 0;
const logger_1 = __importDefault(require("../config/logger"));
const client_1 = require("../db/client");
const context_1 = require("../rbac/context");
const principals_1 = require("../rbac/principals");
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const StatusesRepo_1 = require("../repositories/StatusesRepo");
const TagsRepo_1 = require("../repositories/TagsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const TaskMembershipRepo_1 = require("../repositories/TaskMembershipRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskTypesRepo_1 = require("../repositories/TaskTypesRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const WorkspaceRepo_1 = require("../repositories/WorkspaceRepo");
const TasksService_1 = require("../services/TasksService");
const TaskWriteService_1 = require("../services/TaskWriteService");
const dhakaTime_1 = require("../utils/dhakaTime");
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
const occurrenceSuffix = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
};
exports.occurrenceSuffix = occurrenceSuffix;
/** tasks.name is VARCHAR(500); keep the DATE and trim the name if we must. */
const TASK_NAME_MAX = 500;
const occurrenceName = (templateName, ymd) => {
    const suffix = ` — ${(0, exports.occurrenceSuffix)(ymd)}`;
    const room = TASK_NAME_MAX - suffix.length;
    const base = templateName.length > room
        ? `${templateName.slice(0, room - 1)}…`
        : templateName;
    return `${base}${suffix}`;
};
exports.occurrenceName = occurrenceName;
const recurrenceSpawn = async ({ dryRun, }) => {
    const db = (0, client_1.getDb)();
    const workspaces = new WorkspaceRepo_1.WorkspaceRepo(db);
    const tasksRepo = new TasksRepo_1.TasksRepo(db);
    const listsRepo = new ListsRepo_1.ListsRepo(db);
    const taskWrite = new TaskWriteService_1.TaskWriteService(db, listsRepo, new StatusesRepo_1.StatusesRepo(db), new TaskTypesRepo_1.TaskTypesRepo(db), tasksRepo, new TaskMembershipRepo_1.TaskMembershipRepo(db), new UsersRepo_1.UsersRepo(db), new TagsRepo_1.TagsRepo(db), new TaskActivityRepo_1.TaskActivityRepo(db), new NotificationsRepo_1.NotificationsRepo(db), new AttachmentsRepo_1.AttachmentsRepo(db), workspaces, new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db), new TasksService_1.TasksService(listsRepo, tasksRepo), logger_1.default);
    let processed = 0;
    let spawned = 0;
    let skipped = 0;
    let failed = 0;
    let truncated = 0;
    for (const ws of await workspaces.listAll()) {
        const today = (0, dhakaTime_1.todayInZone)(ws.timezone);
        const nowHHMM = (0, dhakaTime_1.clockInZone)(ws.timezone);
        // The weekday of the workspace's OWN calendar day. Parsing the ymd as
        // UTC midnight is exact: it is a calendar day, not an instant.
        const weekday = WEEKDAY_KEYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
        const due = await tasksRepo.findRecurringDue({
            workspaceId: ws.id,
            todayYmd: today,
            nowHHMM,
            weekday,
            limit: SPAWN_BATCH_LIMIT,
        });
        processed += due.length;
        if (due.length === SPAWN_BATCH_LIMIT)
            truncated += 1;
        if (due.length === 0 || dryRun)
            continue;
        for (const template of due) {
            try {
                await (0, context_1.runWithPrincipal)((0, principals_1.systemPrincipal)(ws.id), async () => {
                    // CLAIM FIRST, on its own. It cannot share a transaction
                    // with the create below — `TaskWriteService.create` opens
                    // one itself, and wrapping it would put the insert on a
                    // second pooled connection while this one holds the
                    // template's row lock: two connections, no atomicity, and
                    // a rollback here could unwind the claim of a task that
                    // had already been committed there. So the claim stands
                    // alone as the gate, and the create's failure path puts it
                    // back explicitly.
                    const claimed = await tasksRepo.claimRecurrenceSpawn(template.id, today);
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
                            name: (0, exports.occurrenceName)(template.name, today),
                            taskTypeId: template.taskTypeId,
                            // Everything else is deliberately absent — see the
                            // header. A clean task, not a clone.
                        });
                    }
                    catch (err) {
                        // Nothing was created: hand the day back so the next
                        // tick tries again instead of silently skipping today.
                        await tasksRepo.releaseRecurrenceSpawn(template.id, today, template.recurrenceLastSpawnedOn);
                        throw err;
                    }
                    // From here the task EXISTS, so the day is genuinely spent
                    // — a failure to stamp the back-link must not release the
                    // claim (that would spawn a second copy at the next tick).
                    // The link is provenance, not correctness.
                    spawned += 1;
                    try {
                        await tasksRepo.setRecurringSource(created.id, template.id);
                    }
                    catch (err) {
                        logger_1.default.warn("job.recurrence-spawn.link_failed", {
                            taskId: created.id,
                            templateId: template.id,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                });
            }
            catch (err) {
                // One bad template (a deleted list, a workspace with no task
                // types) must not stop the rest of the office's day.
                failed += 1;
                logger_1.default.error("job.recurrence-spawn.task_failed", {
                    workspaceId: ws.id,
                    templateId: template.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
    return { processed, spawned, skipped, failed, truncated };
};
exports.recurrenceSpawn = recurrenceSpawn;
