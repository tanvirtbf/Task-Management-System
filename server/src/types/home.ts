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
/**
 * F24 (ISS-057): a KPI is a LABEL AND A NUMBER, and nothing else.
 *
 * It used to carry `trend`/`trendDirection`/`isPositive` — hardcoded to
 * `0 / "flat" / false` with the comment "V1 computes no trend (mock parity)"
 * — which the client rendered as a permanent "— 0.0%" badge that reads as a
 * MEASURED "no change since last period". And `sparkline`, which bucketed the
 * currently-matching tasks by `DATE(created_at)`: a creation-date histogram,
 * not a time series of the metric, so "Open Team Tasks 31" sat above a line
 * summing to 4.
 *
 * The six NUMBERS were always right (P19 recomputed all six by hand in SQL for
 * four accounts). Removing the two fabricated signals around them is the whole
 * fix; a real trend needs task status HISTORY, which is not stored, and that is
 * a feature (F28's backlog), not something to fake in the meantime.
 */
export interface HomeKpi {
    label: string;
    value: number;
    valueDisplay: string;
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
