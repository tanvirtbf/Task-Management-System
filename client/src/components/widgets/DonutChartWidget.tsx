import { DonutChart } from "../charts/DonutChart";
import { groupTasks } from "./widget-data";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const DonutChartWidget = ({ widget }: Props) => {
    const data = groupTasks(widget.config);
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
        <DonutChart
            data={data}
            showLegend={widget.config.showLegend ?? true}
            centerValue={total}
            centerLabel="Total"
        />
    );
};
