import { Button, Input, Dropdown, Popover, Switch } from "antd";
import {
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
import { TaskFilterPopover, type StatusOption } from "./TaskFilterPopover";
import type { TaskFilterState } from "./taskFilters";

export type GroupBy = "status" | "assignee" | "priority" | "task_type" | "none";

export type SortKey =
    | "default"
    | "name"
    | "priority"
    | "due_date"
    | "created_at"
    | "updated_at";

interface ListViewToolbarProps {
    groupBy: GroupBy;
    onGroupByChange: (g: GroupBy) => void;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
    showArchived: boolean;
    onShowArchivedChange: (v: boolean) => void;
    sortBy: SortKey;
    onSortByChange: (s: SortKey) => void;
    sortDir: "asc" | "desc";
    onSortDirChange: (d: "asc" | "desc") => void;
    filters: TaskFilterState;
    onFiltersChange: (f: TaskFilterState) => void;
    statusOptions: StatusOption[];
    weekStartsOn?: number;
}

const SORT_LABELS: Record<SortKey, string> = {
    default: "Default order",
    name: "Name",
    priority: "Priority",
    due_date: "Due date",
    created_at: "Created",
    updated_at: "Updated",
};

export const ListViewToolbar = ({
    groupBy,
    onGroupByChange,
    search,
    onSearchChange,
    meMode,
    onMeModeChange,
    showClosedTasks,
    onShowClosedChange,
    showArchived,
    onShowArchivedChange,
    sortBy,
    onSortByChange,
    sortDir,
    onSortDirChange,
    filters,
    onFiltersChange,
    statusOptions,
    weekStartsOn,
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

    const sortItems = [
        { key: "default", label: SORT_LABELS.default },
        { type: "divider" as const },
        { key: "name", label: SORT_LABELS.name },
        { key: "priority", label: SORT_LABELS.priority },
        { key: "due_date", label: SORT_LABELS.due_date },
        { key: "created_at", label: SORT_LABELS.created_at },
        { key: "updated_at", label: SORT_LABELS.updated_at },
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
                        {groupBy === "none"
                            ? "None"
                            : groupItems.find(
                                  (i) => "key" in i && i.key === groupBy,
                              )?.label ?? "Status"}
                    </span>
                </Button>
            </Dropdown>

            <TaskFilterPopover
                filters={filters}
                onChange={onFiltersChange}
                statusOptions={statusOptions}
                weekStartsOn={weekStartsOn}
                extraActiveCount={meMode ? 1 : 0}
                onClearExtras={() => onMeModeChange(false)}
            />

            <Dropdown
                menu={{
                    items: sortItems,
                    onClick: (e) => onSortByChange(e.key as SortKey),
                    selectable: true,
                    selectedKeys: [sortBy],
                }}
                trigger={["click"]}
            >
                <Button
                    type={sortBy !== "default" ? "primary" : "text"}
                    size="small"
                    icon={<ArrowUpDown size={13} strokeWidth={1.75} />}
                >
                    Sort:{" "}
                    <span style={{ fontWeight: 500, marginLeft: 2 }}>
                        {SORT_LABELS[sortBy]}
                    </span>
                </Button>
            </Dropdown>
            {sortBy !== "default" && (
                <Button
                    type="text"
                    size="small"
                    onClick={() =>
                        onSortDirChange(sortDir === "asc" ? "desc" : "asc")
                    }
                    title={sortDir === "asc" ? "Ascending" : "Descending"}
                    style={{ fontFamily: tokens.typography.fontFamilyMono }}
                >
                    {sortDir === "asc" ? "↑" : "↓"}
                </Button>
            )}

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

                {/*
                 * This button had no `onClick` at all — it rendered, looked
                 * enabled, and did nothing, which is how it was reported. It
                 * now opens the one view setting that had nowhere to live:
                 * archived tasks were invisible everywhere in this client,
                 * even though the API has always accepted `include_archived`.
                 */}
                <Popover
                    trigger="click"
                    placement="bottomRight"
                    content={
                        <div style={{ width: 260 }}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 500 }}>
                                        Show archived tasks
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            color: tokens.colors.textMuted,
                                            marginTop: 2,
                                        }}
                                    >
                                        Archived tasks are hidden by default.
                                        Open one to restore it.
                                    </div>
                                </div>
                                <Switch
                                    size="small"
                                    checked={showArchived}
                                    onChange={onShowArchivedChange}
                                    aria-label="Show archived tasks"
                                />
                            </div>
                        </div>
                    }
                >
                    <Button
                        type={showArchived ? "primary" : "text"}
                        size="small"
                        icon={<Settings2 size={13} strokeWidth={1.75} />}
                        title="View settings"
                        aria-label="View settings"
                    />
                </Popover>
            </div>
        </div>
    );
};

