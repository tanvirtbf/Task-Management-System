import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { mockApi } from "../../lib/mock-api";
import { tokens } from "../../theme";
import { KpiCard } from "./KpiCard";

export const KpiRow = () => {
    const { data, isLoading } = useQuery({
        queryKey: ["home", "kpis"],
        queryFn: () => mockApi.home.kpis(),
    });

    if (isLoading || !data) {
        return (
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: tokens.spacing[4],
                }}
            >
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                        key={i}
                        style={{
                            background: tokens.colors.bgSurface,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.lg,
                            padding: tokens.spacing[5],
                        }}
                    >
                        <Skeleton active paragraph={{ rows: 2 }} />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: tokens.spacing[4],
            }}
        >
            <KpiCard kpi={data.todayOrders} color={tokens.colors.primary} />
            <KpiCard kpi={data.codCollected} color={tokens.colors.success} />
            <KpiCard kpi={data.openComplaints} color={tokens.colors.danger} />
            <KpiCard kpi={data.stuckOrders} color={tokens.colors.warning} />
            <KpiCard kpi={data.lowStock} color={tokens.colors.warning} />
            <KpiCard kpi={data.myTasks} color={tokens.colors.primary} />
        </div>
    );
};
