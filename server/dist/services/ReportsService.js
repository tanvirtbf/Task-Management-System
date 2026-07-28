"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const errors_1 = require("../errors");
const dhakaTime_1 = require("../utils/dhakaTime");
const reportSerializer_1 = require("../serializers/reportSerializer");
const constants_1 = require("../constants");
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
const clampLimit = (raw) => {
    if (raw === undefined || !Number.isFinite(raw))
        return LIST_DEFAULT_LIMIT;
    return Math.min(Math.max(Math.trunc(raw), 1), LIST_MAX_LIMIT);
};
// Composite keyset cursor — (week_start, internal_id), a VARIANT of the
// repo's simple internal_id codecs (different shape, so it stays local).
const encodeReportCursor = (key) => Buffer.from(`${key.weekStart}|${key.internalId.toString()}`, "utf8").toString("base64url");
const decodeReportCursor = (cursor) => {
    const fail = () => {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "Malformed pagination cursor");
    };
    if (!/^[A-Za-z0-9_-]+$/.test(cursor))
        fail();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const [weekStart, internalId, extra] = decoded.split("|");
    if (extra !== undefined)
        fail();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? ""))
        fail();
    if (!/^\d+$/.test(internalId ?? ""))
        fail();
    return { weekStart, internalId: BigInt(internalId) };
};
/** Notification title, capped well under the 300-char column. */
const reportTitle = (spaceName, weekStart, weekEnd) => `Weekly report ready: ${spaceName} (${weekStart} – ${weekEnd})`.slice(0, 300);
class ReportsService {
    db;
    reports;
    spaces;
    users;
    stats;
    notifications;
    logger;
    constructor(db, reports, spaces, users, stats, notifications, logger) {
        this.db = db;
        this.reports = reports;
        this.spaces = spaces;
        this.users = users;
        this.stats = stats;
        this.notifications = notifications;
        this.logger = logger;
    }
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
    async generateFor(input) {
        const weekEnd = (0, dhakaTime_1.addDaysYmd)(input.weekStart, 6);
        const prevRow = await this.reports.findBySpaceWeek(input.space.id, (0, dhakaTime_1.previousWeekStart)(input.weekStart));
        const prevPayload = (prevRow?.payload ?? null);
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
            today: (0, dhakaTime_1.dhakaToday)(),
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
            const claimed = await this.reports.claimNotification(input.space.id, input.weekStart, now, tx);
            if (!claimed)
                return;
            notified = true;
            const adminIds = await this.users.findActiveAdminIds(input.space.workspaceId);
            const recipients = [
                ...new Set([
                    ...adminIds,
                    ...(input.space.headUserId
                        ? [input.space.headUserId]
                        : []),
                ]),
            ];
            await this.notifications.createMany(recipients.map((userId) => ({
                userId,
                type: "report_ready",
                entityType: "report",
                entityId: report.id,
                actorId: input.actorId,
                title: reportTitle(input.space.name, input.weekStart, weekEnd),
                body: `Completed ${payload.totals.completed} · flagged ${payload.totals.flagged} · overdue ${payload.totals.overdue_now}`,
            })), tx);
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
    async headedSpaceIds(workspaceId, userId) {
        const rows = await this.spaces.listByWorkspace(workspaceId, {
            includeArchived: true,
        });
        return rows
            .filter((s) => s.headUserId === userId)
            .map((s) => s.id);
    }
    isAdmin(role) {
        return role === constants_1.Roles.OWNER || role === constants_1.Roles.ADMIN;
    }
    /** A-6 — `GET /api/v1/reports`. */
    async list(input) {
        const limit = clampLimit(input.limit);
        const afterKey = input.cursor
            ? decodeReportCursor(input.cursor)
            : undefined;
        const headVisibility = this.isAdmin(input.role)
            ? undefined
            : {
                userId: input.userId,
                headedSpaceIds: await this.headedSpaceIds(input.workspaceId, input.userId),
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
            data: page.map((r) => (0, reportSerializer_1.toWireReportListItem)(r, r.headUserId ? (heads.get(r.headUserId) ?? null) : null)),
            nextCursor: hasMore && last
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
    async getById(input) {
        const row = await this.reports.findByIdInWorkspace(input.id, input.workspaceId);
        if (!row) {
            throw errors_1.AppError.notFound("report.not_found", `Report ${input.id} does not exist`);
        }
        if (!this.isAdmin(input.role)) {
            const snapshotHead = row.headUserId === input.userId;
            let currentHead = false;
            if (!snapshotHead) {
                const space = await this.spaces.findByIdInWorkspace(row.spaceId, input.workspaceId);
                currentHead =
                    !!space && space.headUserId === input.userId;
            }
            if (!snapshotHead && !currentHead) {
                throw errors_1.AppError.forbidden("report.forbidden", "Only owners/admins and the department's head may read its reports");
            }
        }
        const heads = await this.hydrateHeads([row], input.workspaceId);
        return (0, reportSerializer_1.toWireReport)(row, row.headUserId ? (heads.get(row.headUserId) ?? null) : null);
    }
    async hydrateHeads(rows, workspaceId) {
        const ids = [
            ...new Set(rows.flatMap((r) => (r.headUserId ? [r.headUserId] : []))),
        ];
        const users = ids.length
            ? await this.users.findManyByIdsInWorkspace(ids, workspaceId)
            : [];
        return new Map(users.map((u) => [u.id, u]));
    }
    async wireOne(row, workspaceId) {
        const heads = await this.hydrateHeads([row], workspaceId);
        return (0, reportSerializer_1.toWireReport)(row, row.headUserId ? (heads.get(row.headUserId) ?? null) : null);
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
    async generateOnDemand(input) {
        const space = await this.spaces.findByIdInWorkspace(input.spaceId, input.workspaceId);
        if (!space) {
            throw errors_1.AppError.notFound("space.not_found", `Space ${input.spaceId} does not exist`);
        }
        if (space.archivedAt) {
            throw errors_1.AppError.conflict("space.archived", "This space is archived; reports need a live department");
        }
        if (!this.isAdmin(input.role) &&
            space.headUserId !== input.userId) {
            throw errors_1.AppError.forbidden("report.forbidden", "Only owners/admins and the department's head may generate its report");
        }
        const currentMonday = (0, dhakaTime_1.dhakaWeekOf)(new Date()).weekStart;
        const weekStart = input.weekStart ?? (0, dhakaTime_1.previousWeekStart)(currentMonday);
        if (input.weekStart) {
            if (!(0, dhakaTime_1.isDhakaMonday)(input.weekStart) ||
                !(input.weekStart < currentMonday)) {
                throw errors_1.AppError.unprocessable("report.invalid_week", "week_start must be a past Dhaka Monday", [
                    {
                        field: "week_start",
                        issue: "must be a Monday strictly before the current week",
                    },
                ]);
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
    async setHeadNote(input) {
        const row = await this.reports.findByIdInWorkspace(input.id, input.workspaceId);
        if (!row) {
            throw errors_1.AppError.notFound("report.not_found", `Report ${input.id} does not exist`);
        }
        if (row.headUserId !== input.userId) {
            throw errors_1.AppError.forbidden("report.forbidden", "Only this report's department head may attach a note");
        }
        await this.reports.setHeadNote(row.id, input.headNote);
        const updated = await this.reports.findByIdInWorkspace(input.id, input.workspaceId);
        return this.wireOne(updated ?? row, input.workspaceId);
    }
    /**
     * A-10 — HR "Mark seen". Role gate (👑) sits on the route; the write is
     * FIRST-ack-wins and the endpoint is idempotent-200 (a repeat ack returns
     * the original actor/timestamp; there is deliberately NO
     * `report.already_acknowledged` error).
     */
    async acknowledge(input) {
        const row = await this.reports.findByIdInWorkspace(input.id, input.workspaceId);
        if (!row) {
            throw errors_1.AppError.notFound("report.not_found", `Report ${input.id} does not exist`);
        }
        await this.reports.acknowledgeIfFirst(row.id, input.userId, new Date());
        const updated = await this.reports.findByIdInWorkspace(input.id, input.workspaceId);
        return this.wireOne(updated ?? row, input.workspaceId);
    }
}
exports.ReportsService = ReportsService;
