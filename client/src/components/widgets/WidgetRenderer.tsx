import type { DashboardWidget } from "../../types/dashboard";
import { KpiWidget } from "./KpiWidget";
import { BarChartWidget } from "./BarChartWidget";
import { DonutChartWidget } from "./DonutChartWidget";
import { LineChartWidget } from "./LineChartWidget";
import { TaskListWidget } from "./TaskListWidget";
import { WorkloadWidget } from "./WorkloadWidget";
import { ActivityFeedWidget } from "./ActivityFeedWidget";
import { TextWidget } from "./TextWidget";
import { StatusBreakdownWidget } from "./StatusBreakdownWidget";
import { CalendarHeatmapWidget } from "./CalendarHeatmapWidget";

interface Props {
    widget: DashboardWidget;
}

export const WidgetRenderer = ({ widget }: Props) => {
    switch (widget.type) {
        case "kpi":
            return <KpiWidget widget={widget} />;
        case "bar_chart":
            return <BarChartWidget widget={widget} />;
        case "donut_chart":
            return <DonutChartWidget widget={widget} />;
        case "line_chart":
            return <LineChartWidget widget={widget} />;
        case "task_list":
            return <TaskListWidget widget={widget} />;
        case "workload":
            return <WorkloadWidget widget={widget} />;
        case "activity_feed":
            return <ActivityFeedWidget widget={widget} />;
        case "text":
            return <TextWidget widget={widget} />;
        case "status_breakdown":
            return <StatusBreakdownWidget widget={widget} />;
        case "calendar_heatmap":
            return <CalendarHeatmapWidget widget={widget} />;
        default:
            return null;
    }
};
