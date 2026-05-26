import { Dropdown, Popconfirm } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ChevronDown,
    Flag,
    UserCircle,
    Tag as TagIcon,
    Calendar,
    Archive,
    Trash2,
    X,
} from "lucide-react";
import { mockApi } from "../../lib/mock-api";
import { PRIORITY_LABELS, type Priority } from "../../types";
import { useBulkUpdateTasks } from "../../hooks/useTaskMutations";
import { PriorityFlag } from "../ui/PriorityFlag";
import { StatusPill } from "../ui/StatusPill";
import { tokens } from "../../theme";

interface BulkActionToolbarProps {
    listId: string;
    selectedIds: string[];
    onClear: () => void;
}

export const BulkActionToolbar = ({
    listId,
    selectedIds,
    onClear,
}: BulkActionToolbarProps) => {
    const bulkUpdate = useBulkUpdateTasks(listId);
    const qc = useQueryClient();
    const { data: statuses = [] } = useQuery({
        queryKey: ["statuses", listId],
        queryFn: () => mockApi.statuses.byList(listId),
    });

    const handleBulkStatus = (statusId: string) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { statusId } });
        onClear();
    };
    const handleBulkPriority = (priority: Priority) => {
        bulkUpdate.mutate({ ids: selectedIds, patch: { priority } });
        onClear();
    };

    const statusMenu = {
        items: statuses.map((s) => ({
            key: s.id,
            label: <StatusPill status={s} variant="subtle" size="sm" />,
            onClick: () => handleBulkStatus(s.id),
        })),
    };

    const priorityMenu = {
        items: ([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
            key: String(p),
            label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <PriorityFlag priority={p} size={12} />
                    {PRIORITY_LABELS[p]}
                </span>
            ),
            onClick: () => handleBulkPriority(p),
        })),
    };

    return (
        <div
            style={{
                position: "fixed",
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
                background: tokens.colors.textPrimary,
                color: "#FFFFFF",
                borderRadius: tokens.radius.lg,
                boxShadow: tokens.shadows.lg,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: tokens.zIndex.toast,
                animation: "slideUp var(--transition-slow)",
            }}
        >
            <span
                style={{
                    fontSize: tokens.typography.fontSize.sm,
                    fontWeight: 600,
                    padding: "0 6px",
                    color: "#FFFFFF",
                    fontFamily: tokens.typography.fontFamilyMono,
                }}
            >
                {selectedIds.length} selected
            </span>

            <div
                style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.2)",
                }}
            />

            <Dropdown menu={statusMenu} trigger={["click"]} placement="top">
                <button
                    style={btnStyle}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    Status
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <Dropdown menu={priorityMenu} trigger={["click"]} placement="top">
                <button
                    style={btnStyle}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <Flag size={12} strokeWidth={1.75} /> Priority
                    <ChevronDown size={12} strokeWidth={2} />
                </button>
            </Dropdown>

            <button style={btnStyle} disabled title="Coming in Phase 7">
                <UserCircle size={12} strokeWidth={1.75} /> Assign
            </button>
            <button style={btnStyle} disabled title="Coming in Phase 7">
                <TagIcon size={12} strokeWidth={1.75} /> Tag
            </button>
            <button style={btnStyle} disabled title="Coming in Phase 7">
                <Calendar size={12} strokeWidth={1.75} /> Date
            </button>

            <div
                style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.2)",
                }}
            />

            <Popconfirm
                title="Archive selected tasks?"
                onConfirm={async () => {
                    await Promise.all(
                        selectedIds.map((id) => mockApi.tasks.archive(id)),
                    );
                    qc.invalidateQueries({
                        queryKey: ["tasks-by-list", listId],
                    });
                    onClear();
                }}
            >
                <button
                    style={btnStyle}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <Archive size={12} strokeWidth={1.75} /> Archive
                </button>
            </Popconfirm>

            <Popconfirm
                title="Delete selected tasks? This cannot be undone."
                okType="danger"
                onConfirm={async () => {
                    await Promise.all(
                        selectedIds.map((id) => mockApi.tasks.delete(id)),
                    );
                    qc.invalidateQueries({
                        queryKey: ["tasks-by-list", listId],
                    });
                    onClear();
                }}
            >
                <button
                    style={{ ...btnStyle, color: "#FCA5A5" }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(239,68,68,0.15)")
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    <Trash2 size={12} strokeWidth={1.75} /> Delete
                </button>
            </Popconfirm>

            <div
                style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.2)",
                }}
            />

            <button
                onClick={onClear}
                style={{ ...btnStyle, opacity: 0.7 }}
                title="Clear selection (Esc)"
                onMouseEnter={(e) =>
                    (e.currentTarget.style.opacity = "1")
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.opacity = "0.7")
                }
            >
                <X size={14} strokeWidth={1.75} />
            </button>
        </div>
    );
};

const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: 0,
    padding: "6px 10px",
    borderRadius: tokens.radius.md,
    color: "#FFFFFF",
    fontSize: tokens.typography.fontSize.sm,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background var(--transition-base)",
};
