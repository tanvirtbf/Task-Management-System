import { Button, Dropdown, Input } from "antd";
import {
    Search,
    UserCheck,
    Eye,
    EyeOff,
    Rows3,
    LayoutGrid,
    Layers,
    ListFilter,
} from "lucide-react";
import { useBoardStore, type SubgroupBy } from "../../stores/board";
import { tokens } from "../../theme";

interface BoardToolbarProps {
    listId: string;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
}

const subgroupOptions = [
    { key: "none", label: "No swimlanes" },
    { key: "assignee", label: "Assignee" },
    { key: "priority", label: "Priority" },
];

export const BoardToolbar = ({
    listId,
    search,
    onSearchChange,
    meMode,
    onMeModeChange,
    showClosedTasks,
    onShowClosedChange,
}: BoardToolbarProps) => {
    const density =
        useBoardStore((s) => s.cardDensity[listId]) ?? "compact";
    const setDensity = useBoardStore((s) => s.setCardDensity);
    const subgroupBy =
        (useBoardStore((s) => s.subgroupBy[listId]) ?? "none") as SubgroupBy;
    const setSubgroupBy = useBoardStore((s) => s.setSubgroupBy);

    return (
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
            <Dropdown
                menu={{
                    items: subgroupOptions,
                    selectable: true,
                    selectedKeys: [subgroupBy],
                    onClick: (e) =>
                        setSubgroupBy(listId, e.key as SubgroupBy),
                }}
                trigger={["click"]}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<Layers size={13} strokeWidth={1.75} />}
                >
                    Swimlanes:{" "}
                    <span style={{ fontWeight: 500, marginLeft: 2 }}>
                        {subgroupOptions.find((o) => o.key === subgroupBy)
                            ?.label ?? "None"}
                    </span>
                </Button>
            </Dropdown>

            <Button
                type="text"
                size="small"
                icon={<ListFilter size={13} strokeWidth={1.75} />}
            >
                Filter
            </Button>

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

            <div
                style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                {/* Density toggle */}
                <div
                    style={{
                        display: "inline-flex",
                        background: tokens.colors.bgMuted,
                        borderRadius: tokens.radius.md,
                        padding: 2,
                    }}
                >
                    <button
                        onClick={() => setDensity(listId, "compact")}
                        title="Compact cards"
                        style={densityBtnStyle(density === "compact")}
                    >
                        <Rows3 size={13} strokeWidth={1.75} />
                    </button>
                    <button
                        onClick={() => setDensity(listId, "comfortable")}
                        title="Comfortable cards"
                        style={densityBtnStyle(density === "comfortable")}
                    >
                        <LayoutGrid size={13} strokeWidth={1.75} />
                    </button>
                </div>

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
                    placeholder="Search this board..."
                    prefix={
                        <Search
                            size={13}
                            strokeWidth={1.75}
                            color={tokens.colors.textMuted}
                        />
                    }
                    size="small"
                    style={{ width: 220 }}
                    allowClear
                />
            </div>
        </div>
    );
};

const densityBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 8px",
    background: active ? tokens.colors.bgSurface : "transparent",
    border: 0,
    borderRadius: tokens.radius.sm,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    color: active ? tokens.colors.textPrimary : tokens.colors.textMuted,
    boxShadow: active ? tokens.shadows.sm : "none",
    transition: "all var(--transition-base)",
});
