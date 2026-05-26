import { Button, Input, Dropdown } from "antd";
import {
    ListFilter,
    ArrowUpDown,
    Group as GroupIcon,
    Search,
    UserCheck,
    Settings2,
    Eye,
    EyeOff,
} from "lucide-react";
import { useAuthStore } from "../../stores/auth";
import { tokens } from "../../theme";

export type GroupBy = "status" | "assignee" | "priority" | "task_type" | "none";

interface ListViewToolbarProps {
    groupBy: GroupBy;
    onGroupByChange: (g: GroupBy) => void;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
    activeFilterCount: number;
}

export const ListViewToolbar = ({
    groupBy,
    onGroupByChange,
    search,
    onSearchChange,
    meMode,
    onMeModeChange,
    showClosedTasks,
    onShowClosedChange,
    activeFilterCount,
}: ListViewToolbarProps) => {
    const user = useAuthStore((s) => s.user);

    const groupItems = [
        { key: "status", label: "Status" },
        { key: "assignee", label: "Assignee" },
        { key: "priority", label: "Priority" },
        { key: "task_type", label: "Task Type" },
        { type: "divider" as const },
        { key: "none", label: "None (flat list)" },
    ];

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
            {/* Left controls */}
            <Dropdown
                menu={{
                    items: groupItems,
                    onClick: (e) => onGroupByChange(e.key as GroupBy),
                    selectable: true,
                    selectedKeys: [groupBy],
                }}
                trigger={["click"]}
            >
                <Button
                    type="text"
                    size="small"
                    icon={<GroupIcon size={13} strokeWidth={1.75} />}
                >
                    Group:{" "}
                    <span style={{ fontWeight: 500, marginLeft: 2 }}>
                        {groupBy === "none" ? "None" : groupItems.find(
                            (i) => "key" in i && i.key === groupBy,
                        )?.label ?? "Status"}
                    </span>
                </Button>
            </Dropdown>

            <Button
                type="text"
                size="small"
                icon={<ListFilter size={13} strokeWidth={1.75} />}
            >
                Filter
                {activeFilterCount > 0 && (
                    <span
                        style={{
                            background: tokens.colors.primary,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 5px",
                            borderRadius: 9,
                            marginLeft: 4,
                            fontFamily: tokens.typography.fontFamilyMono,
                        }}
                    >
                        {activeFilterCount}
                    </span>
                )}
            </Button>

            <Button
                type="text"
                size="small"
                icon={<ArrowUpDown size={13} strokeWidth={1.75} />}
            >
                Sort
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

            {/* Right controls */}
            <div
                style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                <Button
                    type={meMode ? "primary" : "text"}
                    size="small"
                    icon={<UserCheck size={13} strokeWidth={1.75} />}
                    onClick={() => onMeModeChange(!meMode)}
                    title={user ? `${user.firstName}'s view` : ""}
                >
                    Me Mode
                </Button>

                <Input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search in this list..."
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

                <Button
                    type="text"
                    size="small"
                    icon={<Settings2 size={13} strokeWidth={1.75} />}
                    title="View settings"
                />
            </div>
        </div>
    );
};
