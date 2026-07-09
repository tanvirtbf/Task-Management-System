import { Button, Input, Dropdown, Popover, Select } from "antd";
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
import { useUsers } from "../../hooks/useReferenceData";
import { tokens } from "../../theme";
import { PRIORITY_LABELS, type Priority } from "../../types";

export type GroupBy = "status" | "assignee" | "priority" | "task_type" | "none";

export type SortKey =
    | "default"
    | "name"
    | "priority"
    | "due_date"
    | "created_at"
    | "updated_at";

export interface FilterState {
    priorities: Priority[];
    assigneeIds: string[];
}

interface ListViewToolbarProps {
    groupBy: GroupBy;
    onGroupByChange: (g: GroupBy) => void;
    search: string;
    onSearchChange: (s: string) => void;
    meMode: boolean;
    onMeModeChange: (v: boolean) => void;
    showClosedTasks: boolean;
    onShowClosedChange: (v: boolean) => void;
    sortBy: SortKey;
    onSortByChange: (s: SortKey) => void;
    sortDir: "asc" | "desc";
    onSortDirChange: (d: "asc" | "desc") => void;
    filters: FilterState;
    onFiltersChange: (f: FilterState) => void;
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
    sortBy,
    onSortByChange,
    sortDir,
    onSortDirChange,
    filters,
    onFiltersChange,
}: ListViewToolbarProps) => {
    const user = useAuthStore((s) => s.user);
    const { data: allUsers = [] } = useUsers();

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

    const activeFilterCount =
        (meMode ? 1 : 0) +
        (filters.priorities.length > 0 ? 1 : 0) +
        (filters.assigneeIds.length > 0 ? 1 : 0);

    const filterContent = (
        <div
            style={{
                width: 260,
                display: "flex",
                flexDirection: "column",
                gap: 10,
            }}
        >
            <div>
                <Label>Priority</Label>
                <Select
                    mode="multiple"
                    value={filters.priorities}
                    onChange={(v) =>
                        onFiltersChange({ ...filters, priorities: v })
                    }
                    placeholder="Any priority"
                    style={{ width: "100%" }}
                    size="small"
                    options={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
                        value: p,
                        label: PRIORITY_LABELS[p],
                    }))}
                />
            </div>
            <div>
                <Label>Assignee</Label>
                <Select
                    mode="multiple"
                    value={filters.assigneeIds}
                    onChange={(v) =>
                        onFiltersChange({ ...filters, assigneeIds: v })
                    }
                    placeholder="Anyone"
                    style={{ width: "100%" }}
                    size="small"
                    showSearch
                    optionFilterProp="label"
                    options={allUsers
                        .filter((u) => u.status === "active")
                        .map((u) => ({
                            value: u.id,
                            label: `${u.firstName} ${u.lastName}`,
                        }))}
                />
            </div>
            {activeFilterCount > 0 && (
                <Button
                    size="small"
                    type="link"
                    style={{ alignSelf: "flex-start", padding: 0 }}
                    onClick={() => {
                        onFiltersChange({
                            priorities: [],
                            assigneeIds: [],
                        });
                        onMeModeChange(false);
                    }}
                >
                    Clear all filters
                </Button>
            )}
        </div>
    );

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

            <Popover
                content={filterContent}
                trigger="click"
                placement="bottomLeft"
                title="Filters"
            >
                <Button
                    type={activeFilterCount > 0 ? "primary" : "text"}
                    size="small"
                    icon={<ListFilter size={13} strokeWidth={1.75} />}
                >
                    Filter
                    {activeFilterCount > 0 && (
                        <span
                            style={{
                                background:
                                    activeFilterCount > 0
                                        ? "rgba(255,255,255,0.25)"
                                        : tokens.colors.primary,
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
            </Popover>

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

                <Button
                    type="text"
                    size="small"
                    icon={<Settings2 size={13} strokeWidth={1.75} />}
                    title="View settings"
                    aria-label="View settings"
                />
            </div>
        </div>
    );
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <label
        style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            color: tokens.colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
        }}
    >
        {children}
    </label>
);
