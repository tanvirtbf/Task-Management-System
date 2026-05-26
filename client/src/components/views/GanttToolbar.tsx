import { Button, Input } from "antd";
import {
    ChevronLeft,
    ChevronRight,
    Search,
    UserCheck,
    Eye,
    EyeOff,
    Zap,
    Diamond,
} from "lucide-react";
import { tokens } from "../../theme";

export type GanttZoom = "day" | "week" | "month";

interface GanttToolbarProps {
    zoom: GanttZoom;
    onZoomChange: (z: GanttZoom) => void;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    rangeLabel: string;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
    showCriticalPath: boolean;
    onShowCriticalPathChange: (v: boolean) => void;
    showMilestones: boolean;
    onShowMilestonesChange: (v: boolean) => void;
}

export const GanttToolbar = ({
    zoom,
    onZoomChange,
    onPrev,
    onNext,
    onToday,
    rangeLabel,
    search,
    onSearchChange,
    meMode,
    onMeModeChange,
    showClosedTasks,
    onShowClosedChange,
    showCriticalPath,
    onShowCriticalPathChange,
    showMilestones,
    onShowMilestonesChange,
}: GanttToolbarProps) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: `${tokens.spacing[3]}px ${tokens.spacing[6]}px`,
            background: tokens.colors.bgSurface,
            borderBottom: `1px solid ${tokens.colors.border}`,
            flexWrap: "wrap",
        }}
    >
        <Button size="small" onClick={onToday}>
            Today
        </Button>
        <div
            style={{
                display: "inline-flex",
                background: tokens.colors.bgMuted,
                borderRadius: tokens.radius.md,
                padding: 2,
            }}
        >
            <button onClick={onPrev} style={navBtnStyle} title="Previous">
                <ChevronLeft size={14} strokeWidth={2} />
            </button>
            <button onClick={onNext} style={navBtnStyle} title="Next">
                <ChevronRight size={14} strokeWidth={2} />
            </button>
        </div>
        <span
            style={{
                fontSize: tokens.typography.fontSize.base,
                fontWeight: 600,
                color: tokens.colors.textPrimary,
                marginLeft: 4,
                minWidth: 180,
            }}
        >
            {rangeLabel}
        </span>

        <div
            style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
            }}
        >
            <Button
                type={showCriticalPath ? "primary" : "text"}
                size="small"
                icon={<Zap size={13} strokeWidth={1.75} />}
                onClick={() => onShowCriticalPathChange(!showCriticalPath)}
                title="Highlight tasks on the critical path"
            >
                Critical path
            </Button>

            <Button
                type="text"
                size="small"
                icon={<Diamond size={13} strokeWidth={1.75} />}
                onClick={() => onShowMilestonesChange(!showMilestones)}
                style={{
                    opacity: showMilestones ? 1 : 0.5,
                }}
            >
                Milestones
            </Button>

            {/* Zoom toggle */}
            <div
                style={{
                    display: "inline-flex",
                    background: tokens.colors.bgMuted,
                    borderRadius: tokens.radius.md,
                    padding: 2,
                }}
            >
                {(["day", "week", "month"] as GanttZoom[]).map((z) => (
                    <button
                        key={z}
                        onClick={() => onZoomChange(z)}
                        style={zoomBtnStyle(zoom === z)}
                    >
                        {z === "day" ? "Day" : z === "week" ? "Week" : "Month"}
                    </button>
                ))}
            </div>

            <Button
                type="text"
                size="small"
                icon={
                    showClosedTasks ? (
                        <Eye size={13} strokeWidth={1.75} />
                    ) : (
                        <EyeOff size={13} strokeWidth={1.75} />
                    )
                }
                onClick={() => onShowClosedChange(!showClosedTasks)}
            >
                {showClosedTasks ? "Hide closed" : "Show closed"}
            </Button>

            <Button
                type={meMode ? "primary" : "text"}
                size="small"
                icon={<UserCheck size={13} strokeWidth={1.75} />}
                onClick={() => onMeModeChange(!meMode)}
            >
                Me Mode
            </Button>

            <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search..."
                prefix={
                    <Search
                        size={13}
                        strokeWidth={1.75}
                        color={tokens.colors.textMuted}
                    />
                }
                size="small"
                style={{ width: 200 }}
                allowClear
            />
        </div>
    </div>
);

const navBtnStyle: React.CSSProperties = {
    padding: "4px 6px",
    background: "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    color: tokens.colors.textSecondary,
    display: "inline-flex",
    alignItems: "center",
};

const zoomBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    background: active ? tokens.colors.bgSurface : "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: active ? 600 : 500,
    color: active ? tokens.colors.textPrimary : tokens.colors.textSecondary,
    boxShadow: active ? tokens.shadows.sm : "none",
    transition: "all var(--transition-base)",
});
