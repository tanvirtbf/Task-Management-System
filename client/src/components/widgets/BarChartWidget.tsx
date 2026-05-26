import { BarChart } from "../charts/BarChart";
import { groupTasks } from "./widget-data";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const BarChartWidget = ({ widget }: Props) => {
    const data = groupTasks(widget.config);
    return (
        <BarChart
            data={data}
            orientation="horizontal"
            color={widget.config.chartColor}
        />
    );
};
