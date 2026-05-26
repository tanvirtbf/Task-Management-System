/**
 * Phase 9 — Dashboard + widget types.
 */

export type WidgetType =
    | "kpi"
    | "bar_chart"
    | "donut_chart"
    | "line_chart"
    | "task_list"
    | "workload"
    | "activity_feed"
    | "text"
    | "status_breakdown"
    | "calendar_heatmap";

export type WidgetMetric =
    | "task_count"
    | "task_count_completed"
    | "task_count_overdue"
    | "task_count_due_today"
    | "task_count_due_this_week"
    | "comment_count"
    | "form_submission_count"
    | "automation_run_count"
    | "time_tracked";

export type WidgetGroupBy =
    | "status"
    | "priority"
    | "assignee"
    | "tag"
    | "list"
    | "task_type"
    | "due_date"
    | "created_date";

export type WidgetScope =
    | { type: "workspace" }
    | { type: "space"; id: string }
    | { type: "list"; id: string };

export interface DashboardWidget {
    id: string;
    type: WidgetType;
    title: string;
    /** Column span on a 12-col grid (1..12) */
    colSpan: number;
    /** Row height multiplier (1..3) — controls minHeight */
    rowSpan: number;
    /** Widget-specific configuration */
    config: WidgetConfig;
}

export interface WidgetConfig {
    /** What to count/aggregate */
    metric?: WidgetMetric;
    /** How to group results */
    groupBy?: WidgetGroupBy;
    /** Filter scope — workspace/space/list */
    scope?: WidgetScope;
    /** Additional filters */
    filters?: {
        statusIds?: string[];
        priorityIn?: number[];
        assigneeIds?: string[];
        listIds?: string[];
        tagIds?: string[];
    };
    /** Time window — for line charts and KPI trends */
    timeRange?: "today" | "7d" | "30d" | "90d" | "all";
    /** Chart-specific */
    chartColor?: string;
    showLegend?: boolean;
    /** KPI-specific */
    kpiCompareTo?: "prev_period";
    kpiPrefix?: string;
    kpiSuffix?: string;
    /** Text widget */
    bodyMarkdown?: string;
    /** Task list — max rows */
    limit?: number;
    /** Sort order for task list */
    sortBy?: "priority" | "due_date" | "updated_at" | "created_at";
}

export interface Dashboard {
    id: string;
    workspaceId: string;
    name: string;
    icon: string; // Lucide icon name
    color: string;
    description?: string;
    widgets: DashboardWidget[];
    scope: WidgetScope;
    sharing: "private" | "members" | "admins";
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    /** Pin to top of dashboards list */
    isFavorite?: boolean;
}
