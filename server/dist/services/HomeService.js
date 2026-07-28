"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeService = void 0;
const constants_1 = require("../constants");
const taskSerializer_1 = require("../serializers/taskSerializer");
/**
 * §25 Home business logic. Computes the 6 KPI tiles (camelCase `HomeKpiSet`) and
 * the daily agenda. Read-only, no transactions.
 *
 * Caching: 25-home-kpis.md asks for a 30s/user cache, but the project's cache
 * layer (Redis) is not built (only an in-memory rate-limiter exists), so V1
 * computes fresh on every call — the queries are bounded, indexed COUNTs (6 of
 * them, run in parallel). Add a read-through cache here when Redis lands.
 *
 * Sparklines: each KPI's filtered task set is bucketed by `DATE(created_at)`
 * over the trailing 7 days (the §25-blessed technique); `value` is the total
 * count of that set. A true point-in-time running-total series would need task
 * status history (not stored) — deferred to V2.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const SPARKLINE_DAYS = 7;
/** Local `YYYY-MM-DD` for a Date (matches the §10 myWork / serializer formatting). */
const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};
/** Fixed trend metadata — V1 computes no trend (mock parity: 0 / flat / false). */
const buildKpi = (label, value, sparkline) => ({
    label,
    value,
    valueDisplay: String(value),
    trend: 0,
    trendDirection: "flat",
    isPositive: false,
    sparkline,
});
class HomeService {
    homeRepo;
    tasksRepo;
    constructor(homeRepo, tasksRepo) {
        this.homeRepo = homeRepo;
        this.tasksRepo = tasksRepo;
    }
    /**
     * The 6 home KPI tiles for the caller. `myTasks`/`dueToday`/`overdue` are
     * user-scoped (assignee = caller); `openTeamTasks`/`slaBreaches` are
     * workspace-wide; `awaitingReview` is the caller's open review queue.
     */
    async kpis(workspaceId, userId) {
        const now = new Date();
        const days = [];
        for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
            days.push(ymd(new Date(now.getTime() - i * DAY_MS)));
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
            myTasks: buildKpi("My Open Tasks", my.value, my.sparkline),
            dueToday: buildKpi("Due Today", due.value, due.sparkline),
            overdue: buildKpi("Overdue", over.value, over.sparkline),
            awaitingReview: buildKpi("Awaiting My Review", review.value, review.sparkline),
            openTeamTasks: buildKpi("Open Team Tasks", team.value, team.sparkline),
            slaBreaches: buildKpi("SLA Breaches", sla.value, sla.sparkline),
        };
    }
    /**
     * The caller's open tasks due on `date` (default today), as full wire
     * `Task[]` (hydrated like a normal §10 read, guest custom-field redaction
     * applied). Bare array — no `{data,pagination}` envelope (per §25).
     */
    async agenda(workspaceId, userId, role, date) {
        const targetDate = date ?? ymd(new Date());
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
