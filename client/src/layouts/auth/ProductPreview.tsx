import { tokens } from "../../theme";

/**
 * Decorative product mock-up shown on the auth brand panel.
 * Stylized abstract dashboard — not a real screenshot.
 * Pure CSS / no images, so it scales and themes cleanly.
 */
export const ProductPreview = () => (
    <div
        style={{
            position: "relative",
            transform: "perspective(1200px) rotateX(5deg) rotateY(-8deg)",
            transformOrigin: "center",
        }}
    >
        {/* Faux app window */}
        <div
            style={{
                background: tokens.colors.bgSurface,
                borderRadius: tokens.radius.lg,
                boxShadow:
                    "0 24px 48px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.10)",
                overflow: "hidden",
                color: tokens.colors.textPrimary,
            }}
        >
            {/* Title bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 14px",
                    borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                    background: tokens.colors.bgPage,
                }}
            >
                <Dot color="#EF4444" />
                <Dot color="#F59E0B" />
                <Dot color="#10B981" />
            </div>

            {/* App body */}
            <div style={{ display: "flex", height: 220 }}>
                {/* Sidebar */}
                <div
                    style={{
                        width: 56,
                        background: tokens.colors.bgSidebar,
                        borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                        padding: "12px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div
                            key={i}
                            style={{
                                width: 36,
                                height: 28,
                                borderRadius: 6,
                                background:
                                    i === 0
                                        ? tokens.colors.primarySubtle
                                        : "rgba(0,0,0,0.05)",
                            }}
                        />
                    ))}
                </div>

                {/* Content */}
                <div
                    style={{
                        flex: 1,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                    }}
                >
                    {/* KPI row */}
                    <div style={{ display: "flex", gap: 8 }}>
                        <KpiTile label="Orders" value="142" trend="+12%" />
                        <KpiTile label="COD" value="৳86k" trend="+8%" />
                        <KpiTile label="Returns" value="4.2%" trend="-1.4%" />
                    </div>

                    {/* Task rows */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        <TaskRow status="#3B82F6" />
                        <TaskRow status="#8B5CF6" />
                        <TaskRow status="#10B981" />
                        <TaskRow status="#F59E0B" />
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const Dot = ({ color }: { color: string }) => (
    <div
        style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color,
        }}
    />
);

const KpiTile = ({
    label,
    value,
    trend,
}: {
    label: string;
    value: string;
    trend: string;
}) => (
    <div
        style={{
            flex: 1,
            border: `1px solid ${tokens.colors.borderSubtle}`,
            borderRadius: 6,
            padding: "8px 10px",
        }}
    >
        <div style={{ fontSize: 9, color: tokens.colors.textMuted }}>{label}</div>
        <div
            style={{
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: 14,
                fontWeight: 600,
                color: tokens.colors.textPrimary,
                marginTop: 2,
            }}
        >
            {value}
        </div>
        <div
            style={{
                fontSize: 9,
                color: trend.startsWith("-")
                    ? tokens.colors.danger
                    : tokens.colors.success,
                marginTop: 1,
            }}
        >
            {trend}
        </div>
    </div>
);

const TaskRow = ({ status }: { status: string }) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 4,
            background: "#FAFAFB",
        }}
    >
        <div
            style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: status,
            }}
        />
        <div
            style={{
                flex: 1,
                height: 8,
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
            }}
        />
        <div
            style={{
                width: 36,
                height: 8,
                borderRadius: 3,
                background: "rgba(0,0,0,0.08)",
            }}
        />
    </div>
);
