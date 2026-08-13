"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeService = void 0;
const constants_1 = require("../constants");
const taskSerializer_1 = require("../serializers/taskSerializer");
const dhakaTime_1 = require("../utils/dhakaTime");
/**
 * §25 Home business logic. Computes the 6 KPI tiles (camelCase `HomeKpiSet`) and
 * the daily agenda. Read-only, no transactions.
 *
 * Caching: 25-home-kpis.md asks for a 30s/user cache, but the project's cache
 * layer (Redis) is not built (only an in-memory rate-limiter exists), so V1
 * computes fresh on every call — the queries are bounded, indexed COUNTs (6 of
 * them, run in parallel). Add a read-through cache here when Redis lands.
 *
 * F24 (ISS-057): the tiles carry a label and a number only. The trend badge was
 * hardcoded and the sparkline plotted `DATE(created_at)` rather than the
 * metric, so both were removed rather than left to mislead. The day-bucket
 * queries remain because `value` is their SUM (the folding is unchanged); a
 * real series needs task status history, which is not stored.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const SPARKLINE_DAYS = 7;
// "Today" (and the 7 sparkline day-keys) run on the WORKSPACE's calendar —
// `workspaces.timezone`, resolved per call — not the API box's OS zone. F5
// (ISS-058): before this, the timezone setting was stored, validated and
// returned but read by nothing; the process TZ silently decided every date
// boundary. Fallback for a null/garbage zone is the Dhaka business default.
/** Fixed trend metadata — V1 computes no trend (mock parity: 0 / flat / false). */
const buildKpi = (label, value) => ({
    label,
    value,
    valueDisplay: String(value),
});
class HomeService {
    homeRepo;
    tasksRepo;
    workspaceRepo;
    constructor(homeRepo, tasksRepo, workspaceRepo) {
        this.homeRepo = homeRepo;
        this.tasksRepo = tasksRepo;
        this.workspaceRepo = workspaceRepo;
    }
    /** The workspace's IANA zone, with the Dhaka business default as fallback. */
    async zoneOf(workspaceId) {
        const ws = await this.workspaceRepo.findById(workspaceId);
        return ws?.timezone ?? "Asia/Dhaka";
    }
    /**
     * The 6 home KPI tiles for the caller. `myTasks`/`dueToday`/`overdue` are
     * user-scoped (assignee = caller); `openTeamTasks`/`slaBreaches` are
     * workspace-wide; `awaitingReview` is the caller's open review queue.
     */
    async kpis(workspaceId, userId) {
        const zone = await this.zoneOf(workspaceId);
        const now = new Date();
        const days = [];
        for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
            days.push((0, dhakaTime_1.zoneDateOf)(new Date(now.getTime() - i * DAY_MS), zone));
        }
        const today = days[days.length - 1];
        const [myRows, dueRows, overdueRows, reviewRows, teamRows, slaRows,] = await Promise.all([
            this.homeRepo.myOpenSeries(workspaceId, userId),
            this.homeRepo.dueTodaySeries(workspaceId, userId, today),
            this.homeRepo.overdueSeries(workspaceId, userId, today),
            this.homeRepo.awaitingReviewSeries(workspaceId, userId),
            this.homeRepo.openTeamSeries(workspaceId),
            this.homeRepo.slaBreachesSeries(workspaceId, now),
        ]);
        const fold = (rows) => {
            const byDay = new Map(rows.map((r) => [r.day, Number(r.cnt)]));
            const sparkline = days.map((d) => byDay.get(d) ?? 0);
            const value = rows.reduce((sum, r) => sum + Number(r.cnt), 0);
            return { value, sparkline };
        };
        const my = fold(myRows);
        const due = fold(dueRows);
        const over = fold(overdueRows);
        const review = fold(reviewRows);
        const team = fold(teamRows);
        const sla = fold(slaRows);
        return {
            myTasks: buildKpi("My Open Tasks", my.value),
            dueToday: buildKpi("Due Today", due.value),
            overdue: buildKpi("Overdue", over.value),
            awaitingReview: buildKpi("Awaiting My Review", review.value),
            openTeamTasks: buildKpi("Open Team Tasks", team.value),
            slaBreaches: buildKpi("SLA Breaches", sla.value),
        };
    }
    /**
     * The caller's open tasks due on `date` (default today), as full wire
     * `Task[]` (hydrated like a normal §10 read, guest custom-field redaction
     * applied). Bare array — no `{data,pagination}` envelope (per §25).
     */
    /**
     * The assistant's "my work" list (deep-plan P3) — WHICH tasks, not how
     * many. Thin on purpose: the repo query is already the whole answer, and
     * "today" must be the WORKSPACE's calendar day (the canonical clock), so
     * `overdue` here and the overdue tile can never disagree by a timezone.
     */
    async myTasks(input) {
        return this.homeRepo.myTasksByBucket({
            ...input,
            today: (0, dhakaTime_1.todayInZone)(await this.zoneOf(input.workspaceId)),
        });
    }
    async agenda(workspaceId, userId, role, date) {
        const targetDate = date ?? (0, dhakaTime_1.todayInZone)(await this.zoneOf(workspaceId));
        const rows = await this.homeRepo.agendaTasks(workspaceId, userId, targetDate);
        if (rows.length === 0)
            return [];
        const ids = rows.map((row) => row.id);
        const redactGuest = role === constants_1.Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] = await Promise.all([
            this.tasksRepo.assigneesByTask(ids),
            this.tasksRepo.watchersByTask(ids),
            this.tasksRepo.tagsByTask(ids),
            this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
        ]);
        return rows.map((row) => (0, taskSerializer_1.toWireTask)(row, {
            assignees: assignees.get(row.id) ?? [],
            watchers: watchers.get(row.id) ?? [],
            tags: tags.get(row.id) ?? [],
            customFieldValues: customFieldValues.get(row.id) ?? {},
        }));
    }
}
exports.HomeService = HomeService;
