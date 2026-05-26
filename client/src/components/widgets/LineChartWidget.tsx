import { LineChart } from "../charts/LineChart";
import { timeSeries } from "./widget-data";
import { tokens } from "../../theme";
import type { DashboardWidget } from "../../types/dashboard";

interface Props {
    widget: DashboardWidget;
}

export const LineChartWidget = ({ widget }: Props) => {
    const data = timeSeries(widget.config);
    return (
        <LineChart
            data={data}
            color={widget.config.chartColor ?? tokens.colors.primary}
            area
        />
    );
};
