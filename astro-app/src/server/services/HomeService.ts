import { Roles, type Role } from "../constants";
import { HomeRepo, type DayCount } from "../repositories/HomeRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { toWireTask, type WireTask } from "../serializers/taskSerializer";
import type { HomeKpi, HomeKpiSet } from "../types/home";

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
const ymd = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

/**
 * `YYYY-MM-DD` for `epochMs` in the given IANA timezone (P35-1). The deployed
 * worker's clock is UTC, so `ymd(new Date())` would shift "today" for Dhaka
 * users between 00:00–06:00; deriving it from the workspace tz fixes that.
 * Falls back to the server-local date if the tz string is invalid.
 */
const dateInTz = (epochMs: number, tz: string): string => {
    try {
        return new Date(epochMs).toLocaleDateString("en-CA", { timeZone: tz });
    } catch {
        return ymd(new Date(epochMs));
    }
};

/** Fixed trend metadata — V1 computes no trend (mock parity: 0 / flat / false). */
const buildKpi = (
    label: string,
    value: number,
    sparkline: number[],
): HomeKpi => ({
    label,
    value,
    valueDisplay: String(value),
    trend: 0,
    trendDirection: "flat",
    isPositive: false,
    sparkline,
});

export class HomeService {
    constructor(
        private homeRepo: HomeRepo,
        private tasksRepo: TasksRepo,
    ) {}

    /**
     * The 6 home KPI tiles for the caller. `myTasks`/`dueToday`/`overdue` are
     * user-scoped (assignee = caller); `openTeamTasks`/`slaBreaches` are
     * workspace-wide; `awaitingReview` is the caller's open review queue.
     */
    async kpis(workspaceId: string, userId: string): Promise<HomeKpiSet> {
        const now = new Date();
        const days: string[] = [];
        for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
            days.push(ymd(new Date(now.getTime() - i * DAY_MS)));
        }
        // "today" in the workspace timezone, not the UTC server clock (P35-1).
        const tz = await this.tasksRepo.workspaceTimezone(workspaceId);
        const today = dateInTz(Date.now(), tz);

        const [
            myRows,
            dueRows,
            overdueRows,
            reviewRows,
            teamRows,
            slaRows,
        ] = await Promise.all([
            this.homeRepo.myOpenSeries(workspaceId, userId),
            this.homeRepo.dueTodaySeries(workspaceId, userId, today),
            this.homeRepo.overdueSeries(workspaceId, userId, today),
            this.homeRepo.awaitingReviewSeries(workspaceId, userId),
            this.homeRepo.openTeamSeries(workspaceId),
            this.homeRepo.slaBreachesSeries(workspaceId, now),
        ]);

        const fold = (rows: DayCount[]): { value: number; sparkline: number[] } => {
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
            awaitingReview: buildKpi(
                "Awaiting My Review",
                review.value,
                review.sparkline,
            ),
            openTeamTasks: buildKpi(
                "Open Team Tasks",
                team.value,
                team.sparkline,
            ),
            slaBreaches: buildKpi("SLA Breaches", sla.value, sla.sparkline),
        };
    }

    /**
     * The caller's open tasks due on `date` (default today), as full wire
     * `Task[]` (hydrated like a normal §10 read, guest custom-field redaction
     * applied). Bare array — no `{data,pagination}` envelope (per §25).
     */
    async agenda(
        workspaceId: string,
        userId: string,
        role: Role,
        date?: string,
    ): Promise<WireTask[]> {
        const targetDate =
            date ??
            dateInTz(
                Date.now(),
                await this.tasksRepo.workspaceTimezone(workspaceId),
            );
        const rows = await this.homeRepo.agendaTasks(
            workspaceId,
            userId,
            targetDate,
        );
        if (rows.length === 0) return [];

        const ids = rows.map((row) => row.id);
        const redactGuest = role === Roles.GUEST;
        const [assignees, watchers, tags, customFieldValues] =
            await Promise.all([
                this.tasksRepo.assigneesByTask(ids),
                this.tasksRepo.watchersByTask(ids),
                this.tasksRepo.tagsByTask(ids),
                this.tasksRepo.customFieldValuesByTask(ids, redactGuest),
            ]);

        return rows.map((row) =>
            toWireTask(row, {
                assignees: assignees.get(row.id) ?? [],
                watchers: watchers.get(row.id) ?? [],
                tags: tags.get(row.id) ?? [],
                customFieldValues: customFieldValues.get(row.id) ?? {},
            }),
        );
    }
}
