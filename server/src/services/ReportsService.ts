import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { holds } from "../rbac/can";
import { liveLegacyRole } from "../rbac/scopeGuard";
import { currentActor } from "../rbac/context";
import {
    DepartmentReportsRepo,
    type DeptReportRecord,
} from "../repositories/DepartmentReportsRepo";
import type { SpacesRepo } from "../repositories/SpacesRepo";
import type { UsersRepo } from "../repositories/UsersRepo";
import type { NotificationsRepo } from "../repositories/NotificationsRepo";
import type {
    DeptReportPayload,
    ReportStatsService,
} from "./ReportStatsService";
import {
    addDaysYmd,
    dhakaToday,
    dhakaWeekOf,
    isDhakaMonday,
    previousWeekStart,
} from "../utils/dhakaTime";
import {
    toWireReport,
    toWireReportListItem,
    type WireDepartmentReport,
    type WireDepartmentReportListItem,
} from "../serializers/reportSerializer";
import { Roles, type Role } from "../constants";

/**
 * Dept Review V1 — reports read-side (P19; P20 adds generation, P21 the
 * on-demand/note/ack writers).
 *
 * A-6/A-7 gate: owner/admin see every report; anyone else sees exactly the
 * rows of spaces they CURRENTLY head plus rows where they are the SNAPSHOT
 * head — an ex-head keeps their own past reports, a new head sees the
 * department's history (v1.1 H-12 amendment). A non-head member simply gets
 * an empty list (harmless), and 403 `report.forbidden` on a direct read.
 */

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;

const clampLimit = (raw?: number): number => {
    if (raw === undefined || !Number.isFinite(raw)) return LIST_DEFAULT_LIMIT;
    return Math.min(Math.max(Math.trunc(raw), 1), LIST_MAX_LIMIT);
};

// Composite keyset cursor — (week_start, internal_id), a VARIANT of the
// repo's simple internal_id codecs (different shape, so it stays local).
const encodeReportCursor = (key: {
    weekStart: string;
    internalId: bigint;
}): string =>
    Buffer.from(`${key.weekStart}|${key.internalId.toString()}`, "utf8").toString(
        "base64url",
    );

const decodeReportCursor = (
    cursor: string,
): { weekStart: string; internalId: bigint } => {
    const fail = () => {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "Malformed pagination cursor",
        );
    };
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) fail();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const [weekStart, internalId, extra] = decoded.split("|");
    if (extra !== undefined) fail();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "")) fail();
    if (!/^\d+$/.test(internalId ?? "")) fail();
    return { weekStart, internalId: BigInt(internalId) };
};

/** Notification title, capped well under the 300-char column. */
const reportTitle = (
    spaceName: string,
    weekStart: string,
    weekEnd: string,
): string =>
    `Weekly report ready: ${spaceName} (${weekStart} – ${weekEnd})`.slice(
        0,
        300,
    );

export class ReportsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private reports: DepartmentReportsRepo,
        private spaces: SpacesRepo,
        private users: UsersRepo,
        private stats: ReportStatsService,
        private notifications: NotificationsRepo,
        private logger: Logger,
    ) {}

    /**
     * The SHARED generation path (P20) — the weekly job and A-8's manual
     * generate both land here, so the notification semantics cannot diverge.
     *
     * Flow: previous week's stored totals (copied, never recomputed) →
     * `computeWeek` → upsert (refreshes ONLY the payload, the generated_*
     * columns and the head snapshot) → the ATOMIC claim-then-notify:
     * `notified_at` flips from NULL
     * exactly once per (space, week) inside a tx with the fanout, so a
     * job-vs-manual race elects a single notifier and an early manual
     * generate can never suppress the weekly notification (H-8).
     *
     * Recipients (D-1): every active owner/admin plus the CURRENT head when
     * one is set — deduped (a head who is also an admin gets ONE row).
     * Headless departments still generate and notify the admins (H-2).
     */
    async generateFor(input: {
        space: {
            id: string;
            workspaceId: string;
            name: string;
            headUserId: string | null;
        };
        /** Dhaka Monday — callers validate (A-8) or construct (job) it. */
        weekStart: string;
        /** null = the automated job. */
        actorId: string | null;
    }): Promise<{ report: DeptReportRecord; notified: boolean }> {
        const weekEnd = addDaysYmd(input.weekStart, 6);
        const prevRow = await this.reports.findBySpaceWeek(
            input.space.id,
            previousWeekStart(input.weekStart),
        );
        const prevPayload = (prevRow?.payload ?? null) as
            | DeptReportPayload
            | null;
        const prevTotals = prevPayload?.totals
            ? {
                  completed: prevPayload.totals.completed,
                  overdue_now: prevPayload.totals.overdue_now,
              }
            : null;

        const payload = await this.stats.computeWeek({
            spaceId: input.space.id,
            workspaceId: input.space.workspaceId,
            weekStart: input.weekStart,
            today: dhakaToday(),
            prevTotals,
        });

        const now = new Date();
        const report = await this.reports.upsert({
            workspaceId: input.space.workspaceId,
            spaceId: input.space.id,
            weekStart: input.weekStart,
            weekEnd,
            headUserId: input.space.headUserId,
            payload,
            generatedBy: input.actorId,
            generatedAt: now,
        });

        let notified = false;
        await this.db.transaction(async (tx) => {
            const claimed = await this.reports.claimNotification(
                input.space.id,
                input.weekStart,
                now,
                tx,
            );
            if (!claimed) return;
            notified = true;
            const adminIds = await this.users.findActiveAdminIds(
                input.space.workspaceId,
            );
            const recipients = [
                ...new Set([
                    ...adminIds,
                    ...(input.space.headUserId
                        ? [input.space.headUserId]
                        : []),
                ]),
            ];
            await this.notifications.createMany(
                recipients.map((userId) => ({
                    userId,
                    type: "report_ready" as const,
                    entityType: "report" as const,
                    entityId: report.id,
                    actorId: input.actorId,
                    title: reportTitle(
                        input.space.name,
                        input.weekStart,
                        weekEnd,
                    ),
                    body: `Completed ${payload.totals.completed} · flagged ${payload.totals.flagged} · overdue ${payload.totals.overdue_now}`,
                })),
                tx,
            );
        });

        this.logger.info("report.generated", {
            reportId: report.id,
            spaceId: input.space.id,
            weekStart: input.weekStart,
            actorId: input.actorId,
            notified,
        });
        return { report, notified };
    }

    /** Space ids the user currently heads (archived included — history). */
    private async headedSpaceIds(
        workspaceId: string,
        userId: string,
    ): Promise<string[]> {
        const rows = await this.spaces.listByWorkspace(workspaceId, {
            includeArchived: true,
        });
        return rows
            .filter((s) => s.headUserId === userId)
            .map((s) => s.id);
    }

    private isAdmin(role: Role): boolean {
        return role === Roles.OWNER || role === Roles.ADMIN;
    }

    /** A-6 — `GET /api/v1/reports`. */
    async list(input: {
        workspaceId: string;
        userId: string;
        role: Role;
        spaceId?: string;
        cursor?: string;
        limit?: number;
    }): Promise<{
        data: WireDepartmentReportListItem[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
    }> {
        const limit = clampLimit(input.limit);
        const afterKey = input.cursor
            ? decodeReportCursor(input.cursor)
            : undefined;
        // F7 / D3.1 compose: head-scoped visibility is feature logic (D-5) and
        // is untouched; the "admins see every department" fast-path now also
        // requires the `report.view` grant. An admin whose role has the toggle
        // off falls back to head scoping (usually an empty list) — the toggle
        // is real, and department heads are unaffected. NEVER make this a
        // route gate: heads are legacy `member`s and would lose dept-review.
        const adminSeesAll =
            this.isAdmin(await liveLegacyRole(input.role) as Role) &&
            holds(await currentActor(), "report.view");
        const headVisibility = adminSeesAll
            ? undefined
            : {
                  userId: input.userId,
                  headedSpaceIds: await this.headedSpaceIds(
                      input.workspaceId,
                      input.userId,
                  ),
              };

        const filter = {
            workspaceId: input.workspaceId,
            spaceId: input.spaceId,
            headVisibility,
        };
        const [rows, total] = await Promise.all([
            this.reports.list({ ...filter, afterKey, limit: limit + 1 }),
            this.reports.countFor(filter),
        ]);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const heads = await this.hydrateHeads(page, input.workspaceId);

        const last = page[page.length - 1];
        return {
            data: page.map((r) =>
                toWireReportListItem(
                    r,
                    r.headUserId ? (heads.get(r.headUserId) ?? null) : null,
                ),
            ),
            nextCursor:
                hasMore && last
                    ? encodeReportCursor({
                          weekStart: last.weekStart,
                          internalId: last.internalId,
                      })
                    : null,
            hasMore,
            total,
        };
    }

    /** A-7 — `GET /api/v1/reports/:id`. */
    async getById(input: {
        id: string;
        workspaceId: string;
        userId: string;
        role: Role;
    }): Promise<WireDepartmentReport> {
        const row = await this.reports.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!row) {
            throw AppError.notFound(
                "report.not_found",
                `Report ${input.id} does not exist`,
            );
        }
        // Same compose as `list` — the admin fast-path needs the grant; the
        // snapshot-head / current-head branches are feature logic, untouched.
        const adminSeesAll =
            this.isAdmin(await liveLegacyRole(input.role) as Role) &&
            holds(await currentActor(), "report.view");
        if (!adminSeesAll) {
            const snapshotHead = row.headUserId === input.userId;
            let currentHead = false;
            if (!snapshotHead) {
                const space = await this.spaces.findByIdInWorkspace(
                    row.spaceId,
                    input.workspaceId,
                );
                currentHead =
                    !!space && space.headUserId === input.userId;
            }
            if (!snapshotHead && !currentHead) {
                throw AppError.forbidden(
                    "report.forbidden",
                    "Only owners/admins and the department's head may read its reports",
                );
            }
        }
        const heads = await this.hydrateHeads([row], input.workspaceId);
        return toWireReport(
            row,
            row.headUserId ? (heads.get(row.headUserId) ?? null) : null,
        );
    }

    private async hydrateHeads(rows: DeptReportRecord[], workspaceId: string) {
        const ids = [
            ...new Set(
                rows.flatMap((r) => (r.headUserId ? [r.headUserId] : [])),
            ),
        ];
        const users = ids.length
            ? await this.users.findManyByIdsInWorkspace(ids, workspaceId)
            : [];
        return new Map(users.map((u) => [u.id, u]));
    }

    private async wireOne(
        row: DeptReportRecord,
        workspaceId: string,
    ): Promise<WireDepartmentReport> {
        const heads = await this.hydrateHeads([row], workspaceId);
        return toWireReport(
            row,
            row.headUserId ? (heads.get(row.headUserId) ?? null) : null,
        );
    }

    /**
     * A-8 — on-demand (re)generate. Gate: owner/admin or the space's CURRENT
     * head; archived spaces refuse (409 — the weekly job skips them too).
     * `week_start` defaults to the last completed Dhaka week; when supplied
     * it must be a PAST Dhaka Monday (422 `report.invalid_week` — anything
     * else would plant bogus rows beside the real Monday rows under the
     * unique key). Shares `generateFor`, so the notification claim semantics
     * are identical to the job's.
     */
    async generateOnDemand(input: {
        spaceId: string;
        workspaceId: string;
        userId: string;
        role: Role;
        weekStart?: string;
    }): Promise<WireDepartmentReport> {
        const space = await this.spaces.findByIdInWorkspace(
            input.spaceId,
            input.workspaceId,
        );
        if (!space) {
            throw AppError.notFound(
                "space.not_found",
                `Space ${input.spaceId} does not exist`,
            );
        }
        if (space.archivedAt) {
            throw AppError.conflict(
                "space.archived",
                "This space is archived; reports need a live department",
            );
        }
        if (
            !this.isAdmin(await liveLegacyRole(input.role) as Role) &&
            space.headUserId !== input.userId
        ) {
            throw AppError.forbidden(
                "report.forbidden",
                "Only owners/admins and the department's head may generate its report",
            );
        }

        const currentMonday = dhakaWeekOf(new Date()).weekStart;
        const weekStart =
            input.weekStart ?? previousWeekStart(currentMonday);
        if (input.weekStart) {
            if (
                !isDhakaMonday(input.weekStart) ||
                !(input.weekStart < currentMonday)
            ) {
                throw AppError.unprocessable(
                    "report.invalid_week",
                    "week_start must be a past Dhaka Monday",
                    [
                        {
                            field: "week_start",
                            issue: "must be a Monday strictly before the current week",
                        },
                    ],
                );
            }
        }

        const { report } = await this.generateFor({
            space: {
                id: space.id,
                workspaceId: input.workspaceId,
                name: space.name,
                headUserId: space.headUserId,
            },
            weekStart,
            actorId: input.userId,
        });
        return this.wireOne(report, input.workspaceId);
    }

    /**
     * A-9 — the head's note. SNAPSHOT-head only (it is the report head's
     * personal commentary — even admins may not write it); `null` clears.
     * Survives regeneration by the §2.5 upsert invariant.
     */
    async setHeadNote(input: {
        id: string;
        workspaceId: string;
        userId: string;
        headNote: string | null;
    }): Promise<WireDepartmentReport> {
        const row = await this.reports.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!row) {
            throw AppError.notFound(
                "report.not_found",
                `Report ${input.id} does not exist`,
            );
        }
        if (row.headUserId !== input.userId) {
            throw AppError.forbidden(
                "report.forbidden",
                "Only this report's department head may attach a note",
            );
        }
        await this.reports.setHeadNote(row.id, input.headNote);
        const updated = await this.reports.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        return this.wireOne(updated ?? row, input.workspaceId);
    }

    /**
     * A-10 — HR "Mark seen". Role gate (👑) sits on the route; the write is
     * FIRST-ack-wins and the endpoint is idempotent-200 (a repeat ack returns
     * the original actor/timestamp; there is deliberately NO
     * `report.already_acknowledged` error).
     */
    async acknowledge(input: {
        id: string;
        workspaceId: string;
        userId: string;
    }): Promise<WireDepartmentReport> {
        const row = await this.reports.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        if (!row) {
            throw AppError.notFound(
                "report.not_found",
                `Report ${input.id} does not exist`,
            );
        }
        await this.reports.acknowledgeIfFirst(
            row.id,
            input.userId,
            new Date(),
        );
        const updated = await this.reports.findByIdInWorkspace(
            input.id,
            input.workspaceId,
        );
        return this.wireOne(updated ?? row, input.workspaceId);
    }
}
