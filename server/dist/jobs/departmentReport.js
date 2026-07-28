"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.departmentReport = void 0;
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const DepartmentReportsRepo_1 = require("../repositories/DepartmentReportsRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const ReviewsRepo_1 = require("../repositories/ReviewsRepo");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const ReportStatsService_1 = require("../services/ReportStatsService");
const ReportsService_1 = require("../services/ReportsService");
const dhakaTime_1 = require("../utils/dhakaTime");
/**
 * Dept Review V1 — department-report (weekly; external cron Mon 09:00
 * Asia/Dhaka per KI-9, safe to run any time).
 *
 * For EVERY non-archived space (across workspaces) that shows WINDOW ACTIVITY
 * — a completion in the week, a review action in the week, or an open task
 * now — generate the LAST COMPLETED Dhaka week's report. Head is OPTIONAL:
 * headless departments still report so HR is never blind right when a head
 * leaves (v1.1 H-2). Dormant spaces are skipped (no empty-report buildup).
 *
 * SELF-HEAL: if the week BEFORE last has no stored row (a missed cron) and
 * that week had activity, it is generated too; older gaps are manual via the
 * A-8 endpoint.
 *
 * Idempotent: the upsert refreshes the payload (a Sunday manual preview gets
 * finalized on Monday) and the `notified_at` atomic claim keeps the
 * `report_ready` fanout EXACTLY-ONCE per (space, week) — re-runs never
 * re-notify. `dry_run` counts what would generate without writing.
 */
const departmentReport = async ({ dryRun, }) => {
    const db = (0, client_1.getDb)();
    const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
    const reviewsRepo = new ReviewsRepo_1.ReviewsRepo(db);
    const reportsRepo = new DepartmentReportsRepo_1.DepartmentReportsRepo(db);
    const usersRepo = new UsersRepo_1.UsersRepo(db);
    const service = new ReportsService_1.ReportsService(db, reportsRepo, spacesRepo, usersRepo, new ReportStatsService_1.ReportStatsService(reviewsRepo, new TasksRepo_1.TasksRepo(db), usersRepo, logger_1.default), new NotificationsRepo_1.NotificationsRepo(db), logger_1.default);
    const lastWeek = (0, dhakaTime_1.previousWeekStart)((0, dhakaTime_1.dhakaWeekOf)(new Date()).weekStart);
    const healWeek = (0, dhakaTime_1.previousWeekStart)(lastWeek);
    const lastBounds = (0, dhakaTime_1.weekBoundsUtc)(lastWeek);
    const healBounds = (0, dhakaTime_1.weekBoundsUtc)(healWeek);
    const spaces = await spacesRepo.listAllActive();
    let generated = 0;
    let selfHealed = 0;
    let skippedNoActivity = 0;
    let notified = 0;
    for (const space of spaces) {
        const active = await reviewsRepo.spaceHasWindowActivity(space.id, lastBounds.fromUtc, lastBounds.toUtcExclusive);
        if (active) {
            if (!dryRun) {
                const r = await service.generateFor({
                    space,
                    weekStart: lastWeek,
                    actorId: null,
                });
                if (r.notified)
                    notified += 1;
            }
            generated += 1;
        }
        else {
            skippedNoActivity += 1;
        }
        // One-week self-heal: only when the older row is ABSENT.
        const healMissing = !(await reportsRepo.findBySpaceWeek(space.id, healWeek));
        if (healMissing) {
            const healActive = await reviewsRepo.spaceHasWindowActivity(space.id, healBounds.fromUtc, healBounds.toUtcExclusive);
            if (healActive) {
                if (!dryRun) {
                    const r = await service.generateFor({
                        space,
                        weekStart: healWeek,
                        actorId: null,
                    });
                    if (r.notified)
                        notified += 1;
                }
                selfHealed += 1;
            }
        }
    }
    return {
        processed: generated + selfHealed,
        generated,
        selfHealed,
        skippedNoActivity,
        notified,
    };
};
exports.departmentReport = departmentReport;
