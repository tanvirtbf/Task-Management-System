import { getDb } from "../db/client";
import logger from "../config/logger";
import { DepartmentReportsRepo } from "../repositories/DepartmentReportsRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { ReviewsRepo } from "../repositories/ReviewsRepo";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { ReportStatsService } from "../services/ReportStatsService";
import { ReportsService } from "../services/ReportsService";
import {
    dhakaWeekOf,
    previousWeekStart,
    weekBoundsUtc,
} from "../utils/dhakaTime";
import type { JobContext, JobOutcome } from "./types";

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
export const departmentReport = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const db = getDb();
    const spacesRepo = new SpacesRepo(db);
    const reviewsRepo = new ReviewsRepo(db);
    const reportsRepo = new DepartmentReportsRepo(db);
    const usersRepo = new UsersRepo(db);
    const service = new ReportsService(
        db,
        reportsRepo,
        spacesRepo,
        usersRepo,
        new ReportStatsService(
            reviewsRepo,
            new TasksRepo(db),
            usersRepo,
            logger,
        ),
        new NotificationsRepo(db),
        logger,
    );

    const lastWeek = previousWeekStart(dhakaWeekOf(new Date()).weekStart);
    const healWeek = previousWeekStart(lastWeek);
    const lastBounds = weekBoundsUtc(lastWeek);
    const healBounds = weekBoundsUtc(healWeek);

    const spaces = await spacesRepo.listAllActive();
    let generated = 0;
    let selfHealed = 0;
    let skippedNoActivity = 0;
    let notified = 0;

    for (const space of spaces) {
        const active = await reviewsRepo.spaceHasWindowActivity(
            space.id,
            lastBounds.fromUtc,
            lastBounds.toUtcExclusive,
        );
        if (active) {
            if (!dryRun) {
                const r = await service.generateFor({
                    space,
                    weekStart: lastWeek,
                    actorId: null,
                });
                if (r.notified) notified += 1;
            }
            generated += 1;
        } else {
            skippedNoActivity += 1;
        }

        // One-week self-heal: only when the older row is ABSENT.
        const healMissing = !(await reportsRepo.findBySpaceWeek(
            space.id,
            healWeek,
        ));
        if (healMissing) {
            const healActive = await reviewsRepo.spaceHasWindowActivity(
                space.id,
                healBounds.fromUtc,
                healBounds.toUtcExclusive,
            );
            if (healActive) {
                if (!dryRun) {
                    const r = await service.generateFor({
                        space,
                        weekStart: healWeek,
                        actorId: null,
                    });
                    if (r.notified) notified += 1;
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
