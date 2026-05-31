/**
 * §25 Home / KPIs types.
 *
 * The KPI payload is emitted in **camelCase** to match the frontend's
 * `HomeKpiSet` (client/src/types/index.ts) — the authoritative `25-home-kpis.md`
 * checklist explicitly requires this ("Names must match the frontend's
 * HomeKpiSet type exactly (camelCase)"). This is a deliberate per-endpoint
 * exception to the project's snake_case wire convention: the dashboard payload
 * is consumed directly by the frontend's typed `HomeKpiSet`. (API_DESIGN.md's
 * §25 snake_case inline example and its stale ecom Appendix-A `HomeKpiSet` are
 * both disregarded as the contract source.) The §25 `agenda` endpoint, by
 * contrast, returns standard snake_case `Task[]`.
 */

export type TrendDirection = "up" | "down" | "flat";

/** One KPI tile. */
export interface HomeKpi {
    label: string;
    value: number;
    valueDisplay: string;
    /** Percent change vs the prior period. V1 has no trend computation → 0. */
    trend: number;
    trendDirection: TrendDirection;
    /** Whether an "up" trend is good. V1 fixed false (neutral, trend is 0). */
    isPositive: boolean;
    /** 7 daily counts, oldest → today. */
    sparkline: number[];
}

/** The six home-page KPI tiles (camelCase keys, matching the frontend). */
export interface HomeKpiSet {
    myTasks: HomeKpi;
    dueToday: HomeKpi;
    overdue: HomeKpi;
    awaitingReview: HomeKpi;
    openTeamTasks: HomeKpi;
    slaBreaches: HomeKpi;
}
