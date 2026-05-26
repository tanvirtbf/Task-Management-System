import { Modal } from "antd";
import {
    Activity,
    BarChart3,
    PieChart,
    TrendingUp,
    ListTodo,
    Users,
    History,
    Type,
    LayoutGrid,
    CalendarRange,
} from "lucide-react";
import type { WidgetType, DashboardWidget } from "../../types/dashboard";
import { tokens } from "../../theme";

interface Props {
    onPick: (widget: Omit<DashboardWidget, "id">) => void;
    onClose: () => void;
}

interface WidgetTemplate {
    type: WidgetType;
    title: string;
    description: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    color: string;
    colSpan: number;
    rowSpan: number;
    defaultConfig: DashboardWidget["config"];
}

const WIDGET_TEMPLATES: WidgetTemplate[] = [
    {
        type: "kpi",
        title: "KPI card",
        description: "Single metric with sparkline + trend.",
        icon: Activity,
        color: "#4F46E5",
        colSpan: 3,
        rowSpan: 1,
        defaultConfig: {
            metric: "task_count",
            scope: { type: "workspace" },
            kpiCompareTo: "prev_period",
            chartColor: "#4F46E5",
        },
    },
    {
        type: "bar_chart",
        title: "Bar chart",
        description: "Group tasks by status, assignee, priority, etc.",
        icon: BarChart3,
        color: "#10B981",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: {
            metric: "task_count",
            groupBy: "status",
            scope: { type: "workspace" },
            chartColor: "#4F46E5",
        },
    },
    {
        type: "donut_chart",
        title: "Donut chart",
        description: "Distribution as a donut with legend.",
        icon: PieChart,
        color: "#8B5CF6",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: {
            metric: "task_count",
            groupBy: "priority",
            scope: { type: "workspace" },
            showLegend: true,
        },
    },
    {
        type: "line_chart",
        title: "Line chart",
        description: "Time series — completed/created per day.",
        icon: TrendingUp,
        color: "#06B6D4",
        colSpan: 8,
        rowSpan: 2,
        defaultConfig: {
            metric: "task_count_completed",
            scope: { type: "workspace" },
            timeRange: "30d",
            chartColor: "#4F46E5",
        },
    },
    {
        type: "task_list",
        title: "Task list",
        description: "Filtered task list with sort.",
        icon: ListTodo,
        color: "#F59E0B",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: {
            scope: { type: "workspace" },
            limit: 8,
            sortBy: "priority",
        },
    },
    {
        type: "workload",
        title: "Workload",
        description: "Open task counts per assignee.",
        icon: Users,
        color: "#E11D48",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: { scope: { type: "workspace" }, limit: 8 },
    },
    {
        type: "activity_feed",
        title: "Activity feed",
        description: "Latest events on tasks.",
        icon: History,
        color: "#64748B",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: { scope: { type: "workspace" }, limit: 10 },
    },
    {
        type: "status_breakdown",
        title: "Status breakdown",
        description: "Stacked bar with status group percentages.",
        icon: LayoutGrid,
        color: "#10B981",
        colSpan: 6,
        rowSpan: 2,
        defaultConfig: { scope: { type: "workspace" } },
    },
    {
        type: "calendar_heatmap",
        title: "Activity heatmap",
        description: "Daily activity grid (GitHub-style).",
        icon: CalendarRange,
        color: "#8B5CF6",
        colSpan: 12,
        rowSpan: 2,
        defaultConfig: {
            scope: { type: "workspace" },
            timeRange: "90d",
            chartColor: "#8B5CF6",
        },
    },
    {
        type: "text",
        title: "Text / Markdown",
        description: "Rich text block for notes and context.",
        icon: Type,
        color: "#94A3B8",
        colSpan: 12,
        rowSpan: 1,
        defaultConfig: {
            bodyMarkdown: "## New text block\n\nEdit this widget to add notes.",
        },
    },
];

export const WidgetPicker = ({ onPick, onClose }: Props) => {
    return (
        <Modal
            open
            onCancel={onClose}
            footer={null}
            width={760}
            title={null}
        >
            <div style={{ padding: "8px 0 16px" }}>
                <h3
                    style={{
                        margin: 0,
                        fontSize: tokens.typography.fontSize.lg,
                        fontWeight: 700,
                        color: tokens.colors.textPrimary,
                    }}
                >
                    Add a widget
                </h3>
                <p
                    style={{
                        margin: 0,
                        marginTop: 2,
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textMuted,
                    }}
                >
                    Pick a widget type — you can edit its config after adding.
                </p>
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                }}
            >
                {WIDGET_TEMPLATES.map((tpl) => {
                    const Icon = tpl.icon;
                    return (
                        <button
                            key={tpl.type}
                            onClick={() =>
                                onPick({
                                    type: tpl.type,
                                    title: tpl.title,
                                    colSpan: tpl.colSpan,
                                    rowSpan: tpl.rowSpan,
                                    config: tpl.defaultConfig,
                                })
                            }
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 10,
                                padding: 12,
                                background: tokens.colors.bgSurface,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.md,
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "all var(--transition-fast)",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = tpl.color;
                                e.currentTarget.style.background = `${tpl.color}08`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor =
                                    tokens.colors.border;
                                e.currentTarget.style.background =
                                    tokens.colors.bgSurface;
                            }}
                        >
                            <span
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: tokens.radius.md,
                                    background: `${tpl.color}1A`,
                                    color: tpl.color,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}
                            >
                                <Icon size={18} strokeWidth={1.75} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                    style={{
                                        fontSize:
                                            tokens.typography.fontSize.sm,
                                        fontWeight: 600,
                                        color: tokens.colors.textPrimary,
                                    }}
                                >
                                    {tpl.title}
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: tokens.colors.textMuted,
                                        marginTop: 2,
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {tpl.description}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
};
