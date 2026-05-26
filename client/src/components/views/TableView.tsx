import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnSizingState,
} from "@tanstack/react-table";
import { Button, Input, App as AntApp } from "antd";
import {
    Search,
    UserCheck,
    Eye,
    EyeOff,
    Download,
    Table2,
    Group as GroupIcon,
    ChevronRight,
} from "lucide-react";
import { Dropdown } from "antd";
import { mockApi } from "../../lib/mock-api";
import { useAuthStore } from "../../stores/auth";
import { useUpdateTask } from "../../hooks/useTaskMutations";
import { statusesById } from "../../mocks/statuses";
import { usersById } from "../../mocks/users";
import { tagsById } from "../../mocks/tags";
import { InlineNameEdit } from "../task/InlineNameEdit";
import { InlineStatusEdit } from "../task/InlineStatusEdit";
import { InlinePriorityEdit } from "../task/InlinePriorityEdit";
import { InlineAssigneeEdit } from "../task/InlineAssigneeEdit";
import { InlineDateEdit } from "../task/InlineDateEdit";
import { TagChip } from "../ui/TagChip";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../shared/LoadingState";
import { tokens } from "../../theme";
import type { Task } from "../../types";

interface TableViewProps {
    listId: string;
}

const COL_NAME_WIDTH = 320;

type GroupBy = "none" | "status" | "priority" | "assignee";

export const TableView = ({ listId }: TableViewProps) => {
    const user = useAuthStore((s) => s.user);
    const [, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [meMode, setMeMode] = useState(false);
    const [showClosedTasks, setShowClosedTasks] = useState(false);
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
    const [groupBy, setGroupBy] = useState<GroupBy>("none");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        new Set(),
    );
    const { message } = AntApp.useApp();

    const toggleGroup = (key: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const update = useUpdateTask(listId);

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: ["tasks-by-list", listId],
        queryFn: () => mockApi.tasks.listByList(listId),
    });

    const filtered = useMemo(() => {
        let r = tasks;
        if (!showClosedTasks) {
            r = r.filter((t) => {
                const s = statusesById.get(t.statusId);
                return s?.statusGroup !== "closed";
            });
        }
        if (meMode && user) r = r.filter((t) => t.assignees.includes(user.id));
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.customId?.toLowerCase().includes(q),
            );
        }
        return r;
    }, [tasks, showClosedTasks, meMode, search, user]);

    // Build columns dynamically based on what the tasks have
    const columns = useMemo<ColumnDef<Task>[]>(() => {
        const sampleTask = tasks[0];
        const customFieldKeys = sampleTask
            ? Object.keys(sampleTask.customFields ?? {})
            : [];

        const cols: ColumnDef<Task>[] = [
            {
                id: "customId",
                header: "ID",
                size: 90,
                cell: ({ row }) => (
                    <span
                        style={{
                            fontFamily: tokens.typography.fontFamilyMono,
                            fontSize: 11,
                            color: tokens.colors.textMuted,
                        }}
                    >
                        {row.original.customId ?? `T-${row.original.taskNumber}`}
                    </span>
                ),
            },
            {
                id: "priority",
                header: "P",
                size: 40,
                cell: ({ row }) => (
                    <InlinePriorityEdit
                        priority={row.original.priority}
                        onChange={(p) =>
                            update.mutate({
                                id: row.original.id,
                                patch: { priority: p },
                            })
                        }
                    />
                ),
            },
            {
                id: "name",
                header: "Task name",
                size: COL_NAME_WIDTH,
                cell: ({ row }) => (
                    <InlineNameEdit
                        value={row.original.name}
                        onSave={(name) =>
                            update.mutate({
                                id: row.original.id,
                                patch: { name },
                            })
                        }
                    />
                ),
            },
            {
                id: "status",
                header: "Status",
                size: 160,
                cell: ({ row }) => (
                    <InlineStatusEdit
                        listId={row.original.primaryListId}
                        statusId={row.original.statusId}
                        onChange={(statusId) =>
                            update.mutate({
                                id: row.original.id,
                                patch: { statusId },
                            })
                        }
                    />
                ),
            },
            {
                id: "assignees",
                header: "Assignees",
                size: 140,
                cell: ({ row }) => (
                    <InlineAssigneeEdit
                        assigneeIds={row.original.assignees}
                        onChange={(assignees) =>
                            update.mutate({
                                id: row.original.id,
                                patch: { assignees },
                            })
                        }
                    />
                ),
            },
            {
                id: "dueDate",
                header: "Due date",
                size: 140,
                cell: ({ row }) => (
                    <InlineDateEdit
                        date={row.original.dueDate}
                        onChange={(d) =>
                            update.mutate({
                                id: row.original.id,
                                patch: { dueDate: d },
                            })
                        }
                    />
                ),
            },
            {
                id: "tags",
                header: "Tags",
                size: 200,
                cell: ({ row }) => {
                    const tagObjs = row.original.tags
                        .map((id) => tagsById.get(id))
                        .filter((t): t is NonNullable<typeof t> => !!t);
                    return tagObjs.length === 0 ? (
                        <span
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                            }}
                        >
                            —
                        </span>
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                gap: 3,
                                flexWrap: "wrap",
                            }}
                        >
                            {tagObjs.slice(0, 3).map((t) => (
                                <TagChip key={t.id} tag={t} size="sm" />
                            ))}
                            {tagObjs.length > 3 && (
                                <span
                                    style={{
                                        fontSize: 10,
                                        color: tokens.colors.textMuted,
                                    }}
                                >
                                    +{tagObjs.length - 3}
                                </span>
                            )}
                        </div>
                    );
                },
            },
        ];

        // Add custom field columns dynamically
        for (const key of customFieldKeys) {
            const label = key
                .replace(/^cf_/, "")
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());

            cols.push({
                id: key,
                header: label,
                size: 140,
                cell: ({ row }) => {
                    const val = row.original.customFields[key];
                    return (
                        <span
                            style={{
                                fontSize: tokens.typography.fontSize.sm,
                                color: tokens.colors.textPrimary,
                            }}
                        >
                            {renderCustomFieldValue(val)}
                        </span>
                    );
                },
            });
        }

        return cols;
    }, [tasks, update]);

    const table = useReactTable({
        data: filtered,
        columns,
        state: { columnSizing },
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        columnResizeMode: "onChange",
        defaultColumn: {
            minSize: 60,
            maxSize: 600,
        },
    });

    const handleExportCsv = () => {
        if (filtered.length === 0) {
            message.warning("No tasks to export");
            return;
        }
        const cols = table.getAllColumns();
        const header = cols.map((c) => {
            const headerVal = c.columnDef.header;
            return typeof headerVal === "string" ? headerVal : c.id;
        });
        const rows = filtered.map((t) => [
            t.customId ?? `T-${t.taskNumber}`,
            String(t.priority),
            t.name,
            statusesById.get(t.statusId)?.name ?? "",
            t.assignees
                .map((id) => {
                    const u = usersById.get(id);
                    return u ? `${u.firstName} ${u.lastName}` : "";
                })
                .join("; "),
            t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "",
            t.tags.map((id) => tagsById.get(id)?.name ?? "").join("; "),
            ...Object.values(t.customFields).map((v) => renderCustomFieldValue(v)),
        ]);

        const csv = [
            header.map(csvEscape).join(","),
            ...rows.map((row) => row.map(csvEscape).join(",")),
        ].join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `tasks-${listId}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        message.success(`Exported ${filtered.length} tasks to CSV`);
    };

    // Footer calculations
    const calculations = useMemo(() => {
        const moneyKeys = Object.keys(
            tasks[0]?.customFields ?? {},
        ).filter((k) => k.startsWith("cf_") && k.includes("amount"));
        const sums: Record<string, number> = {};
        for (const key of moneyKeys) {
            sums[key] = filtered.reduce((acc, t) => {
                const v = t.customFields[key] as
                    | { amount?: number }
                    | undefined;
                return acc + (v?.amount ?? 0);
            }, 0);
        }
        return { count: filtered.length, sums };
    }, [filtered, tasks]);

    return (
        <>
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
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "none", label: "No grouping" },
                            { type: "divider" as const },
                            { key: "status", label: "Status" },
                            { key: "priority", label: "Priority" },
                            { key: "assignee", label: "Assignee" },
                        ],
                        selectable: true,
                        selectedKeys: [groupBy],
                        onClick: (e) => setGroupBy(e.key as GroupBy),
                    }}
                >
                    <Button
                        type={groupBy !== "none" ? "primary" : "text"}
                        size="small"
                        icon={<GroupIcon size={13} strokeWidth={1.75} />}
                    >
                        Group:{" "}
                        <span style={{ marginLeft: 2, fontWeight: 500 }}>
                            {groupBy === "none"
                                ? "None"
                                : groupBy.charAt(0).toUpperCase() +
                                  groupBy.slice(1)}
                        </span>
                    </Button>
                </Dropdown>

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
                    onClick={() => setShowClosedTasks(!showClosedTasks)}
                >
                    {showClosedTasks ? "Hide closed" : "Show closed"}
                </Button>

                <Button
                    type={meMode ? "primary" : "text"}
                    size="small"
                    icon={<UserCheck size={13} strokeWidth={1.75} />}
                    onClick={() => setMeMode(!meMode)}
                >
                    Me Mode
                </Button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <Button
                        type="text"
                        size="small"
                        icon={<Download size={13} strokeWidth={1.75} />}
                        onClick={handleExportCsv}
                    >
                        Export CSV
                    </Button>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search..."
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

            {isLoading ? (
                <LoadingState />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={Table2}
                    title="No tasks to show"
                    description="Adjust filters or add tasks to populate the table."
                />
            ) : (
                <div
                    style={{
                        flex: 1,
                        overflow: "auto",
                        margin: tokens.spacing[5],
                        marginTop: tokens.spacing[3],
                        border: `1px solid ${tokens.colors.border}`,
                        borderRadius: tokens.radius.lg,
                        background: tokens.colors.bgSurface,
                    }}
                >
                    <table
                        style={{
                            borderCollapse: "separate",
                            borderSpacing: 0,
                            width: table.getTotalSize(),
                            tableLayout: "fixed",
                        }}
                    >
                        <thead
                            style={{
                                position: "sticky",
                                top: 0,
                                zIndex: 3,
                                background: tokens.colors.bgPage,
                            }}
                        >
                            {table.getHeaderGroups().map((hg) => (
                                <tr key={hg.id}>
                                    {hg.headers.map((header) => {
                                        const isNameCol = header.column.id === "name";
                                        return (
                                            <th
                                                key={header.id}
                                                style={{
                                                    position: "relative",
                                                    width: header.getSize(),
                                                    padding: "8px 12px",
                                                    textAlign: "left",
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    color: tokens.colors.textMuted,
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.05em",
                                                    borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                                                    borderBottom: `1px solid ${tokens.colors.border}`,
                                                    background:
                                                        tokens.colors.bgPage,
                                                    ...(isNameCol
                                                        ? {
                                                              position: "sticky",
                                                              left: 0,
                                                              zIndex: 4,
                                                          }
                                                        : {}),
                                                }}
                                            >
                                                {flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext(),
                                                )}
                                                {header.column.getCanResize() && (
                                                    <div
                                                        onMouseDown={header.getResizeHandler()}
                                                        onTouchStart={header.getResizeHandler()}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            right: 0,
                                                            width: 5,
                                                            height: "100%",
                                                            cursor: "col-resize",
                                                            userSelect: "none",
                                                            touchAction: "none",
                                                            background:
                                                                header.column.getIsResizing()
                                                                    ? tokens.colors.primary
                                                                    : "transparent",
                                                        }}
                                                    />
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {renderGroupedRows({
                                rows: table.getRowModel().rows,
                                groupBy,
                                collapsedGroups,
                                toggleGroup,
                                totalColumns: table.getAllColumns().length,
                                onSelect: (taskId) =>
                                    setSearchParams((prev) => {
                                        const next = new URLSearchParams(prev);
                                        next.set("task", taskId);
                                        return next;
                                    }),
                            })}
                        </tbody>
                        <tfoot
                            style={{
                                position: "sticky",
                                bottom: 0,
                                zIndex: 2,
                                background: tokens.colors.bgPage,
                            }}
                        >
                            <tr>
                                {table.getAllColumns().map((col, idx) => (
                                    <td
                                        key={col.id}
                                        style={{
                                            width: col.getSize(),
                                            padding: "8px 12px",
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: tokens.colors.textSecondary,
                                            borderTop: `1px solid ${tokens.colors.border}`,
                                            borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                                            background: tokens.colors.bgPage,
                                            fontFamily:
                                                tokens.typography.fontFamilyMono,
                                            ...(idx === 0
                                                ? { position: "sticky", left: 0, zIndex: 3 }
                                                : {}),
                                        }}
                                    >
                                        {idx === 0
                                            ? `${calculations.count} tasks`
                                            : col.id.includes("amount")
                                              ? `৳ ${(
                                                    (calculations.sums[col.id] ??
                                                        0) / 100
                                                ).toLocaleString()}`
                                              : ""}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </>
    );
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const renderCustomFieldValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val !== "object") return String(val);
    const v = val as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (typeof v.number === "number") return String(v.number);
    if (typeof v.amount === "number" && typeof v.currency === "string")
        return `${v.currency === "BDT" ? "৳" : v.currency} ${(v.amount / 100).toLocaleString()}`;
    if (typeof v.option_id === "string") return v.option_id;
    if (typeof v.date === "string") return new Date(v.date).toLocaleDateString();
    if (typeof v.checked === "boolean") return v.checked ? "✓" : "—";
    return JSON.stringify(val);
};

const csvEscape = (val: string): string => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
};

interface RowLike {
    id: string;
    original: Task;
    getVisibleCells: () => Array<{
        id: string;
        column: {
            id: string;
            columnDef: { cell?: unknown };
            getSize: () => number;
        };
        getContext: () => unknown;
    }>;
}

/**
 * Render either a flat list of rows or rows grouped under collapsible headers.
 * Returns React elements directly (tr-level) — caller wraps in tbody.
 */
const renderGroupedRows = ({
    rows,
    groupBy,
    collapsedGroups,
    toggleGroup,
    totalColumns,
    onSelect,
}: {
    rows: RowLike[];
    groupBy: GroupBy;
    collapsedGroups: Set<string>;
    toggleGroup: (key: string) => void;
    totalColumns: number;
    onSelect: (taskId: string) => void;
}): React.ReactNode => {
    if (groupBy === "none") {
        return rows.map((row, idx) => (
            <DataRow
                key={row.id}
                row={row}
                rowIdx={idx}
                onSelect={onSelect}
            />
        ));
    }

    const groups = new Map<
        string,
        { label: string; color: string; tasks: RowLike[] }
    >();

    rows.forEach((row) => {
        const { key, label, color } = groupOf(row.original, groupBy);
        const g = groups.get(key);
        if (g) g.tasks.push(row);
        else groups.set(key, { label, color, tasks: [row] });
    });

    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
        a.localeCompare(b),
    );

    const out: React.ReactNode[] = [];
    sorted.forEach(([key, { label, color, tasks: groupRows }]) => {
        const isCollapsed = collapsedGroups.has(key);
        out.push(
            <tr
                key={`group-${key}`}
                onClick={() => toggleGroup(key)}
                style={{
                    cursor: "pointer",
                    background: tokens.colors.bgMuted,
                    borderBottom: `1px solid ${tokens.colors.border}`,
                }}
            >
                <td
                    colSpan={totalColumns}
                    style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: tokens.colors.textPrimary,
                        position: "sticky",
                        left: 0,
                    }}
                >
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <ChevronRight
                            size={12}
                            strokeWidth={2}
                            style={{
                                transition:
                                    "transform var(--transition-base)",
                                transform: isCollapsed
                                    ? "rotate(0deg)"
                                    : "rotate(90deg)",
                                color: tokens.colors.textMuted,
                            }}
                        />
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: color,
                            }}
                        />
                        <span>{label}</span>
                        <span
                            style={{
                                fontSize: 11,
                                color: tokens.colors.textMuted,
                                fontFamily:
                                    tokens.typography.fontFamilyMono,
                                fontWeight: 500,
                            }}
                        >
                            {groupRows.length}
                        </span>
                    </span>
                </td>
            </tr>,
        );
        if (!isCollapsed) {
            groupRows.forEach((row, idx) => {
                out.push(
                    <DataRow
                        key={row.id}
                        row={row}
                        rowIdx={idx}
                        onSelect={onSelect}
                    />,
                );
            });
        }
    });
    return out;
};

const groupOf = (
    task: Task,
    groupBy: GroupBy,
): { key: string; label: string; color: string } => {
    if (groupBy === "status") {
        const s = statusesById.get(task.statusId);
        return {
            key: s?.id ?? "unknown",
            label: s?.name ?? "Unknown status",
            color: s?.color ?? "#94A3B8",
        };
    }
    if (groupBy === "priority") {
        const colors: Record<number, string> = {
            0: "#94A3B8",
            1: "#E11D48",
            2: "#F59E0B",
            3: "#3B82F6",
            4: "#10B981",
        };
        const labels: Record<number, string> = {
            0: "No priority",
            1: "Urgent",
            2: "High",
            3: "Normal",
            4: "Low",
        };
        return {
            key: String(task.priority),
            label: labels[task.priority] ?? "Unknown",
            color: colors[task.priority] ?? "#94A3B8",
        };
    }
    // assignee
    const first = task.assignees[0];
    if (!first) {
        return { key: "_unassigned", label: "Unassigned", color: "#94A3B8" };
    }
    const u = usersById.get(first);
    return {
        key: first,
        label: u ? `${u.firstName} ${u.lastName}` : first,
        color: "#4F46E5",
    };
};

const DataRow = ({
    row,
    rowIdx,
    onSelect,
}: {
    row: RowLike;
    rowIdx: number;
    onSelect: (id: string) => void;
}) => (
    <tr
        onClick={() => onSelect(row.original.id)}
        style={{
            background:
                rowIdx % 2 === 0
                    ? tokens.colors.bgSurface
                    : tokens.colors.bgPage,
            cursor: "pointer",
        }}
        onMouseEnter={(e) =>
            (e.currentTarget.style.background = tokens.colors.bgHover)
        }
        onMouseLeave={(e) =>
            (e.currentTarget.style.background =
                rowIdx % 2 === 0
                    ? tokens.colors.bgSurface
                    : tokens.colors.bgPage)
        }
    >
        {row.getVisibleCells().map((cell) => {
            const isNameCol = cell.column.id === "name";
            return (
                <td
                    key={cell.id}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        width: cell.column.getSize(),
                        padding: "6px 12px",
                        fontSize: tokens.typography.fontSize.sm,
                        color: tokens.colors.textPrimary,
                        borderRight: `1px solid ${tokens.colors.borderSubtle}`,
                        borderBottom: `1px solid ${tokens.colors.borderSubtle}`,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        ...(isNameCol
                            ? {
                                  position: "sticky",
                                  left: 0,
                                  background:
                                      rowIdx % 2 === 0
                                          ? tokens.colors.bgSurface
                                          : tokens.colors.bgPage,
                                  zIndex: 2,
                              }
                            : {}),
                    }}
                >
                    {flexRender(
                        cell.column.columnDef.cell as never,
                        cell.getContext() as never,
                    )}
                </td>
            );
        })}
    </tr>
);
